'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { updatePasswordAfterReset } from '@/lib/auth'

const wrap: React.CSSProperties = {
  minHeight: '100dvh', background: '#0F1117', display: 'flex', flexDirection: 'column',
  alignItems: 'center', justifyContent: 'center', padding: 24, textAlign: 'center',
  fontFamily: 'Inter, sans-serif',
}

const inp: React.CSSProperties = {
  width: '100%', background: '#1A1F2E', border: '1px solid #2A3045',
  borderRadius: 12, padding: '14px 16px', color: '#fff', fontSize: 16,
  fontFamily: 'Inter, sans-serif', outline: 'none', boxSizing: 'border-box',
}

export default function ResetPasswordPage() {
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [password2, setPassword2] = useState('')
  const [status, setStatus] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle')
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (password.length < 6) { setError('Пароль має містити щонайменше 6 символів.'); return }
    if (password !== password2) { setError('Паролі не співпадають.'); return }
    setStatus('loading')
    const res = await updatePasswordAfterReset(password)
    if (!res.ok) {
      setStatus('error')
      setError(res.error || 'Не вдалося змінити пароль. Спробуйте перейти за посиланням з листа ще раз.')
      return
    }
    setStatus('ok')
    setTimeout(() => router.push('/'), 1200)
  }

  if (status === 'ok') {
    return (
      <div style={wrap}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>✅</div>
        <div style={{ fontSize: 18, fontWeight: 700, color: '#fff' }}>Пароль змінено!</div>
        <div style={{ fontSize: 14, color: '#A0A8BC', marginTop: 8 }}>Заходимо в додаток…</div>
      </div>
    )
  }

  return (
    <div style={wrap}>
      <div style={{ fontSize: 48, marginBottom: 16 }}>🔑</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: '#fff', marginBottom: 8 }}>Новий пароль</div>
      <div style={{ fontSize: 14, color: '#A0A8BC', marginBottom: 24, maxWidth: 320 }}>
        Введіть новий пароль для вашого акаунту.
      </div>
      {error && (
        <div style={{ background: '#EF444418', border: '1px solid #EF444440', borderRadius: 12, padding: '13px 16px', marginBottom: 16, color: '#EF4444', fontSize: 14, maxWidth: 320, textAlign: 'left' }}>
          ⚠️ {error}
        </div>
      )}
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12, width: '100%', maxWidth: 320 }}>
        <input style={inp} type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Новий пароль" autoComplete="new-password" />
        <input style={inp} type="password" value={password2} onChange={e => setPassword2(e.target.value)} placeholder="Повторіть пароль" autoComplete="new-password" />
        <button type="submit" disabled={status === 'loading'} style={{
          padding: '16px', marginTop: 4,
          background: status === 'loading' ? '#4B5563' : 'linear-gradient(135deg, #FF6B1A, #FF8C3A)',
          border: 'none', borderRadius: 14, color: '#fff', fontSize: 16, fontWeight: 700,
          cursor: status === 'loading' ? 'not-allowed' : 'pointer', fontFamily: 'Inter, sans-serif',
          minHeight: 52,
        }}>
          {status === 'loading' ? '⏳ Зберігаємо…' : 'Зберегти пароль'}
        </button>
      </form>
    </div>
  )
}
