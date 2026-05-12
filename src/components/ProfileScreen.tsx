'use client'
import { useState, useEffect } from 'react'
import type { User, ListingData } from '@/types'
import { ADMIN_EMAIL, getAccounts, getFeedbacks, markFeedbackRead, updateAccount, saveSession, type FeedbackRecord } from '@/lib/storage'

interface Props {
  user: User | null
  isGuest: boolean
  onLogin: () => void
  onAddListing: () => void
  onFeedback: () => void
  favCount: number
  onLogout: () => void
  showToast: (m: string) => void
  listings?: ListingData[]
  onListing?: (l: ListingData) => void
  onDeleteListing?: (id: number) => void
}

const isAdmin = (user: User | null) =>
  user?.email?.toLowerCase() === ADMIN_EMAIL.toLowerCase() || user?.role === 'admin'

// ── Icons ─────────────────────────────────────────────────────
const I = {
  user: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>,
  phone: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.61 3.28 2 2 0 0 1 3.6 1h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.8a16 16 0 0 0 5.55 5.55l.86-.86a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 21 16.92z"/></svg>,
  bell: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>,
  lock: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>,
  chat: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>,
  heart: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>,
  home: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9,22 9,12 15,12 15,22"/></svg>,
  eye: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>,
  shield: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>,
  info: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>,
  arrow: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>,
  plus: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>,
  trash: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>,
  edit: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>,
}

function MenuRow({ icon, label, sublabel, right, onClick, danger, color }: { icon: React.ReactNode; label: string; sublabel?: string; right?: React.ReactNode; onClick?: () => void; danger?: boolean; color?: string }) {
  return (
    <div onClick={onClick} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 18px', cursor: onClick ? 'pointer' : 'default', transition: 'background .15s', borderBottom: '1px solid rgba(42,48,69,.5)' }}
      onMouseEnter={e => onClick && ((e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,.03)')}
      onMouseLeave={e => ((e.currentTarget as HTMLElement).style.background = 'transparent')}
    >
      <div style={{ width: 36, height: 36, borderRadius: 10, background: danger ? '#EF444422' : (color ? color + '22' : '#2A3045'), display: 'flex', alignItems: 'center', justifyContent: 'center', color: danger ? '#EF4444' : (color || '#A0A8BC'), flexShrink: 0 }}>{icon}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 500, color: danger ? '#EF4444' : '#fff' }}>{label}</div>
        {sublabel && <div style={{ fontSize: 12, color: '#6B7280', marginTop: 1 }}>{sublabel}</div>}
      </div>
      {right !== undefined ? right : onClick && <div style={{ color: '#6B7280' }}>{I.arrow}</div>}
    </div>
  )
}

function Section({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 20 }}>
      {title && <div style={{ fontSize: 11, color: '#6B7280', fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase' as const, padding: '0 20px', marginBottom: 8 }}>{title}</div>}
      <div style={{ background: '#1A1F2E', borderRadius: 18, overflow: 'hidden', border: '1px solid #2A3045' }}>
        {children}
      </div>
    </div>
  )
}

// ── EDIT PROFILE MODAL ────────────────────────────────────────
function EditProfileModal({ user, onClose, onSaved }: { user: User; onClose: () => void; onSaved: (u: User) => void }) {
  const [name, setName] = useState(user.name)
  const [phone, setPhone] = useState(user.phone || '')
  const [loading, setLoading] = useState(false)
  const inp: React.CSSProperties = { width: '100%', background: '#0F1117', border: '1px solid #2A3045', borderRadius: 12, padding: '13px 14px', color: '#fff', fontSize: 15, fontFamily: 'Inter,sans-serif', outline: 'none', boxSizing: 'border-box' }
  const save = async () => {
    if (!name.trim()) return
    setLoading(true)
    await new Promise(r => setTimeout(r, 300))
    const updated = updateAccount(user.id, { name: name.trim(), phone: phone.trim() })
    setLoading(false)
    if (updated) onSaved(updated)
    onClose()
  }
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.7)', zIndex: 600, display: 'flex', alignItems: 'flex-end', backdropFilter: 'blur(4px)' }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 430, margin: '0 auto', background: '#1A1F2E', borderRadius: '24px 24px 0 0', padding: '20px 20px', paddingBottom: 'max(24px, env(safe-area-inset-bottom,24px))', border: '1px solid #2A3045' }}>
        <div style={{ width: 36, height: 4, background: '#2A3045', borderRadius: 2, margin: '0 auto 20px' }} />
        <div style={{ fontSize: 18, fontWeight: 700, color: '#fff', marginBottom: 20 }}>Редагувати профіль</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 20 }}>
          <div><div style={{ fontSize: 12, color: '#A0A8BC', marginBottom: 5, fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '.5px' }}>Ім'я</div><input style={inp} value={name} onChange={e => setName(e.target.value)} /></div>
          <div><div style={{ fontSize: 12, color: '#A0A8BC', marginBottom: 5, fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '.5px' }}>Телефон</div><input style={inp} type="tel" value={phone} onChange={e => setPhone(e.target.value)} /></div>
        </div>
        <button onClick={save} disabled={loading} style={{ width: '100%', padding: '15px', background: loading ? '#4B5563' : 'linear-gradient(135deg,#FF6B1A,#FF8C3A)', border: 'none', borderRadius: 14, color: '#fff', fontSize: 16, fontWeight: 700, cursor: 'pointer' }}>{loading ? '⏳ Збереження...' : 'Зберегти'}</button>
        <button onClick={onClose} style={{ width: '100%', padding: '14px', marginTop: 8, background: 'transparent', border: '1px solid #2A3045', borderRadius: 14, color: '#A0A8BC', fontSize: 14, cursor: 'pointer' }}>Скасувати</button>
      </div>
    </div>
  )
}

// ── ADMIN PANEL ───────────────────────────────────────────────
function AdminPanel({ listings, feedbacks, onDeleteListing, onMarkRead }: {
  listings: ListingData[]; feedbacks: FeedbackRecord[];
  onDeleteListing?: (id: number) => void; onMarkRead: (id: string) => void
}) {
  const [tab, setTab] = useState<'listings' | 'feedbacks' | 'users'>('feedbacks')
  const accounts = getAccounts()
  const unread = feedbacks.filter(f => !f.read).length

  return (
    <div style={{ background: '#1A1F2E', borderRadius: 18, border: '1px solid #FF6B1A44', padding: 16, marginBottom: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
        <div style={{ color: '#FFB020', fontSize: 18 }}>{I.shield}</div>
        <span style={{ fontSize: 15, fontWeight: 700, color: '#FFB020' }}>Адмін-панель</span>
        {unread > 0 && <span style={{ background: '#EF4444', color: '#fff', fontSize: 11, fontWeight: 700, borderRadius: 20, padding: '2px 8px' }}>{unread} нових</span>}
      </div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
        {([['feedbacks', `Feedback${unread > 0 ? ` (${unread})` : ''}`], ['listings', 'Оголошення'], ['users', 'Користувачі']] as const).map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} style={{ flex: 1, padding: '8px 4px', background: tab === id ? '#FF6B1A' : '#0F1117', border: `1px solid ${tab === id ? '#FF6B1A' : '#2A3045'}`, borderRadius: 10, color: tab === id ? '#fff' : '#A0A8BC', fontSize: 11, fontWeight: tab === id ? 700 : 400, cursor: 'pointer' }}>{label}</button>
        ))}
      </div>

      {tab === 'feedbacks' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 300, overflowY: 'auto' }}>
          {feedbacks.length === 0 && <div style={{ textAlign: 'center', color: '#6B7280', fontSize: 13, padding: '20px 0' }}>Немає повідомлень</div>}
          {feedbacks.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).map(fb => (
            <div key={fb.id} style={{ background: '#0F1117', borderRadius: 12, padding: '10px 12px', border: `1px solid ${fb.read ? '#2A3045' : '#FF6B1A44'}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: '#fff' }}>{fb.name}</span>
                {!fb.read && <button onClick={() => onMarkRead(fb.id)} style={{ background: '#FF6B1A22', border: '1px solid #FF6B1A44', borderRadius: 8, padding: '2px 8px', color: '#FF6B1A', fontSize: 10, cursor: 'pointer' }}>Прочитано</button>}
              </div>
              {fb.email && <div style={{ fontSize: 11, color: '#6B7280', marginBottom: 4 }}>{fb.email}</div>}
              <div style={{ fontSize: 13, color: '#A0A8BC', lineHeight: 1.5 }}>{fb.message}</div>
              <div style={{ fontSize: 10, color: '#6B7280', marginTop: 6 }}>{new Date(fb.createdAt).toLocaleString('uk-UA')}</div>
            </div>
          ))}
        </div>
      )}

      {tab === 'listings' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 300, overflowY: 'auto' }}>
          {listings.length === 0 && <div style={{ textAlign: 'center', color: '#6B7280', fontSize: 13, padding: '20px 0' }}>Немає оголошень</div>}
          {listings.map(l => (
            <div key={l.id} style={{ background: '#0F1117', borderRadius: 10, padding: '8px 10px', display: 'flex', alignItems: 'center', gap: 8 }}>
              <img src={l.images?.[0]} alt="" style={{ width: 40, height: 40, borderRadius: 8, objectFit: 'cover', flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.title}</div>
                <div style={{ fontSize: 11, color: '#6B7280' }}>{l.ownerName} • {l.price.toLocaleString('uk-UA')} ₴</div>
              </div>
              {onDeleteListing && <button onClick={() => { if (confirm('Видалити?')) onDeleteListing(l.id) }} style={{ background: '#EF444422', border: 'none', borderRadius: 8, padding: '6px 8px', color: '#EF4444', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>{I.trash}</button>}
            </div>
          ))}
        </div>
      )}

      {tab === 'users' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 300, overflowY: 'auto' }}>
          {accounts.length === 0 && <div style={{ textAlign: 'center', color: '#6B7280', fontSize: 13, padding: '20px 0' }}>Немає користувачів</div>}
          {accounts.map(acc => (
            <div key={acc.id} style={{ background: '#0F1117', borderRadius: 10, padding: '8px 10px', display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 34, height: 34, borderRadius: '50%', background: 'linear-gradient(135deg,#FF6B1A,#FFB020)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700, color: '#fff', flexShrink: 0 }}>{acc.name.charAt(0)}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{acc.name}</div>
                <div style={{ fontSize: 11, color: '#6B7280', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{acc.email}</div>
              </div>
              <span style={{ fontSize: 10, color: acc.role === 'admin' ? '#FFB020' : '#A0A8BC', background: acc.role === 'admin' ? '#FFB02022' : '#2A3045', borderRadius: 6, padding: '2px 6px', flexShrink: 0 }}>{acc.role}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── MAIN COMPONENT ────────────────────────────────────────────
export default function ProfileScreen({ user, isGuest, onLogin, onAddListing, onFeedback, favCount, onLogout, showToast, listings = [], onListing, onDeleteListing }: Props) {
  const [notif, setNotif] = useState(true)
  const [showEdit, setShowEdit] = useState(false)
  const [currentUser, setCurrentUser] = useState(user)
  const [feedbacks, setFeedbacks] = useState<FeedbackRecord[]>([])
  const admin = isAdmin(currentUser)
  const myListings = listings.filter(l => l.userId === currentUser?.id || l.userId === 'me')
  const totalViews = myListings.reduce((s, l) => s + (l.views || 0), 0)

  useEffect(() => {
    setCurrentUser(user)
    if (admin) setFeedbacks(getFeedbacks())
  }, [user, admin])

  if (!currentUser && !isGuest) {
    return (
      <div style={{ minHeight: '100dvh', background: '#0F1117' }}>
        <div style={{ padding: '44px 20px 16px', paddingTop: 'max(44px,env(safe-area-inset-top,44px))', background: '#0D1018' }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: '#fff' }}>Профіль</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '60px 24px', textAlign: 'center' }}>
          <div style={{ width: 80, height: 80, borderRadius: 24, background: 'linear-gradient(135deg,#1A1F2E,#2A3045)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 36, marginBottom: 20 }}>👤</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: '#fff', marginBottom: 8 }}>Ви не авторизовані</div>
          <div style={{ fontSize: 14, color: '#A0A8BC', lineHeight: 1.6, maxWidth: 280, marginBottom: 28 }}>Увійдіть для доступу до профілю, оголошень та збережених</div>
          <button onClick={onLogin} style={{ width: '100%', maxWidth: 300, padding: '16px', background: 'linear-gradient(135deg,#FF6B1A,#FF8C3A)', border: 'none', borderRadius: 14, color: '#fff', fontSize: 16, fontWeight: 700, cursor: 'pointer', boxShadow: '0 4px 20px rgba(255,107,26,.35)' }}>Увійти / Зареєструватись</button>
        </div>
      </div>
    )
  }

  const u = currentUser!

  return (
    <div style={{ minHeight: '100dvh', background: '#0F1117', paddingBottom: 100 }}>
      {/* ── HEADER HERO ── */}
      <div style={{ background: 'linear-gradient(160deg,#0D1018 0%,#1A1020 100%)', padding: '44px 20px 28px', paddingTop: 'max(44px,env(safe-area-inset-top,44px))', position: 'relative', overflow: 'hidden' }}>
        {/* BG decor */}
        <div style={{ position: 'absolute', top: -40, right: -40, width: 200, height: 200, borderRadius: '50%', background: 'radial-gradient(circle,rgba(255,107,26,.12),transparent)', pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', bottom: -20, left: -20, width: 150, height: 150, borderRadius: '50%', background: 'radial-gradient(circle,rgba(255,176,32,.06),transparent)', pointerEvents: 'none' }} />

        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, marginBottom: 20, position: 'relative' }}>
          {/* Avatar */}
          <div style={{ position: 'relative', flexShrink: 0 }}>
            <div style={{ width: 72, height: 72, borderRadius: 22, background: 'linear-gradient(135deg,#FF6B1A,#FFB020)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, fontWeight: 800, color: '#fff', border: '3px solid rgba(255,107,26,.3)' }}>
              {u.name?.charAt(0)?.toUpperCase() || '?'}
            </div>
            {admin && <div style={{ position: 'absolute', bottom: -4, right: -4, background: 'linear-gradient(135deg,#FFB020,#FF6B1A)', borderRadius: 8, width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12 }}>🛡️</div>}
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <div style={{ fontSize: 20, fontWeight: 800, color: '#fff' }}>{u.name}</div>
              {admin && <span style={{ background: 'linear-gradient(135deg,#FFB020,#FF6B1A)', borderRadius: 8, padding: '2px 8px', fontSize: 10, fontWeight: 700, color: '#fff' }}>ADMIN</span>}
            </div>
            <div style={{ fontSize: 13, color: '#A0A8BC', marginBottom: 4 }}>{u.email}</div>
            {u.phone && <div style={{ fontSize: 13, color: '#A0A8BC' }}>{u.phone}</div>}
          </div>

          <button onClick={() => setShowEdit(true)} style={{ background: 'rgba(255,255,255,.08)', border: '1px solid rgba(255,255,255,.1)', borderRadius: 12, padding: '8px 12px', color: '#A0A8BC', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, flexShrink: 0 }}>
            {I.edit} Ред.
          </button>
        </div>

        {/* Stats row */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 8 }}>
          {[
            { icon: '❤️', val: favCount, label: 'Збережено' },
            { icon: '🏢', val: myListings.length, label: 'Оголошень' },
            { icon: '👁️', val: totalViews > 999 ? Math.round(totalViews / 1000) + 'k' : totalViews, label: 'Переглядів' },
            { icon: '💬', val: 0, label: 'Чатів' },
          ].map(s => (
            <div key={s.label} style={{ background: 'rgba(255,255,255,.05)', borderRadius: 14, padding: '10px 6px', textAlign: 'center', border: '1px solid rgba(255,255,255,.06)' }}>
              <div style={{ fontSize: 16, marginBottom: 2 }}>{s.icon}</div>
              <div style={{ fontSize: 17, fontWeight: 800, color: '#fff' }}>{s.val}</div>
              <div style={{ fontSize: 10, color: '#6B7280', marginTop: 1 }}>{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ padding: '20px 20px 0' }}>
        {/* ── ADMIN PANEL ── */}
        {admin && (
          <AdminPanel
            listings={listings}
            feedbacks={feedbacks}
            onDeleteListing={onDeleteListing}
            onMarkRead={(id) => { markFeedbackRead(id); setFeedbacks(getFeedbacks()) }}
          />
        )}

        {/* ── QUICK ACTIONS ── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 20 }}>
          <button onClick={onAddListing} style={{ background: 'linear-gradient(135deg,#FF6B1A,#FF8C3A)', border: 'none', borderRadius: 16, padding: '16px 14px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10, boxShadow: '0 4px 16px rgba(255,107,26,.3)' }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(255,255,255,.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', flexShrink: 0 }}>{I.plus}</div>
            <div style={{ textAlign: 'left' }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>Додати</div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,.7)' }}>приміщення</div>
            </div>
          </button>
          <button onClick={onFeedback} style={{ background: '#1A1F2E', border: '1px solid #2A3045', borderRadius: 16, padding: '16px 14px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: '#2A9FD622', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#2A9FD6', flexShrink: 0 }}>{I.chat}</div>
            <div style={{ textAlign: 'left' }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>Підтримка</div>
              <div style={{ fontSize: 11, color: '#6B7280' }}>Написати нам</div>
            </div>
          </button>
        </div>

        {/* ── MY LISTINGS PREVIEW ── */}
        {myListings.length > 0 && (
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 11, color: '#6B7280', fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase' as const, marginBottom: 8 }}>Мої оголошення</div>
            <div style={{ background: '#1A1F2E', borderRadius: 18, overflow: 'hidden', border: '1px solid #2A3045' }}>
              {myListings.slice(0, 3).map((l, i) => (
                <div key={l.id} onClick={() => onListing?.(l)} style={{ display: 'flex', gap: 12, padding: '12px 16px', borderBottom: i < Math.min(myListings.length, 3) - 1 ? '1px solid #2A3045' : 'none', cursor: 'pointer' }}>
                  <img src={l.images?.[0]} alt="" style={{ width: 52, height: 52, borderRadius: 12, objectFit: 'cover', flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.title}</div>
                    <div style={{ fontSize: 12, color: '#A0A8BC', marginTop: 2 }}>{l.district} • {l.area} м²</div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: '#FF6B1A', marginTop: 2 }}>{l.price.toLocaleString('uk-UA')} ₴/міс</div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                    <span style={{ background: '#22C55E22', color: '#22C55E', fontSize: 10, fontWeight: 700, borderRadius: 20, padding: '2px 7px' }}>Активне</span>
                    <div style={{ fontSize: 10, color: '#6B7280' }}>👁 {l.views || 0}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── SETTINGS ── */}
        <Section title="Акаунт">
          <MenuRow icon={<div style={{ color: '#FF6B1A' }}>{I.user}</div>} label="Редагувати профіль" sublabel="Ім'я, фото, біо" onClick={() => setShowEdit(true)} color="#FF6B1A" />
          <MenuRow icon={<div style={{ color: '#2A9FD6' }}>{I.phone}</div>} label="Змінити телефон" sublabel={u.phone || 'Не вказано'} onClick={() => setShowEdit(true)} color="#2A9FD6" />
        </Section>

        <Section title="Налаштування">
          <MenuRow
            icon={<div style={{ color: '#22C55E' }}>{I.bell}</div>} label="Сповіщення" color="#22C55E"
            right={
              <div onClick={e => { e.stopPropagation(); setNotif(n => !n) }} style={{ width: 44, height: 26, borderRadius: 13, background: notif ? '#FF6B1A' : '#2A3045', position: 'relative', cursor: 'pointer', transition: 'background .2s', flexShrink: 0 }}>
                <div style={{ position: 'absolute', top: 3, left: notif ? 21 : 3, width: 20, height: 20, borderRadius: '50%', background: '#fff', transition: 'left .2s' }} />
              </div>
            }
          />
          <MenuRow icon={<div style={{ color: '#8B5CF6' }}>{I.lock}</div>} label="Конфіденційність" sublabel="Дані та безпека" onClick={() => showToast('Розділ в розробці')} color="#8B5CF6" />
        </Section>

        <Section title="Інфо">
          <MenuRow icon={<div style={{ color: '#FFB020' }}>{I.info}</div>} label="Про додаток" sublabel="Простір Коштує v1.0.0" onClick={() => showToast('Простір Коштує v1.0.0 — платформа комерційної нерухомості')} color="#FFB020" />
          <MenuRow icon={<div style={{ color: '#14B8A6' }}>{I.chat}</div>} label="Зворотній зв'язок" onClick={onFeedback} color="#14B8A6" />
        </Section>

        <button onClick={onLogout} style={{ width: '100%', padding: '16px', background: '#EF444411', border: '1px solid #EF444422', borderRadius: 16, color: '#EF4444', fontSize: 15, fontWeight: 600, cursor: 'pointer', marginBottom: 20 }}>
          Вийти з акаунту
        </button>
      </div>

      {/* Edit modal */}
      {showEdit && currentUser && (
        <EditProfileModal
          user={currentUser}
          onClose={() => setShowEdit(false)}
          onSaved={(updated) => { setCurrentUser(updated); saveSession(updated); showToast('✅ Профіль оновлено') }}
        />
      )}
    </div>
  )
}
