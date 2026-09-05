/**
 * DATABASE LAYER — Supabase
 * Full CRUD + Realtime + Debug logging
 */
import { supabase } from './supabase'
import type { ListingData } from '@/types'
import { parseOwnListingImagePath } from './listingImagePath'
import { MIGRATION_B_LIVE } from './featureFlags'
import { buildCursorFilter, type PendingReviewCursor } from './pendingReviewCursor'

export function isSupabaseReady(): boolean {
  const ready = !!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
  if (!ready) console.warn('[db] Supabase not configured! Check env vars.')
  return ready
}

// ── LISTINGS ──────────────────────────────────────────────────

// `onError` is optional and additive — existing callers that don't pass it
// keep the exact same behavior (swallow the error, return []). Callers that
// want to distinguish "genuinely empty" from "fetch failed" (spec §25: "an
// API error is not an empty result") can opt in without any signature break.
export async function dbGetListings(opts?: { onError?: () => void }): Promise<ListingData[]> {
  if (!isSupabaseReady()) return []
  try {
    // NO is_active filter — get ALL listings, let frontend filter
    // This fixes the issue where is_active might be null in DB
    const { data, error, status, statusText } = await supabase
      .from('listings')
      .select('*')
      .order('created_at', { ascending: false })

    console.log(`[dbGetListings] status=${status} count=${data?.length ?? 0} error=${error?.message || 'none'}`)

    if (error) {
      console.error('[dbGetListings] ERROR:', error.message, error.code)
      opts?.onError?.()
      return []
    }

    const listings = (data || []).map(rowToListing)
    console.log('[dbGetListings] IDs:', listings.map(l => l.id).join(', '))
    return listings
  } catch (e: any) {
    console.error('[dbGetListings] CATCH:', e?.message)
    opts?.onError?.()
    return []
  }
}

// ── STORAGE (listing photos) ───────────────────────────────────
// Photos are uploaded as real files to a Storage bucket and only the
// resulting short public URL is stored in listings.images. Previously the
// app stored full base64-encoded photos directly in that column, which:
//  - made every publish take ~20s (multi-MB text payload per photo)
//  - made every feed load slow (every listing row carries its full photos)
//  - could outright fail ("Помилка збереження") once the base64 payload
//    crossed the API gateway's request-size limit
// This bucket must exist and be public — see MIGRATION NOTE at bottom of
// this file for the one-time setup SQL if it hasn't been created yet.
const LISTING_IMAGES_BUCKET = 'listing-images'

export async function dbUploadListingImage(file: File, userId: string): Promise<string | null> {
  if (!isSupabaseReady()) return null
  try {
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg'
    const path = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
    const { error } = await supabase.storage
      .from(LISTING_IMAGES_BUCKET)
      .upload(path, file, { cacheControl: '3600', upsert: false, contentType: file.type || 'image/jpeg' })
    if (error) { console.error('[dbUploadListingImage]', error.message); return null }
    const { data } = supabase.storage.from(LISTING_IMAGES_BUCKET).getPublicUrl(path)
    return data.publicUrl
  } catch (e: any) {
    console.error('[dbUploadListingImage] CATCH:', e?.message)
    return null
  }
}

// Inverse of dbUploadListingImage — used when the wizard removes a photo
// the user already uploaded (before submit) and when a whole draft is
// deleted (its remaining photos must not become orphan Storage objects).
//
// The actual bucket/owner/origin/path validation is in
// src/lib/listingImagePath.ts — pure, no Supabase/env dependency, unit
// tested directly (scripts/test-listing-image-path.ts). This is deliberately
// STRICT: an arbitrary string that ultimately originated from
// listings.images (client-editable state, not something to trust blindly)
// must refuse anything that doesn't clearly and unambiguously name a file
// this exact user owns, on this exact project, in this exact bucket, BEFORE
// ever issuing a delete call — this matters even before Storage RLS is
// applied (supabase/migrations/20260830090000_listing_images_storage_policy.sql,
// not yet applied), and doubly so once it is, since a rejected-here call
// never even reaches Storage to test that policy.
//
// `ownerId` MUST be the id of the currently authenticated user (the
// caller's own session — e.g. the wizard's `user.id`), never a value read
// back from someone else's data. Passing it explicitly (rather than this
// function independently re-deriving it) keeps the check pure and
// easily-audited, with no hidden network call of its own.
export async function dbDeleteListingImage(publicUrl: string, ownerId: string): Promise<boolean> {
  if (!isSupabaseReady()) return false
  const path = parseOwnListingImagePath(publicUrl, ownerId, LISTING_IMAGES_BUCKET, process.env.NEXT_PUBLIC_SUPABASE_URL || '')
  if (!path) {
    console.error('[dbDeleteListingImage] refused — URL failed bucket/owner/origin/path validation, no delete attempted')
    return false
  }
  try {
    const { error } = await supabase.storage.from(LISTING_IMAGES_BUCKET).remove([path])
    if (error) { console.error('[dbDeleteListingImage]', error.message); return false }
    return true
  } catch (e: any) {
    console.error('[dbDeleteListingImage] CATCH:', e?.message)
    return false
  }
}

// ── LISTING LIFECYCLE ERRORS ─────────────────────────────────────
// One typed error surface for every rejection the DB-side lifecycle
// enforcement (supabase/migrations/20260830110000_listing_status_enforce.sql)
// can raise — both the trigger's own RAISE EXCEPTION codes and the CHECK
// constraints it relies on (which apply regardless of role — see that
// file's comments). Callers branch on `code`, never on the raw message
// text (message text is not guaranteed stable, code is).
export type ListingLifecycleErrorCode =
  | 'LISTING_STATUS_REQUIRED'
  | 'LISTING_STATUS_FORBIDDEN_INSERT'
  | 'LISTING_OWNER_IMMUTABLE'
  | 'LISTING_LOCKED_PENDING_REVIEW'
  | 'LISTING_STATUS_FORBIDDEN_SELF_APPROVE'
  | 'LISTING_STATUS_FORBIDDEN_SELF_REJECT'
  | 'LISTING_STATUS_INVALID_TRANSITION'
  | 'LISTING_STATUS_FORBIDDEN_ADMIN_TRANSITION'
  | 'LISTING_REJECTION_REASON_REQUIRED'
  | 'LISTING_REQUIRED_FIELDS_MISSING'
  | 'LISTING_TOO_MANY_PHOTOS'
  | 'LISTING_RATE_LIMIT_10_MIN'
  | 'LISTING_RATE_LIMIT_24_HOURS'
  // UPDATE matched zero rows — id doesn't exist, OR the row exists but its
  // status no longer matches the `.in('status', [...])` guard (someone
  // else already changed it), OR RLS silently excluded it. PostgREST/
  // supabase-js's `.select().single()` can't tell these apart in one
  // round trip without a second, separate lookup that would itself leak
  // "does a row with this id exist" to a caller who might not own it —
  // so all three collapse into one safe, generic code. Caller should
  // reload the listing's real current state, not assume anything about
  // why it didn't update.
  | 'LISTING_UPDATE_CONFLICT'
  // Thrown client-side, BEFORE any network call, by every function that
  // moves a row into/through moderation, when featureFlags.MIGRATION_B_LIVE
  // is false — see that file and the A→B rollout comment in
  // supabase/migrations/20260830110000_listing_status_enforce.sql. Never comes
  // back from Postgres/PostgREST.
  | 'MIGRATION_B_NOT_LIVE'

export class ListingLifecycleError extends Error {
  constructor(public code: ListingLifecycleErrorCode) {
    super(code)
  }
}

// RAISE EXCEPTION codes come back as error.message verbatim (Postgres
// exception message = the literal string passed to RAISE EXCEPTION).
const TRIGGER_MESSAGE_CODES = new Set<string>([
  'LISTING_STATUS_REQUIRED', 'LISTING_STATUS_FORBIDDEN_INSERT', 'LISTING_OWNER_IMMUTABLE',
  'LISTING_LOCKED_PENDING_REVIEW', 'LISTING_STATUS_FORBIDDEN_SELF_APPROVE',
  'LISTING_STATUS_FORBIDDEN_SELF_REJECT', 'LISTING_STATUS_INVALID_TRANSITION',
  'LISTING_STATUS_FORBIDDEN_ADMIN_TRANSITION', 'LISTING_REJECTION_REASON_REQUIRED',
  'LISTING_RATE_LIMIT_10_MIN', 'LISTING_RATE_LIMIT_24_HOURS',
])

// CHECK-constraint violations (SQLSTATE 23514) carry the constraint name
// inside error.message (`... violates check constraint "listings_..."`),
// but Postgrest sometimes puts the fuller text in `details`/`hint` instead
// of (or in addition to) `message` — matched against all three here, once,
// so every caller gets the same typed code instead of parsing Postgres
// text itself.
function classifyListingError(
  error: { message?: string; details?: string; hint?: string; code?: string } | null | undefined
): ListingLifecycleError | null {
  const msg = error?.message || ''
  if (TRIGGER_MESSAGE_CODES.has(msg)) {
    return new ListingLifecycleError(msg as ListingLifecycleErrorCode)
  }
  if (error?.code === '23514') {
    const text = `${error.message || ''} ${error.details || ''} ${error.hint || ''}`
    if (text.includes('listings_required_for_review')) return new ListingLifecycleError('LISTING_REQUIRED_FIELDS_MISSING')
    if (text.includes('listings_max_photos')) return new ListingLifecycleError('LISTING_TOO_MANY_PHOTOS')
    if (text.includes('listings_rejection_reason_check')) return new ListingLifecycleError('LISTING_REJECTION_REASON_REQUIRED')
  }
  // PGRST116 = PostgREST's code for ".single() got 0 (or >1) rows" — for
  // every call site that uses classifyListingError, the query is always
  // `.update(...).eq('id', id)[.in('status', allowedFrom)].select().single()`,
  // so 0 rows can only mean the UPDATE matched nothing. See the
  // LISTING_UPDATE_CONFLICT doc comment above for why the three possible
  // reasons aren't split further.
  if (error?.code === 'PGRST116') {
    return new ListingLifecycleError('LISTING_UPDATE_CONFLICT')
  }
  return null
}

// ── TEMPORARY A→B ROLLOUT BRIDGE — is_active dual-write ──────────
// Read-only audit (2026-08-31, live DB, no writes): listings.is_active is
// `nullable, DEFAULT true`; the CURRENTLY LIVE RLS ("anyone can read
// active listings") still reads `is_active = true`, unchanged by Migration
// A (by design — A doesn't touch RLS at all). An INSERT that sends only
// status='draft' and omits is_active would default it to `true` — the
// draft would be publicly readable through that still-live old policy
// until Migration B replaces it with a status-based one. Confirmed this
// is a real gap, not a hypothetical: archive/restore built in E.2.1 only
// touched `status`, so during the A→B window "archive" would NOT actually
// hide anything from the public feed either.
//
// This is a bridge, not a new source of truth:
//   - Nothing in this client ever READS is_active to make a lifecycle
//     decision — rowToListing() only surfaces it for the pre-existing
//     isActive-based UI visibility filter (src/app/page.tsx visibleListings).
//   - Once Migration B is applied, enforce_listing_lifecycle() overwrites
//     NEW.is_active unconditionally from the final NEW.status on every
//     INSERT/UPDATE (see that file, section 4) — whatever this client
//     sends for is_active is silently replaced server-side and stops
//     mattering from that point on.
//   - Remove this dual-write in a follow-up, separate change once B has
//     been live long enough — not automatic, not part of this stage.
function isActiveBridge(status: 'draft' | 'pending_review' | 'active' | 'rejected' | 'paused' | 'archived'): boolean {
  return status === 'active'
}

// ── LISTING WRITES (draft → pending_review → moderation) ────────
// Draft lives in the SAME public.listings row for its whole life (spec
// §17 — one id throughout) — "create" is an INSERT with status='draft'
// (dbSaveDraft with id=null), everything after that (autosave, step
// edits, and the final submit) is an UPDATE of that same row.
//
// Every function below requires Migration A (new columns) to be applied
// to actually succeed against the live DB — see supabase/migrations/
// 20260830100000_listing_status_expand.sql. Until then these will fail with a
// Postgres "column does not exist" error (not a ListingLifecycleError —
// that's not one of the classified codes), which is expected: this code
// is written for the post-Migration-A schema, not the current live one.

// Draft recovery on wizard open (and after a page reload — this reads the
// DB, never a React ref/localStorage, so it survives a refresh honestly).
// "rejected" is included deliberately: from the owner's point of view a
// rejected listing is exactly as editable as a draft (see the confirmed
// transition table — rejected → pending_review is a normal resubmit, not a
// new object), so it's offered the same way.
//
// The product model is ONE draft per user. `dbSaveDraft`'s own INSERT path
// only ever creates a fresh row when the wizard was never given an
// existing id, so under normal use this returns at most one row — but it
// deliberately does NOT use `.maybeSingle()` (which would throw/error on
// >1 rows, or silently pick an arbitrary one depending on the client
// version) for exactly the case where that invariant has already been
// violated by something outside normal wizard use (e.g. a row created
// before this rule existed, a retried request that raced, direct SQL).
// Instead: fetch a bounded page ordered by updated_at, treat the most
// recently touched row as canonical, and report every other one found so
// the caller can surface — and let the user resolve — the conflict rather
// than silently hiding extra rows or crashing.
const DRAFT_LOOKUP_PAGE_SIZE = 20 // defensive cap, not "unlimited" — one real user is never expected to have more than a handful of stray drafts

export interface DraftLookupResult {
  draft: ListingData | null
  /** OTHER draft rows found for this user, besides `draft` itself —
   *  non-empty only when the one-draft-per-user invariant has already been
   *  violated. Full rows (not just ids) so the caller can clean them up
   *  properly, images included, instead of leaving them as orphans by only
   *  knowing their id. Never silently dropped. */
  extraDrafts: ListingData[]
}

// status='draft' ONLY — NOT 'rejected'. A rejected listing is a distinct
// object in the confirmed lifecycle model: it's an already-submitted,
// already-reviewed listing the owner can resubmit (rejected →
// pending_review is a normal edit-and-resubmit, handled by
// dbSaveDraft/dbSubmitListingForReview, which DO still accept 'rejected' —
// see their own comments), but it is NOT something the wizard's "continue
// a draft / start fresh / delete a draft" recovery flow owns. Concretely:
// the owner-DELETE model only ever allows status IN ('draft','archived')
// (see supabase/migrations/20260830110000_listing_status_enforce.sql, RLS
// section) — a rejected row was never eligible for DELETE at all, so
// recovery must never even offer it as something to "continue or discard"
// the way a throwaway draft is. Editing/resubmitting a rejected listing is
// E.2.3's "Мої оголошення" surface, not this wizard's recovery prompt.
export async function dbFindExistingDraft(ownerId: string): Promise<DraftLookupResult> {
  const empty: DraftLookupResult = { draft: null, extraDrafts: [] }
  if (!isSupabaseReady() || !ownerId) return empty
  try {
    const { data, error } = await supabase
      .from('listings')
      .select('*')
      .eq('owner_id', ownerId)
      .eq('status', 'draft')
      .order('updated_at', { ascending: false })
      .limit(DRAFT_LOOKUP_PAGE_SIZE)
    if (error) { console.error('[dbFindExistingDraft]', error.message, error.code); return empty }
    if (!data || data.length === 0) return empty
    return {
      draft: rowToListing(data[0]),
      extraDrafts: data.slice(1).map((row: any) => rowToListing(row)),
    }
  } catch (e: any) {
    console.error('[dbFindExistingDraft] CATCH:', e?.message)
    return empty
  }
}

// E.2.3 requirement 5 — opening a SPECIFIC draft from its card in "Мої
// оголошення" ("Продовжити заповнення"), instead of the generic multi-draft
// recovery prompt. Deliberately re-fetches from the DB rather than trusting
// the ListingData object the list screen already has in memory — that
// local copy could be stale (edited/deleted elsewhere, status changed) by
// the time the wizard actually opens; owner_id and status='draft' are
// re-checked here, server-side, at the moment it matters. `.maybeSingle()`
// is correct here (unlike dbFindExistingDraft) — this filters by primary
// key `id`, so at most one row can ever match regardless of how many other
// drafts this owner has; there is no multi-row ambiguity to guard against.
export async function dbGetDraftById(id: number, ownerId: string): Promise<ListingData | null> {
  if (!isSupabaseReady() || !ownerId) return null
  try {
    const { data, error } = await supabase
      .from('listings')
      .select('*')
      .eq('id', id)
      .eq('owner_id', ownerId)
      .eq('status', 'draft')
      .maybeSingle()
    if (error) { console.error('[dbGetDraftById]', error.message, error.code); return null }
    return data ? rowToListing(data) : null
  } catch (e: any) {
    console.error('[dbGetDraftById] CATCH:', e?.message)
    return null
  }
}

export async function dbSaveDraft(id: number | null, listing: Partial<ListingData>): Promise<ListingData | null> {
  if (!isSupabaseReady()) return null
  try {
    if (id == null) {
      const row = listingToRow(listing)
      const { data, error } = await supabase.from('listings').insert(row).select().single()
      if (error) {
        console.error('[dbSaveDraft insert] ERROR:', error.message, error.code)
        const classified = classifyListingError(error)
        if (classified) throw classified
        return null
      }
      return rowToListing(data)
    }
    const row = listingToUpdateRow(listing)
    // Restrict the target row to draft/rejected — until Migration B lands
    // there is no trigger stopping a stray/reused id from silently
    // rewriting an active/pending_review/paused/archived listing as if it
    // were an ordinary draft edit; RLS alone ("owner can update own
    // listings") does not check status at all pre-B. `.in()` here is that
    // missing guard on the client side; after B, enforce_listing_lifecycle()
    // enforces the same boundary independently (LISTING_LOCKED_PENDING_REVIEW
    // / LISTING_STATUS_INVALID_TRANSITION), so this becomes defense-in-depth
    // rather than the only line of defense.
    const { data, error } = await supabase
      .from('listings')
      .update(row)
      .eq('id', id)
      .in('status', ['draft', 'rejected'])
      .select()
      .single()
    if (error) {
      console.error('[dbSaveDraft update] ERROR:', error.message, error.code)
      const classified = classifyListingError(error)
      if (classified) throw classified
      return null
    }
    return rowToListing(data)
  } catch (e: any) {
    if (e instanceof ListingLifecycleError) throw e
    console.error('[dbSaveDraft] CATCH:', e?.message)
    return null
  }
}

// The only path a listing may take from draft/rejected into pending_review
// (and, for an already-live listing edited significantly, the trigger
// forces this same status itself — see enforce_listing_lifecycle()). This
// is an UPDATE, never an INSERT: the row was already created by
// dbSaveDraft(null, ...) earlier in the wizard.
export async function dbSubmitListingForReview(id: number, listing: Partial<ListingData>): Promise<ListingData | null> {
  if (!isSupabaseReady()) return null
  // E.2.4 requirement 3 — see featureFlags.ts. Thrown BEFORE any network
  // call: submitting into pending_review during the A→B window would enter
  // a state that today's still-live old RLS can't safely moderate yet.
  if (!MIGRATION_B_LIVE) throw new ListingLifecycleError('MIGRATION_B_NOT_LIVE')
  try {
    const row = {
      ...listingToUpdateRow(listing),
      status: 'pending_review' as const,
      is_active: isActiveBridge('pending_review'), // dual-write bridge, see above
    }
    // Same pre-B guard as dbSaveDraft — only a draft/rejected row may be
    // submitted; nothing today stops a wrong id from moving an active
    // listing straight to pending_review without this.
    const { data, error } = await supabase
      .from('listings')
      .update(row)
      .eq('id', id)
      .in('status', ['draft', 'rejected'])
      .select()
      .single()
    if (error) {
      console.error('[dbSubmitListingForReview] ERROR:', error.message, error.code)
      const classified = classifyListingError(error)
      if (classified) throw classified
      return null
    }
    return rowToListing(data)
  } catch (e: any) {
    if (e instanceof ListingLifecycleError) throw e
    console.error('[dbSubmitListingForReview] CATCH:', e?.message)
    return null
  }
}

// ── MODERATION (E.2.4) ───────────────────────────────────────────
// Every function here is reachable from the app ONLY via ModerationScreen,
// which itself is gated client-side by isAdmin(user) (src/lib/auth.ts) —
// but that gate is UX ONLY (E.2.4 requirement 1). The real enforcement is
// RLS ("admin can update/delete/read any listing", using public.is_admin())
// plus, once Migration B is live, enforce_listing_lifecycle()'s own admin
// branch (pending_review→active / pending_review→rejected only, everything
// else LISTING_STATUS_FORBIDDEN_ADMIN_TRANSITION — see that file). None of
// these functions independently re-check is_admin() themselves: a forged
// request that bypasses this client code entirely hits the exact same RLS
// a legitimate call would, so a client-side admin check here would be
// theater, not a real second layer.
//
// Known PRE-Migration-B gap, honestly documented rather than papered over:
// today's live RLS ("owner or admin can update own listings") reads
// `owner_id = auth.uid() OR is_admin()` — before B's trigger exists to add
// enforce_listing_lifecycle()'s self-approve/self-reject block, a
// MALICIOUS OWNER (not this UI, but someone crafting a raw request against
// their own pending_review row) could in principle approve/reject their
// own listing, since RLS alone doesn't distinguish "owner" from "admin"
// intent the way the trigger will. This isn't something E.2.4's code can
// close — a client-side guard can't stop a request forged outside this
// client, and RLS itself is out of scope this stage ("не изменять RLS без
// отдельного согласования"). It closes automatically the moment Migration
// B is applied — exactly why this must ship before B, not after.

const PENDING_REVIEW_PAGE_SIZE = 20 // "не загружать бесконечно всю таблицу" — a bounded page, not the whole queue

export interface PendingReviewPage {
  items: ListingData[]
  hasMore: boolean
  // Cursor for the NEXT page (pass to the next call), derived from the
  // last row actually returned — null when there's nothing more, or the
  // page came back empty. Callers must not construct this themselves.
  nextCursor: PendingReviewCursor | null
  // Only populated on the FIRST page (cursor omitted) — see the NULL-
  // handling note below. A normal post-Migration-B pending_review row
  // always has pending_review_at set by the trigger; this counts rows
  // that don't (legacy/anomalous data). Present so these rows are never
  // silently invisible — just never mixed into the cursor-paginated list.
  anomalousNullCount?: number
}

// Oldest-first (requirement 2: "сначала самые старые"), ordered and paged
// by pending_review_at ASC, id ASC — see src/lib/pendingReviewCursor.ts for
// the full reasoning (a timestamp-only cursor is unsafe once two rows can
// share the same pending_review_at). pending_review_at is the REAL,
// server-set "entered pending_review at" timestamp (Migration B's
// enforce_listing_lifecycle(), never client-writable) — no longer a proxy
// via updated_at (E.2.4 correction; see that migration's "Гарантии"
// comment for exactly where it's stamped). The composite index
// idx_listings_pending_review_queue (status, pending_review_at, id) in
// Migration A backs this exact order.
//
// NULL pending_review_at handling: rows with status='pending_review' but a
// null pending_review_at can only be legacy/anomalous (a normal row always
// gets it stamped by the trigger — see pendingReviewCursor.ts's
// excludeNullPendingReviewAt doc comment for why they'd otherwise silently
// break cursor pagination). They're excluded from this query
// (`.not('pending_review_at','is',null)`) and their count is reported
// separately via `anomalousNullCount` on the first page only, so they're
// visible to the caller without corrupting the paginated list.
export async function dbGetPendingReviewListings(cursor?: PendingReviewCursor | null): Promise<PendingReviewPage> {
  if (!isSupabaseReady()) return { items: [], hasMore: false, nextCursor: null }
  try {
    let query = supabase
      .from('listings')
      .select('*')
      .eq('status', 'pending_review')
      .not('pending_review_at', 'is', null)
      .order('pending_review_at', { ascending: true })
      .order('id', { ascending: true })
      .limit(PENDING_REVIEW_PAGE_SIZE + 1)
    if (cursor) query = query.or(buildCursorFilter(cursor))
    const { data, error } = await query
    if (error) { console.error('[dbGetPendingReviewListings]', error.message, error.code); return { items: [], hasMore: false, nextCursor: null } }
    const rows = data || []
    const hasMore = rows.length > PENDING_REVIEW_PAGE_SIZE
    const page = hasMore ? rows.slice(0, PENDING_REVIEW_PAGE_SIZE) : rows
    const items = page.map((row: any) => rowToListing(row))
    const lastRow = page[page.length - 1]
    const nextCursor: PendingReviewCursor | null = lastRow
      ? { pendingReviewAt: lastRow.pending_review_at as string, id: lastRow.id as number }
      : null

    let anomalousNullCount: number | undefined
    if (!cursor) {
      const { count, error: countError } = await supabase
        .from('listings')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending_review')
        .is('pending_review_at', null)
      if (!countError) anomalousNullCount = count ?? 0
      else console.error('[dbGetPendingReviewListings] anomalousNullCount ERROR:', countError.message)
    }

    return { items, hasMore, nextCursor, anomalousNullCount }
  } catch (e: any) {
    console.error('[dbGetPendingReviewListings] CATCH:', e?.message)
    return { items: [], hasMore: false, nextCursor: null }
  }
}

// Approve — the ONLY fields this sends are status and (bridge) is_active.
// Deliberately does NOT send moderated_at/moderated_by — those are the DB
// trigger's job once Migration B is live (enforce_listing_lifecycle()
// stamps them from now()/auth.uid() itself); before B they simply stay
// NULL, which is honest (no moderation trigger has run yet) rather than a
// client-fabricated guess at an audit trail. is_active IS dual-written
// (isActiveBridge — the SAME established bridge every other status
// transition in this file uses, not a new ad-hoc decision) — without it, a
// row approved to 'active' during the A→B window would stay invisible
// under the still-live old public RLS (`is_active = true`), silently
// undoing the approval from the public's point of view.
export async function dbApproveListing(id: number): Promise<ListingData | null> {
  if (!isSupabaseReady()) return null
  // E.2.4 requirement 3 — see featureFlags.ts. Before Migration B, the
  // lifecycle trigger doesn't exist yet: an UPDATE here would still pass
  // the old RLS but skip moderated_at/moderated_by/published_at server
  // stamping and strict transition enforcement entirely. A UI label alone
  // was rejected as insufficient — this is the real, code-level block, and
  // it fires before any request is sent.
  if (!MIGRATION_B_LIVE) throw new ListingLifecycleError('MIGRATION_B_NOT_LIVE')
  try {
    const { data, error } = await supabase
      .from('listings')
      .update({ status: 'active', is_active: isActiveBridge('active'), updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('status', 'pending_review')
      .select()
      .single()
    if (error) {
      const classified = classifyListingError(error)
      console.error('[dbApproveListing]', error.message, error.code, classified ? `→ ${classified.code}` : '')
      if (classified) throw classified
      return null
    }
    return rowToListing(data)
  } catch (e: any) {
    if (e instanceof ListingLifecycleError) throw e
    console.error('[dbApproveListing] CATCH:', e?.message)
    return null
  }
}

// Reject — same non-fields-sent reasoning as dbApproveListing for
// moderated_at/moderated_by. `reason` is required and trimmed here (not
// just by the caller) so this function can never silently write an
// empty/whitespace rejection_reason even if a future caller forgets to
// validate — matches listings_rejection_reason_check's own intent
// (Migration B) at the client boundary too.
export async function dbRejectListing(id: number, reason: string): Promise<ListingData | null> {
  if (!isSupabaseReady()) return null
  // E.2.4 requirement 3 — see featureFlags.ts and dbApproveListing's
  // comment above (same reasoning, the reject side of the same gap).
  if (!MIGRATION_B_LIVE) throw new ListingLifecycleError('MIGRATION_B_NOT_LIVE')
  const trimmed = reason.trim()
  if (!trimmed) {
    // E.2.4 requirement 4 — a typed throw, not `return null`: null is
    // already the "conflict/not found" signal every other lifecycle
    // function in this file uses (see LISTING_UPDATE_CONFLICT), so
    // returning it here for "you passed an empty string" would be
    // indistinguishable from "someone else already moderated this row" to
    // any caller. This never reaches Postgres either — same validation
    // listings_rejection_reason_check enforces server-side (Migration B),
    // caught here first so the caller gets a specific, actionable error
    // instead of a round trip.
    throw new ListingLifecycleError('LISTING_REJECTION_REASON_REQUIRED')
  }
  try {
    const { data, error } = await supabase
      .from('listings')
      .update({ status: 'rejected', rejection_reason: trimmed, is_active: isActiveBridge('rejected'), updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('status', 'pending_review')
      .select()
      .single()
    if (error) {
      const classified = classifyListingError(error)
      console.error('[dbRejectListing]', error.message, error.code, classified ? `→ ${classified.code}` : '')
      if (classified) throw classified
      return null
    }
    return rowToListing(data)
  } catch (e: any) {
    if (e instanceof ListingLifecycleError) throw e
    console.error('[dbRejectListing] CATCH:', e?.message)
    return null
  }
}

export async function dbUpdateListing(id: number, listing: Partial<ListingData>): Promise<ListingData | null> {
  if (!isSupabaseReady()) { console.error('[dbUpdateListing] Supabase not ready'); return null }
  const row = listingToUpdateRow(listing)
  try {
    const { data, error } = await supabase
      .from('listings')
      .update(row)
      .eq('id', id)
      .select()
      .single()
    if (error) { console.error('[dbUpdateListing] ERROR:', error.message); return null }
    return rowToListing(data)
  } catch (e: any) {
    console.error('[dbUpdateListing] CATCH:', e?.message)
    return null
  }
}

// E.2.3 requirement 2 — editing a SIGNIFICANT field on an already-published
// listing (active/paused/archived). Migration B's trigger will eventually
// enforce this transition unconditionally and independently of the client
// (enforce_listing_lifecycle()'s v_significant check) — but the rollout
// window between deploying this code and applying B has no such
// enforcement yet (RLS alone doesn't check status), so the client must not
// rely on a server that isn't live yet. This function explicitly:
//   - sends only the changed fields (caller's responsibility to diff —
//     see EditListingForm's buildChangedFields) — never a blind full row;
//   - sets status='pending_review' itself, in the same UPDATE;
//   - dual-writes is_active=false (same A→B bridge as isActiveBridge
//     elsewhere — the old public RLS still reads is_active during that
//     window, so a pending_review row must not stay publicly visible);
//   - is guarded to `.in('status', ['active','paused','archived'])` and
//     `.select().single()`, so 0 rows matched is a real, classified
//     LISTING_UPDATE_CONFLICT, not silent success.
// Named distinctly from dbUpdateListing (which does NOT touch status —
// used for the wizard/draft paths where a status change is either not
// wanted or handled separately) so the two are never confused at a call site.
export async function dbUpdateListingForReview(id: number, changedFields: Partial<ListingData>, ownerId: string): Promise<ListingData | null> {
  if (!isSupabaseReady()) return null
  // E.2.4 requirement 3 — see featureFlags.ts. Same reasoning as
  // dbSubmitListingForReview: this also moves a row into pending_review.
  if (!MIGRATION_B_LIVE) throw new ListingLifecycleError('MIGRATION_B_NOT_LIVE')
  try {
    const row = {
      ...listingToUpdateRow(changedFields),
      status: 'pending_review' as const,
      is_active: isActiveBridge('pending_review'),
    }
    const { data, error } = await supabase
      .from('listings')
      .update(row)
      .eq('id', id)
      .eq('owner_id', ownerId)
      .in('status', ['active', 'paused', 'archived'])
      .select()
      .single()
    if (error) {
      const classified = classifyListingError(error)
      console.error('[dbUpdateListingForReview] ERROR:', error.message, error.code, classified ? `→ ${classified.code}` : '')
      if (classified) throw classified
      return null
    }
    return rowToListing(data)
  } catch (e: any) {
    if (e instanceof ListingLifecycleError) throw e
    console.error('[dbUpdateListingForReview] CATCH:', e?.message)
    return null
  }
}

// Owner-facing archive/restore/pause — status(+is_active bridge)-only
// UPDATE, no other field in the row changes, so the trigger's
// v_significant check (once B is live) sees no changed field and does NOT
// force pending_review for these. `allowedFrom` is the same kind of
// pre-B client-side guard as dbSaveDraft/dbSubmitListingForReview above —
// RLS alone doesn't check source status, so a wrong id must not be able to
// e.g. "archive" a pending_review listing.
export type ListingStatusValue = 'draft' | 'pending_review' | 'active' | 'rejected' | 'paused' | 'archived'

// Returns the CONFIRMED row from the DB, or null on any failure —
// requirement 3 ("обновлять локальный объект ответом БД, а не
// предположением клиента"): callers must apply THIS return value to their
// local state, never assume the requested transition happened.
async function dbSetListingStatus(
  id: number,
  status: 'archived' | 'active' | 'paused',
  allowedFrom: ListingStatusValue[]
): Promise<ListingData | null> {
  if (!isSupabaseReady()) return null
  try {
    // `.select().single()` is required, not cosmetic: a plain `.update()`
    // with no matching row (wrong id, OR the row exists but its status
    // already left `allowedFrom` — e.g. someone else archived it a moment
    // ago) returns `error: null` from Postgrest — Postgres doesn't treat
    // "0 rows matched" as a failure. Without asking for the row back,
    // this function would report success for an UPDATE that changed
    // nothing. `.single()` turns that same 0-rows case into a real error
    // (PGRST116), which classifyListingError maps to LISTING_UPDATE_CONFLICT.
    const { data, error } = await supabase
      .from('listings')
      .update({ status, is_active: isActiveBridge(status), updated_at: new Date().toISOString() })
      .eq('id', id)
      .in('status', allowedFrom)
      .select()
      .single()
    if (error) {
      const classified = classifyListingError(error)
      console.error(`[dbSetListingStatus:${status}]`, error.message, error.code, classified ? `→ ${classified.code}` : '')
      if (classified) throw classified
      return null
    }
    return data ? rowToListing(data) : null
  } catch (e: any) {
    if (e instanceof ListingLifecycleError) throw e
    console.error(`[dbSetListingStatus:${status}] CATCH:`, e?.message)
    return null
  }
}

// Soft delete: the listing stays in the DB, status moves to 'archived' (was
// is_active=false pre-migration) so it can be restored later, instead of
// dbDeleteListing's permanent removal. Owner can archive from active or
// paused (see the confirmed transition table — E.1 audit).
export async function dbArchiveListing(id: number): Promise<ListingData | null> {
  return dbSetListingStatus(id, 'archived', ['active', 'paused'])
}

// active → paused. Owner-initiated pause, no field changes — the trigger
// (once B is live) does not require re-moderation for this, matching the
// confirmed transition table.
export async function dbPauseListing(id: number): Promise<ListingData | null> {
  return dbSetListingStatus(id, 'paused', ['active'])
}

// Restores from paused or archived back to active. The DB trigger (once B
// is live) only allows this when the listing's data hasn't changed since
// it was last approved (OLD.status in ('paused','archived') with no
// significant edit in the same request) — this call never carries field
// edits, so that condition is always met from the client's side.
export async function dbRestoreListing(id: number): Promise<ListingData | null> {
  return dbSetListingStatus(id, 'active', ['paused', 'archived'])
}

// Pre-migration audit fix (3rd round, blocker 1): a plain `.delete().eq('id',
// id)` with no `.select()` returns `error: null` from PostgREST even when
// ZERO rows matched (wrong/already-deleted id, RLS silently excluded it) —
// Postgres doesn't treat "0 rows affected" as a failure, and without asking
// for the deleted row back there's no way to tell "actually deleted" apart
// from "matched nothing". `.select('id').single()` closes that: 0 rows
// becomes a real error (PGRST116), so this only ever returns `true` when a
// row was CONFIRMED deleted — the caller (handleAdminDeleteListing in
// page.tsx) relies on exactly this to know when it's safe to update local
// state, never before.
export async function dbDeleteListing(id: number): Promise<boolean> {
  if (!isSupabaseReady()) return false
  try {
    const { data, error } = await supabase.from('listings').delete().eq('id', id).select('id').single()
    if (error) { console.error('[dbDeleteListing]', error.message, error.code); return false }
    return !!data
  } catch (e: any) { console.error('[dbDeleteListing] CATCH:', e?.message); return false }
}

export interface DeleteDraftResult {
  ok: boolean
  code?: ListingLifecycleErrorCode
  /** Number of images the row referenced that could NOT be removed from
   *  Storage after the row was already gone — orphan files, reported here
   *  (not just to console) so the caller can surface it if useful. Only
   *  meaningful when ok=true; row deletion is never rolled back over this. */
  orphanedImageCount?: number
}

// Wizard "Видалити чернетку" — permanently removes a DRAFT (status='draft'
// ONLY, see the note on dbFindExistingDraft above — a rejected listing is
// never eligible: the confirmed owner-DELETE model is status IN
// ('draft','archived'), and 'archived' deletion already goes through
// RequestsScreen's own existing action, not this function) AND every photo
// it uploaded to Storage. Order matters and is deliberately ROW FIRST,
// THEN STORAGE:
//   1. DELETE the row itself, guarded to status = 'draft' and
//      `.select('id').single()` so "0 rows matched" (wrong id / already
//      changed status / RLS) is a real, classified error
//      (LISTING_UPDATE_CONFLICT via classifyListingError's PGRST116
//      handling) — NOT silently "nothing happened".
//   2. Only once the row is CONFIRMED gone do we touch Storage — deleting
//      images first (the previous design) risks a row that survives
//      (delete rejected/raced) while its photos are already destroyed,
//      strictly worse than the reverse (a gone row with a few leftover
//      files) — a live listing must never end up referencing deleted
//      images.
//   3. Storage cleanup after that point is best-effort: a failure there
//      can only ever produce an orphan file, never resurrect the row or
//      make this call report failure — surfaced via `orphanedImageCount`.
// Restricted to status = 'draft' for the same pre-B reason as
// dbSaveDraft/dbSubmitListingForReview's own guards: RLS alone doesn't
// check status yet. After Migration B, RLS itself only allows owner DELETE
// for draft/archived — a rejected row would be rejected there too; this
// client-side guard is deliberately narrower (draft only), matching what
// THIS function is for.
export async function dbDeleteDraftListing(id: number, imageUrls: string[], ownerId: string): Promise<DeleteDraftResult> {
  if (!isSupabaseReady()) return { ok: false }
  try {
    const { error } = await supabase
      .from('listings')
      .delete()
      .eq('id', id)
      .eq('status', 'draft')
      .select('id')
      .single()
    if (error) {
      const classified = classifyListingError(error)
      console.error('[dbDeleteDraftListing] row delete failed', error.message, error.code, classified ? `→ ${classified.code}` : '')
      return { ok: false, code: classified?.code }
    }
  } catch (e: any) {
    console.error('[dbDeleteDraftListing] CATCH (row delete):', e?.message)
    return { ok: false }
  }

  // Row is confirmed gone from this point on — everything below is
  // best-effort cleanup and can never turn this call into a failure.
  const results = await Promise.all(
    imageUrls.filter(Boolean).map(url => dbDeleteListingImage(url, ownerId))
  )
  const orphanedImageCount = results.filter(ok => !ok).length
  if (orphanedImageCount > 0) {
    console.error(`[dbDeleteDraftListing] row deleted but ${orphanedImageCount} image(s) could not be removed from Storage — orphan file(s), row deletion still succeeded`)
  }
  return { ok: true, orphanedImageCount }
}

// "Видалити назавжди" for an ARCHIVED listing — E.2.3 requirement 4.
// Deliberately a SEPARATE function from dbDeleteDraftListing, not a reuse:
// different source status (archived, never draft — the two are unrelated
// lifecycle states with unrelated DELETE eligibility), and this one reads
// the images to clean up FROM THE DELETE RESPONSE ITSELF
// (`.select('id, images')`) rather than trusting a client-supplied list —
// more trustworthy, since by definition nothing in this flow has a live,
// continuously-synced local copy of the row the way the wizard's
// photosRef is for a draft still being edited. Same row-first-then-Storage
// ordering and the same 0-rows-is-a-classified-conflict guarantee as
// dbDeleteDraftListing.
export async function dbDeleteArchivedListing(id: number, ownerId: string): Promise<DeleteDraftResult> {
  if (!isSupabaseReady()) return { ok: false }
  let images: string[] = []
  try {
    const { data, error } = await supabase
      .from('listings')
      .delete()
      .eq('id', id)
      .eq('status', 'archived')
      .select('id, images')
      .single()
    if (error) {
      const classified = classifyListingError(error)
      console.error('[dbDeleteArchivedListing] row delete failed', error.message, error.code, classified ? `→ ${classified.code}` : '')
      return { ok: false, code: classified?.code }
    }
    images = Array.isArray(data?.images) ? data.images : []
  } catch (e: any) {
    console.error('[dbDeleteArchivedListing] CATCH (row delete):', e?.message)
    return { ok: false }
  }

  // Row is confirmed gone from this point on — everything below is
  // best-effort cleanup and can never turn this call into a failure.
  const results = await Promise.all(
    images.filter(Boolean).map(url => dbDeleteListingImage(url, ownerId))
  )
  const orphanedImageCount = results.filter(ok => !ok).length
  if (orphanedImageCount > 0) {
    console.error(`[dbDeleteArchivedListing] row deleted but ${orphanedImageCount} image(s) could not be removed from Storage — orphan file(s), row deletion still succeeded`)
  }
  return { ok: true, orphanedImageCount }
}

// ── ACCOUNTS ──────────────────────────────────────────────────

export interface DbAccount {
  id: string; name: string; email: string; phone: string
  role: string; password_hash: string; created_at: string
  avatar_url?: string | null
  // Bridge to Supabase Auth (auth.users.id). Column + the trigger that
  // populates it (handle_new_auth_user()) are added by
  // supabase/migrations/20260806_auth_rls_hardening.sql (STAGE 1) — no
  // client code writes this field; it's typed here only so reads (e.g. a
  // future dbFindAccountByAuthId()) have it available once STAGE 1 lands.
  auth_id?: string | null
}

// What dbGetAccounts() actually selects — deliberately excludes
// password_hash (no reason for a user-list view to ever fetch it) and
// avatar_url/auth_id (not currently shown there). This was previously
// mistyped as DbAccount[] itself, which requires password_hash — a latent
// type error that TypeScript wasn't reporting only because a syntax error
// elsewhere (src/components/InstallPrompt.tsx) was short-circuiting the
// project's type-check before it got this far; unrelated to Supabase Auth.
export type DbAccountSummary = Pick<DbAccount, 'id' | 'name' | 'email' | 'phone' | 'role' | 'created_at'>

export async function dbGetAccounts(): Promise<DbAccountSummary[]> {
  if (!isSupabaseReady()) return []
  try {
    const { data, error } = await supabase
      .from('accounts')
      .select('id, name, email, phone, role, created_at')
      .order('created_at', { ascending: false })
    if (error) { console.error('[dbGetAccounts]', error.message); return [] }
    console.log('[dbGetAccounts] count:', data?.length)
    return data || []
  } catch (e: any) { console.error('[dbGetAccounts] CATCH:', e?.message); return [] }
}

export async function dbFindAccount(email: string): Promise<DbAccount | null> {
  if (!isSupabaseReady()) return null
  try {
    const { data, error } = await supabase
      .from('accounts')
      .select('*')
      .eq('email', email.toLowerCase().trim())
      .maybeSingle()
    if (error) { console.error('[dbFindAccount]', error.message); return null }
    return data
  } catch (e: any) { console.error('[dbFindAccount] CATCH:', e?.message); return null }
}

export async function dbFindAccountById(id: string): Promise<DbAccount | null> {
  if (!isSupabaseReady()) return null
  try {
    const { data, error } = await supabase
      .from('accounts')
      .select('*')
      .eq('id', id)
      .maybeSingle()
    if (error) { console.error('[dbFindAccountById]', error.message); return null }
    return data
  } catch (e: any) { console.error('[dbFindAccountById] CATCH:', e?.message); return null }
}

const AVATARS_BUCKET = 'avatars'

export async function dbUploadAvatar(file: File, userId: string): Promise<string | null> {
  if (!isSupabaseReady()) return null
  try {
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg'
    // Fixed filename per user (not timestamped like listing photos) so a new
    // upload simply overwrites the old avatar instead of leaving orphans.
    const path = `${userId}/avatar.${ext}`
    const { error } = await supabase.storage
      .from(AVATARS_BUCKET)
      .upload(path, file, { cacheControl: '3600', upsert: true, contentType: file.type || 'image/jpeg' })
    if (error) { console.error('[dbUploadAvatar]', error.message); return null }
    const { data } = supabase.storage.from(AVATARS_BUCKET).getPublicUrl(path)
    // Cache-bust so the new photo shows immediately even though the path
    // (and therefore any CDN/browser cache key) is identical to the old one.
    return `${data.publicUrl}?t=${Date.now()}`
  } catch (e: any) {
    console.error('[dbUploadAvatar] CATCH:', e?.message)
    return null
  }
}

// Not called by the live signup flow anymore — src/lib/auth.ts registerAccount()
// deliberately leaves creating the `accounts` row to the handle_new_auth_user()
// DB trigger (STAGE 1) so there's a single source of truth for that insert.
// Left here as a general-purpose helper for any future admin/manual-account use.
export async function dbCreateAccount(acc: DbAccount): Promise<{ ok: boolean; error?: string }> {
  if (!isSupabaseReady()) return { ok: false, error: 'Supabase not configured' }
  try {
    const { error } = await supabase.from('accounts').insert(acc)
    if (error) { console.error('[dbCreateAccount]', error.message); return { ok: false, error: error.message } }
    console.log('[dbCreateAccount] SUCCESS, id:', acc.id)
    return { ok: true }
  } catch (e: any) { return { ok: false, error: e?.message || 'Unknown' } }
}

// `id` here is the Supabase Auth uid (ProfileScreen's only caller passes
// user.id, i.e. authUser.id from buildUser() in auth.ts) — NOT
// accounts.id, which is stored as "auth_"+uid. Matching against `id`
// silently updates zero rows (no error, since RLS/eq just filters to
// nothing) — every profile edit (name/phone/avatar) was a silent no-op.
// auth_id is the raw uid column and what RLS's own policy already checks
// (`auth_id = auth.uid()`), so filtering on it here is both correct and
// consistent with that policy.
export async function dbUpdateAccount(id: string, updates: Partial<DbAccount>): Promise<boolean> {
  if (!isSupabaseReady()) return false
  try {
    const { error } = await supabase.from('accounts').update(updates).eq('auth_id', id)
    if (error) { console.error('[dbUpdateAccount]', error.message); return false }
    return true
  } catch (e: any) { console.error('[dbUpdateAccount] CATCH:', e?.message); return false }
}

// ── FEEDBACK ──────────────────────────────────────────────────

export interface DbFeedback {
  id?: number; name: string; email: string; message: string
  is_read?: boolean; created_at?: string
}

export async function dbGetFeedbacks(): Promise<DbFeedback[]> {
  if (!isSupabaseReady()) return []
  try {
    const { data, error } = await supabase
      .from('feedback')
      .select('*')
      .order('created_at', { ascending: false })
    if (error) { console.error('[dbGetFeedbacks]', error.message); return [] }
    console.log('[dbGetFeedbacks] count:', data?.length)
    return data || []
  } catch (e: any) { console.error('[dbGetFeedbacks] CATCH:', e?.message); return [] }
}

export async function dbSaveFeedback(fb: Omit<DbFeedback, 'id' | 'created_at' | 'is_read'>): Promise<boolean> {
  if (!isSupabaseReady()) return false
  try {
    const { error } = await supabase.from('feedback').insert({
      name: fb.name, email: fb.email || '', message: fb.message,
    })
    if (error) { console.error('[dbSaveFeedback]', error.message); return false }
    return true
  } catch (e: any) { console.error('[dbSaveFeedback] CATCH:', e?.message); return false }
}

export async function dbMarkFeedbackRead(id: number): Promise<boolean> {
  if (!isSupabaseReady()) return false
  try {
    const { error } = await supabase.from('feedback').update({ is_read: true }).eq('id', id)
    return !error
  } catch { return false }
}

// ── REALTIME ──────────────────────────────────────────────────

export function subscribeToListings(
  onInsert: (l: ListingData) => void,
  onDelete?: (id: number) => void,
  onUpdate?: (l: ListingData) => void
) {
  console.log('[realtime] subscribing to listings...')
  const channel = supabase
    .channel('db_listings_' + Date.now())
    .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'listings' },
      (payload) => {
        console.log('[realtime] INSERT listing:', payload.new?.id)
        onInsert(rowToListing(payload.new))
      }
    )
    .on('postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'listings' },
      (payload) => {
        console.log('[realtime] UPDATE listing:', payload.new?.id, 'likes:', payload.new?.likes)
        onUpdate?.(rowToListing(payload.new))
      }
    )
    .on('postgres_changes',
      { event: 'DELETE', schema: 'public', table: 'listings' },
      (payload) => {
        console.log('[realtime] DELETE listing:', payload.old?.id)
        onDelete?.(payload.old?.id)
      }
    )
    .subscribe((status) => {
      console.log('[realtime] listings channel status:', status)
    })
  return channel
}

export function subscribeToAccounts(onUpdate: () => void) {
  return supabase
    .channel('db_accounts_' + Date.now())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'accounts' }, () => {
      console.log('[realtime] accounts updated')
      onUpdate()
    })
    .subscribe()
}

export function subscribeFeedback(onUpdate: () => void) {
  return supabase
    .channel('db_feedback_' + Date.now())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'feedback' }, () => {
      console.log('[realtime] feedback updated')
      onUpdate()
    })
    .subscribe()
}

// ── ROW CONVERTERS ────────────────────────────────────────────

export function rowToListing(row: any): ListingData {
  if (!row) { console.warn('[rowToListing] null row'); return {} as ListingData }
  return {
    id: Number(row.id),
    userId: row.user_id || '',
    // Falls back to user_id for any row where owner_id hasn't been
    // populated (shouldn't happen for rows written by listingToRow() below,
    // which always sets both) — see the ListingData.ownerId comment.
    ownerId: row.owner_id || row.user_id || '',
    ownerName: row.owner_name || null,
    ownerPhone: row.owner_phone || null,
    title: row.title || '',
    type: row.type || 'Офіс',
    price: Number(row.price) || 0,
    area: Number(row.area) || 0,
    floor: row.floor != null ? Number(row.floor) : null,
    totalFloors: row.total_floors != null ? Number(row.total_floors) : null,
    district: row.district || '',
    address: row.address || '',
    city: row.city || 'Одеса',
    condition: row.condition || null,
    utilities: row.utilities ?? null,
    buildingType: row.building_type ?? null,
    parking: Boolean(row.parking),
    separateEntrance: Boolean(row.separate_entrance),
    description: row.description || null,
    images: Array.isArray(row.images) ? row.images.filter(Boolean) : [],
    features: Array.isArray(row.features) ? row.features.filter(Boolean) : [],
    // Honest pass-through, no derived/fallback value: `undefined` (column
    // doesn't exist — schema migration not applied yet) and an actual SQL
    // NULL both collapse to `null` here, which is exactly what they are —
    // "unknown/not set", never guessed from is_active or anything else.
    status: (row.status ?? null) as ListingData['status'],
    rejectionReason: row.rejection_reason ?? null,
    moderatedAt: row.moderated_at ?? null,
    pendingReviewAt: row.pending_review_at ?? null,
    publishedAt: row.published_at ?? null,
    archivedAt: row.archived_at ?? null,
    isActive: row.is_active !== false, // default true if null
    isNew: row.is_new !== false,
    isPromoted: Boolean(row.is_promoted),
    isFeatured: Boolean(row.is_featured),
    views: Number(row.views) || 0,
    likes: Number(row.likes) || 0,
    score: Number(row.score) || 0,
    promotedUntil: row.promoted_until || null,
    createdAt: row.created_at || new Date().toISOString(),
    updatedAt: row.updated_at || row.created_at || new Date().toISOString(),
  }
}

// INSERT row builder — used only by dbSaveDraft(id=null, ...) to create a
// brand new draft. status is always 'draft': the DB trigger rejects any
// other status on INSERT for every role (see enforce_listing_lifecycle()),
// so there is no "publish directly" path here anymore — dbPublishListing
// (direct is_active:true insert) is retired, replaced by
// dbSaveDraft + dbSubmitListingForReview.
//
// No fictitious defaults for the fields Migration A drops NOT NULL from
// (title/type/price/area/district/address) — a step-1-only draft sends
// real `null`/undefined for whatever it doesn't have yet, never a
// placeholder like 0 or '' (E.1 audit: "без фиктивных значений"). Fields
// outside that six-column list keep their previous safe defaults (city,
// parking, images: [], etc.) since those were never meant to be
// user-empty in the first place.
function listingToRow(l: Partial<ListingData>) {
  return {
    // No 'anonymous' fallback: publishing is gated to logged-in users
    // (see handleAddListing()'s guard in page.tsx), so userId should always
    // be a real Supabase Auth uid here. owner_id mirrors it — same value,
    // written to the new bridge column STAGE2's RLS policies will check
    // (owner_id = auth.uid()), while user_id stays for old-code compat.
    user_id: l.userId || '',
    owner_id: l.userId || null,
    owner_name: l.ownerName || null,
    owner_phone: l.ownerPhone || null,
    title: l.title != null ? l.title.trim() : null,
    type: l.type || null,
    price: l.price != null ? Number(l.price) : null,
    area: l.area != null ? Number(l.area) : null,
    floor: l.floor != null ? Number(l.floor) : null,
    total_floors: l.totalFloors != null ? Number(l.totalFloors) : null,
    district: l.district || null,
    address: l.address != null ? l.address.trim() : null,
    city: l.city || 'Одеса',
    condition: l.condition || null,
    utilities: l.utilities || null,
    building_type: l.buildingType || null,
    parking: Boolean(l.parking),
    separate_entrance: Boolean(l.separateEntrance),
    description: l.description || null,
    images: Array.isArray(l.images) ? l.images.filter(Boolean) : [],
    features: Array.isArray(l.features) ? l.features.filter(Boolean) : [],
    status: 'draft' as const,
    is_active: isActiveBridge('draft'), // dual-write bridge, see above — keeps the draft hidden from the still-live old public RLS during the A→B window
    is_new: true,
    is_promoted: false,
    is_featured: false,
    views: 0,
    likes: 0,
    score: 0,
  }
}

// UPDATE row builder — shared by dbUpdateListing (full edit of an existing
// listing), dbSaveDraft's update-existing-draft path (autosave/step edits),
// and dbSubmitListingForReview (which layers status on top of this). Every
// field is coerced only when the caller actually supplied it (`!== undefined`)
// and otherwise omitted from the object entirely — Postgres UPDATE only
// touches the columns present in the SET list, so a partial wizard-step
// payload can never stomp a field it didn't touch with a fake default. Same
// "no fictitious values" reasoning as listingToRow() above.
function listingToUpdateRow(l: Partial<ListingData>) {
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (l.title !== undefined) row.title = (l.title || '').trim()
  if (l.type !== undefined) row.type = l.type || null
  if (l.price !== undefined) row.price = l.price != null ? Number(l.price) : null
  if (l.area !== undefined) row.area = l.area != null ? Number(l.area) : null
  if (l.floor !== undefined) row.floor = l.floor != null ? Number(l.floor) : null
  if (l.totalFloors !== undefined) row.total_floors = l.totalFloors != null ? Number(l.totalFloors) : null
  if (l.district !== undefined) row.district = l.district || null
  if (l.address !== undefined) row.address = (l.address || '').trim()
  if (l.city !== undefined) row.city = l.city || 'Одеса'
  if (l.condition !== undefined) row.condition = l.condition || null
  if (l.utilities !== undefined) row.utilities = l.utilities || null
  if (l.buildingType !== undefined) row.building_type = l.buildingType || null
  if (l.parking !== undefined) row.parking = Boolean(l.parking)
  if (l.separateEntrance !== undefined) row.separate_entrance = Boolean(l.separateEntrance)
  if (l.description !== undefined) row.description = l.description || null
  if (l.images !== undefined) row.images = Array.isArray(l.images) ? l.images.filter(Boolean) : []
  if (l.features !== undefined) row.features = Array.isArray(l.features) ? l.features.filter(Boolean) : []
  return row
}
export async function dbIncrementViews(id: number): Promise<void> {
  if (!isSupabaseReady()) return
  try {
    const { error } = await supabase.rpc('increment_listing_views', { listing_id: id })
    if (error) {
      console.error('[dbIncrementViews] RPC error:', error.message)
      const { data } = await supabase.from('listings').select('views').eq('id', id).single()
      if (data) {
        await supabase.from('listings').update({ views: (data.views || 0) + 1 }).eq('id', id)
      }
    }
  } catch (e) {
    console.error('[dbIncrementViews] catch:', e)
  }
}

export async function dbAdjustLikes(id: number, delta: 1 | -1): Promise<void> {
  if (!isSupabaseReady()) return
  try {
    const { error } = await supabase.rpc('adjust_listing_likes', { listing_id: id, delta })
    if (error) {
      console.error('[dbAdjustLikes] RPC error:', error.message)
      const { data } = await supabase.from('listings').select('likes').eq('id', id).single()
      if (data) {
        const newLikes = Math.max(0, (data.likes || 0) + delta)
        await supabase.from('listings').update({ likes: newLikes }).eq('id', id)
      }
    }
  } catch (e) {
    console.error('[dbAdjustLikes] catch:', e)
  }
}

// ── FAVORITES (per-user, persisted in Supabase) ───────────────
// The `favorites` table stores one row per (user_id, listing_id). The
// listings.likes counter is kept in sync automatically by a DB trigger
// (favorites_sync_likes), so the frontend must NOT also call
// adjust_listing_likes — that would double-count.

export async function dbGetUserFavorites(userId: string): Promise<number[]> {
  if (!isSupabaseReady() || !userId) return []
  try {
    // Filters on user_id_uuid (not the old text user_id) — that's the
    // column STAGE2's RLS policy (user_id_uuid = auth.uid()) will check,
    // and dbAddFavorite() below always populates it now.
    const { data, error } = await supabase
      .from('favorites')
      .select('listing_id')
      .eq('user_id_uuid', userId)
    if (error) { console.error('[dbGetUserFavorites]', error.message); return [] }
    return (data || []).map(r => Number(r.listing_id))
  } catch (e: any) {
    console.error('[dbGetUserFavorites] CATCH:', e?.message)
    return []
  }
}

export async function dbAddFavorite(userId: string, listingId: number): Promise<boolean> {
  if (!isSupabaseReady() || !userId) return false
  try {
    // Writes both user_id (old, kept for compat) and user_id_uuid (new
    // bridge column). onConflict still targets the old (user_id, listing_id)
    // unique constraint — that constraint isn't changing.
    const { error } = await supabase
      .from('favorites')
      .upsert(
        { user_id: userId, user_id_uuid: userId, listing_id: listingId },
        { onConflict: 'user_id,listing_id', ignoreDuplicates: true }
      )
    if (error) { console.error('[dbAddFavorite]', error.message); return false }
    return true
  } catch (e: any) {
    console.error('[dbAddFavorite] CATCH:', e?.message)
    return false
  }
}

export async function dbRemoveFavorite(userId: string, listingId: number): Promise<boolean> {
  if (!isSupabaseReady() || !userId) return false
  try {
    const { error } = await supabase
      .from('favorites')
      .delete()
      .eq('user_id_uuid', userId)
      .eq('listing_id', listingId)
    if (error) { console.error('[dbRemoveFavorite]', error.message); return false }
    return true
  } catch (e: any) {
    console.error('[dbRemoveFavorite] CATCH:', e?.message)
    return false
  }
}

export async function dbGetListingCounters(id: number): Promise<{ views: number; likes: number } | null> {
  if (!isSupabaseReady()) return null
  try {
    const { data, error } = await supabase
      .from('listings')
      .select('views, likes')
      .eq('id', id)
      .single()
    if (error || !data) return null
    return { views: data.views || 0, likes: data.likes || 0 }
  } catch {
    return null
  }
}
