// Pure, framework/Supabase-independent retry policy for best-effort Storage
// cleanup — no network, no env vars, no module-load side effects (same
// reasoning as src/lib/listingImagePath.ts, unit-tested the same way via
// scripts/test-image-delete-retry.ts). The actual Storage call
// (dbDeleteListingImageDetailed in src/lib/db.ts) is injected as `deleteFn`
// so this can be driven deterministically in tests without a network call.
//
// Policy: 'error' (transient — the check passed but the Storage call
// itself failed) gets retried, up to maxAttempts total tries. 'refused'
// (deterministic — the URL failed ownership/path validation before any
// network call; the same input always fails the same way) is counted and
// never retried, since a retry cannot change its outcome.

export type ImageDeleteOutcome = 'ok' | 'refused' | 'error'

export interface FlushRetryResult {
  // URLs rejected by the ownership/path check — never retried.
  refusedCount: number
  // URLs that still hadn't succeeded after maxAttempts (all outcomes were
  // 'error' every time they were tried) — the caller's actual orphan list.
  remaining: string[]
}

export async function flushImageDeletesWithRetry(
  urls: string[],
  maxAttempts: number,
  deleteFn: (url: string) => Promise<ImageDeleteOutcome>
): Promise<FlushRetryResult> {
  let pending = urls
  let refusedCount = 0
  for (let attempt = 0; attempt < maxAttempts && pending.length > 0; attempt++) {
    const outcomes = await Promise.all(pending.map(async url => ({ url, result: await deleteFn(url) })))
    pending = outcomes.filter(({ result }) => result === 'error').map(({ url }) => url)
    refusedCount += outcomes.filter(({ result }) => result === 'refused').length
  }
  return { refusedCount, remaining: pending }
}
