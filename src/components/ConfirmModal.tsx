'use client'
import { useEffect } from 'react'

interface Props {
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export default function ConfirmModal({
  title, message,
  confirmLabel = 'Підтвердити',
  cancelLabel = 'Скасувати',
  danger = false,
  onConfirm, onCancel,
}: Props) {
  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onCancel])

  return (
    <div
      onClick={onCancel}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.65)',
        backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '0 24px',
        animation: 'fadeIn .15s ease',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#141928',
          border: '1px solid #252D45',
          borderRadius: 20,
          padding: '28px 24px 20px',
          width: '100%',
          maxWidth: 360,
          boxShadow: '0 24px 60px rgba(0,0,0,.6)',
          animation: 'slideUp .18s ease',
        }}
      >
        {/* Icon */}
        <div style={{
          width: 52, height: 52, borderRadius: 14,
          background: danger ? '#EF444418' : '#FF6B1A18',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 24, marginBottom: 16,
        }}>
          {danger ? '🗑️' : '❓'}
        </div>

        <div style={{ fontSize: 18, fontWeight: 700, color: '#fff', marginBottom: 8 }}>
          {title}
        </div>
        <div style={{ fontSize: 14, color: '#A0A8BC', lineHeight: 1.55, marginBottom: 24 }}>
          {message}
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={onCancel}
            style={{
              flex: 1, padding: '13px',
              background: '#1E2438', border: '1px solid #2A3045',
              borderRadius: 12, color: '#A0A8BC',
              fontSize: 15, fontWeight: 600, cursor: 'pointer',
              fontFamily: 'Inter, sans-serif',
            }}
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            style={{
              flex: 1, padding: '13px',
              background: danger
                ? 'linear-gradient(135deg,#EF4444,#DC2626)'
                : 'linear-gradient(135deg,#FF6B1A,#FF8C3A)',
              border: 'none',
              borderRadius: 12, color: '#fff',
              fontSize: 15, fontWeight: 700, cursor: 'pointer',
              fontFamily: 'Inter, sans-serif',
              boxShadow: danger
                ? '0 4px 14px rgba(239,68,68,.35)'
                : '0 4px 14px rgba(255,107,26,.35)',
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
