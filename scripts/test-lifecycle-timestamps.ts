// Unit tests for the lifecycle-timestamp transition table (E.2.4, 2nd round
// audit, п.1) — pure, no Supabase, no network, no env vars. Exercises
// scripts/lifecycleTimestampsModel.ts, a hand-maintained TypeScript mirror
// of enforce_listing_lifecycle()'s field-setting logic in
// supabase/migrations/20260830110000_listing_status_enforce.sql. Run via
// `npm run test:lifecycle-timestamps` (scripts/run-lifecycle-timestamps-test.js
// compiles + runs this and cleans up).
//
// This does NOT talk to Postgres and cannot catch the model and the .sql
// file drifting apart by itself — see the model file's header comment. It
// proves the DESIGNED table is internally consistent and matches the
// requirements below; the actual .sql was hand-verified line-by-line
// against this same table when written (see that file's "2nd round, п.1"
// comments at each transition).

import {
  applyInsert,
  applyUpdate,
  NULL_FIELDS,
  LifecycleTransitionError,
  type LifecycleFields,
  type ListingLifecycleStatus,
} from './lifecycleTimestampsModel'

let failed = false
function assert(cond: boolean, msg: string) {
  if (!cond) { failed = true; console.error('FAIL:', msg) }
  else console.log('ok:', msg)
}

const T1 = '2026-01-01T10:00:00.000Z' // an arbitrary earlier "OLD" instant
const NOW = '2026-01-02T12:00:00.000Z' // the transition's "now()"
const ADMIN_ID = 'admin-uuid'

function fieldsWith(overrides: Partial<LifecycleFields>): LifecycleFields {
  return { ...NULL_FIELDS, ...overrides }
}

function main() {
  // ── INSERT — draft, all six NULL regardless of role ─────────────
  {
    const r = applyInsert('draft')
    assert(r.status === 'draft', 'INSERT draft → status is draft')
    assert(JSON.stringify(r.fields) === JSON.stringify(NULL_FIELDS), 'INSERT draft → all six lifecycle fields NULL')
  }
  {
    let threw = false
    try { applyInsert('active') } catch (e) { threw = e instanceof LifecycleTransitionError && e.code === 'LISTING_STATUS_FORBIDDEN_INSERT' }
    assert(threw, 'INSERT with status != draft is rejected (LISTING_STATUS_FORBIDDEN_INSERT)')
  }

  // ── draft → pending_review (owner explicit submit) ───────────────
  {
    const old = { status: 'draft' as ListingLifecycleStatus, fields: NULL_FIELDS }
    const r = applyUpdate({ old, isAdmin: false, requestedStatus: 'pending_review', significantEdit: false, now: NOW, actorId: null })
    assert(r.status === 'pending_review', 'draft→pending_review: status becomes pending_review')
    assert(r.fields.pendingReviewAt === NOW, 'draft→pending_review: pending_review_at = now()')
    assert(r.fields.rejectionReason === null, 'draft→pending_review: rejection_reason = null')
    assert(r.fields.moderatedAt === null && r.fields.moderatedBy === null, 'draft→pending_review: moderated_at/by = null')
    assert(r.fields.publishedAt === null && r.fields.archivedAt === null, 'draft→pending_review: published_at/archived_at stay null')
  }

  // ── rejected → pending_review (owner resubmit) ────────────────────
  {
    const old = {
      status: 'rejected' as ListingLifecycleStatus,
      fields: fieldsWith({ pendingReviewAt: T1, moderatedAt: T1, moderatedBy: ADMIN_ID, rejectionReason: 'Фото не відповідають опису', publishedAt: null }),
    }
    const r = applyUpdate({ old, isAdmin: false, requestedStatus: 'pending_review', significantEdit: false, now: NOW, actorId: null })
    assert(r.fields.pendingReviewAt === NOW, 'rejected→pending_review: pending_review_at is a NEW now(), not the old T1')
    assert(r.fields.rejectionReason === null, 'rejected→pending_review: rejection_reason cleared')
    assert(r.fields.moderatedAt === null && r.fields.moderatedBy === null, 'rejected→pending_review: moderated_at/by cleared (old decision no longer applies)')
  }

  // ── значимая правка active/paused/archived → pending_review ──────
  for (const fromStatus of ['active', 'paused', 'archived'] as ListingLifecycleStatus[]) {
    const old = {
      status: fromStatus,
      fields: fieldsWith({
        publishedAt: T1,
        archivedAt: fromStatus === 'archived' ? T1 : null,
        moderatedAt: T1,
        moderatedBy: ADMIN_ID,
      }),
    }
    // requestedStatus intent is irrelevant here — significant edit always wins
    const r = applyUpdate({ old, isAdmin: false, requestedStatus: fromStatus, significantEdit: true, now: NOW, actorId: null })
    assert(r.status === 'pending_review', `significant edit on ${fromStatus}: forced into pending_review regardless of requested status`)
    assert(r.fields.pendingReviewAt === NOW, `significant edit on ${fromStatus}: pending_review_at = now()`)
    assert(r.fields.rejectionReason === null, `significant edit on ${fromStatus}: rejection_reason = null`)
    assert(r.fields.moderatedAt === null && r.fields.moderatedBy === null, `significant edit on ${fromStatus}: moderated_at/by cleared — new review cycle`)
    assert(r.fields.archivedAt === null, `significant edit on ${fromStatus}: archived_at cleared — no longer archived, must not look current`)
    assert(r.fields.publishedAt === T1, `significant edit on ${fromStatus}: published_at preserved as history`)
  }

  // ── pending_review → active (admin approve) ───────────────────────
  {
    const old = {
      status: 'pending_review' as ListingLifecycleStatus,
      fields: fieldsWith({ pendingReviewAt: T1, archivedAt: T1 /* stale, from before a significant-edit downgrade in a hypothetical earlier bug */ }),
    }
    const r = applyUpdate({ old, isAdmin: true, requestedStatus: 'active', significantEdit: false, now: NOW, actorId: ADMIN_ID })
    assert(r.fields.publishedAt === NOW, 'pending_review→active: published_at = now()')
    assert(r.fields.moderatedAt === NOW && r.fields.moderatedBy === ADMIN_ID, 'pending_review→active: moderated_at = now(), moderated_by = auth.uid()')
    assert(r.fields.archivedAt === null, 'pending_review→active: archived_at explicitly cleared')
    assert(r.fields.rejectionReason === null, 'pending_review→active: rejection_reason = null')
    assert(r.fields.pendingReviewAt === T1, 'pending_review→active: pending_review_at preserved (original submission time, decision does not overwrite it)')
  }

  // ── pending_review → rejected (admin reject) ──────────────────────
  {
    const old = {
      status: 'pending_review' as ListingLifecycleStatus,
      fields: fieldsWith({ pendingReviewAt: T1, publishedAt: T1 /* was live before a significant edit sent it back for review */ }),
    }
    const r = applyUpdate({ old, isAdmin: true, requestedStatus: 'rejected', significantEdit: false, rejectionReason: 'Неповна інформація', now: NOW, actorId: ADMIN_ID })
    assert(r.fields.moderatedAt === NOW && r.fields.moderatedBy === ADMIN_ID, 'pending_review→rejected: moderated_at = now(), moderated_by = auth.uid()')
    assert(r.fields.rejectionReason === 'Неповна інформація', 'pending_review→rejected: rejection_reason = the provided reason')
    assert(r.fields.publishedAt === T1, 'pending_review→rejected: published_at preserved as honest history, not cleared')
    assert(r.fields.archivedAt === null, 'pending_review→rejected: archived_at stays null (already null on this path)')
    assert(r.fields.pendingReviewAt === T1, 'pending_review→rejected: pending_review_at untouched')
  }
  {
    const old = { status: 'pending_review' as ListingLifecycleStatus, fields: NULL_FIELDS }
    let threw = false
    try { applyUpdate({ old, isAdmin: true, requestedStatus: 'rejected', significantEdit: false, rejectionReason: '   ', now: NOW, actorId: ADMIN_ID }) }
    catch (e) { threw = e instanceof LifecycleTransitionError && e.code === 'LISTING_REJECTION_REASON_REQUIRED' }
    assert(threw, 'pending_review→rejected with a blank reason is rejected (LISTING_REJECTION_REASON_REQUIRED)')
  }

  // ── active → paused (owner) ───────────────────────────────────────
  {
    const old = { status: 'active' as ListingLifecycleStatus, fields: fieldsWith({ publishedAt: T1, moderatedAt: T1, moderatedBy: ADMIN_ID }) }
    const r = applyUpdate({ old, isAdmin: false, requestedStatus: 'paused', significantEdit: false, now: NOW, actorId: null })
    assert(r.fields.publishedAt === T1, 'active→paused: published_at preserved as the date of last publication')
    assert(r.fields.archivedAt === null, 'active→paused: archived_at stays null')
    assert(r.fields.moderatedAt === T1 && r.fields.moderatedBy === ADMIN_ID, 'active→paused: moderated_at/by untouched')
  }

  // ── active/paused → archived (owner, and admin emergency) ────────
  for (const fromStatus of ['active', 'paused'] as ListingLifecycleStatus[]) {
    const old = { status: fromStatus, fields: fieldsWith({ publishedAt: T1, moderatedAt: T1, moderatedBy: ADMIN_ID }) }
    const rOwner = applyUpdate({ old, isAdmin: false, requestedStatus: 'archived', significantEdit: false, now: NOW, actorId: null })
    assert(rOwner.fields.archivedAt === NOW, `${fromStatus}→archived (owner): archived_at = now()`)
    assert(rOwner.fields.publishedAt === T1, `${fromStatus}→archived (owner): published_at preserved`)

    const rAdmin = applyUpdate({ old, isAdmin: true, requestedStatus: 'archived', significantEdit: false, now: NOW, actorId: ADMIN_ID })
    assert(rAdmin.fields.archivedAt === NOW, `${fromStatus}→archived (admin emergency): archived_at = now()`)
    assert(rAdmin.fields.moderatedAt === T1 && rAdmin.fields.moderatedBy === ADMIN_ID, `${fromStatus}→archived (admin emergency): moderated_at/by preserved`)
  }

  // ── paused/archived → active (owner restore) ─────────────────────
  for (const fromStatus of ['paused', 'archived'] as ListingLifecycleStatus[]) {
    const old = {
      status: fromStatus,
      fields: fieldsWith({
        publishedAt: T1,
        archivedAt: fromStatus === 'archived' ? T1 : null,
        moderatedAt: T1,
        moderatedBy: ADMIN_ID,
      }),
    }
    const r = applyUpdate({ old, isAdmin: false, requestedStatus: 'active', significantEdit: false, now: NOW, actorId: null })
    assert(r.fields.publishedAt === NOW, `${fromStatus}→active (restore): published_at = now() (restore counts as "published now")`)
    assert(r.fields.archivedAt === null, `${fromStatus}→active (restore): archived_at cleared`)
    assert(r.fields.rejectionReason === null, `${fromStatus}→active (restore): rejection_reason cleared`)
    assert(r.fields.moderatedAt === T1 && r.fields.moderatedBy === ADMIN_ID, `${fromStatus}→active (restore): moderated_at/by PRESERVED as history of last real review (documented decision — not a new moderation cycle)`)
  }

  // ── Guard rails not directly in the user's table, but load-bearing ──
  {
    const old = { status: 'draft' as ListingLifecycleStatus, fields: NULL_FIELDS }
    let threw = false
    try { applyUpdate({ old, isAdmin: false, requestedStatus: 'active', significantEdit: false, now: NOW, actorId: null }) }
    catch (e) { threw = e instanceof LifecycleTransitionError && e.code === 'LISTING_STATUS_FORBIDDEN_SELF_APPROVE' }
    assert(threw, 'owner cannot self-approve draft→active directly')
  }
  {
    const old = { status: 'pending_review' as ListingLifecycleStatus, fields: NULL_FIELDS }
    let threw = false
    try { applyUpdate({ old, isAdmin: false, requestedStatus: 'draft', significantEdit: false, now: NOW, actorId: null }) }
    catch (e) { threw = e instanceof LifecycleTransitionError && e.code === 'LISTING_LOCKED_PENDING_REVIEW' }
    assert(threw, 'owner is locked out of a pending_review row entirely, regardless of requested status')
  }

  console.log('')
  if (failed) {
    console.error('LIFECYCLE TIMESTAMPS TABLE TEST: FAILED')
    process.exit(1)
  } else {
    console.log('LIFECYCLE TIMESTAMPS TABLE TEST: PASSED')
  }
}

main()
