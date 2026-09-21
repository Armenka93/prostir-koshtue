// Framework-independent autosave engine — no React, no Supabase, no DOM.
// Extracted specifically so its single-flight + freshness guarantees can be
// exercised by a deterministic test with fully controlled promises (see
// scripts/test-autosave-engine.ts), instead of only being reasoned about
// informally inside a React component.
//
// Guarantees (see the test script for the exact scenario each one covers):
//   1. At most one save() call in flight at a time.
//   2. A change (markDirty) that happens while a save is in flight causes
//      exactly one more save afterward, with a snapshot taken at THAT
//      later time (never the stale one from when the first save started).
//   3. A save's result is only reflected in onStateChange('saved'/'error')
//      if no NEWER change arrived while it was in flight — an old
//      response can never overwrite the status implied by a newer edit.
//   4. flush() resolves only once the ENTIRE chain (including any
//      follow-up triggered by edits during the last save) has drained —
//      not just whichever request happened to be in flight when flush()
//      was called.

export type AutosaveState = 'idle' | 'saving' | 'saved' | 'error'

export interface AutosaveEngine {
  /** Call whenever the underlying data changes. Debouncing is the caller's
   *  responsibility (this call is what actually schedules a save attempt). */
  markDirty(): void
  /** Force an immediate save of the latest data and wait for the entire
   *  chain (including any follow-up save triggered by a change that
   *  happened during it) to settle. */
  flush(): Promise<void>
  /** True once the most recently applied revision matches the latest
   *  known revision — i.e. nothing is dirty and no save is in flight. */
  isSettled(): boolean
  /** True while a save request is actually in flight. */
  isSaving(): boolean
}

export interface AutosaveEngineOptions<T> {
  /** Reads the CURRENT data at call time — never a cached/closed-over
   *  value. Called fresh at the start of every save attempt. */
  getSnapshot: () => T
  /** Persists one snapshot. Resolve `true` on success, `false` on a
   *  handled failure; throwing is treated the same as resolving `false`. */
  save: (snapshot: T) => Promise<boolean>
  onStateChange: (state: AutosaveState) => void
}

export function createAutosaveEngine<T>(opts: AutosaveEngineOptions<T>): AutosaveEngine {
  let dirty = false
  let saving = false
  let latestRevision = 0
  let appliedRevision = 0
  let activePromise: Promise<void> | null = null

  async function performSave(): Promise<void> {
    const revisionAtStart = latestRevision
    opts.onStateChange('saving')
    const snapshot = opts.getSnapshot()
    let ok = false
    try {
      ok = await opts.save(snapshot)
    } catch {
      ok = false
    }
    // A markDirty() that happened WHILE opts.save() was in flight has
    // already bumped latestRevision past revisionAtStart — this response
    // describes stale data and must not be allowed to claim "saved" (or
    // "error") over whatever the newer, still-pending revision implies.
    // The loop below will immediately start a fresh save for it instead.
    if (latestRevision === revisionAtStart) {
      opts.onStateChange(ok ? 'saved' : 'error')
    }
    if (ok) appliedRevision = revisionAtStart
  }

  async function loop(): Promise<void> {
    while (dirty) {
      dirty = false
      await performSave()
    }
  }

  function kick(): void {
    if (saving) return // a loop is already running — it will observe the fresh `dirty`/latestRevision on its own next iteration
    saving = true
    activePromise = loop().finally(() => { saving = false })
  }

  return {
    markDirty() {
      dirty = true
      latestRevision += 1
      kick()
    },
    async flush() {
      dirty = true
      latestRevision += 1
      kick()
      if (activePromise) await activePromise
    },
    isSettled() {
      return appliedRevision === latestRevision && !saving
    },
    isSaving() {
      return saving
    },
  }
}
