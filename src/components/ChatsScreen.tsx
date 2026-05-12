'use client'
import type { User } from '@/types'

interface Props {
  user: User | null
  isGuest: boolean
  onLogin: () => void
}

export default function ChatsScreen({ user, isGuest, onLogin }: Props) {
  if (!user) {
    return (
      <div style={{ paddingBottom: 80 }}>
        <div style={{ padding: '48px 20px 16px', background: 'linear-gradient(180deg,#0D1018,#0F1117)', borderBottom: '1px solid #1E2334' }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#fff' }}>Повідомлення</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '80px 24px', gap: 16, textAlign: 'center' }}>
          <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="#2A3045" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          <div style={{ fontSize: 16, fontWeight: 600, color: '#fff' }}>Увійдіть, щоб писати продавцям</div>
          <button onClick={onLogin} style={{ background: 'linear-gradient(135deg,#FF6B1A,#FF8C3A)', border: 'none', borderRadius: 12, padding: '12px 28px', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>Увійти</button>
        </div>
      </div>
    )
  }

  return (
    <div style={{ paddingBottom: 80 }}>
      <div style={{ padding: '48px 20px 16px', background: 'linear-gradient(180deg,#0D1018,#0F1117)', borderBottom: '1px solid #1E2334' }}>
        <div style={{ fontSize: 22, fontWeight: 700, color: '#fff' }}>Повідомлення</div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '60px 24px', gap: 12, textAlign: 'center' }}>
        <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="#2A3045" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        <div style={{ fontSize: 16, fontWeight: 600, color: '#fff' }}>Поки немає повідомлень</div>
        <div style={{ fontSize: 13, color: '#A0A8BC', lineHeight: 1.6 }}>Натисніть «Написати» на картці оголошення, щоб почати переписку</div>
      </div>
    </div>
  )
}
