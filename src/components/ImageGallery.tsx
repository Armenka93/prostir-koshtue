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
  const [offset, setOffset] = useState(0)
  const dragStart = useRef<number | null>(null)
  const dragDelta = useRef(0)
  const total = images.length

  const goTo = useCallback((i: number) => {
    setIdx(Math.max(0, Math.min(i, total - 1)))
    setOffset(0)
  }, [total])

  const onTouchStart = (e: React.TouchEvent) => { dragStart.current = e.touches[0].clientX; dragDelta.current = 0 }
  const onTouchMove = (e: React.TouchEvent) => {
    if (dragStart.current === null) return
    dragDelta.current = e.touches[0].clientX - dragStart.current
    setOffset(dragDelta.current)
  }
  const onTouchEnd = () => {
    if (dragDelta.current < -50) goTo(idx + 1)
    else if (dragDelta.current > 50) goTo(idx - 1)
    else goTo(idx)
    dragStart.current = null
  }
  const onMouseDown = (e: React.MouseEvent) => { dragStart.current = e.clientX; dragDelta.current = 0 }
  const onMouseMove = (e: React.MouseEvent) => {
    if (dragStart.current === null) return
    dragDelta.current = e.clientX - dragStart.current
    setOffset(dragDelta.current)
  }
  const onMouseUp = () => {
    if (dragDelta.current < -50) goTo(idx + 1)
    else if (dragDelta.current > 50) goTo(idx - 1)
    else goTo(idx)
    dragStart.current = null
  }

  useEffect(() => {
    if (!fullscreen) return
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFullscreen(false)
      if (e.key === 'ArrowRight') setFsIdx(i => Math.min(i + 1, total - 1))
      if (e.key === 'ArrowLeft') setFsIdx(i => Math.max(i - 1, 0))
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [fullscreen, total])

  useEffect(() => {
    document.body.style.overflow = fullscreen ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [fullscreen])

  return (
    <>
      <div style={{ position: 'relative', overflow: 'hidden', height, userSelect: 'none' }}>
        <div
          onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}
          onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp}
          onClick={() => { if (Math.abs(dragDelta.current) < 8) { setFsIdx(idx); setFullscreen(true) } }}
          style={{
            display: 'flex', width: `${total * 100}%`, height: '100%',
            transform: `translateX(calc(${-idx * (100 / total)}% + ${offset / total}px))`,
            transition: dragStart.current ? 'none' : 'transform .28s cubic-bezier(.4,0,.2,1)',
            cursor: 'pointer',
          }}
        >
          {images.map((src, i) => (
            <div key={i} style={{ width: `${100 / total}%`, flexShrink: 0, height: '100%' }}>
              {Math.abs(i - idx) <= 1
                ? <img src={src} alt={title} draggable={false} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                : <div style={{ width: '100%', height: '100%', background: '#1A1F2E' }} />
              }
            </div>
          ))}
        </div>
        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 100, background: 'linear-gradient(to bottom, transparent 0%, rgba(15,17,23,0.7) 70%, rgba(15,17,23,0.95) 100%)', pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 80, background: 'linear-gradient(to bottom, rgba(0,0,0,0.4) 0%, transparent 100%)', pointerEvents: 'none' }} />
        {topLeft}
        {topRight}
        {total > 1 && (
          <div style={{ position: 'absolute', top: 52, left: '50%', transform: 'translateX(-50%)', background: 'rgba(0,0,0,0.5)', borderRadius: 20, padding: '3px 10px', fontSize: 12, color: 'rgba(255,255,255,0.85)', pointerEvents: 'none', backdropFilter: 'blur(4px)' }}>
            {idx + 1} / {total}
          </div>
        )}
        {total > 1 && (
          <div style={{ position: 'absolute', bottom: 14, left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: 5, alignItems: 'center' }}>
            {images.map((_, i) => (
              <button key={i} onClick={e => { e.stopPropagation(); goTo(i) }} style={{
                width: i === idx ? 20 : 6, height: 6, borderRadius: 3,
                background: i === idx ? '#FF6B1A' : 'rgba(255,255,255,0.45)',
                border: 'none', cursor: 'pointer', padding: 0, transition: 'all .2s ease',
              }} />
            ))}
          </div>
        )}
      </div>

      {fullscreen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.97)', zIndex: 1000, display: 'flex', flexDirection: 'column', animation: 'fadeIn .18s ease-out' }} onClick={() => setFullscreen(false)}>
          <div style={{ padding: '48px 16px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.7)' }}>{fsIdx + 1} / {total}</div>
            <button onClick={() => setFullscreen(false)} style={{ background: 'rgba(255,255,255,0.12)', border: 'none', borderRadius: 10, width: 36, height: 36, cursor: 'pointer', color: '#fff', fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
          </div>
          <div style={{ flex: 1, overflow: 'hidden', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={e => e.stopPropagation()}>
            <img src={images[fsIdx]} alt="" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', touchAction: 'pinch-zoom' }} />
          </div>
          {total > 1 && (
            <>
              <button onClick={e => { e.stopPropagation(); setFsIdx(i => Math.max(i - 1, 0)) }} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', background: 'rgba(255,255,255,0.12)', border: 'none', borderRadius: 10, width: 40, height: 40, cursor: 'pointer', color: '#fff', fontSize: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: fsIdx === 0 ? 0.3 : 1 }}>‹</button>
              <button onClick={e => { e.stopPropagation(); setFsIdx(i => Math.min(i + 1, total - 1)) }} style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'rgba(255,255,255,0.12)', border: 'none', borderRadius: 10, width: 40, height: 40, cursor: 'pointer', color: '#fff', fontSize: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: fsIdx === total - 1 ? 0.3 : 1 }}>›</button>
            </>
          )}
          <div style={{ padding: '14px 0 32px', display: 'flex', justifyContent: 'center', gap: 6, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
            {images.map((_, i) => (
              <button key={i} onClick={() => setFsIdx(i)} style={{ width: i === fsIdx ? 20 : 6, height: 6, borderRadius: 3, background: i === fsIdx ? '#FF6B1A' : 'rgba(255,255,255,0.3)', border: 'none', cursor: 'pointer', padding: 0, transition: 'all .2s' }} />
            ))}
          </div>
        </div>
      )}
    </>
  )
}
