'use client'
import { useState } from 'react'
import { saveFeedback } from '@/lib/storage'

interface Props { onBack: () => void }

export default function FeedbackScreen({ onBack }: Props) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const inp: React.CSSProperties = { width: '100%', background: '#1A1F2E', border: '1px solid #2A3045', borderRadius: 12, padding: '13px 14px', color: '#fff', fontSize: 15, fontFamily: 'Inter, sans-serif', outline: 'none', display: 'block', boxSizing: 'border-box' as const }
  const lbl: React.CSSProperties = { fontSize: 12, color: '#A0A8BC', marginBottom: 6, fontWeight: 600, display: 'block', textTransform: 'uppercase' as const, letterSpacing: '.5px' }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || !message.trim()) { setError("Заповніть ім'я і повідомлення"); return }
    setError('')
    setLoading(true)
    await new Promise(r => setTimeout(r, 500))
    saveFeedback({ name: name.trim(), email: email.trim(), message: message.trim() })
    setSubmitted(true)
    setLoading(false)
  }

  return (
    <div style={{ minHeight: '100dvh', background: '#0F1117', paddingBottom: 40 }}>
      <div style={{ padding: "44px 20px 24px", paddingTop: 'max(44px,env(safe-area-inset-top,44px))', background: '#0D1018' }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', color: '#FF6B1A', fontSize: 16, cursor: 'pointer', marginBottom: 16, fontFamily: 'Inter,sans-serif' }}>← Назад</button>
        <div style={{ fontSize: 22, fontWeight: 800, color: '#fff' }}>Зворотній зв'язок</div>
        <div style={{ fontSize: 13, color: '#A0A8BC', marginTop: 4 }}>Ваше повідомлення отримає адміністратор</div>
      </div>
      <div style={{ padding: 20 }}>
        {submitted ? (
          <div style={{ textAlign: 'center', padding: '60px 0' }}>
            <div style={{ fontSize: 64, marginBottom: 20 }}>✅</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: '#fff', marginBottom: 8 }}>Повідомлення надіслано!</div>
            <div style={{ fontSize: 14, color: '#A0A8BC', marginBottom: 24 }}>Адміністратор отримав ваш відгук</div>
            <button onClick={onBack} style={{ padding: '14px 28px', background: '#FF6B1A', border: 'none', borderRadius: 14, color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer' }}>Повернутись</button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {error && <div style={{ background: '#EF444418', border: '1px solid #EF444440', borderRadius: 12, padding: '12px 14px', color: '#EF4444', fontSize: 14 }}>⚠️ {error}</div>}
            <div><label style={lbl}>Ім'я *</label><input style={inp} value={name} onChange={e => setName(e.target.value)} placeholder="Ваше ім'я" /></div>
            <div><label style={lbl}>Email</label><input style={inp} type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="твій@email.com" /></div>
            <div><label style={lbl}>Повідомлення *</label><textarea style={{ ...inp, minHeight: 120, resize: 'none' } as React.CSSProperties} value={message} onChange={e => setMessage(e.target.value)} placeholder="Ваша пропозиція або зауваження..." /></div>
            <button type="submit" disabled={loading || !name || !message} style={{ width: '100%', padding: 16, background: (loading || !name || !message) ? '#4B5563' : 'linear-gradient(135deg,#FF6B1A,#FF8C3A)', border: 'none', borderRadius: 12, color: '#fff', fontSize: 15, fontWeight: 700, cursor: (loading || !name || !message) ? 'not-allowed' : 'pointer' }}>
              {loading ? '⏳ Відправляємо...' : '📨 Відправити'}
            </button>
            <div style={{ background: '#1A1F2E', borderRadius: 12, padding: '14px 16px', border: '1px solid #2A3045' }}>
              <div style={{ fontSize: 12, color: '#A0A8BC', lineHeight: 1.6 }}>
                💬 Термінові питання:<br/>
                <a href="mailto:armen.saakyan9393@gmail.com" style={{ color: '#FF6B1A' }}>armen.saakyan9393@gmail.com</a>
              </div>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
