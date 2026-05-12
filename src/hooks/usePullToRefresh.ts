import { useRef, useCallback, useEffect, useState } from 'react'

interface Options {
  onRefresh: () => Promise<void>
  threshold?: number
  containerRef?: React.RefObject<HTMLElement>
}

export function usePullToRefresh({ onRefresh, threshold = 72, containerRef }: Options) {
  const [state, setState] = useState<'idle' | 'pulling' | 'ready' | 'refreshing'>('idle')
  const [pullY, setPullY] = useState(0)
  const startY = useRef(0)
  const isDragging = useRef(false)
  const isRefreshing = useRef(false)

  const getScrollTop = useCallback(() => {
    if (containerRef?.current) return containerRef.current.scrollTop
    return window.scrollY || document.documentElement.scrollTop
  }, [containerRef])

  const getTarget = useCallback((): EventTarget => {
    return containerRef?.current ?? window
  }, [containerRef])

  useEffect(() => {
    const target = getTarget()

    const onTouchStart = (e: Event) => {
      if (isRefreshing.current) return
      const touch = (e as TouchEvent).touches[0]
      startY.current = touch.clientY
      isDragging.current = true
    }

    const onTouchMove = (e: Event) => {
      if (!isDragging.current || isRefreshing.current) return
      const touch = (e as TouchEvent).touches[0]
      const delta = touch.clientY - startY.current
      const scrollTop = getScrollTop()

      if (delta > 0 && scrollTop <= 0) {
        const clamped = Math.min(delta * 0.45, threshold * 1.5)
        setPullY(clamped)
        setState(clamped >= threshold ? 'ready' : 'pulling')
      } else {
        setPullY(0)
        setState('idle')
      }
    }

    const onTouchEnd = async () => {
      if (!isDragging.current || isRefreshing.current) return
      isDragging.current = false

      if (state === 'ready' || pullY >= threshold) {
        isRefreshing.current = true
        setState('refreshing')
        setPullY(0)
        try { await onRefresh() } catch {}
        isRefreshing.current = false
        setState('idle')
      } else {
        setPullY(0)
        setState('idle')
      }
    }

    target.addEventListener('touchstart', onTouchStart, { passive: true })
    target.addEventListener('touchmove', onTouchMove, { passive: true })
    target.addEventListener('touchend', onTouchEnd)

    return () => {
      target.removeEventListener('touchstart', onTouchStart)
      target.removeEventListener('touchmove', onTouchMove)
      target.removeEventListener('touchend', onTouchEnd)
    }
  }, [state, pullY, threshold, onRefresh, getScrollTop, getTarget])

  return { state, pullY }
}
