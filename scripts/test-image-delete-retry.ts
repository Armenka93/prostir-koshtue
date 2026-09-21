// Unit tests for src/lib/imageDeleteRetry.ts — pure, no Supabase, no
// network, no env vars. Run via `npm run test:image-delete-retry`
// (scripts/run-image-delete-retry-test.js compiles + runs this and cleans up).
//
// Exercises the three request shapes called out for this fix:
//   1. error -> ok            (transient failure, succeeds on retry)
//   2. error -> error -> error (retries exhausted, stays an orphan)
//   3. refused                (deterministic, must NOT be retried)

import { flushImageDeletesWithRetry, type ImageDeleteOutcome } from '../src/lib/imageDeleteRetry'

let failed = false
function assert(cond: boolean, msg: string) {
  if (!cond) { failed = true; console.error('FAIL:', msg) }
  else console.log('ok:', msg)
}

// Scripts a fixed sequence of outcomes per URL; records every call.
function scriptedDeleteFn(script: Record<string, ImageDeleteOutcome[]>) {
  const calls: string[] = []
  const cursor: Record<string, number> = {}
  const fn = async (url: string): Promise<ImageDeleteOutcome> => {
    calls.push(url)
    const seq = script[url]
    const i = cursor[url] ?? 0
    cursor[url] = i + 1
    // Once the scripted sequence is exhausted, keep returning its last
    // outcome — a test should never actually reach this (maxAttempts
    // bounds the real call count), but it keeps a bug loud instead of
    // throwing "undefined is not an ImageDeleteOutcome".
    return seq[Math.min(i, seq.length - 1)]
  }
  return { fn, calls }
}

async function testErrorThenOk() {
  const { fn, calls } = scriptedDeleteFn({ 'a.jpg': ['error', 'ok'] })
  const result = await flushImageDeletesWithRetry(['a.jpg'], 3, fn)
  assert(calls.length === 2, `error->ok: exactly 2 attempts made, got ${calls.length}`)
  assert(result.remaining.length === 0, `error->ok: nothing left orphaned, got ${JSON.stringify(result.remaining)}`)
  assert(result.refusedCount === 0, `error->ok: refusedCount is 0, got ${result.refusedCount}`)
}

async function testErrorExhausted() {
  const { fn, calls } = scriptedDeleteFn({ 'b.jpg': ['error', 'error', 'error'] })
  const result = await flushImageDeletesWithRetry(['b.jpg'], 3, fn)
  assert(calls.length === 3, `error x3: exactly 3 attempts made (maxAttempts), got ${calls.length}`)
  assert(
    result.remaining.length === 1 && result.remaining[0] === 'b.jpg',
    `error x3: b.jpg still orphaned after exhausting retries, got ${JSON.stringify(result.remaining)}`
  )
  assert(result.refusedCount === 0, `error x3: refusedCount is 0 (never a refusal), got ${result.refusedCount}`)
}

async function testRefusedNeverRetried() {
  const { fn, calls } = scriptedDeleteFn({ 'c.jpg': ['refused'] })
  const result = await flushImageDeletesWithRetry(['c.jpg'], 3, fn)
  assert(calls.length === 1, `refused: exactly 1 attempt made — never retried despite maxAttempts=3, got ${calls.length}`)
  assert(result.refusedCount === 1, `refused: counted once, got ${result.refusedCount}`)
  assert(result.remaining.length === 0, `refused: NOT reported as a retry-exhausted orphan (separate bucket), got ${JSON.stringify(result.remaining)}`)
}

async function testMixedBatchIndependent() {
  // Three URLs in the same call, each following its own script —
  // confirms attempts are tracked per-URL, not globally, matching how
  // page.tsx's handleUpdateListing calls this with the whole removedUrls
  // batch in one go.
  const { fn, calls } = scriptedDeleteFn({
    'ok-first.jpg': ['ok'],
    'ok-after-retry.jpg': ['error', 'ok'],
    'stuck.jpg': ['error', 'error', 'error'],
    'bad-owner.jpg': ['refused'],
  })
  const result = await flushImageDeletesWithRetry(
    ['ok-first.jpg', 'ok-after-retry.jpg', 'stuck.jpg', 'bad-owner.jpg'],
    3,
    fn
  )
  assert(result.refusedCount === 1, `mixed batch: exactly 1 refused, got ${result.refusedCount}`)
  assert(
    result.remaining.length === 1 && result.remaining[0] === 'stuck.jpg',
    `mixed batch: only stuck.jpg remains orphaned, got ${JSON.stringify(result.remaining)}`
  )
  // ok-first.jpg: 1 call, ok-after-retry.jpg: 2 calls, stuck.jpg: 3 calls, bad-owner.jpg: 1 call = 7
  assert(calls.length === 7, `mixed batch: call count matches per-URL attempt bounds, got ${calls.length}`)
}

async function main() {
  await testErrorThenOk()
  await testErrorExhausted()
  await testRefusedNeverRetried()
  await testMixedBatchIndependent()

  console.log('')
  if (failed) {
    console.error('IMAGE DELETE RETRY TEST: FAILED')
    process.exit(1)
  } else {
    console.log('IMAGE DELETE RETRY TEST: PASSED')
  }
}

main()
