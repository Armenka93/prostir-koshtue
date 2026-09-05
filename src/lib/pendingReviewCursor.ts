// Pure, Supabase-independent logic for the moderation queue's composite
// cursor pagination (E.2.4, requirement 2). No import of supabase or React
// here — everything below is testable with plain objects (see
// scripts/test-pending-review-cursor.ts), the same pattern as
// autosaveEngine.ts / listingImagePath.ts.
//
// Why composite, not a single timestamp cursor: several rows can share the
// exact same pending_review_at (submitted in the same second, or — after a
// migration/backfill — literally the same value). A cursor on time alone
// (`pending_review_at > lastSeen`) would either skip every row that ties
// with the last row of a page, or (with `>=`) re-return the last row of
// the previous page forever. Ordering and paging by
// `(pending_review_at, id)` together, both strictly ascending, is stable:
// `id` is unique, so ties can never repeat or vanish across a page
// boundary.

export interface PendingReviewCursor {
  pendingReviewAt: string
  id: number
}

export interface PendingReviewCursorRow {
  id: number
  pendingReviewAt: string | null
}

// The PostgREST `.or()` filter string for "strictly after this cursor" in
// the composite order — used verbatim by dbGetPendingReviewListings in
// src/lib/db.ts. Kept here, not inlined there, so the same string-building
// logic is what the pure test below exercises.
export function buildCursorFilter(cursor: PendingReviewCursor): string {
  const ts = cursor.pendingReviewAt
  return `pending_review_at.gt.${ts},and(pending_review_at.eq.${ts},id.gt.${cursor.id})`
}

// Comparator for the same `(pending_review_at, id)` ascending order the
// real query uses. Caller must have already excluded null pendingReviewAt
// rows (see excludeNullPendingReviewAt) — comparing against null here
// would silently misorder rather than fail loud.
export function compareQueueRows(a: PendingReviewCursorRow, b: PendingReviewCursorRow): number {
  const ta = a.pendingReviewAt as string
  const tb = b.pendingReviewAt as string
  if (ta !== tb) return ta < tb ? -1 : 1
  return a.id - b.id
}

// A normal post-Migration-B pending_review row always has pending_review_at
// set by enforce_listing_lifecycle() at the moment of entry — see that
// migration's "Гарантии" comment. A row with status='pending_review' but
// pending_review_at=null can only be legacy/anomalous data (e.g. a row that
// somehow reached pending_review before Migration B existed, or a direct
// DB edit). SQL three-valued logic means a cursor filter like
// `pending_review_at > X` or `= X` is never true for a null value, so once
// such a row fell off a page (or was never the first page's cursor edge)
// it would be silently, permanently unreachable by further pages —
// corrupting pagination rather than just being "an odd row". Decision:
// exclude these rows from the cursor-paginated query entirely (this
// function), and surface their existence separately via a count
// (dbGetPendingReviewListings' `anomalousNullCount`) so they're never
// silently lost from view, just never mixed into the paginated list.
export function excludeNullPendingReviewAt<T extends PendingReviewCursorRow>(rows: T[]): T[] {
  return rows.filter(r => r.pendingReviewAt !== null)
}

export function nextCursorFrom(row: PendingReviewCursorRow): PendingReviewCursor | null {
  if (row.pendingReviewAt === null) return null
  return { pendingReviewAt: row.pendingReviewAt, id: row.id }
}

// Pure, Supabase-free reference simulation of what the real composite-
// cursor query (dbGetPendingReviewListings) returns for a given full
// dataset. Used ONLY by the test below to prove the pagination contract
// (no skips, no duplicates, stable across a shared-timestamp page
// boundary) — the real query in src/lib/db.ts talks to Postgres directly
// and relies on the DB doing this same ordering/filtering via
// idx_listings_pending_review_queue (status, pending_review_at, id); this
// function does not call it and is not a mock of it, it's an independent
// implementation of the same contract so a test can check they agree.
export function simulatePage<T extends PendingReviewCursorRow>(
  allRows: T[],
  cursor: PendingReviewCursor | null,
  pageSize: number
): { items: T[]; hasMore: boolean } {
  const visible = excludeNullPendingReviewAt(allRows).slice().sort(compareQueueRows)
  const after = cursor
    ? visible.filter(r => {
        const t = r.pendingReviewAt as string
        if (t > cursor.pendingReviewAt) return true
        if (t === cursor.pendingReviewAt && r.id > cursor.id) return true
        return false
      })
    : visible
  const hasMore = after.length > pageSize
  return { items: after.slice(0, pageSize), hasMore }
}
