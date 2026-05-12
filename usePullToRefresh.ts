import { useRef, useEffect, useState } from 'react'

interface Options {
  onRefresh: () => Promise<void>
  threshold?: number
}

export function usePullToRefresh({ onRefresh, threshold = 72 }: Options) {
  const [state, setState] = useState<'idle' | 'pulling' | 'ready' | 'refreshing'>('idle')
  const [pullY, setPullY] = useState(0)

  const startY = useRef(0)
  const isDragging = useRef(false)
  const isRefreshing = useRef(false)
  const currentPullY = useRef(0)
  const currentState = useRef<'idle' | 'pulling' | 'ready' | 'refreshing'>('idle')
  const onRefreshRef = useRef(onRefresh)

  // Always keep ref up to date — avoids stale closure
  useEffect(() => { onRefreshRef.current = onRefresh }, [onRefresh])

  useEffect(() => {
    const onTouchStart = (e: TouchEvent) => {
      if (isRefreshing.current) return
      const scrollTop = window.scrollY || document.documentElement.scrollTop
      if (scrollTop > 0) return
      startY.current = e.touches[0].clientY
      isDragging.current = true
    }

    const onTouchMove = (e: TouchEvent) => {
      if (!isDragging.current || isRefreshing.current) return
      const delta = e.touches[0].clientY - startY.current
      const scrollTop = window.scrollY || document.documentElement.scrollTop

      if (delta > 0 && scrollTop <= 0) {
        const clamped = Math.min(delta * 0.45, threshold * 1.5)
        currentPullY.current = clamped
        const newState = clamped >= threshold ? 'ready' : 'pulling'
        currentState.current = newState
        setPullY(clamped)
        setState(newState)
      } else {
        currentPullY.current = 0
        currentState.current = 'idle'
        setPullY(0)
        setState('idle')
      }
    }

    const onTouchEnd = async () => {
      if (!isDragging.current || isRefreshing.current) return
      isDragging.current = false

      if (currentPullY.current >= threshold) {
        isRefreshing.current = true
        currentState.current = 'refreshing'
        setState('refreshing')
        setPullY(0)
        try { await onRefreshRef.current() } catch {}
        isRefreshing.current = false
        currentState.current = 'idle'
        setState('idle')
      } else {
        currentPullY.current = 0
        currentState.current = 'idle'
        setPullY(0)
        setState('idle')
      }
    }

    window.addEventListener('touchstart', onTouchStart, { passive: true })
    window.addEventListener('touchmove', onTouchMove, { passive: true })
    window.addEventListener('touchend', onTouchEnd)

    return () => {
      window.removeEventListener('touchstart', onTouchStart)
      window.removeEventListener('touchmove', onTouchMove)
      window.removeEventListener('touchend', onTouchEnd)
    }
  }, [threshold]) // ← no onRefresh in deps, using ref instead

  return { state, pullY }
}
