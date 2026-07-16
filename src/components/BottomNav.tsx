'use client'

type Screen = 'home' | 'messages' | 'favorites' | 'requests' | 'profile'

interface Props {
  active: Screen
  onChange: (s: Screen) => void
  favCount?: number
  unreadMessages?: number
}

const icons = {
  home: (active: boolean) => (
    <svg width="23" height="23" viewBox="0 0 24 24" fill={active ? '#FF6B1A' : 'none'} stroke={active ? '#FF6B1A' : '#6B7280'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
      <polyline points="9,22 9,12 15,12 15,22"/>
    </svg>
  ),
  messages: (active: boolean) => (
    <svg width="23" height="23" viewBox="0 0 24 24" fill={active ? '#FF6B1A' : 'none'} stroke={active ? '#FF6B1A' : '#6B7280'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
    </svg>
  ),
  favorites: (active: boolean) => (
    <svg width="23" height="23" viewBox="0 0 24 24" fill={active ? '#FF6B1A' : 'none'} stroke={active ? '#FF6B1A' : '#6B7280'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
    </svg>
  ),
  requests: (active: boolean) => (
    <svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke={active ? '#FF6B1A' : '#6B7280'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>
      <rect x="8" y="2" width="8" height="4" rx="1" ry="1"/>
      <line x1="9" y1="12" x2="15" y2="12"/>
      <line x1="9" y1="16" x2="13" y2="16"/>
    </svg>
  ),
  profile: (active: boolean) => (
    <svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke={active ? '#FF6B1A' : '#6B7280'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
      <circle cx="12" cy="7" r="4"/>
    </svg>
  ),
}

const items: { id: Screen; label: string }[] = [
  { id: 'home', label: 'Головна' },
  { id: 'messages', label: 'Чати' },
  { id: 'favorites', label: 'Обране' },
  { id: 'profile', label: 'Профіль' },
]

export default function BottomNav({ active, onChange, favCount = 0, unreadMessages = 0 }: Props) {
  return (
    <div style={{
      position: 'fixed', bottom: 0, left: '50%', transform: 'translateX(-50%)',
      width: '100%', maxWidth: 430,
      background: '#0D1018',
      borderTop: '1px solid #1E2334',
      paddingBottom: 'env(safe-area-inset-bottom, 0px)',
      zIndex: 100,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-around', paddingTop: 10, paddingBottom: 8 }}>
        {items.map(item => {
          const isActive = active === item.id
          // Only show badge for correct tabs
          const badge = item.id === 'favorites'
            ? (favCount > 0 ? favCount : 0)
            : item.id === 'messages'
            ? (unreadMessages > 0 ? unreadMessages : 0)
            : 0

          return (
            <button
              key={item.id}
              onClick={() => onChange(item.id)}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                display: 'flex', flexDirection: 'column', alignItems: 'center',
                gap: 3, padding: '2px 14px', position: 'relative',
                touchAction: 'manipulation',
              }}
            >
              {badge > 0 && (
                <span style={{
                  position: 'absolute', top: -2, right: 6,
                  background: item.id === 'messages' ? '#EF4444' : '#FF6B1A',
                  color: '#fff', fontSize: 9, fontWeight: 700,
                  borderRadius: 10, padding: '1px 5px', lineHeight: 1.4,
                  minWidth: 16, textAlign: 'center',
                }}>
                  {badge}
                </span>
              )}
              {icons[item.id](isActive)}
              <span style={{
                fontSize: 10, fontWeight: isActive ? 600 : 400,
                color: isActive ? '#FF6B1A' : '#6B7280',
                fontFamily: 'Inter, sans-serif',
              }}>
                {item.label}
              </span>
              {isActive && (
                <span style={{
                  position: 'absolute', bottom: -8,
                  width: 4, height: 4, borderRadius: '50%', background: '#FF6B1A',
                }} />
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
