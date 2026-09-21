'use client'
import { useState } from 'react'
import type { User } from '@/types'
import { registerAccount, loginAccount, resendConfirmation, requestPasswordReset, signInWithGoogle } from '@/lib/auth'

interface Props {
  onDone: (user: User) => void
  onGuest: () => void
}

// Only rendered when the Google provider has actually been configured in
// the Supabase dashboard + Google Cloud Console — see signInWithGoogle()'s
// comment in src/lib/auth.ts. Never shown "just in case"; a misconfigured
// provider would surface as a real error from Supabase, not a fake login.
const GOOGLE_AUTH_ENABLED = process.env.NEXT_PUBLIC_GOOGLE_AUTH_ENABLED === 'true'

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.71v2.26h2.91c1.7-1.57 2.69-3.87 2.69-6.61z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.91-2.26c-.81.54-1.85.86-3.05.86-2.35 0-4.34-1.58-5.05-3.71H.96v2.33A9 9 0 0 0 9 18z" />
      <path fill="#FBBC05" d="M3.95 10.71a5.4 5.4 0 0 1 0-3.42V4.96H.96a9 9 0 0 0 0 8.08l2.99-2.33z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.51.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.96l2.99 2.33C4.66 5.16 6.65 3.58 9 3.58z" />
    </svg>
  )
}

export default function AuthScreen({ onDone, onGuest }: Props) {
  const [mode, setMode] = useState<'signin' | 'signup' | 'reset'>('signin')
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
  const [resetEmail, setResetEmail] = useState('')
  const [resetSent, setResetSent] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)

  const inp: React.CSSProperties = {
    width: '100%', background: '#1A1F2E', border: '1px solid #2A3045',
    borderRadius: 12, padding: '14px 16px', color: '#fff', fontSize: 16,
    fontFamily: 'Inter, sans-serif', outline: 'none', display: 'block',
    boxSizing: 'border-box', WebkitAppearance: 'none' as any,
  }

  const switchMode = (m: 'signin' | 'signup' | 'reset') => {
    setMode(m); setError(''); setInfo(''); setPendingEmail(''); setResendState('idle'); setResetSent(false)
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

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!resetEmail.trim() || !resetEmail.includes('@')) { setError('Невірний email'); return }
    setLoading(true)
    const res = await requestPasswordReset(resetEmail.trim())
    setLoading(false)
    if (!res.ok) { setError(res.error || 'Помилка'); return }
    setResetSent(true)
  }

  const handleGoogle = async () => {
    setError('')
    setGoogleLoading(true)
    const res = await signInWithGoogle()
    // Success redirects the whole page to Google immediately — this only
    // runs if that call itself failed to even start the redirect.
    setGoogleLoading(false)
    if (!res.ok) setError(res.error || 'Не вдалося увійти через Google')
  }

  const label: React.CSSProperties = { fontSize: 12, color: '#A0A8BC', marginBottom: 6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.5px' }

  return (
    <div className="desktop-wide-screen" style={{ background: '#0F1117' }}>
      <div className="auth-screen-wrap">
        <div style={{ width: '100%', maxWidth: 440, margin: '0 auto' }}>
          {/* Logo + form live in the same visual block on purpose — the
              form is introduced by the brand, not just floating below it. */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', marginBottom: 28 }}>
            <img src="/logo-main.png" alt="" style={{ width: 72, height: 72, objectFit: 'contain', marginBottom: 12 }}
              onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
            <span style={{ fontFamily: "'Russo One', sans-serif", fontSize: 22, color: '#FFB020', letterSpacing: '.5px' }}>ПРОСТІР КОШТУЄ</span>
            <span style={{ fontSize: 13, color: '#6B7280', marginTop: 4 }}>Оренда комерційної нерухомості</span>
          </div>

          {mode !== 'reset' && (
            <div style={{ display: 'flex', background: '#1A1F2E', borderRadius: 14, padding: 4, gap: 4, marginBottom: 24, border: '1px solid #2A3045' }}>
              {(['signin', 'signup'] as const).map(m => (
                <button key={m} onClick={() => switchMode(m)} style={{
                  flex: 1, padding: '12px', border: 'none', borderRadius: 11,
                  background: mode === m ? '#FF6B1A' : 'transparent',
                  color: mode === m ? '#fff' : '#A0A8BC',
                  fontSize: 15, fontWeight: mode === m ? 700 : 500,
                  cursor: 'pointer', fontFamily: 'Inter, sans-serif', transition: 'all .15s',
                }}>{m === 'signin' ? 'Увійти' : 'Реєстрація'}</button>
              ))}
            </div>
          )}

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

          {mode === 'reset' ? (
            resetSent ? (
              <div>
                <div style={{ background: '#22C55E18', border: '1px solid #22C55E40', borderRadius: 12, padding: '13px 16px', marginBottom: 16, color: '#22C55E', fontSize: 14, lineHeight: 1.5 }}>
                  ✉️ Якщо акаунт з такою адресою існує, лист для відновлення паролю вже надіслано. Перевірте пошту.
                </div>
                <button onClick={() => switchMode('signin')} style={{ width: '100%', padding: '14px', background: 'transparent', border: '1px solid #2A3045', borderRadius: 12, color: '#A0A8BC', fontSize: 14, fontWeight: 500, cursor: 'pointer' }}>
                  ← Повернутися до входу
                </button>
              </div>
            ) : (
              <form onSubmit={handleReset} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div style={{ fontSize: 18, fontWeight: 700, color: '#fff', marginBottom: -2 }}>Відновлення паролю</div>
                <div style={{ fontSize: 13, color: '#A0A8BC', marginBottom: 4 }}>Введіть email — надішлемо посилання для скидання паролю.</div>
                <div>
                  <div style={label}>Email *</div>
                  <input style={inp} type="email" value={resetEmail} onChange={e => setResetEmail(e.target.value)} placeholder="email@example.com" autoComplete="email" />
                </div>
                <button type="submit" disabled={loading} style={{
                  width: '100%', padding: '16px', marginTop: 4,
                  background: loading ? '#4B5563' : 'linear-gradient(135deg, #FF6B1A, #FF8C3A)',
                  border: 'none', borderRadius: 14, color: '#fff', fontSize: 16, fontWeight: 700,
                  cursor: loading ? 'not-allowed' : 'pointer', fontFamily: 'Inter, sans-serif',
                  boxShadow: loading ? 'none' : '0 4px 20px rgba(255,107,26,.3)', minHeight: 52,
                }}>
                  {loading ? '⏳ Надсилаємо...' : 'Надіслати посилання'}
                </button>
                <button type="button" onClick={() => switchMode('signin')} style={{ background: 'none', border: 'none', color: '#A0A8BC', fontSize: 14, cursor: 'pointer', padding: '4px 0' }}>
                  ← Повернутися до входу
                </button>
              </form>
            )
          ) : (
            <>
              <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {mode === 'signup' && (
                  <div>
                    <div style={label}>Ваше ім'я *</div>
                    <input style={inp} value={name} onChange={e => setName(e.target.value)} placeholder="Олексій Мельник" autoComplete="name" />
                  </div>
                )}
                <div>
                  <div style={label}>Email *</div>
                  <input style={inp} type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="email@example.com" autoComplete="email" />
                </div>
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <div style={{ ...label, marginBottom: 0 }}>Пароль *</div>
                    {mode === 'signin' && (
                      <button type="button" onClick={() => switchMode('reset')} style={{ background: 'none', border: 'none', color: '#FF6B1A', fontSize: 12, fontWeight: 600, cursor: 'pointer', padding: 0 }}>
                        Забули пароль?
                      </button>
                    )}
                  </div>
                  <input style={inp} type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Мінімум 8 символів" />
                </div>
                {mode === 'signup' && (
                  <div>
                    <div style={label}>Телефон *</div>
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

              {GOOGLE_AUTH_ENABLED && (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '18px 0' }}>
                    <div style={{ flex: 1, height: 1, background: '#2A3045' }} />
                    <span style={{ fontSize: 12, color: '#6B7280' }}>або</span>
                    <div style={{ flex: 1, height: 1, background: '#2A3045' }} />
                  </div>
                  <button onClick={handleGoogle} disabled={googleLoading} type="button" style={{
                    width: '100%', padding: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
                    background: '#fff', border: 'none', borderRadius: 14, color: '#1F2430', fontSize: 15, fontWeight: 600,
                    cursor: googleLoading ? 'default' : 'pointer', fontFamily: 'Inter, sans-serif', opacity: googleLoading ? 0.7 : 1,
                  }}>
                    <GoogleIcon />
                    {googleLoading ? 'Зачекайте…' : 'Продовжити через Google'}
                  </button>
                </>
              )}
            </>
          )}

          <button onClick={onGuest} style={{
            width: '100%', padding: '14px 24px', marginTop: 12,
            background: '#1A1F2E', border: '1px solid #2A3045', borderRadius: 16,
            color: '#A0A8BC', fontSize: 14, fontWeight: 500, cursor: 'pointer',
            fontFamily: 'Inter, sans-serif', minHeight: 50,
          }}>
            👁️ Переглянути як гість
          </button>
        </div>
      </div>
    </div>
  )
}
