'use client'
import { useState, useEffect } from 'react'

type OS = 'ios' | 'android' | null

function detect(): OS {
  if (typeof navigator === 'undefined') return null
  const ua = navigator.userAgent
  // iOS: iPhone/iPad/iPod
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios'
  // Android
  if (/Android/i.test(ua)) return 'android'
  return null
}

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  return (
    (window.navigator as any).standalone === true ||
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: fullscreen)').matches
  )
}

// Works in ALL mobile browsers including Telegram WebView, Instagram, etc.
function isMobileBrowser(): boolean {
  if (typeof navigator === 'undefined') return false
  return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)
}

const KEY = 'pk_install_v2'
const COOLDOWN_DAYS = 7

export default function InstallPrompt() {
  const [visible, setVisible] = useState(false)
  const [hiding, setHiding] = useState(false)
  const [os, setOs] = useState<OS>(null)
  const [step, setStep] = useState(0)

  useEffect(() => {
    // Don't show if already installed
    if (isStandalone()) return
    // Only on mobile
    if (!isMobileBrowser()) return

    const os = detect()
    if (!os) return

    // Check cooldown
    const stored = localStorage.getItem(KEY)
    if (stored) {
      const days = (Date.now() - parseInt(stored)) / 86400000
      if (days < COOLDOWN_DAYS) return
    }

    setOs(os)
    // Delay: give page time to load
    const t = setTimeout(() => setVisible(true), 2500)
    return () => clearTimeout(t)
  }, [])

  const close = () => {
    setHiding(true)
    setTimeout(() => { setVisible(false); setHiding(false) }, 300)
    localStorage.setItem(KEY, Date.now().toString())
  }

  if (!visible || !os) return null

  const iosSteps = [
    { emoji: '⬆️', title: 'Натисни «Поділитися»', sub: 'Кнопка внизу Safari (□ зі стрілкою)' },
    { emoji: '➕', title: '«На початковий екран»', sub: 'Прокрути список вниз і знайди цей пункт' },
    { emoji: '✅', title: 'Натисни «Додати»', sub: 'Додаток з\'явиться на головному екрані' },
  ]

  return (
    <>
      <div onClick={close} style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)',
        zIndex: 900, backdropFilter: 'blur(4px)',
        animation: `${hiding ? 'fadeOut' : 'fadeIn'} .3s ease forwards`,
      }} />

      <div style={{
        position: 'fixed', bottom: 0, left: '50%',
        transform: 'translateX(-50%)',
        width: '100%', maxWidth: 430,
        background: 'linear-gradient(160deg, #131720, #0F1117)',
        borderRadius: '24px 24px 0 0',
        border: '1px solid #2A3045', borderBottom: 'none',
        paddingBottom: 'max(24px, env(safe-area-inset-bottom, 24px))',
        zIndex: 901,
        boxShadow: '0 -12px 48px rgba(0,0,0,.7)',
        animation: `${hiding ? 'slideDown' : 'slideUp'} .35s cubic-bezier(.34,1.1,.64,1) forwards`,
      }}>
        {/* Handle */}
        <div style={{ width: 40, height: 4, background: '#2A3045', borderRadius: 2, margin: '14px auto 0' }} />

        {/* App icon + title */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '18px 24px 0' }}>
          <div style={{ width: 56, height: 56, borderRadius: 16, background: 'linear-gradient(135deg,#FF6B1A,#FFB020)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, flexShrink: 0, boxShadow: '0 4px 16px rgba(255,107,26,.4)' }}>🏢</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 17, fontWeight: 700, color: '#fff' }}>Простір Коштує</div>
            <div style={{ fontSize: 13, color: '#A0A8BC', marginTop: 2 }}>
              {os === 'ios' ? 'Додати в Safari на iPhone' : 'Встановити на Android'}
            </div>
          </div>
          <button onClick={close} style={{ width: 32, height: 32, background: 'rgba(255,255,255,.08)', border: 'none', borderRadius: 10, cursor: 'pointer', color: '#6B7280', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>✕</button>
        </div>

        {/* Benefits */}
        <div style={{ display: 'flex', gap: 8, padding: '14px 24px', overflowX: 'auto', scrollbarWidth: 'none' }}>
          {[{ icon: '⚡', t: 'Швидко' }, { icon: '📵', t: 'Без браузера' }, { icon: '💾', t: 'Офлайн' }].map(b => (
            <div key={b.t} style={{ background: '#1A1F2E', borderRadius: 12, padding: '9px 14px', display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, border: '1px solid #2A3045' }}>
              <span style={{ fontSize: 15 }}>{b.icon}</span>
              <span style={{ fontSize: 12, color: '#A0A8BC', whiteSpace: 'nowrap' }}>{b.t}</span>
            </div>
          ))}
        </div>

        <div style={{ height: 1, background: '#1E2334', margin: '0 24px' }} />

        <div style={{ padding: '16px 24px 0' }}>
          {/* iOS — step by step */}
          {os === 'ios' && (
            <>
              <div style={{ fontSize: 12, color: '#6B7280', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '.6px', marginBottom: 12 }}>Кроки для Safari</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
                {iosSteps.map((s, i) => (
                  <div key={i} onClick={() => setStep(i)} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', background: i === step ? '#1A1F2E' : 'transparent', borderRadius: 14, border: `1px solid ${i === step ? '#FF6B1A' : 'transparent'}`, cursor: 'pointer', transition: 'all .2s' }}>
                    <div style={{ width: 36, height: 36, borderRadius: 12, background: i === step ? 'linear-gradient(135deg,#FF6B1A,#FF8C3A)' : '#1A1F2E', border: `1px solid ${i === step ? '#FF6B1A' : '#2A3045'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0, transition: 'all .2s' }}>{s.emoji}</div>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: i === step ? 600 : 500, color: i === step ? '#fff' : '#A0A8BC', transition: 'color .2s' }}>{s.title}</div>
                      <div style={{ fontSize: 12, color: '#6B7280', marginTop: 1 }}>{s.sub}</div>
                    </div>
                  </div>
                ))}
              </div>
              {/* Step dots */}
              <div style={{ display: 'flex', gap: 5, justifyContent: 'center', marginBottom: 14 }}>
                {iosSteps.map((_, i) => (
                  <button key={i} onClick={() => setStep(i)} style={{ width: i === step ? 20 : 6, height: 6, borderRadius: 3, background: i === step ? '#FF6B1A' : '#2A3045', border: 'none', cursor: 'pointer', padding: 0, transition: 'all .2s' }} />
                ))}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                {step < 2
                  ? <button onClick={() => setStep(s => s + 1)} style={{ flex: 1, padding: '14px', background: 'linear-gradient(135deg,#FF6B1A,#FF8C3A)', border: 'none', borderRadius: 14, color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer' }}>Далі →</button>
                  : <button onClick={close} style={{ flex: 1, padding: '14px', background: 'linear-gradient(135deg,#22C55E,#16A34A)', border: 'none', borderRadius: 14, color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer' }}>✅ Готово!</button>
                }
                <button onClick={close} style={{ padding: '14px 16px', background: '#1A1F2E', border: '1px solid #2A3045', borderRadius: 14, color: '#6B7280', fontSize: 14, cursor: 'pointer' }}>Пізніше</button>
              </div>
            </>
          )}

          {/* Android */}
          {os === 'android' && (
            <>
              <div style={{ fontSize: 12, color: '#6B7280', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '.6px', marginBottom: 12 }}>Як встановити на Android</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
                {[
                  { emoji: '⋮', title: 'Відкрий меню Chrome', sub: 'Три крапки у правому верхньому куті' },
                  { emoji: '📲', title: 'Додати на головний екран', sub: 'Або «Встановити додаток»' },
                  { emoji: '✅', title: 'Підтвердь встановлення', sub: 'Натисни «Додати» у діалозі' },
                ].map((s, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', background: '#1A1F2E', borderRadius: 12, border: '1px solid #2A3045' }}>
                    <div style={{ width: 36, height: 36, borderRadius: 12, background: '#0F1117', border: '1px solid #2A3045', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: i === 0 ? 22 : 18, fontWeight: 700, color: '#FF6B1A', flexShrink: 0 }}>{s.emoji}</div>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 600, color: '#fff' }}>{s.title}</div>
                      <div style={{ fontSize: 12, color: '#6B7280', marginTop: 1 }}>{s.sub}</div>
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={close} style={{ flex: 1, padding: '14px', background: 'linear-gradient(135deg,#FF6B1A,#FF8C3A)', border: 'none', borderRadius: 14, color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer', boxShadow: '0 4px 16px rgba(255,107,26,.3)' }}>Зрозуміло!</button>
                <button onClick={close} style={{ padding: '14px 16px', background: '#1A1F2E', border: '1px solid #2A3045', borderRadius: 14, color: '#6B7280', fontSize: 14, cursor: 'pointer' }}>Пізніше</button>
              </div>
            </>
          )}
        </div>
      </div>

      <style>{`
        @keyframes slideUp { from { transform: translateX(-50%) translateY(110%); } to { transform: translateX(-50%) translateY(0); } }
        @keyframes slideDown { from { transform: translateX(-50%) translateY(0); } to { transform: translateX(-50%) translateY(110%); } }
        @keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }
        @keyframes fadeOut { from { opacity: 1 } to { opacity: 0 } }
      `}</style>
    </>
  )
}
