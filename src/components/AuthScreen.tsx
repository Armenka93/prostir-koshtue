'use client'
import { useState } from 'react'
import type { User } from '@/types'

interface Props {
  onDone: (user: User) => void
  onGuest: () => void
}

const inp: React.CSSProperties = {
  width: '100%',
  background: '#1A1F2E',
  border: '1px solid #2A3045',
  borderRadius: 12,
  padding: '13px 14px',
  color: '#fff',
  fontSize: 15,
  fontFamily: 'Inter, sans-serif',
  outline: 'none',
  display: 'block',
  transition: 'border-color .15s',
}

const lbl: React.CSSProperties = {
  fontSize: 12,
  color: '#A0A8BC',
  fontFamily: 'Inter, sans-serif',
  marginBottom: 6,
  fontWeight: 600,
  display: 'block',
  textTransform: 'uppercase',
  letterSpacing: '.5px',
}

export default function AuthScreen({ onDone, onGuest }: Props) {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [phone, setPhone] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (mode === 'signup' && (!name || !email || !password || !phone)) {
      setError("Заповніть всі поля")
      return
    }
    if (!email || !password) { setError("Введіть email і пароль"); return }
    if (password.length < 8) { setError("Пароль мінімум 8 символів"); return }

    setLoading(true)
    await new Promise(r => setTimeout(r, 600)) // simulate auth

    const user: User = {
      id: 'me',
      name: mode === 'signup' ? name : email.split('@')[0],
      email,
      phone: mode === 'signup' ? phone : '+380000000000',
      role: 'landlord',
    }
    setLoading(false)
    onDone(user)
  }

  return (
    <div style={{
      padding: '0 24px',
      minHeight: '100dvh',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      background: '#0F1117',
    }}>
      {/* Logo */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 20, marginLeft: -8 }}>
        <img src="/logo-main.png" alt="" style={{ width: 110, height: 'auto', objectFit: 'contain', flexShrink: 0 }}
          onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
        <span style={{ fontFamily: "'Russo One', sans-serif", fontSize: 18, color: '#FFB020', letterSpacing: '.5px', lineHeight: 1.2, whiteSpace: 'nowrap' }}>
          ПРОСТІР КОШТУЄ
        </span>
      </div>

      {/* Toggle */}
      <div style={{ display: 'flex', background: '#1A1F2E', borderRadius: 14, padding: 3, marginBottom: 20, border: '1px solid #2A3045' }}>
        {(['signin', 'signup'] as const).map(m => (
          <button key={m} onClick={() => { setMode(m); setError('') }} style={{
            flex: 1, padding: '12px', background: mode === m ? '#FF6B1A' : 'transparent',
            border: 'none', borderRadius: 12, color: mode === m ? '#fff' : '#A0A8BC',
            fontSize: 14, fontWeight: mode === m ? 700 : 400, cursor: 'pointer',
            fontFamily: 'Inter, sans-serif', transition: 'all .15s',
          }}>
            {m === 'signin' ? 'Увійти' : 'Реєстрація'}
          </button>
        ))}
      </div>

      {error && (
        <div style={{ background: '#EF444422', border: '1px solid #EF444440', borderRadius: 12, padding: '12px 14px', marginBottom: 16, color: '#EF4444', fontSize: 14, fontFamily: 'Inter, sans-serif' }}>
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {mode === 'signup' && (
          <div>
            <label style={lbl}>Ваше ім'я</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="Олексій Мельник" required style={inp} />
          </div>
        )}
        <div>
          <label style={lbl}>Email</label>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="email@example.com" required style={inp} />
        </div>
        <div>
          <label style={lbl}>Пароль</label>
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Мінімум 8 символів" required style={inp} />
        </div>
        {mode === 'signup' && (
          <div>
            <label style={lbl}>Телефон *</label>
            <input type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="+380 67 123 45 67" required style={inp} />
            <div style={{ fontSize: 11, color: '#6B7280', marginTop: 4 }}>Номер буде видно тільки зареєстрованим користувачам</div>
          </div>
        )}

        <button type="submit" disabled={loading} style={{
          width: '100%', padding: '16px',
          background: loading ? '#6B7280' : 'linear-gradient(135deg, #FF6B1A, #FF8C3A)',
          border: 'none', borderRadius: 14, color: '#fff',
          fontSize: 16, fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer',
          fontFamily: 'Inter, sans-serif', marginTop: 4,
          boxShadow: loading ? 'none' : '0 4px 20px rgba(255,107,26,.3)',
          transition: 'opacity .15s',
        }}>
          {loading ? '⏳ Завантаження...' : mode === 'signin' ? 'Увійти' : 'Зареєструватись'}
        </button>
      </form>

      <button onClick={onGuest} style={{
        width: '100%', padding: '14px 24px', marginTop: 10,
        background: '#1A1F2E', border: '1px solid #2A3045', borderRadius: 16,
        color: '#A0A8BC', fontSize: 14, fontWeight: 500, cursor: 'pointer',
        fontFamily: 'Inter, sans-serif',
      }}>
        👁️ Переглянути як гість
      </button>
    </div>
  )
}
