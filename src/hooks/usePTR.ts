import { useState, useRef, useEffect } from 'react'

export function usePTR(onRefresh?: () => Promise<void>) {
  const [state, setState] = useState<'idle'|'pulling'|'ready'|'refreshing'>('idle')
  const [pullY, setPullY] = useState(0)
  const startY = useRef(0)
  const drag = useRef(false)
  const busy = useRef(false)
  const fn = useRef(onRefresh)
  useEffect(() => { fn.current = onRefresh }, [onRefresh])

  useEffect(() => {
    if (!onRefresh) return
    const THRESHOLD = 64
    const onTS = (e: TouchEvent) => {
      if (window.scrollY > 4 || busy.current) return
      startY.current = e.touches[0].clientY
      drag.current = true
    }
    const onTM = (e: TouchEvent) => {
      if (!drag.current || busy.current) return
      const dy = e.touches[0].clientY - startY.current
      if (dy <= 0) { setPullY(0); setState('idle'); return }
      const y = Math.min(dy * 0.4, 100)
      setPullY(y)
      setState(y >= THRESHOLD ? 'ready' : 'pulling')
    }
    const onTE = async () => {
      if (!drag.current) return
      drag.current = false
      const y = pullY
      if (y >= THRESHOLD && !busy.current) {
        busy.current = true
        setState('refreshing')
        setPullY(0)
        await fn.current?.().catch(() => {})
        busy.current = false
        setState('idle')
      } else {
        setPullY(0)
        setState('idle')
      }
    }
    window.addEventListener('touchstart', onTS, { passive: true })
    window.addEventListener('touchmove', onTM, { passive: true })
    window.addEventListener('touchend', onTE)
    return () => {
      window.removeEventListener('touchstart', onTS)
      window.removeEventListener('touchmove', onTM)
      window.removeEventListener('touchend', onTE)
    }
  }, [onRefresh, pullY])

  return { state, pullY }
}
