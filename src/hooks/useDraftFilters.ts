import { useState, useCallback } from 'react'

// Shared draft/applied filter mechanism (spec §07): opening the panel
// copies appliedFilters -> draftFilters; editing only touches the draft;
// "Показати N об'єктів" commits draft -> applied; closing without applying
// (Escape/backdrop/X) discards the draft and leaves applied untouched.
export function useDraftFilters<T>(applied: T, setApplied: (f: T) => void, baseFilters: T) {
  const [draft, setDraft] = useState<T>(applied)
  const [isOpen, setIsOpen] = useState(false)

  const open = useCallback(() => {
    setDraft(applied)
    setIsOpen(true)
  }, [applied])

  const close = useCallback(() => {
    setIsOpen(false)
  }, [])

  const apply = useCallback(() => {
    setApplied(draft)
    setIsOpen(false)
  }, [draft, setApplied])

  // Clears the draft only — the live results stay on the currently applied
  // filters until the user presses "Показати" (or the panel's apply action).
  const resetDraft = useCallback(() => {
    setDraft(baseFilters)
  }, [baseFilters])

  return { draft, setDraft, isOpen, open, close, apply, resetDraft }
}

// A "від/до" pair is invalid only when BOTH bounds are set and min > max.
// A single filled bound (the other left at 0 = unlimited) is always valid.
export function isRangeInvalid(min: number, max: number): boolean {
  return min > 0 && max > 0 && min > max
}

// Clamps a raw number input to a non-negative integer (empty/invalid -> 0,
// which this app's filter fields treat as "unlimited").
export function clampNonNegative(raw: string): number {
  const n = Math.trunc(+raw)
  return Number.isFinite(n) && n > 0 ? n : 0
}
