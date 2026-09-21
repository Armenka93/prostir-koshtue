'use client'

interface Props {
  message?: string
  onRetry: () => void
  retrying?: boolean
}

// Spec §25/§30: an API error is never presented as an empty result — it
// gets its own state with a real retry action, distinct from EmptyState.
export default function ErrorState({ message = 'Не вдалося завантажити', onRetry, retrying = false }: Props) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '70px 24px', gap: 14, textAlign: 'center' }}>
      <div style={{
        width: 80, height: 80, background: '#2A1414', borderRadius: 24,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 36, border: '1px solid #3D2020',
      }}>⚠️</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: '#fff' }}>{message}</div>
      <div style={{ fontSize: 14, color: '#A0A8BC', lineHeight: 1.6, maxWidth: 280 }}>
        Перевірте з'єднання та спробуйте ще раз
      </div>
      <button
        onClick={onRetry}
        disabled={retrying}
        style={{
          padding: '13px 28px', marginTop: 6,
          background: retrying ? '#4B5563' : 'linear-gradient(135deg,#FF6B1A,#FF8C3A)',
          border: 'none', borderRadius: 12, color: '#fff', fontSize: 15, fontWeight: 700,
          cursor: retrying ? 'wait' : 'pointer', fontFamily: 'Inter, sans-serif',
        }}
      >
        {retrying ? '⏳ Спробуємо…' : 'Спробувати ще раз'}
      </button>
    </div>
  )
}
