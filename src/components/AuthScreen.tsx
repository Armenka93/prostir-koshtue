'use client'
import { useState } from 'react'
import type { User } from '@/types'
import { registerAccount, loginAccount, resendConfirmation } from '@/lib/auth'

interface Props {
  onDone: (user: User) => void
  onGuest: () => void
}

export default function AuthScreen({ onDone, onGuest }: Props) {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [phone, setPhone] = useState('')
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [loading, setLoading] = useState(false)
  // Set only while the "check your email" info banner is showing after a
  // signup — lets the resend button below know which address to resend to,
  // without re-reading the (possibly since-edited) email input.
  const [pendingEmail, setPendingEmail] = useState('')
  const [resendState, setResendState] = useState<'idle' | 'sending' | 'sent'>('idle')

  const inp: React.CSSProperties = {
    width: '100%', background: '#1A1F2E', border: '1px solid #2A3045',
    borderRadius: 12, padding: '14px 16px', color: '#fff', fontSize: 16,
    fontFamily: 'Inter, sans-serif', outline: 'none', display: 'block',
    boxSizing: 'border-box', WebkitAppearance: 'none' as any,
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setInfo('')
    setPendingEmail('')
    setResendState('idle')
    if (mode === 'signup') {
      if (!name.trim()) { setError("Введіть ваше ім'я"); return }
      if (!email.trim() || !email.includes('@')) { setError('Невірний email'); return }
      if (!phone.trim()) { setError('Введіть номер телефону'); return }
      if (password.length < 8) { setError('Пароль мінімум 8 символів'); return }
      setLoading(true)
      await new Promise(r => setTimeout(r, 400))
      const result = await registerAccount(name.trim(), email.trim().toLowerCase(), phone.trim(), password)
      setLoading(false)
      if (!result.ok) { setError(result.error || 'Помилка'); return }
      if (result.needsEmailConfirmation) {
        // "Confirm email" is on in Supabase Auth — the account exists but
        // there's no session yet. Don't call onDone() (that would treat
        // this as a completed login); show instructions instead.
        setInfo('Акаунт створено. Перевірте пошту та підтвердіть email, щоб увійти.')
        setPendingEmail(email.trim().toLowerCase())
        return
      }
      onDone(result.user!)
    } else {
      if (!email.trim()) { setError('Введіть email'); return }
      // Previously only enforced by the browser's native type="email"
      // validation on the input, which silently no-ops if bypassed
      // (e.g. programmatic submit) — check it explicitly too.
      if (!email.includes('@')) { setError('Невірний email'); return }
      if (!password) { setError('Введіть пароль'); return }
      setLoading(true)
      await new Promise(r => setTimeout(r, 400))
      const result = await loginAccount(email.trim().toLowerCase(), password)
      setLoading(false)
      if (!result.ok) {
        setError(result.error || 'Помилка')
        if (result.needsEmailConfirmation) setPendingEmail(email.trim().toLowerCase())
        return
      }
      onDone(result.user!)
    }
  }

  const handleResend = async () => {
    if (!pendingEmail) return
    setResendState('sending')
    const res = await resendConfirmation(pendingEmail)
    if (!res.ok) {
      setResendState('idle')
      setError(res.error || 'Не вдалося надіслати лист.')
      return
    }
    setResendState('sent')
  }

  return (
    <div style={{ minHeight: '100dvh', background: '#0F1117', display: 'flex', flexDirection: 'column', padding: '48px 24px 40px', overflowY: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 28 }}>
        <img src="/logo-main.png" alt="" style={{ width: 52, height: 52, objectFit: 'contain', flexShrink: 0 }}
          onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
        <span style={{ fontFamily: "'Russo One', sans-serif", fontSize: 18, color: '#FFB020' }}>ПРОСТІР КОШТУЄ</span>
      </div>

      <div style={{ display: 'flex', background: '#1A1F2E', borderRadius: 14, padding: 4, gap: 4, marginBottom: 24, border: '1px solid #2A3045' }}>
        {(['signin', 'signup'] as const).map(m => (
          <button key={m} onClick={() => { setMode(m); setError(''); setInfo(''); setPendingEmail(''); setResendState('idle') }} style={{
            flex: 1, padding: '12px', border: 'none', borderRadius: 11,
            background: mode === m ? '#FF6B1A' : 'transparent',
            color: mode === m ? '#fff' : '#A0A8BC',
            fontSize: 15, fontWeight: mode === m ? 700 : 500,
            cursor: 'pointer', fontFamily: 'Inter, sans-serif', transition: 'all .15s',
          }}>{m === 'signin' ? 'Увійти' : 'Реєстрація'}</button>
        ))}
      </div>

      {error && (
        <div style={{ background: '#EF444418', border: '1px solid #EF444440', borderRadius: 12, padding: '13px 16px', marginBottom: 16, color: '#EF4444', fontSize: 14, lineHeight: 1.5 }}>
          ⚠️ {error}
        </div>
      )}

      {info && (
        <div style={{ background: '#22C55E18', border: '1px solid #22C55E40', borderRadius: 12, padding: '13px 16px', marginBottom: 16, color: '#22C55E', fontSize: 14, lineHeight: 1.5 }}>
          ✉️ {info}
        </div>
      )}

      {pendingEmail && (
        <button onClick={handleResend} disabled={resendState !== 'idle'} style={{
          width: '100%', padding: '13px', marginBottom: 16,
          background: 'transparent', border: '1px solid #2A3045', borderRadius: 12,
          color: resendState === 'sent' ? '#22C55E' : '#A0A8BC', fontSize: 14, fontWeight: 500,
          cursor: resendState === 'idle' ? 'pointer' : 'default', fontFamily: 'Inter, sans-serif',
        }}>
          {resendState === 'sent' ? '✅ Лист надіслано ще раз' : resendState === 'sending' ? 'Надсилаємо…' : 'Надіслати лист ще раз'}
        </button>
      )}

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {mode === 'signup' && (
          <div>
            <div style={{ fontSize: 12, color: '#A0A8BC', marginBottom: 6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.5px' }}>Ваше ім'я *</div>
            <input style={inp} value={name} onChange={e => setName(e.target.value)} placeholder="Олексій Мельник" autoComplete="name" />
          </div>
        )}
        <div>
          <div style={{ fontSize: 12, color: '#A0A8BC', marginBottom: 6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.5px' }}>Email *</div>
          <input style={inp} type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="email@example.com" autoComplete="email" />
        </div>
        <div>
          <div style={{ fontSize: 12, color: '#A0A8BC', marginBottom: 6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.5px' }}>Пароль *</div>
          <input style={inp} type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Мінімум 8 символів" />
        </div>
        {mode === 'signup' && (
          <div>
            <div style={{ fontSize: 12, color: '#A0A8BC', marginBottom: 6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.5px' }}>Телефон *</div>
            <input style={inp} type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="+380 67 123 45 67" autoComplete="tel" />
            <div style={{ fontSize: 12, color: '#6B7280', marginTop: 5 }}>Номер буде видно тільки зареєстрованим користувачам</div>
          </div>
        )}
        <button type="submit" disabled={loading} style={{
          width: '100%', padding: '16px', marginTop: 4,
          background: loading ? '#4B5563' : 'linear-gradient(135deg, #FF6B1A, #FF8C3A)',
          border: 'none', borderRadius: 14, color: '#fff', fontSize: 16, fontWeight: 700,
          cursor: loading ? 'not-allowed' : 'pointer', fontFamily: 'Inter, sans-serif',
          boxShadow: loading ? 'none' : '0 4px 20px rgba(255,107,26,.3)', minHeight: 52,
        }}>
          {loading ? '⏳ Завантаження...' : mode === 'signin' ? 'Увійти' : 'Зареєструватись'}
        </button>
      </form>

      <button onClick={onGuest} style={{
        width: '100%', padding: '14px 24px', marginTop: 12,
        background: '#1A1F2E', border: '1px solid #2A3045', borderRadius: 16,
        color: '#A0A8BC', fontSize: 14, fontWeight: 500, cursor: 'pointer',
        fontFamily: 'Inter, sans-serif', minHeight: 50,
      }}>
        👁️ Переглянути як гість
      </button>
    </div>
  )
}
