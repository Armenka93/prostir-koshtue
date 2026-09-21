// A pure, hand-written REFERENCE MODEL of exactly what
// enforce_listing_lifecycle() (supabase/migrations/20260830110000_listing_status_enforce.sql)
// does to the six client-uncontrollable lifecycle fields — pending_review_at,
// published_at, archived_at, moderated_at, moderated_by, rejection_reason —
// for every real transition. NOT executable production code, NOT imported by
// the app: its only purpose is to be a plain-TypeScript, Supabase-free
// executable specification of the SQL trigger's field-setting table (E.2.4,
// 2nd round audit, п.1), so that table has an automated regression test
// instead of living only as a comment inside a .sql file that's never
// applied in this environment.
//
// IMPORTANT: this model does NOT accept "what the client sent" for any of
// the six fields at all — by construction, its signature has no parameter
// for them. That mirrors the actual protection in the SQL: every branch of
// the real trigger overwrites NEW.<field> from OLD/now()/auth.uid()/null
// BEFORE returning, so whatever value a forged request put in NEW.<field>
// is always discarded. A model that can't even accept those values is the
// cleanest way to encode "the client can't set this" as a type signature,
// not just a comment.
//
// Kept in sync BY HAND with the .sql file — if that file's field-setting
// logic changes, this model (and scripts/test-lifecycle-timestamps.ts) must
// be updated in the same change, or the test stops proving anything.

export type ListingLifecycleStatus = 'draft' | 'pending_review' | 'active' | 'rejected' | 'paused' | 'archived'

export interface LifecycleFields {
  pendingReviewAt: string | null
  publishedAt: string | null
  archivedAt: string | null
  moderatedAt: string | null
  moderatedBy: string | null
  rejectionReason: string | null
}

export const NULL_FIELDS: LifecycleFields = {
  pendingReviewAt: null,
  publishedAt: null,
  archivedAt: null,
  moderatedAt: null,
  moderatedBy: null,
  rejectionReason: null,
}

export class LifecycleTransitionError extends Error {
  constructor(public code: string) { super(code) }
}

interface TransitionResult {
  status: ListingLifecycleStatus
  fields: LifecycleFields
}

// Models the INSERT branch — no OLD exists yet. Mirrors: TG_OP='INSERT'
// checked and fully handled (including the six-field NULL reset) BEFORE any
// OLD.* reference exists in the real function.
export function applyInsert(requestedStatus: ListingLifecycleStatus): TransitionResult {
  if (requestedStatus !== 'draft') throw new LifecycleTransitionError('LISTING_STATUS_FORBIDDEN_INSERT')
  return { status: 'draft', fields: { ...NULL_FIELDS } }
}

export interface UpdateInput {
  old: { status: ListingLifecycleStatus; fields: LifecycleFields }
  isAdmin: boolean
  requestedStatus: ListingLifecycleStatus
  significantEdit: boolean // ignored when isAdmin
  rejectionReason?: string | null // admin reject only
  now: string
  actorId: string | null // auth.uid()
}

// Models the UPDATE branch (admin and owner) — mirrors enforce_listing_lifecycle()
// exactly for the six fields, including which are reset to OLD by default
// and which explicit transitions override that default.
export function applyUpdate(input: UpdateInput): TransitionResult {
  const { old, isAdmin, requestedStatus, significantEdit, now, actorId } = input

  if (isAdmin) {
    // Admin branch top-of-block reset (mirrors lines resetting
    // pending_review_at/published_at/archived_at to OLD before any if/elsif).
    let fields: LifecycleFields = {
      ...old.fields,
      pendingReviewAt: old.fields.pendingReviewAt,
      publishedAt: old.fields.publishedAt,
      archivedAt: old.fields.archivedAt,
    }

    if (requestedStatus !== old.status) {
      if (old.status === 'pending_review' && requestedStatus === 'active') {
        fields = {
          ...fields,
          moderatedAt: now,
          moderatedBy: actorId,
          rejectionReason: null,
          publishedAt: now,
          archivedAt: null,
        }
      } else if (old.status === 'pending_review' && requestedStatus === 'rejected') {
        const reason = input.rejectionReason
        if (!reason || reason.trim() === '') throw new LifecycleTransitionError('LISTING_REJECTION_REASON_REQUIRED')
        fields = {
          ...fields,
          moderatedAt: now,
          moderatedBy: actorId,
          rejectionReason: reason,
          // pending_review_at / published_at / archived_at: untouched (stay at the top reset value = OLD)
        }
      } else if ((old.status === 'active' || old.status === 'paused') && requestedStatus === 'archived') {
        fields = {
          ...fields,
          moderatedAt: old.fields.moderatedAt,
          moderatedBy: old.fields.moderatedBy,
          rejectionReason: old.fields.rejectionReason,
          archivedAt: now,
        }
      } else {
        throw new LifecycleTransitionError('LISTING_STATUS_FORBIDDEN_ADMIN_TRANSITION')
      }
    } else {
      fields = {
        ...fields,
        moderatedAt: old.fields.moderatedAt,
        moderatedBy: old.fields.moderatedBy,
        rejectionReason: old.fields.rejectionReason,
      }
    }
    return { status: requestedStatus, fields }
  }

  // ── Owner ──────────────────────────────────────────────────────
  if (old.status === 'pending_review') throw new LifecycleTransitionError('LISTING_LOCKED_PENDING_REVIEW')

  // Owner branch top-of-block reset — every field defaults to OLD.
  let fields: LifecycleFields = { ...old.fields }
  let finalStatus: ListingLifecycleStatus = requestedStatus

  if ((old.status === 'active' || old.status === 'paused' || old.status === 'archived') && significantEdit) {
    finalStatus = 'pending_review'
    fields = {
      ...fields,
      rejectionReason: null,
      pendingReviewAt: now,
      moderatedAt: null,
      moderatedBy: null,
      archivedAt: null,
      // publishedAt: untouched (stays OLD)
    }
  } else if (requestedStatus !== old.status) {
    if (requestedStatus === 'active') {
      if (old.status !== 'paused' && old.status !== 'archived') throw new LifecycleTransitionError('LISTING_STATUS_FORBIDDEN_SELF_APPROVE')
      fields = {
        ...fields,
        publishedAt: now,
        archivedAt: null,
        rejectionReason: null,
        // moderatedAt/moderatedBy: untouched (stay OLD, preserved as history)
      }
    } else if (requestedStatus === 'rejected') {
      throw new LifecycleTransitionError('LISTING_STATUS_FORBIDDEN_SELF_REJECT')
    } else if (requestedStatus === 'pending_review') {
      if (old.status !== 'draft' && old.status !== 'rejected') throw new LifecycleTransitionError('LISTING_STATUS_INVALID_TRANSITION')
      fields = {
        ...fields,
        rejectionReason: null,
        pendingReviewAt: now,
        moderatedAt: null,
        moderatedBy: null,
        archivedAt: null,
      }
    } else if (requestedStatus === 'paused') {
      if (old.status !== 'active') throw new LifecycleTransitionError('LISTING_STATUS_INVALID_TRANSITION')
      // no field changes beyond the top reset
    } else if (requestedStatus === 'archived') {
      if (old.status !== 'active' && old.status !== 'paused') throw new LifecycleTransitionError('LISTING_STATUS_INVALID_TRANSITION')
      fields = { ...fields, archivedAt: now }
    } else {
      throw new LifecycleTransitionError('LISTING_STATUS_INVALID_TRANSITION')
    }
  }
  // else: status unchanged, no significant edit — plain field edit, no lifecycle field changes beyond the top reset.

  return { status: finalStatus, fields }
}
