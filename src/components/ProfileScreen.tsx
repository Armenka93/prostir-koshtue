'use client'
import { useState } from 'react'
import type { User } from '@/types'

interface Props {
  user: User | null
  isGuest: boolean
  onLogin: () => void
  onAddListing: () => void
  onFeedback: () => void
  favCount: number
  onLogout: () => void
  showToast: (m: string) => void
}

export default function ProfileScreen({ user, isGuest, onLogin, onAddListing, onFeedback, favCount, onLogout, showToast }: Props) {
  const [notifications, setNotifications] = useState(true)

  if (isGuest || !user) {
    return (
      <div style={{ paddingBottom: 80 }}>
        <div style={{ padding: '48px 20px 16px', background: '#0D1018' }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: '#fff' }}>Профіль</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '60px 24px', textAlign: 'center' }}>
          <img src="/logo-120.png" alt="" style={{ width: 80, height: 80, borderRadius: 20, marginBottom: 20 }}
            onError={e => { const t = e.target as HTMLImageElement; t.style.display='none' }} />
          <div style={{ fontSize: 20, fontWeight: 700, color: '#fff', marginBottom: 8 }}>Ви переглядаєте як гість</div>
          <div style={{ fontSize: 14, color: '#A0A8BC', lineHeight: 1.6, maxWidth: 280, marginBottom: 24 }}>
            Увійдіть для доступу до збережених та додавання приміщень
          </div>
          <button onClick={onLogin} style={{ padding: '16px 40px', background: 'linear-gradient(135deg,#FF6B1A,#FF8C3A)', border: 'none', borderRadius: 14, color: '#fff', fontSize: 16, fontWeight: 700, cursor: 'pointer', boxShadow: '0 4px 20px rgba(255,107,26,.35)' }}>
            Увійти / Зареєструватись
          </button>
        </div>
      </div>
    )
  }

  return (
    <div style={{ paddingBottom: 90 }}>
      {/* Header + profile card */}
      <div style={{ padding: '48px 20px 20px', background: '#0D1018' }}>
        <div style={{ fontSize: 22, fontWeight: 800, color: '#fff', marginBottom: 20 }}>Профіль</div>
        <div style={{ background: '#1A1F2E', borderRadius: 18, padding: 18, border: '1px solid #2A3045' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
            <div style={{ width: 56, height: 56, borderRadius: 18, flexShrink: 0, background: 'linear-gradient(135deg,#FF6B1A,#FFB020)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, fontWeight: 800, color: '#fff' }}>
              {user.name?.charAt(0)?.toUpperCase() || '?'}
            </div>
            <div>
              <div style={{ fontSize: 17, fontWeight: 700, color: '#fff' }}>{user.name || '—'}</div>
              <div style={{ fontSize: 13, color: '#A0A8BC', marginTop: 2 }}>{user.email}</div>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ background: '#0F1117', borderRadius: 12, padding: '12px 14px' }}>
              <div style={{ fontSize: 11, color: '#6B7280', textTransform: 'uppercase' as const, letterSpacing: '.5px', marginBottom: 3 }}>Телефон</div>
              {user.phone ? (
                <div style={{ fontSize: 15, fontWeight: 600, color: '#fff' }}>{user.phone}</div>
              ) : (
                <div style={{ fontSize: 13, color: '#EF4444' }}>Не вказано</div>
              )}
            </div>
            <div style={{ background: '#0F1117', borderRadius: 12, padding: '12px 14px' }}>
              <div style={{ fontSize: 11, color: '#6B7280', textTransform: 'uppercase' as const, letterSpacing: '.5px', marginBottom: 3 }}>Роль</div>
              <div style={{ fontSize: 14, color: '#A0A8BC' }}>
                {user.role === 'admin' ? '🛡️ Адмін' : user.role === 'landlord' ? '🏢 Орендодавець' : '👤 Користувач'}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div style={{ padding: '0 20px 20px' }}>
        {/* Stats */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
          <div style={{ flex: 1, background: '#1A1F2E', borderRadius: 14, padding: '14px 10px', textAlign: 'center', border: '1px solid #2A3045' }}>
            <div style={{ fontSize: 20, marginBottom: 4 }}>❤️</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: '#FF6B1A' }}>{favCount}</div>
            <div style={{ fontSize: 11, color: '#A0A8BC', marginTop: 2 }}>Збережено</div>
          </div>
        </div>

        {/* Add listing */}
        <button onClick={onAddListing} style={{
          width: '100%', padding: '16px', marginBottom: 16,
          background: 'rgba(255,107,26,0.08)', border: '1px solid rgba(255,107,26,0.3)',
          borderRadius: 14, color: '#FF6B1A', fontSize: 15, fontWeight: 600, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        }}>➕ Додати приміщення</button>

        {/* Settings */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 12, color: '#6B7280', fontWeight: 600, letterSpacing: '.8px', textTransform: 'uppercase' as const, marginBottom: 8 }}>Налаштування</div>
          <div style={{ background: '#1A1F2E', borderRadius: 16, overflow: 'hidden', border: '1px solid #2A3045' }}>
            <div style={{ display: 'flex', alignItems: 'center', padding: '14px 16px', borderBottom: '1px solid #2A3045' }}>
              <span style={{ fontSize: 18, marginRight: 12 }}>🔔</span>
              <span style={{ flex: 1, fontSize: 15, color: '#fff' }}>Сповіщення</span>
              <div onClick={() => setNotifications(n => !n)} style={{
                width: 44, height: 26, borderRadius: 13,
                background: notifications ? '#FF6B1A' : '#2A3045',
                position: 'relative', cursor: 'pointer', transition: 'background .2s',
              }}>
                <div style={{
                  position: 'absolute', top: 3,
                  left: notifications ? 21 : 3,
                  width: 20, height: 20, borderRadius: '50%', background: '#fff',
                  transition: 'left .2s', boxShadow: '0 1px 4px rgba(0,0,0,0.3)',
                }} />
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', padding: '14px 16px', cursor: 'pointer' }} onClick={() => showToast('Простір Коштує v1.0.0')}>
              <span style={{ fontSize: 18, marginRight: 12 }}>ℹ️</span>
              <span style={{ flex: 1, fontSize: 15, color: '#fff' }}>Про додаток</span>
              <span style={{ fontSize: 13, color: '#6B7280' }}>v1.0.0 ›</span>
            </div>
          </div>
        </div>

        {/* Feedback */}
        <button onClick={onFeedback} style={{
          width: '100%', padding: '14px', marginBottom: 12,
          background: '#1A1F2E', border: '1px solid #2A3045', borderRadius: 14,
          color: '#FF6B1A', fontSize: 15, fontWeight: 600, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        }}>📨 Зворотній зв'язок</button>

        {/* Logout */}
        <button onClick={onLogout} style={{
          width: '100%', padding: '15px', background: '#EF444411',
          border: '1px solid #EF444433', borderRadius: 14,
          color: '#EF4444', fontSize: 15, fontWeight: 600, cursor: 'pointer',
        }}>Вийти з акаунту</button>
      </div>
    </div>
  )
}
