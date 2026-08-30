'use client'
import type { User } from '@/types'

interface Props {
  user: User | null
  onLogin: () => void
  onProfile: () => void
  onAddListing: () => void
  onGoHome: () => void
  onComingSoon: (label: string) => void
}

// Tablet+ only (hidden via CSS below 768px, see .desktop-header in
// globals.css). Fixed/full-width by design so it never depends on the
// 430px mobile shell in layout.tsx — see the D.1 CSS block for why that
// matters. The mobile header/BottomNav are untouched by this component.
export default function DesktopHeader({ user, onLogin, onProfile, onAddListing, onGoHome, onComingSoon }: Props) {
  const navLinkStyle: React.CSSProperties = {
    background: 'none', border: 'none', cursor: 'pointer',
    fontSize: 15, fontWeight: 600, fontFamily: 'Inter, sans-serif',
    padding: '8px 4px', color: '#fff',
  }

  return (
    <header className="desktop-header" style={{
      position: 'fixed', top: 0, left: 0, right: 0, height: 80, zIndex: 300,
      alignItems: 'center', justifyContent: 'center',
      background: '#0D1018', borderBottom: '1px solid #1E2334',
    }}>
      <div style={{
        width: '100%', maxWidth: 1440, padding: '0 32px',
        display: 'flex', alignItems: 'center', gap: 32,
      }}>
        <button onClick={onGoHome} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', flexShrink: 0 }} aria-label="Простір Коштує — на головну">
          <img src="/logo-horizontal.png" alt="Простір Коштує" style={{ height: 40, width: 'auto', objectFit: 'contain' }} />
        </button>

        <nav style={{ display: 'flex', alignItems: 'center', gap: 8 }} aria-label="Основна навігація">
          <button onClick={onGoHome} style={{ ...navLinkStyle, color: '#FF6B1A', position: 'relative' }} aria-current="page">
            Оголошення
            <span style={{ position: 'absolute', left: 4, right: 4, bottom: 0, height: 2, background: '#FF6B1A', borderRadius: 2 }} />
          </button>
          <button onClick={() => onComingSoon('Власникам')} style={navLinkStyle}>Власникам</button>
          <button onClick={() => onComingSoon('Про сервіс')} style={navLinkStyle}>Про сервіс</button>
        </nav>

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={onAddListing} style={{
            background: 'linear-gradient(135deg,#FF6B1A,#FF8C3A)', border: 'none', borderRadius: 12,
            padding: '10px 18px', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer',
            fontFamily: 'Inter, sans-serif', whiteSpace: 'nowrap',
          }}>+ Додати оголошення</button>

          {user ? (
            <button onClick={onProfile} style={{
              width: 40, height: 40, borderRadius: 10, border: 'none', cursor: 'pointer',
              background: 'linear-gradient(135deg,#FF6B1A,#FFB020)',
              color: '#fff', fontSize: 15, fontWeight: 700,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>{user.name?.charAt(0)?.toUpperCase() || '?'}</button>
          ) : (
            <button onClick={onLogin} style={{
              background: '#1A1F2E', border: '1px solid #2A3045', borderRadius: 12,
              padding: '10px 18px', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer',
              fontFamily: 'Inter, sans-serif', whiteSpace: 'nowrap',
            }}>Увійти</button>
          )}
        </div>
      </div>
    </header>
  )
}
