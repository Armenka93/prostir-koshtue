// Unit tests for src/lib/pendingReviewCursor.ts — pure, no Supabase, no
// network, no env vars. Run via `npm run test:pending-review-cursor`
// (scripts/run-pending-review-cursor-test.js compiles + runs this and
// cleans up). Proves the E.2.4 requirement 2 pagination contract: a
// composite (pending_review_at, id) cursor across a page boundary where
// several rows share the exact same timestamp produces zero skips and
// zero duplicates, and that rows with a null pending_review_at never
// silently corrupt pagination.

import {
  buildCursorFilter,
  compareQueueRows,
  excludeNullPendingReviewAt,
  nextCursorFrom,
  simulatePage,
  type PendingReviewCursorRow,
} from '../src/lib/pendingReviewCursor'

let failed = false
function assert(cond: boolean, msg: string) {
  if (!cond) { failed = true; console.error('FAIL:', msg) }
  else console.log('ok:', msg)
}

function row(id: number, pendingReviewAt: string | null): PendingReviewCursorRow {
  return { id, pendingReviewAt }
}

function main() {
  // ── buildCursorFilter — exact PostgREST .or() string ────────────
  assert(
    buildCursorFilter({ pendingReviewAt: '2026-01-01T10:00:00.000Z', id: 42 }) ===
      'pending_review_at.gt.2026-01-01T10:00:00.000Z,and(pending_review_at.eq.2026-01-01T10:00:00.000Z,id.gt.42)',
    'buildCursorFilter produces the exact expected .or() filter string'
  )

  // ── compareQueueRows ─────────────────────────────────────────────
  assert(compareQueueRows(row(1, 'T1'), row(2, 'T2')) < 0, 'earlier timestamp sorts first')
  assert(compareQueueRows(row(2, 'T2'), row(1, 'T1')) > 0, 'later timestamp sorts after')
  assert(compareQueueRows(row(5, 'T1'), row(3, 'T1')) > 0, 'same timestamp — lower id sorts first (id tiebreak)')
  assert(compareQueueRows(row(3, 'T1'), row(3, 'T1')) === 0, 'identical row compares equal')

  // ── excludeNullPendingReviewAt ───────────────────────────────────
  const withNulls = [row(1, 'T1'), row(2, null), row(3, 'T2'), row(4, null)]
  assert(
    excludeNullPendingReviewAt(withNulls).map(r => r.id).join(',') === '1,3',
    'excludeNullPendingReviewAt drops every null-timestamp row and keeps the rest, in original order'
  )

  // ── nextCursorFrom ───────────────────────────────────────────────
  assert(nextCursorFrom(row(9, 'T9'))?.pendingReviewAt === 'T9' && nextCursorFrom(row(9, 'T9'))?.id === 9, 'nextCursorFrom builds a cursor from a real row')
  assert(nextCursorFrom(row(9, null)) === null, 'nextCursorFrom refuses to build a cursor from a null-timestamp row')

  // ── simulatePage — the actual pagination contract ────────────────

  // Scenario: 7 rows, 3 of which share the EXACT same pending_review_at —
  // exactly the case a timestamp-only cursor breaks on.
  const SHARED = '2026-02-01T09:00:00.000Z'
  const dataset: PendingReviewCursorRow[] = [
    row(10, '2026-02-01T08:00:00.000Z'), // page 1, oldest
    row(11, SHARED),                      // page 1
    row(12, SHARED),                      // page-boundary tie #1 → falls on page 1 (id tiebreak)
    row(13, SHARED),                      // page-boundary tie #2 → falls on page 2
    row(14, '2026-02-01T10:00:00.000Z'), // page 2
    row(15, '2026-02-01T11:00:00.000Z'), // page 3 (via hasMore)
    row(16, null),                        // anomalous — must never appear on any page
  ]

  // Page size 3 forces the boundary to land INSIDE the SHARED-timestamp
  // group (ids 11,12,13 all share SHARED) — ids 11 and 12 must land on
  // page 1, id 13 must land on page 2, with no skip and no duplicate.
  const page1 = simulatePage(dataset, null, 3)
  assert(page1.items.map(r => r.id).join(',') === '10,11,12', 'page 1 (size 3) returns the 3 oldest non-null rows in order, correctly splitting the shared-timestamp group')
  assert(page1.hasMore === true, 'page 1 reports hasMore=true (4 non-null rows remain)')
  assert(page1.items.every(r => r.pendingReviewAt !== null), 'no null-timestamp row ever appears in a page')

  const cursor1 = nextCursorFrom(page1.items[page1.items.length - 1])!
  assert(cursor1.id === 12 && cursor1.pendingReviewAt === SHARED, 'cursor after page 1 is built from the real last row (id 12, the shared timestamp)')

  const page2 = simulatePage(dataset, cursor1, 3)
  assert(page2.items.map(r => r.id).join(',') === '13,14,15', 'page 2 continues EXACTLY where page 1 left off — id 13 (same timestamp as 11/12, tie broken by id) is not skipped, not duplicated')
  assert(page2.hasMore === false, 'page 2 reports hasMore=false — nothing left after id 15')

  const cursor2 = nextCursorFrom(page2.items[page2.items.length - 1])!
  const page3 = simulatePage(dataset, cursor2, 3)
  assert(page3.items.length === 0, 'paging past the end returns an empty page, not an error or a repeat')
  assert(page3.hasMore === false, 'empty trailing page reports hasMore=false')

  // ── No skips, no duplicates across the FULL walk ──────────────────
  const allPaged = [...page1.items, ...page2.items, ...page3.items].map(r => r.id)
  const expectedNonNullIds = excludeNullPendingReviewAt(dataset).map(r => r.id).sort((a, b) => a - b)
  assert(
    JSON.stringify([...allPaged].sort((a, b) => a - b)) === JSON.stringify(expectedNonNullIds),
    'walking every page start-to-finish visits every non-null row EXACTLY once — no skips, no duplicates'
  )
  assert(!allPaged.includes(16), 'the anomalous null-timestamp row (id 16) never appears across the full walk')
  assert(new Set(allPaged).size === allPaged.length, 'no id repeats across the full walk (no duplicates)')

  // ── Small page (size 1) exercises every possible tie-boundary position ──
  let cursor: ReturnType<typeof nextCursorFrom> = null
  const walked: number[] = []
  for (let i = 0; i < 10; i++) {
    const p = simulatePage(dataset, cursor, 1)
    if (p.items.length === 0) break
    walked.push(...p.items.map(r => r.id))
    cursor = nextCursorFrom(p.items[p.items.length - 1])
    if (!p.hasMore) break
  }
  assert(walked.join(',') === '10,11,12,13,14,15', 'page-size-1 walk (worst case — a boundary at every single row) visits every non-null row in the exact correct order, once each')

  console.log('')
  if (failed) {
    console.error('PENDING REVIEW CURSOR TEST: FAILED')
    process.exit(1)
  } else {
    console.log('PENDING REVIEW CURSOR TEST: PASSED')
  }
}

main()
