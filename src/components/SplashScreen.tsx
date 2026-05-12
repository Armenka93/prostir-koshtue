'use client'

interface Props {
  onEnter: () => void
  onGuest: () => void
}

export default function SplashScreen({ onEnter, onGuest }: Props) {
  return (
    <div style={{
      height: '100dvh',
      background: '#0F1117',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '24px 24px env(safe-area-inset-bottom, 24px)',
    }}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <img
          src="/logo-main.png"
          alt="Простір Коштує"
          style={{ width: '70vw', maxWidth: 280, height: 'auto', objectFit: 'contain', marginBottom: 16 }}
          onError={(e) => {
            const t = e.target as HTMLImageElement
            t.onerror = null
            t.style.display = 'none'
            const placeholder = document.createElement('div')
            placeholder.innerHTML = `<div style="width:180px;height:180px;background:linear-gradient(135deg,#FF6B1A,#FFB020);border-radius:32px;display:flex;align-items:center;justify-content:center;font-size:72px;margin-bottom:16px">🏢</div>`
            t.parentElement?.insertBefore(placeholder, t)
          }}
        />
        <div style={{ fontSize: 14, color: '#A0A8BC', textAlign: 'center', lineHeight: 1.6, maxWidth: 280, fontFamily: 'Inter, sans-serif' }}>
          Оренда комерційної нерухомості — просто й вигідно
        </div>
      </div>

      <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 10, flexShrink: 0 }}>
        <button onClick={onEnter} style={{
          width: '100%',
          padding: '16px 24px',
          background: 'linear-gradient(135deg, #FF6B1A, #FF8C3A)',
          border: 'none',
          borderRadius: 16,
          color: '#fff',
          fontSize: 16,
          fontWeight: 700,
          cursor: 'pointer',
          fontFamily: 'Inter, sans-serif',
          boxShadow: '0 4px 24px rgba(255,107,26,0.4)',
          transition: 'opacity .15s',
        }}>
          Увійти / Зареєструватись
        </button>
        <button onClick={onGuest} style={{
          width: '100%',
          padding: '14px 24px',
          background: '#1A1F2E',
          border: '1px solid #2A3045',
          borderRadius: 16,
          color: '#A0A8BC',
          fontSize: 14,
          fontWeight: 500,
          cursor: 'pointer',
          fontFamily: 'Inter, sans-serif',
          transition: 'opacity .15s',
        }}>
          👁️ Переглянути як гість
        </button>
      </div>
    </div>
  )
}
