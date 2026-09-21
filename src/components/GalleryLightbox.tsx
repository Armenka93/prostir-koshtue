'use client'
import { useEffect, useRef, useCallback } from 'react'

interface Props {
  images: string[]
  initialIndex: number
  title: string
  onIndexChange: (i: number) => void
  onClose: () => void
}

// Fullscreen photo viewer. Focus-trap/Escape/scroll-lock pattern mirrors
// ConfirmModal.tsx — the invoking element gets focus back via the
// caller's onClose (see DetailScreen's closeLightbox).
export default function GalleryLightbox({ images, initialIndex, title, onIndexChange, onClose }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const indexRef = useRef(initialIndex)
  indexRef.current = initialIndex

  const next = useCallback(() => onIndexChange((indexRef.current + 1) % images.length), [images.length, onIndexChange])
  const prev = useCallback(() => onIndexChange((indexRef.current - 1 + images.length) % images.length), [images.length, onIndexChange])

  useEffect(() => {
    closeRef.current?.focus()
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return }
      if (e.key === 'ArrowRight') { next(); return }
      if (e.key === 'ArrowLeft') { prev(); return }
      if (e.key !== 'Tab') return
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      )
      if (!focusable || focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [next, prev, onClose])

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 2000,
        background: 'rgba(6,8,16,0.96)',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        animation: 'fadeIn .15s ease',
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Фотогалерея — ${title}`}
        onClick={e => e.stopPropagation()}
        style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 16, position: 'relative' }}
      >
        <button
          ref={closeRef}
          onClick={onClose}
          aria-label="Закрити"
          style={{
            position: 'absolute', top: 16, right: 16, zIndex: 10,
            width: 44, height: 44, borderRadius: 12, background: 'rgba(255,255,255,0.08)',
            border: 'none', color: '#fff', fontSize: 20, cursor: 'pointer',
          }}
        >✕</button>

        {images.length > 1 && (
          <div style={{ position: 'absolute', top: 16, left: 16, background: 'rgba(255,255,255,0.08)', borderRadius: 20, padding: '8px 16px', color: '#fff', fontSize: 13, fontWeight: 600 }}>
            {initialIndex + 1}/{images.length}
          </div>
        )}

        <div style={{ position: 'relative', width: '100%', maxWidth: 1100, flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 0 }}>
          {images.length > 1 && (
            <button onClick={prev} aria-label="Попереднє фото" style={{
              position: 'absolute', left: 0, top: '50%', transform: 'translateY(-50%)',
              width: 48, height: 48, borderRadius: 12, background: 'rgba(255,255,255,0.08)',
              border: 'none', color: '#fff', fontSize: 24, cursor: 'pointer', zIndex: 5,
            }}>‹</button>
          )}
          <img
            src={images[initialIndex]}
            alt={`${title} — фото ${initialIndex + 1}`}
            style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: 8 }}
          />
          {images.length > 1 && (
            <button onClick={next} aria-label="Наступне фото" style={{
              position: 'absolute', right: 0, top: '50%', transform: 'translateY(-50%)',
              width: 48, height: 48, borderRadius: 12, background: 'rgba(255,255,255,0.08)',
              border: 'none', color: '#fff', fontSize: 24, cursor: 'pointer', zIndex: 5,
            }}>›</button>
          )}
        </div>

        {images.length > 1 && (
          <div style={{ display: 'flex', gap: 8, marginTop: 16, overflowX: 'auto', maxWidth: '100%', padding: '4px 0' }}>
            {images.map((src, i) => (
              <img
                key={i}
                src={src}
                alt=""
                onClick={() => onIndexChange(i)}
                style={{
                  width: 64, height: 48, objectFit: 'cover', borderRadius: 6, cursor: 'pointer', flexShrink: 0,
                  border: i === initialIndex ? '2px solid #FF6B1A' : '2px solid transparent', opacity: i === initialIndex ? 1 : 0.55,
                }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
