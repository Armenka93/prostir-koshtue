// Deterministic test for src/lib/autosaveEngine.ts — no React, no Supabase,
// no network. Run with `npm run test:autosave` (wraps
// scripts/run-autosave-test.js, which compiles this + the engine to a
// scratch dir, runs it with node, and always cleans the scratch dir up).
//
// Scenario exactly as specified: save A is sent; while A is still pending,
// the data changes (B); A's response arrives; a save for B is sent; only
// once B's response arrives does the engine report "saved". A's (stale)
// response must NOT report "saved" once B is already pending, and there
// must be exactly one save call for A and exactly one for B — never a
// re-send of A's now-stale snapshot.

import { createAutosaveEngine, type AutosaveState } from '../src/lib/autosaveEngine'

interface Deferred<T> {
  promise: Promise<T>
  resolve: (v: T) => void
}
function defer<T>(): Deferred<T> {
  let resolve!: (v: T) => void
  const promise = new Promise<T>(res => { resolve = res })
  return { promise, resolve }
}

let failed = false
function assert(cond: boolean, msg: string) {
  if (!cond) {
    failed = true
    console.error('FAIL:', msg)
  } else {
    console.log('ok:', msg)
  }
}

async function main() {
  const calls: string[] = []              // snapshots actually sent to save()
  const stateLog: AutosaveState[] = []     // every onStateChange emission
  const pending: Record<string, Deferred<boolean>> = {}

  let data = 'A' // the "current data" the engine reads at save-time

  const engine = createAutosaveEngine<string>({
    getSnapshot: () => data,
    save: (snapshot) => {
      calls.push(snapshot)
      const d = defer<boolean>()
      pending[snapshot] = d
      return d.promise
    },
    onStateChange: (s) => stateLog.push(s),
  })

  // ── Step 1: A is sent ──────────────────────────────────────────
  engine.markDirty()
  // Let the microtask queue run so performSave's synchronous prefix
  // (onStateChange('saving'), getSnapshot(), calling save()) executes.
  await Promise.resolve()
  await Promise.resolve()

  assert(calls.length === 1 && calls[0] === 'A', 'exactly one save call so far, for snapshot "A"')
  assert(stateLog[stateLog.length - 1] === 'saving', 'state is "saving" while A is in flight')

  // ── Step 2: while A is still pending, data changes to B ─────────
  data = 'B'
  engine.markDirty()
  await Promise.resolve()

  // B must NOT have been sent yet — only one save in flight at a time.
  assert(calls.length === 1, 'no second save is sent while A is still in flight (single-flight)')

  // ── Step 3: A's response arrives ─────────────────────────────────
  const stateLenBeforeAResolves = stateLog.length
  pending['A'].resolve(true)
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()

  const emittedWhileHandlingAsResponse = stateLog.slice(stateLenBeforeAResolves)
  assert(
    !emittedWhileHandlingAsResponse.includes('saved'),
    'A\'s response does not emit "saved" — a newer revision (B) was already pending when it arrived'
  )

  // ── Step 4: B is now sent, with the FRESH snapshot ("B"), not a
  // re-send of the stale "A" ──────────────────────────────────────
  assert(calls.length === 2, 'exactly one follow-up save was sent after A resolved')
  assert(calls[1] === 'B', 'the follow-up save carries the FRESH snapshot ("B"), not a repeat of the stale one ("A")')
  assert(!engine.isSettled(), 'engine is not settled yet — B\'s response has not arrived')

  const stateBeforeBResolves = stateLog.slice()

  // ── Step 5: B's response arrives — THIS is when "saved" may appear ──
  pending['B'].resolve(true)
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()

  assert(stateLog[stateLog.length - 1] === 'saved', 'final state is "saved", and only after B\'s response arrived')
  assert(!stateBeforeBResolves.includes('saved'), '"saved" was never emitted before B actually resolved (no premature/stale success)')
  assert(engine.isSettled(), 'engine reports settled once B is confirmed and nothing further is dirty')
  assert(calls.length === 2, 'still exactly 2 save calls total — A was never re-sent, B was sent exactly once')

  console.log('')
  console.log('save() calls, in order:', JSON.stringify(calls))
  console.log('onStateChange sequence:', JSON.stringify(stateLog))

  if (failed) {
    console.error('\nAUTOSAVE ENGINE TEST: FAILED')
    process.exit(1)
  } else {
    console.log('\nAUTOSAVE ENGINE TEST: PASSED')
  }
}


main()
