'use client'
import { Suspense, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { confirmEmailToken } from '@/lib/auth'

const wrap: React.CSSProperties = {
  minHeight: '100dvh', background: '#0F1117', display: 'flex', flexDirection: 'column',
  alignItems: 'center', justifyContent: 'center', padding: 24, textAlign: 'center',
  fontFamily: 'Inter, sans-serif',
}

function ConfirmContent() {
  const params = useSearchParams()
  const router = useRouter()
  const tokenHash = params.get('token_hash') || ''
  const type = params.get('type') || ''
  const [status, setStatus] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle')
  const [error, setError] = useState('')

  // Landing on this page (a plain GET — including an automated link
  // scanner prefetching the URL from the email) must never confirm
  // anything by itself. Confirmation only happens inside handleConfirm(),
  // triggered by the user's own click below.
  if (!tokenHash || !type) {
    return (
      <div style={wrap}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>⚠️</div>
        <div style={{ fontSize: 18, fontWeight: 700, color: '#fff', marginBottom: 8 }}>Невірне посилання</div>
        <div style={{ fontSize: 14, color: '#A0A8BC' }}>Перевірте, що ви перейшли за повним посиланням з листа.</div>
      </div>
    )
  }

  const handleConfirm = async () => {
    setStatus('loading')
    setError('')
    const res = await confirmEmailToken(tokenHash, type)
    if (!res.ok) {
      setStatus('error')
      setError(res.error || 'Помилка підтвердження.')
      return
    }
    setStatus('ok')
    setTimeout(() => router.push('/'), 1000)
  }

  if (status === 'ok') {
    return (
      <div style={wrap}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>✅</div>
        <div style={{ fontSize: 18, fontWeight: 700, color: '#fff' }}>Email підтверджено!</div>
        <div style={{ fontSize: 14, color: '#A0A8BC', marginTop: 8 }}>Заходимо в додаток…</div>
      </div>
    )
  }

  return (
    <div style={wrap}>
      <div style={{ fontSize: 48, marginBottom: 16 }}>✉️</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: '#fff', marginBottom: 8 }}>Підтвердження email</div>
      <div style={{ fontSize: 14, color: '#A0A8BC', marginBottom: 24, maxWidth: 320 }}>
        Натисніть кнопку нижче, щоб підтвердити вашу email-адресу.
      </div>
      {status === 'error' && (
        <div style={{ background: '#EF444418', border: '1px solid #EF444440', borderRadius: 12, padding: '13px 16px', marginBottom: 16, color: '#EF4444', fontSize: 14, maxWidth: 320 }}>
          ⚠️ {error}
        </div>
      )}
      <button onClick={handleConfirm} disabled={status === 'loading'} style={{
        padding: '16px 28px',
        background: status === 'loading' ? '#4B5563' : 'linear-gradient(135deg, #FF6B1A, #FF8C3A)',
        border: 'none', borderRadius: 14, color: '#fff', fontSize: 16, fontWeight: 700,
        cursor: status === 'loading' ? 'not-allowed' : 'pointer', fontFamily: 'Inter, sans-serif',
        minHeight: 52,
      }}>
        {status === 'loading' ? '⏳ Підтверджуємо…' : 'Підтвердити email'}
      </button>
    </div>
  )
}

export default function ConfirmEmailPage() {
  return (
    <Suspense fallback={null}>
      <ConfirmContent />
    </Suspense>
  )
}
