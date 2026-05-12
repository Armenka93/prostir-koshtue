'use client'
import { useState, useRef, useEffect, useCallback } from 'react'

interface Props {
  images: string[]
  title?: string
  height?: number
  topLeft?: React.ReactNode
  topRight?: React.ReactNode
}

export default function ImageGallery({ images, title, height = 300, topLeft, topRight }: Props) {
  const [idx, setIdx] = useState(0)
  const [fullscreen, setFullscreen] = useState(false)
  const [fsIdx, setFsIdx] = useState(0)

  // Main slider state
  const [mainOffset, setMainOffset] = useState(0)
  const mainStart = useRef<number | null>(null)
  const mainDelta = useRef(0)

  // Fullscreen slider state
  const [fsOffset, setFsOffset] = useState(0)
  const fsStart = useRef<number | null>(null)
  const fsDelta = useRef(0)

  const total = images.length

  const goTo = useCallback((i: number) => {
    setIdx(Math.max(0, Math.min(i, total - 1)))
    setMainOffset(0)
    mainDelta.current = 0
  }, [total])

  const fsGoTo = useCallback((i: number) => {
    setFsIdx(Math.max(0, Math.min(i, total - 1)))
    setFsOffset(0)
    fsDelta.current = 0
  }, [total])

  // ── Main slider touch ──────────────────────────────────────
  const onMainTS = (e: React.TouchEvent) => {
    mainStart.current = e.touches[0].clientX
    mainDelta.current = 0
  }
  const onMainTM = (e: React.TouchEvent) => {
    if (mainStart.current === null) return
    mainDelta.current = e.touches[0].clientX - mainStart.current
    setMainOffset(mainDelta.current)
  }
  const onMainTE = useCallback(() => {
    if (mainDelta.current < -50) goTo(idx + 1)
    else if (mainDelta.current > 50) goTo(idx - 1)
    else goTo(idx)
    mainStart.current = null
  }, [idx, goTo])

  // Mouse (desktop)
  const onMainMD = (e: React.MouseEvent) => { mainStart.current = e.clientX; mainDelta.current = 0 }
  const onMainMM = (e: React.MouseEvent) => {
    if (mainStart.current === null) return
    mainDelta.current = e.clientX - mainStart.current
    setMainOffset(mainDelta.current)
  }
  const onMainMU = useCallback(() => {
    if (mainDelta.current < -50) goTo(idx + 1)
    else if (mainDelta.current > 50) goTo(idx - 1)
    else goTo(idx)
    mainStart.current = null
  }, [idx, goTo])

  // ── Fullscreen touch ────────────────────────────────────────
  const onFsTS = (e: React.TouchEvent) => {
    fsStart.current = e.touches[0].clientX
    fsDelta.current = 0
  }
  const onFsTM = (e: React.TouchEvent) => {
    if (fsStart.current === null) return
    fsDelta.current = e.touches[0].clientX - fsStart.current
    setFsOffset(fsDelta.current)
  }
  const onFsTE = useCallback(() => {
    if (fsDelta.current < -50) fsGoTo(fsIdx + 1)
    else if (fsDelta.current > 50) fsGoTo(fsIdx - 1)
    else fsGoTo(fsIdx)
    fsStart.current = null
  }, [fsIdx, fsGoTo])

  const onFsMD = (e: React.MouseEvent) => { fsStart.current = e.clientX; fsDelta.current = 0 }
  const onFsMM = (e: React.MouseEvent) => {
    if (fsStart.current === null) return
    fsDelta.current = e.clientX - fsStart.current
    setFsOffset(fsDelta.current)
  }
  const onFsMU = useCallback(() => {
    if (fsDelta.current < -50) fsGoTo(fsIdx + 1)
    else if (fsDelta.current > 50) fsGoTo(fsIdx - 1)
    else fsGoTo(fsIdx)
    fsStart.current = null
  }, [fsIdx, fsGoTo])

  // Keyboard nav in fullscreen
  useEffect(() => {
    if (!fullscreen) return
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFullscreen(false)
      if (e.key === 'ArrowRight') fsGoTo(fsIdx + 1)
      if (e.key === 'ArrowLeft') fsGoTo(fsIdx - 1)
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [fullscreen, fsIdx, fsGoTo])

  // Lock scroll in fullscreen
  useEffect(() => {
    if (fullscreen) {
      document.body.style.overflow = 'hidden'
      document.body.style.position = 'fixed'
      document.body.style.width = '100%'
    } else {
      document.body.style.overflow = ''
      document.body.style.position = ''
      document.body.style.width = ''
    }
    return () => {
      document.body.style.overflow = ''
      document.body.style.position = ''
      document.body.style.width = ''
    }
  }, [fullscreen])

  const dots = (current: number, setter: (i: number) => void) => (
    <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
      {images.map((_, i) => (
        <button key={i} onClick={e => { e.stopPropagation(); setter(i) }} style={{
          width: i === current ? 20 : 6, height: 6, borderRadius: 3,
          background: i === current ? '#FF6B1A' : 'rgba(255,255,255,0.4)',
          border: 'none', cursor: 'pointer', padding: 0,
          transition: 'all .2s ease', flexShrink: 0,
        }} />
      ))}
    </div>
  )

  return (
    <>
      {/* ── MAIN GALLERY ── */}
      <div style={{ position: 'relative', overflow: 'hidden', height, userSelect: 'none', WebkitUserSelect: 'none' }}>
        <div
          onTouchStart={onMainTS}
          onTouchMove={onMainTM}
          onTouchEnd={onMainTE}
          onMouseDown={onMainMD}
          onMouseMove={onMainMM}
          onMouseUp={onMainMU}
          onMouseLeave={onMainMU}
          onClick={() => { if (Math.abs(mainDelta.current) < 8) { setFsIdx(idx); setFullscreen(true) } }}
          style={{
            display: 'flex',
            width: `${total * 100}%`,
            height: '100%',
            transform: `translateX(calc(${-idx * (100 / total)}% + ${mainOffset / total}px))`,
            transition: mainStart.current ? 'none' : 'transform .28s cubic-bezier(.4,0,.2,1)',
            cursor: 'pointer',
            willChange: 'transform',
          }}
        >
          {images.map((src, i) => (
            <div key={i} style={{ width: `${100 / total}%`, flexShrink: 0, height: '100%' }}>
              {Math.abs(i - idx) <= 1
                ? <img src={src} alt={`${title} ${i + 1}`} draggable={false} loading={i === 0 ? 'eager' : 'lazy'} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', pointerEvents: 'none' }} />
                : <div style={{ width: '100%', height: '100%', background: '#1A1F2E' }} />
              }
            </div>
          ))}
        </div>

        {/* Gradients */}
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to bottom,rgba(0,0,0,.35) 0%,transparent 40%,rgba(15,17,23,.8) 100%)', pointerEvents: 'none' }} />

        {/* Slot buttons */}
        {topLeft}
        {topRight}

        {/* Counter */}
        {total > 1 && (
          <div style={{ position: 'absolute', top: 52, left: '50%', transform: 'translateX(-50%)', background: 'rgba(0,0,0,.55)', borderRadius: 20, padding: '3px 10px', fontSize: 12, color: 'rgba(255,255,255,.85)', pointerEvents: 'none', backdropFilter: 'blur(4px)' }}>
            {idx + 1} / {total}
          </div>
        )}

        {/* Dots */}
        {total > 1 && (
          <div style={{ position: 'absolute', bottom: 14, left: '50%', transform: 'translateX(-50%)' }}>
            {dots(idx, goTo)}
          </div>
        )}

        {/* Fullscreen hint */}
        {total > 1 && (
          <div style={{ position: 'absolute', bottom: 32, right: 14, background: 'rgba(0,0,0,.4)', borderRadius: 8, padding: '3px 8px', fontSize: 10, color: 'rgba(255,255,255,.55)', pointerEvents: 'none', backdropFilter: 'blur(4px)' }}>
            ⛶ fullscreen
          </div>
        )}
      </div>

      {/* ── FULLSCREEN LIGHTBOX ── */}
      {fullscreen && (
        <div
          style={{
            position: 'fixed', inset: 0,
            background: '#000',
            zIndex: 2000,
            display: 'flex',
            flexDirection: 'column',
            touchAction: 'none',
            WebkitUserSelect: 'none',
            userSelect: 'none',
          }}
        >
          {/* Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '48px 16px 12px', paddingTop: 'max(48px, env(safe-area-inset-top, 48px))', flexShrink: 0 }}>
            <span style={{ fontSize: 14, color: 'rgba(255,255,255,.6)', fontFamily: 'Inter,sans-serif' }}>{fsIdx + 1} / {total}</span>
            <button onClick={() => setFullscreen(false)} style={{ background: 'rgba(255,255,255,.12)', border: 'none', borderRadius: 10, width: 36, height: 36, cursor: 'pointer', color: '#fff', fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(8px)' }}>✕</button>
          </div>

          {/* Image area with swipe */}
          <div
            style={{ flex: 1, overflow: 'hidden', position: 'relative' }}
            onTouchStart={onFsTS}
            onTouchMove={onFsTM}
            onTouchEnd={onFsTE}
            onMouseDown={onFsMD}
            onMouseMove={onFsMM}
            onMouseUp={onFsMU}
            onMouseLeave={onFsMU}
          >
            <div style={{
              display: 'flex',
              width: `${total * 100}%`,
              height: '100%',
              transform: `translateX(calc(${-fsIdx * (100 / total)}% + ${fsOffset / total}px))`,
              transition: fsStart.current ? 'none' : 'transform .28s cubic-bezier(.4,0,.2,1)',
              willChange: 'transform',
            }}>
              {images.map((src, i) => (
                <div key={i} style={{ width: `${100 / total}%`, flexShrink: 0, height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {Math.abs(i - fsIdx) <= 1 && (
                    <img src={src} alt={`${i + 1}`} draggable={false} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', display: 'block', touchAction: 'pinch-zoom' }} />
                  )}
                </div>
              ))}
            </div>

            {/* Arrow buttons (desktop) */}
            {total > 1 && (
              <>
                <button onClick={() => fsGoTo(fsIdx - 1)} style={{
                  position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)',
                  background: 'rgba(255,255,255,.12)', border: 'none', borderRadius: 10,
                  width: 40, height: 40, cursor: 'pointer', color: '#fff', fontSize: 20,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  opacity: fsIdx === 0 ? 0.3 : 1, backdropFilter: 'blur(4px)',
                }}>‹</button>
                <button onClick={() => fsGoTo(fsIdx + 1)} style={{
                  position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
                  background: 'rgba(255,255,255,.12)', border: 'none', borderRadius: 10,
                  width: 40, height: 40, cursor: 'pointer', color: '#fff', fontSize: 20,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  opacity: fsIdx === total - 1 ? 0.3 : 1, backdropFilter: 'blur(4px)',
                }}>›</button>
              </>
            )}
          </div>

          {/* Dots + padding for iPhone */}
          {total > 1 && (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '14px 0', paddingBottom: 'max(24px, env(safe-area-inset-bottom, 24px))', flexShrink: 0 }}>
              {dots(fsIdx, fsGoTo)}
            </div>
          )}
        </div>
      )}
    </>
  )
}
