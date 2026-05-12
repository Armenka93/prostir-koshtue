'use client'
import { useState } from 'react'

interface Props { onBack: () => void }

export default function FeedbackScreen({ onBack }: Props) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [loading, setLoading] = useState(false)

  const inp: React.CSSProperties = { width: '100%', background: '#1A1F2E', border: '1px solid #2A3045', borderRadius: 12, padding: '13px 14px', color: '#fff', fontSize: 14, fontFamily: 'Inter, sans-serif', outline: 'none', display: 'block', marginBottom: 12 }
  const lbl: React.CSSProperties = { fontSize: 12, color: '#A0A8BC', marginBottom: 6, fontWeight: 600, display: 'block', textTransform: 'uppercase', letterSpacing: '.5px' }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name || !message) return
    setLoading(true)
    await new Promise(r => setTimeout(r, 800))
    setSubmitted(true)
    setLoading(false)
  }

  return (
    <div style={{ paddingBottom: 80, minHeight: '100dvh', background: '#0F1117' }}>
      <div style={{ padding: '48px 20px 24px', background: '#0D1018' }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', color: '#FF6B1A', fontSize: 16, cursor: 'pointer', marginBottom: 16 }}>← Назад</button>
        <div style={{ fontSize: 22, fontWeight: 800, color: '#fff' }}>Зворотній зв'язок</div>
        <div style={{ fontSize: 13, color: '#A0A8BC', marginTop: 4 }}>Поділись своїми пропозиціями та зауваженнями</div>
      </div>

      <div style={{ padding: 20 }}>
        {submitted ? (
          <div style={{ textAlign: 'center', padding: '60px 0' }}>
            <div style={{ fontSize: 48, marginBottom: 20 }}>✅</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: '#fff', marginBottom: 8 }}>Дякуємо за повідомлення!</div>
            <div style={{ fontSize: 14, color: '#A0A8BC', marginBottom: 24 }}>Ми обов'язково розглянемо ваш відгук</div>
            <button onClick={onBack} style={{ padding: '14px 28px', background: '#FF6B1A', border: 'none', borderRadius: 14, color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer' }}>Повернутись</button>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <div style={{ marginBottom: 16 }}>
              <label style={lbl}>Ім'я *</label>
              <input style={inp} value={name} onChange={e => setName(e.target.value)} placeholder="Твоє ім'я" required />
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={lbl}>Email</label>
              <input style={inp} type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="твій@email.com" />
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={lbl}>Повідомлення *</label>
              <textarea style={{ ...inp, minHeight: 120, resize: 'vertical' } as React.CSSProperties} value={message} onChange={e => setMessage(e.target.value)} placeholder="Твоя пропозиція або зауваження..." required />
            </div>
            <button type="submit" disabled={loading || !name || !message} style={{
              width: '100%', padding: 16,
              background: (loading || !name || !message) ? '#6B7280' : 'linear-gradient(135deg,#FF6B1A,#FF8C3A)',
              border: 'none', borderRadius: 12, color: '#fff', fontSize: 15, fontWeight: 700,
              cursor: (loading || !name || !message) ? 'not-allowed' : 'pointer',
            }}>
              {loading ? '⏳ Відправляємо...' : '📨 Відправити'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
