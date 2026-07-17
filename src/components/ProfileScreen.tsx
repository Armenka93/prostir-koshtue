'use client'
import { useState, useEffect, useRef } from 'react'
import type { User, ListingData } from '@/types'
import {
  dbGetAccounts, dbGetFeedbacks, dbMarkFeedbackRead,
  dbGetListings, subscribeToAccounts, subscribeFeedback,
  dbUpdateAccount, dbUploadAvatar,
  type DbAccount, type DbFeedback,
} from '@/lib/db'
import { saveSession } from '@/lib/storage'
import { changePassword, changeEmail } from '@/lib/auth'
import { usePTR } from '@/hooks/usePTR'
import PTRIndicator from './PTRIndicator'

export const ADMIN_EMAIL = 'armen.saakyan9393@gmail.com'
function isAdmin(user: User | null | undefined): boolean {
  if (!user) return false
  return (user.email || '').toLowerCase().trim() === ADMIN_EMAIL.toLowerCase()
}

interface Props {
  user: User | null; isGuest: boolean; onLogin: () => void
  onAddListing: () => void; onFeedback: () => void
  favCount: number; onLogout: () => void; showToast: (m: string) => void
  listings?: ListingData[]; onListing?: (l: ListingData) => void
  onDeleteListing?: (id: number) => void; onRefresh?: () => Promise<void>
  onMyListings?: () => void
  onEditListing?: (l: ListingData) => void
  onArchiveListing?: (id: number) => void
}

const IC = {
  edit: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>,
  bell: <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>,
  info: <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>,
  msg: <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>,
  plus: <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>,
  shield: <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>,
  trash: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>,
  arrow: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>,
  lock: <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>,
}

function Row({ icon, label, sub, color = '#A0A8BC', right, onClick, danger }: { icon: React.ReactNode; label: string; sub?: string; color?: string; right?: React.ReactNode; onClick?: () => void; danger?: boolean }) {
  return (
    <div onClick={onClick} style={{ display:'flex', alignItems:'center', gap:14, padding:'13px 18px', cursor:onClick?'pointer':'default', borderBottom:'1px solid rgba(42,48,69,.4)', minHeight:52 }}>
      <div style={{ width:34, height:34, borderRadius:10, background:danger?'#EF444420':color+'20', display:'flex', alignItems:'center', justifyContent:'center', color:danger?'#EF4444':color, flexShrink:0 }}>{icon}</div>
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ fontSize:15, fontWeight:500, color:danger?'#EF4444':'#fff' }}>{label}</div>
        {sub && <div style={{ fontSize:12, color:'#6B7280', marginTop:2 }}>{sub}</div>}
      </div>
      {right !== undefined ? right : onClick && <div style={{ color:'#6B7280', flexShrink:0 }}>{IC.arrow}</div>}
    </div>
  )
}

function Card({ children }: { children: React.ReactNode }) {
  return <div style={{ background:'#1A1F2E', borderRadius:18, overflow:'hidden', border:'1px solid #2A3045' }}>{children}</div>
}

function SheetModal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.75)', zIndex:600, display:'flex', alignItems:'flex-end', backdropFilter:'blur(4px)' }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ width:'100%', maxWidth:430, margin:'0 auto', background:'#1A1F2E', borderRadius:'24px 24px 0 0', padding:'20px', paddingBottom:'max(24px,env(safe-area-inset-bottom,24px))', border:'1px solid #2A3045', maxHeight:'80vh', overflowY:'auto' as const }}>
        <div style={{ width:36, height:4, background:'#2A3045', borderRadius:2, margin:'0 auto 20px' }} />
        <div style={{ fontSize:18, fontWeight:700, color:'#fff', marginBottom:16 }}>{title}</div>
        {children}
        <button onClick={onClose} style={{ width:'100%', padding:'13px', background:'transparent', border:'1px solid #2A3045', borderRadius:14, color:'#A0A8BC', fontSize:14, cursor:'pointer', marginTop:16 }}>Закрити</button>
      </div>
    </div>
  )
}

function PrivacyModal({ onClose, onFeedback }: { onClose: () => void; onFeedback: () => void }) {
  const p: React.CSSProperties = { fontSize:14, color:'#A0A8BC', lineHeight:1.6, marginBottom:14 }
  const h: React.CSSProperties = { fontSize:13, fontWeight:700, color:'#fff', marginBottom:6, marginTop:14 }
  return (
    <SheetModal title="🔒 Конфіденційність" onClose={onClose}>
      <div style={p}>Ми зберігаємо мінімум даних, необхідних для роботи додатку.</div>
      <div style={h}>Що ми зберігаємо</div>
      <div style={p}>Ім'я, телефон та email вашого акаунту, оголошення, які ви публікуєте, список обраного та історію листування в чатах.</div>
      <div style={h}>Хто це бачить</div>
      <div style={p}>Опубліковані оголошення видно всім користувачам додатку. Телефон і листування в чатах доступні лише вам та співрозмовнику.</div>
      <div style={h}>Що ми НЕ робимо</div>
      <div style={p}>Не продаємо і не передаємо ваші дані третім особам.</div>
      <div style={h}>Видалення акаунту або даних</div>
      <div style={p}>Напишіть нам у підтримку — видалимо ваш акаунт та пов'язані дані.</div>
      <button onClick={() => { onClose(); onFeedback() }} style={{ width:'100%', padding:'13px', background:'#8B5CF622', border:'1px solid #8B5CF644', borderRadius:14, color:'#8B5CF6', fontSize:14, fontWeight:600, cursor:'pointer' }}>Написати в підтримку</button>
    </SheetModal>
  )
}

function AboutModal({ onClose, onFeedback }: { onClose: () => void; onFeedback: () => void }) {
  const p: React.CSSProperties = { fontSize:14, color:'#A0A8BC', lineHeight:1.6, marginBottom:14 }
  return (
    <SheetModal title="ℹ️ Про додаток" onClose={onClose}>
      <div style={{ textAlign:'center' as const, marginBottom:16 }}>
        <div style={{ fontSize:32, marginBottom:6 }}>🏢</div>
        <div style={{ fontSize:17, fontWeight:800, color:'#fff' }}>Простір Коштує</div>
        <div style={{ fontSize:12, color:'#6B7280', marginTop:2 }}>Версія 1.0.0</div>
      </div>
      <div style={p}>Застосунок для пошуку та оренди комерційної нерухомості в Одесі — офіси, склади, торгові приміщення від власників.</div>
      <div style={p}>Знайшли помилку або є ідея, як покращити додаток? Будемо раді почути.</div>
      <button onClick={() => { onClose(); onFeedback() }} style={{ width:'100%', padding:'13px', background:'#FFB02022', border:'1px solid #FFB02044', borderRadius:14, color:'#FFB020', fontSize:14, fontWeight:600, cursor:'pointer' }}>Зв'язатися з нами</button>
    </SheetModal>
  )
}

function EditModal({ user, onClose, onSaved, showToast }: { user: User; onClose: () => void; onSaved: (u: User) => void; showToast: (m: string) => void }) {
  const [name, setName] = useState(user.name)
  const [phone, setPhone] = useState(user.phone || '')
  const [email, setEmail] = useState(user.email)
  const [avatarPreview, setAvatarPreview] = useState(user.image || '')
  const [avatarUploading, setAvatarUploading] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const [showPwd, setShowPwd] = useState(false)
  const [curPwd, setCurPwd] = useState('')
  const [newPwd, setNewPwd] = useState('')
  const [newPwd2, setNewPwd2] = useState('')
  const [pwdError, setPwdError] = useState('')
  const [pwdLoading, setPwdLoading] = useState(false)

  const inp: React.CSSProperties = { width:'100%', background:'#0F1117', border:'1px solid #2A3045', borderRadius:12, padding:'13px 14px', color:'#fff', fontSize:15, fontFamily:'Inter,sans-serif', outline:'none', boxSizing:'border-box' as const }
  const fld: React.CSSProperties = { fontSize:11, color:'#A0A8BC', marginBottom:5, fontWeight:600, textTransform:'uppercase' as const, letterSpacing:'.5px' }

  const handleAvatarPick = (file: File | undefined) => {
    if (!file) return
    if (file.size > 5 * 1024 * 1024) { setError('Фото більше за 5 MB'); return }
    setError('')
    const localPreview = URL.createObjectURL(file)
    setAvatarPreview(localPreview)
    setAvatarUploading(true)
    dbUploadAvatar(file, user.id).then(url => {
      setAvatarUploading(false)
      if (url) setAvatarPreview(url)
      else { setError('Не вдалося завантажити фото'); setAvatarPreview(user.image || '') }
    })
  }

  const save = async () => {
    if (!name.trim()) { setError('Введіть ім\'я'); return }
    if (avatarUploading) { setError('Зачекайте, фото ще завантажується'); return }
    setError('')
    setLoading(true)

    // Email is a separate check (uniqueness against other accounts), so it
    // goes through its own helper rather than the generic field update.
    if (email.trim().toLowerCase() !== user.email.toLowerCase()) {
      const res = await changeEmail(user.id, email)
      if (!res.ok) { setError(res.error || 'Помилка зміни email'); setLoading(false); return }
    }

    const ok = await dbUpdateAccount(user.id, {
      name: name.trim(),
      phone: phone.trim(),
      avatar_url: avatarPreview.startsWith('blob:') ? (user.image || null) : (avatarPreview || null),
    })
    setLoading(false)
    if (!ok) { setError('Не вдалося зберегти зміни'); return }

    const updated: User = { ...user, name: name.trim(), phone: phone.trim(), email: email.trim().toLowerCase(), image: avatarPreview.startsWith('blob:') ? user.image : avatarPreview }
    saveSession(updated)
    onSaved(updated)
    onClose()
  }

  const savePassword = async () => {
    if (!curPwd || !newPwd) { setPwdError('Заповніть обидва поля'); return }
    if (newPwd !== newPwd2) { setPwdError('Паролі не співпадають'); return }
    setPwdError('')
    setPwdLoading(true)
    const res = await changePassword(user.id, curPwd, newPwd)
    setPwdLoading(false)
    if (!res.ok) { setPwdError(res.error || 'Помилка'); return }
    setCurPwd(''); setNewPwd(''); setNewPwd2(''); setShowPwd(false)
    showToast('✅ Пароль змінено')
  }

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.75)', zIndex:600, display:'flex', alignItems:'flex-end', backdropFilter:'blur(4px)' }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ width:'100%', maxWidth:430, margin:'0 auto', background:'#1A1F2E', borderRadius:'24px 24px 0 0', padding:'20px', paddingBottom:'max(24px,env(safe-area-inset-bottom,24px))', border:'1px solid #2A3045', maxHeight:'85vh', overflowY:'auto' as const }}>
        <div style={{ width:36, height:4, background:'#2A3045', borderRadius:2, margin:'0 auto 20px' }} />
        <div style={{ fontSize:18, fontWeight:700, color:'#fff', marginBottom:20 }}>Редагувати профіль</div>

        {error && <div style={{ background:'#EF444418', border:'1px solid #EF444440', borderRadius:12, padding:'10px 12px', marginBottom:14, color:'#EF4444', fontSize:13 }}>⚠️ {error}</div>}

        <div style={{ display:'flex', justifyContent:'center', marginBottom:18 }}>
          <div onClick={() => fileRef.current?.click()} style={{ position:'relative', cursor:'pointer' }}>
            <div style={{ width:80, height:80, borderRadius:'50%', overflow:'hidden', background:'linear-gradient(135deg,#FF6B1A,#FFB020)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:30, fontWeight:800, color:'#fff', opacity:avatarUploading?0.5:1 }}>
              {avatarPreview ? <img src={avatarPreview} style={{ width:'100%', height:'100%', objectFit:'cover' }} /> : (name?.charAt(0)?.toUpperCase() || '?')}
            </div>
            {avatarUploading && <div style={{ position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent:'center', fontSize:22 }}>⏳</div>}
            <div style={{ position:'absolute', bottom:-2, right:-2, width:26, height:26, borderRadius:'50%', background:'#FF6B1A', border:'2px solid #1A1F2E', display:'flex', alignItems:'center', justifyContent:'center', fontSize:12 }}>📷</div>
          </div>
          <input ref={fileRef} type="file" accept="image/*" style={{ display:'none' }} onChange={e => handleAvatarPick(e.target.files?.[0])} />
        </div>

        <div style={{ display:'flex', flexDirection:'column', gap:12, marginBottom:20 }}>
          <div><div style={fld}>Ім'я</div><input style={inp} value={name} onChange={e => setName(e.target.value)} /></div>
          <div><div style={fld}>Телефон</div><input style={inp} type="tel" value={phone} onChange={e => setPhone(e.target.value)} /></div>
          <div><div style={fld}>Email</div><input style={inp} type="email" value={email} onChange={e => setEmail(e.target.value)} /></div>
        </div>

        <button onClick={save} disabled={loading || avatarUploading} style={{ width:'100%', padding:'15px', background:(loading||avatarUploading)?'#4B5563':'linear-gradient(135deg,#FF6B1A,#FF8C3A)', border:'none', borderRadius:14, color:'#fff', fontSize:16, fontWeight:700, cursor:'pointer', marginBottom:8 }}>{loading?'⏳ Збереження...':'Зберегти'}</button>

        <div style={{ borderTop:'1px solid #2A3045', marginTop:6, paddingTop:16 }}>
          {!showPwd ? (
            <button onClick={() => setShowPwd(true)} style={{ width:'100%', padding:'13px', background:'transparent', border:'1px solid #2A3045', borderRadius:14, color:'#A0A8BC', fontSize:14, cursor:'pointer' }}>🔑 Змінити пароль</button>
          ) : (
            <div>
              <div style={{ fontSize:13, fontWeight:700, color:'#fff', marginBottom:10 }}>Зміна паролю</div>
              {pwdError && <div style={{ background:'#EF444418', border:'1px solid #EF444440', borderRadius:12, padding:'10px 12px', marginBottom:10, color:'#EF4444', fontSize:13 }}>⚠️ {pwdError}</div>}
              <div style={{ display:'flex', flexDirection:'column', gap:10, marginBottom:10 }}>
                <div><div style={fld}>Поточний пароль</div><input style={inp} type="password" value={curPwd} onChange={e => setCurPwd(e.target.value)} /></div>
                <div><div style={fld}>Новий пароль</div><input style={inp} type="password" value={newPwd} onChange={e => setNewPwd(e.target.value)} /></div>
                <div><div style={fld}>Повторіть новий пароль</div><input style={inp} type="password" value={newPwd2} onChange={e => setNewPwd2(e.target.value)} /></div>
              </div>
              <div style={{ display:'flex', gap:8 }}>
                <button onClick={savePassword} disabled={pwdLoading} style={{ flex:1, padding:'13px', background:pwdLoading?'#4B5563':'linear-gradient(135deg,#FF6B1A,#FF8C3A)', border:'none', borderRadius:12, color:'#fff', fontSize:14, fontWeight:700, cursor:'pointer' }}>{pwdLoading?'⏳':'Зберегти пароль'}</button>
                <button onClick={() => { setShowPwd(false); setPwdError(''); setCurPwd(''); setNewPwd(''); setNewPwd2('') }} style={{ padding:'13px 16px', background:'transparent', border:'1px solid #2A3045', borderRadius:12, color:'#A0A8BC', fontSize:14, cursor:'pointer' }}>Скасувати</button>
              </div>
            </div>
          )}
        </div>

        <button onClick={onClose} style={{ width:'100%', padding:'13px', background:'transparent', border:'none', borderRadius:14, color:'#6B7280', fontSize:14, cursor:'pointer', marginTop:10 }}>Закрити</button>
      </div>
    </div>
  )
}

// ── ADMIN DASHBOARD ───────────────────────────────────────────
function AdminDashboard({ propListings, onDeleteListing, registerReload }: { propListings: ListingData[]; onDeleteListing?: (id: number) => void; registerReload?: (fn: () => void) => void }) {
  const [tab, setTab] = useState<'stats'|'listings'|'feedback'|'users'>('stats')
  const [accounts, setAccounts] = useState<DbAccount[]>([])
  const [feedbacks, setFeedbacks] = useState<DbFeedback[]>([])
  const [listings, setListings] = useState<ListingData[]>([])
  const [loading, setLoading] = useState(true)

  const loadAll = async () => {
    const [accs, fbs, lsts] = await Promise.all([dbGetAccounts(), dbGetFeedbacks(), dbGetListings()])
    setAccounts(accs)
    setFeedbacks(fbs)
    setListings(lsts.length > 0 ? lsts : propListings.filter(l => l.userId !== 'mock'))
    setLoading(false)
  }

  useEffect(() => {
    loadAll()
    registerReload?.(loadAll)
    const acSub = subscribeToAccounts(() => dbGetAccounts().then(setAccounts))
    const fbSub = subscribeFeedback(() => dbGetFeedbacks().then(setFeedbacks))
    const t = setInterval(() => dbGetListings().then(d => { if (d.length > 0) setListings(d) }), 8000)
    return () => { acSub.unsubscribe(); fbSub.unsubscribe(); clearInterval(t) }
  }, [])

  const unread = feedbacks.filter(f => !f.is_read).length
  const totalViews = listings.reduce((s, l) => s + (l.views || 0), 0)
  const newListings = listings.filter(l => (Date.now() - new Date(l.createdAt).getTime()) < 7*24*3600000).length

  const tabs = [
    { id: 'stats' as const, label: '📊 Статистика' },
    { id: 'listings' as const, label: `🏢 Об'єкти (${listings.length})` },
    { id: 'feedback' as const, label: `💬 Feedback${unread > 0 ? ` (${unread})` : ''}` },
    { id: 'users' as const, label: `👥 Юзери (${accounts.length})` },
  ]

  return (
    <div style={{ background:'#1A1020', borderRadius:20, border:'1px solid #FF6B1A33', padding:16, marginBottom:20 }}>
      <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:14 }}>
        <div style={{ background:'linear-gradient(135deg,#FFB020,#FF6B1A)', borderRadius:10, width:32, height:32, display:'flex', alignItems:'center', justifyContent:'center', color:'#fff', flexShrink:0 }}>{IC.shield}</div>
        <span style={{ fontSize:15, fontWeight:700, color:'#FFB020' }}>Адмін-панель</span>
        {unread > 0 && <span style={{ background:'#EF4444', color:'#fff', fontSize:10, fontWeight:700, borderRadius:20, padding:'2px 7px', marginLeft:'auto' }}>🔴 {unread}</span>}
      </div>

      <div style={{ display:'flex', gap:5, marginBottom:14, overflowX:'auto', scrollbarWidth:'none' }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{ padding:'7px 10px', background:tab===t.id?'#FF6B1A':'#0F1117', border:`1px solid ${tab===t.id?'#FF6B1A':'#2A3045'}`, borderRadius:10, color:tab===t.id?'#fff':'#A0A8BC', fontSize:11, fontWeight:tab===t.id?700:400, cursor:'pointer', whiteSpace:'nowrap', flexShrink:0 }}>{t.label}</button>
        ))}
      </div>

      {loading && <div style={{ textAlign:'center', padding:'20px 0', color:'#6B7280', fontSize:13 }}>⏳ Завантаження...</div>}

      {!loading && tab === 'stats' && (
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
          {[
            { icon:'👥', val:accounts.length, label:'Користувачів', color:'#2A9FD6' },
            { icon:'🏢', val:listings.length, label:"Об'єктів", color:'#22C55E' },
            { icon:'👁️', val:totalViews>999?Math.round(totalViews/1000)+'k':totalViews, label:'Переглядів', color:'#FFB020' },
            { icon:'💬', val:feedbacks.length, label:'Feedback', color:'#EC4899' },
            { icon:'✨', val:newListings, label:'Нових (7д)', color:'#FF6B1A' },
            { icon:'📧', val:unread, label:'Непрочитано', color:'#EF4444' },
          ].map(s => (
            <div key={s.label} style={{ background:'#0F1117', borderRadius:14, padding:'12px 10px', border:`1px solid ${s.color}22`, textAlign:'center' }}>
              <div style={{ fontSize:22, marginBottom:4 }}>{s.icon}</div>
              <div style={{ fontSize:20, fontWeight:800, color:s.color }}>{s.val}</div>
              <div style={{ fontSize:10, color:'#6B7280', marginTop:2 }}>{s.label}</div>
            </div>
          ))}
        </div>
      )}

      {!loading && tab === 'listings' && (
        <div style={{ display:'flex', flexDirection:'column', gap:6, maxHeight:300, overflowY:'auto' }}>
          {listings.length === 0 && <div style={{ textAlign:'center', color:'#6B7280', fontSize:13, padding:'20px 0' }}>Немає оголошень</div>}
          {listings.map(l => (
            <div key={l.id} style={{ background:'#0F1117', borderRadius:10, padding:'8px 10px', display:'flex', alignItems:'center', gap:8, border:'1px solid #2A3045' }}>
              <img src={l.images?.[0]} alt="" style={{ width:38, height:38, borderRadius:8, objectFit:'cover', flexShrink:0 }} />
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:12, fontWeight:600, color:'#fff', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{l.title}</div>
                <div style={{ fontSize:11, color:'#6B7280' }}>{l.ownerName || l.userId} • {l.price?.toLocaleString('uk-UA')} ₴</div>
              </div>
              {onDeleteListing && <button onClick={() => { if (confirm('Видалити?')) onDeleteListing(l.id) }} style={{ background:'#EF444418', border:'none', borderRadius:8, padding:'6px 8px', color:'#EF4444', cursor:'pointer', display:'flex', alignItems:'center', flexShrink:0 }}>{IC.trash}</button>}
            </div>
          ))}
        </div>
      )}

      {!loading && tab === 'feedback' && (
        <div style={{ display:'flex', flexDirection:'column', gap:6, maxHeight:300, overflowY:'auto' }}>
          {feedbacks.length === 0 && <div style={{ textAlign:'center', color:'#6B7280', fontSize:13, padding:'20px 0' }}>Немає повідомлень</div>}
          {feedbacks.map(fb => (
            <div key={fb.id} style={{ background:'#0F1117', borderRadius:12, padding:'10px 12px', border:`1px solid ${fb.is_read?'#2A3045':'#FF6B1A44'}` }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:4 }}>
                <div><span style={{ fontSize:13, fontWeight:600, color:'#fff' }}>{fb.name}</span>{fb.email&&<span style={{ fontSize:11, color:'#6B7280', marginLeft:8 }}>{fb.email}</span>}</div>
                {!fb.is_read && <button onClick={() => { dbMarkFeedbackRead(fb.id!); setFeedbacks(p => p.map(f => f.id===fb.id?{...f,is_read:true}:f)) }} style={{ background:'#FF6B1A22', border:'1px solid #FF6B1A44', borderRadius:8, padding:'2px 8px', color:'#FF6B1A', fontSize:10, cursor:'pointer' }}>Прочитано</button>}
              </div>
              <div style={{ fontSize:13, color:'#A0A8BC', lineHeight:1.5 }}>{fb.message}</div>
              <div style={{ fontSize:10, color:'#6B7280', marginTop:4 }}>{new Date(fb.created_at||'').toLocaleString('uk-UA')}</div>
            </div>
          ))}
        </div>
      )}

      {!loading && tab === 'users' && (
        <div style={{ display:'flex', flexDirection:'column', gap:6, maxHeight:300, overflowY:'auto' }}>
          {accounts.length === 0 && <div style={{ textAlign:'center', color:'#6B7280', fontSize:13, padding:'20px 0' }}>Немає користувачів</div>}
          {accounts.map(acc => (
            <div key={acc.id} style={{ background:'#0F1117', borderRadius:10, padding:'8px 10px', display:'flex', alignItems:'center', gap:10, border:'1px solid #2A3045' }}>
              <div style={{ width:34, height:34, borderRadius:'50%', background:'linear-gradient(135deg,#FF6B1A,#FFB020)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:14, fontWeight:700, color:'#fff', flexShrink:0 }}>{acc.name?.charAt(0)?.toUpperCase()}</div>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:13, fontWeight:600, color:'#fff', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{acc.name}</div>
                <div style={{ fontSize:11, color:'#6B7280', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{acc.email}</div>
              </div>
              <span style={{ fontSize:10, color:acc.role==='admin'?'#FFB020':'#A0A8BC', background:acc.role==='admin'?'#FFB02022':'#2A3045', borderRadius:6, padding:'2px 6px', flexShrink:0 }}>{acc.role}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── MAIN ─────────────────────────────────────────────────────
export default function ProfileScreen({ user, isGuest, onLogin, onAddListing, onFeedback, favCount, onLogout, showToast, listings=[], onListing, onDeleteListing, onRefresh, onMyListings, onEditListing, onArchiveListing }: Props) {
  const [notif, setNotif] = useState(true)
  const [showEdit, setShowEdit] = useState(false)
  const [showPrivacy, setShowPrivacy] = useState(false)
  const [showAbout, setShowAbout] = useState(false)
  const [currentUser, setCurrentUser] = useState(user)
  const adminReloadRef = useRef<(() => void) | null>(null)
  const ptr = usePTR(async () => {
    await onRefresh?.()
    adminReloadRef.current?.()
  })
  const admin = isAdmin(currentUser)
  const myListings = listings.filter(l => (l.userId === currentUser?.id || l.userId === 'me') && l.isActive !== false)
  const totalViews = myListings.reduce((s, l) => s + (l.views || 0), 0)

  useEffect(() => { setCurrentUser(user) }, [user])

  if (!currentUser) {
    return (
      <div style={{ paddingBottom:90 }}>
        <PTRIndicator state={ptr.state} pullY={ptr.pullY} />
        <div style={{ padding:'48px 20px 16px', paddingTop:'max(48px,env(safe-area-inset-top,48px))', background:'#0D1018' }}>
          <div style={{ fontSize:22, fontWeight:800, color:'#fff' }}>Профіль</div>
        </div>
        <div style={{ display:'flex', flexDirection:'column', alignItems:'center', padding:'60px 24px', textAlign:'center' }}>
          <div style={{ width:80, height:80, borderRadius:24, background:'#1A1F2E', display:'flex', alignItems:'center', justifyContent:'center', fontSize:36, marginBottom:20, border:'1px solid #2A3045' }}>👤</div>
          <div style={{ fontSize:20, fontWeight:700, color:'#fff', marginBottom:8 }}>Ви не авторизовані</div>
          <div style={{ fontSize:14, color:'#A0A8BC', lineHeight:1.6, maxWidth:280, marginBottom:28 }}>Увійдіть для доступу до профілю та оголошень</div>
          <button onClick={onLogin} style={{ width:'100%', maxWidth:300, padding:'16px', background:'linear-gradient(135deg,#FF6B1A,#FF8C3A)', border:'none', borderRadius:14, color:'#fff', fontSize:16, fontWeight:700, cursor:'pointer' }}>Увійти / Зареєструватись</button>
        </div>
      </div>
    )
  }

  const u = currentUser

  return (
    <div style={{ paddingBottom:90 }}>
      <PTRIndicator state={ptr.state} pullY={ptr.pullY} />

      {/* HERO */}
      <div style={{ background:'linear-gradient(160deg,#0D1018,#170D20)', padding:'0 20px 24px', paddingTop:'max(48px,env(safe-area-inset-top,48px))', position:'relative', overflow:'hidden' }}>
        <div style={{ position:'absolute', top:-60, right:-60, width:200, height:200, borderRadius:'50%', background:'radial-gradient(circle,rgba(255,107,26,.1),transparent)', pointerEvents:'none' }} />
        <div style={{ display:'flex', alignItems:'flex-start', gap:14, marginBottom:20 }}>
          <div style={{ position:'relative', flexShrink:0 }}>
            <div style={{ width:68, height:68, borderRadius:20, overflow:'hidden', background:'linear-gradient(135deg,#FF6B1A,#FFB020)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:26, fontWeight:800, color:'#fff', border:'2px solid rgba(255,107,26,.3)' }}>
              {u.image ? <img src={u.image} style={{ width:'100%', height:'100%', objectFit:'cover' }} /> : (u.name?.charAt(0)?.toUpperCase() || '?')}
            </div>
            {admin && <div style={{ position:'absolute', bottom:-4, right:-4, background:'linear-gradient(135deg,#FFB020,#FF6B1A)', borderRadius:8, width:22, height:22, display:'flex', alignItems:'center', justifyContent:'center', fontSize:11 }}>🛡️</div>}
          </div>
          <div style={{ flex:1, minWidth:0, paddingTop:4 }}>
            <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:3, flexWrap:'wrap' as const }}>
              <div style={{ fontSize:19, fontWeight:800, color:'#fff' }}>{u.name}</div>
              {admin && <span style={{ background:'linear-gradient(135deg,#FFB020,#FF6B1A)', borderRadius:8, padding:'2px 8px', fontSize:10, fontWeight:700, color:'#fff' }}>ADMIN</span>}
            </div>
            <div style={{ fontSize:13, color:'#A0A8BC', marginBottom:2 }}>{u.email}</div>
            {u.phone && <div style={{ fontSize:13, color:'#6B7280' }}>{u.phone}</div>}
          </div>
          <button onClick={() => setShowEdit(true)} style={{ background:'rgba(255,255,255,.08)', border:'1px solid rgba(255,255,255,.1)', borderRadius:12, padding:'8px 12px', color:'#A0A8BC', cursor:'pointer', display:'flex', alignItems:'center', gap:6, fontSize:13, flexShrink:0 }}>
            {IC.edit} Ред.
          </button>
        </div>

        {/* User stats */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:8 }}>
          {[
            { icon:'❤️', val:favCount, label:'Збережено' },
            { icon:'🏢', val:myListings.length, label:'Оголошень' },
            { icon:'👁️', val:totalViews>999?Math.round(totalViews/1000)+'k':totalViews, label:'Переглядів' },
          ].map(s => (
            <div key={s.label} style={{ background:'rgba(255,255,255,.05)', borderRadius:14, padding:'10px 6px', textAlign:'center', border:'1px solid rgba(255,255,255,.06)' }}>
              <div style={{ fontSize:18, marginBottom:2 }}>{s.icon}</div>
              <div style={{ fontSize:18, fontWeight:800, color:'#fff' }}>{s.val}</div>
              <div style={{ fontSize:10, color:'#6B7280', marginTop:1 }}>{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ padding:'20px 20px 0' }}>
        {/* ADMIN DASHBOARD */}
        {admin && <AdminDashboard propListings={listings} onDeleteListing={onDeleteListing} registerReload={fn => { adminReloadRef.current = fn }} />}

        {/* QUICK ACTIONS */}
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:20 }}>
          <button onClick={onAddListing} style={{ background:'linear-gradient(135deg,#FF6B1A,#FF8C3A)', border:'none', borderRadius:16, padding:'15px 12px', cursor:'pointer', display:'flex', alignItems:'center', gap:10, boxShadow:'0 4px 16px rgba(255,107,26,.3)' }}>
            <div style={{ width:34, height:34, borderRadius:10, background:'rgba(255,255,255,.2)', display:'flex', alignItems:'center', justifyContent:'center', color:'#fff', flexShrink:0 }}>{IC.plus}</div>
            <div style={{ textAlign:'left' }}><div style={{ fontSize:13, fontWeight:700, color:'#fff' }}>Додати</div><div style={{ fontSize:11, color:'rgba(255,255,255,.7)' }}>приміщення</div></div>
          </button>
          <button onClick={onFeedback} style={{ background:'#1A1F2E', border:'1px solid #2A3045', borderRadius:16, padding:'15px 12px', cursor:'pointer', display:'flex', alignItems:'center', gap:10 }}>
            <div style={{ width:34, height:34, borderRadius:10, background:'#2A9FD622', display:'flex', alignItems:'center', justifyContent:'center', color:'#2A9FD6', flexShrink:0 }}>{IC.msg}</div>
            <div style={{ textAlign:'left' }}><div style={{ fontSize:13, fontWeight:700, color:'#fff' }}>Підтримка</div><div style={{ fontSize:11, color:'#6B7280' }}>Написати нам</div></div>
          </button>
        </div>

        {/* MY LISTINGS */}
        <div style={{ marginBottom:20 }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8 }}>
            <div style={{ fontSize:11, color:'#6B7280', fontWeight:700, letterSpacing:'1px', textTransform:'uppercase' as const }}>Мої оголошення</div>
            {onMyListings && (
              <button onClick={onMyListings} style={{ background:'none', border:'none', color:'#FF6B1A', fontSize:12, fontWeight:600, cursor:'pointer', padding:0 }}>
                Усі →
              </button>
            )}
          </div>
          {myListings.length > 0 ? (
            <Card>
              {myListings.slice(0,3).map((l,i) => (
                <div key={l.id} style={{ display:'flex', gap:12, padding:'12px 16px', borderBottom:i<Math.min(myListings.length,3)-1?'1px solid #2A3045':'none' }}>
                  <div onClick={() => onListing?.(l)} style={{ display:'flex', gap:12, flex:1, minWidth:0, cursor:'pointer' }}>
                    <img src={l.images?.[0]} alt="" style={{ width:50, height:50, borderRadius:10, objectFit:'cover', flexShrink:0 }} />
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontSize:13, fontWeight:600, color:'#fff', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{l.title}</div>
                      <div style={{ fontSize:12, color:'#A0A8BC', marginTop:2 }}>{l.district} • {l.area} м²</div>
                      <div style={{ fontSize:14, fontWeight:700, color:'#FF6B1A', marginTop:2 }}>{l.price?.toLocaleString('uk-UA')} ₴/міс</div>
                    </div>
                  </div>
                  <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-end', gap:6, flexShrink:0 }}>
                    <span style={{ background:'#22C55E22', color:'#22C55E', fontSize:10, fontWeight:700, borderRadius:20, padding:'2px 7px' }}>Активне</span>
                    <div style={{ display:'flex', gap:4 }}>
                      {onEditListing && (
                        <button onClick={() => onEditListing(l)} style={{ background:'#FFB02018', border:'none', borderRadius:8, padding:'5px 7px', color:'#FFB020', cursor:'pointer', display:'flex', alignItems:'center' }}>{IC.edit}</button>
                      )}
                      {onArchiveListing && (
                        <button onClick={() => { if (confirm('Перенести в архів? Оголошення зникне з пошуку, але ви зможете відновити його пізніше.')) onArchiveListing(l.id) }} style={{ background:'#EF444418', border:'none', borderRadius:8, padding:'5px 7px', color:'#EF4444', cursor:'pointer', display:'flex', alignItems:'center' }}>{IC.trash}</button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </Card>
          ) : (
            <Card>
              <div style={{ padding:'16px', textAlign:'center' as const, color:'#6B7280', fontSize:13 }}>Ще немає оголошень</div>
            </Card>
          )}
        </div>

        {/* SETTINGS */}
        <div style={{ marginBottom:20 }}>
          <div style={{ fontSize:11, color:'#6B7280', fontWeight:700, letterSpacing:'1px', textTransform:'uppercase' as const, marginBottom:8 }}>Налаштування</div>
          <Card>
            <Row icon={<div style={{ color:'#22C55E' }}>{IC.bell}</div>} label="Сповіщення" color="#22C55E"
              right={<div onClick={e => { e.stopPropagation(); setNotif(n => !n) }} style={{ width:44, height:26, borderRadius:13, background:notif?'#FF6B1A':'#2A3045', position:'relative', cursor:'pointer', transition:'background .2s', flexShrink:0 }}><div style={{ position:'absolute', top:3, left:notif?21:3, width:20, height:20, borderRadius:'50%', background:'#fff', transition:'left .2s' }} /></div>}
            />
            <Row icon={<div style={{ color:'#8B5CF6' }}>{IC.lock}</div>} label="Конфіденційність" sub="Дані та безпека" color="#8B5CF6" onClick={() => setShowPrivacy(true)} />
            <Row icon={<div style={{ color:'#FFB020' }}>{IC.info}</div>} label="Про додаток" sub="v1.0.0" color="#FFB020" onClick={() => setShowAbout(true)} />
          </Card>
        </div>

        <button onClick={onLogout} style={{ width:'100%', padding:'15px', background:'#EF444411', border:'1px solid #EF444422', borderRadius:16, color:'#EF4444', fontSize:15, fontWeight:600, cursor:'pointer', marginBottom:24 }}>
          Вийти з акаунту
        </button>
      </div>

      {showEdit && currentUser && (
        <EditModal user={currentUser} onClose={() => setShowEdit(false)} onSaved={u => { setCurrentUser(u); showToast('✅ Профіль оновлено') }} showToast={showToast} />
      )}
      {showPrivacy && <PrivacyModal onClose={() => setShowPrivacy(false)} onFeedback={onFeedback} />}
      {showAbout && <AboutModal onClose={() => setShowAbout(false)} onFeedback={onFeedback} />}
    </div>
  )
}
