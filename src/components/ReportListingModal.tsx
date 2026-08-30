'use client'
import { useEffect, useRef, useState } from 'react'

interface Props {
  onClose: () => void
}

const REASONS = [
  'Неправдива інформація',
  'Дублікат оголошення',
  'Вже здано / продано',
  'Підозра на шахрайство',
  'Інше',
]

// No backend for reports yet — this honestly tells the user that
// instead of pretending to submit anywhere. Focus-trap/Escape pattern
// mirrors ConfirmModal.tsx.
export default function ReportListingModal({ onClose }: Props) {
  const [reason, setReason] = useState(REASONS[0])
  const [comment, setComment] = useState('')
  const [sent, setSent] = useState(false)
  const dialogRef = useRef<HTMLDivElement>(null)
  const firstRef = useRef<HTMLElement | null>(null)
  const titleId = 'report-modal-title'

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null
    firstRef.current?.focus()
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return }
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
      previouslyFocused?.focus()
    }
  }, [onClose])

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 24px', animation: 'fadeIn .15s ease',
    }}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={e => e.stopPropagation()}
        style={{ background: '#141928', border: '1px solid #252D45', borderRadius: 20, padding: '24px', width: '100%', maxWidth: 400, boxShadow: '0 24px 60px rgba(0,0,0,.6)', animation: 'slideUp .18s ease' }}
      >
        {sent ? (
          <>
            <div style={{ fontSize: 32, marginBottom: 12 }}>✅</div>
            <div id={titleId} style={{ fontSize: 17, fontWeight: 700, color: '#fff', marginBottom: 8 }}>Дякуємо</div>
            <div style={{ fontSize: 14, color: '#A0A8BC', lineHeight: 1.55, marginBottom: 20 }}>
              Наразі відправка скарг ще не підключена до сервера — ця форма поки не надсилає дані. Функція буде додана пізніше.
            </div>
            <button ref={el => { firstRef.current = el }} onClick={onClose} style={{ width: '100%', padding: 13, background: '#1E2438', border: '1px solid #2A3045', borderRadius: 12, color: '#fff', fontSize: 15, fontWeight: 600, cursor: 'pointer' }}>
              Закрити
            </button>
          </>
        ) : (
          <>
            <div id={titleId} style={{ fontSize: 17, fontWeight: 700, color: '#fff', marginBottom: 4 }}>Поскаржитися на оголошення</div>
            <div style={{ fontSize: 13, color: '#6B7280', marginBottom: 18 }}>Оберіть причину — це допоможе нам розібратися.</div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
              {REASONS.map((r, i) => (
                <label key={r} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: reason === r ? '#1E2438' : 'transparent', border: '1px solid ' + (reason === r ? '#FF6B1A66' : '#2A3045'), borderRadius: 10, cursor: 'pointer' }}>
                  <input
                    ref={i === 0 ? (el => { firstRef.current = el }) : undefined}
                    type="radio"
                    name="report-reason"
                    checked={reason === r}
                    onChange={() => setReason(r)}
                    style={{ accentColor: '#FF6B1A', width: 16, height: 16, appearance: 'auto' }}
                  />
                  <span style={{ fontSize: 14, color: '#fff' }}>{r}</span>
                </label>
              ))}
            </div>

            <textarea
              value={comment}
              onChange={e => setComment(e.target.value)}
              placeholder="Додатковий коментар (необов'язково)"
              rows={3}
              style={{ width: '100%', background: '#0F1117', border: '1px solid #2A3045', borderRadius: 10, padding: '10px 12px', color: '#fff', fontSize: 13, resize: 'vertical', marginBottom: 20, fontFamily: 'Inter, sans-serif' }}
            />

            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={onClose} style={{ flex: 1, padding: 13, background: '#1E2438', border: '1px solid #2A3045', borderRadius: 12, color: '#A0A8BC', fontSize: 15, fontWeight: 600, cursor: 'pointer' }}>
                Скасувати
              </button>
              <button onClick={() => setSent(true)} style={{ flex: 1, padding: 13, background: 'linear-gradient(135deg,#FF6B1A,#FF8C3A)', border: 'none', borderRadius: 12, color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer' }}>
                Надіслати
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
