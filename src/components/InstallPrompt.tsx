'use client'
import { useState, useEffect } from 'react'

type Platform = 'ios' | 'android' | 'desktop' | null

function getPlatform(): Platform {
  if (typeof window === 'undefined') return null
  const ua = navigator.userAgent
  if (/iPad|iPhone|iPod/.test(ua) && !(window as any).MSStream) return 'ios'
  if (/Android/.test(ua)) return 'android'
  return 'desktop'
}

function isInStandaloneMode(): boolean {
  if (typeof window === 'undefined') return false
  return (
    (window.navigator as any).standalone === true ||
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: fullscreen)').matches
  )
}

const STORAGE_KEY = 'pk_install_dismissed'
const DISMISSED_DAYS = 14 // показати знову через 14 днів

export default function InstallPrompt() {
  const [show, setShow] = useState(false)
  const [platform, setPlatform] = useState<Platform>(null)
  const [step, setStep] = useState(0) // для iOS покрокова інструкція
  const [hiding, setHiding] = useState(false)

  useEffect(() => {
    // Перевірка: вже встановлено?
    if (isInStandaloneMode()) return

    // Перевірка: нещодавно закрив?
    const dismissed = localStorage.getItem(STORAGE_KEY)
    if (dismissed) {
      const days = (Date.now() - parseInt(dismissed)) / 86400000
      if (days < DISMISSED_DAYS) return
    }

    const p = getPlatform()
    if (p === 'desktop') return // тільки мобільні

    setPlatform(p)

    // Показати через 3 сек після відкриття
    const t = setTimeout(() => setShow(true), 3000)
    return () => clearTimeout(t)
  }, [])

  const dismiss = () => {
    setHiding(true)
    setTimeout(() => {
      setShow(false)
      setHiding(false)
    }, 300)
    localStorage.setItem(STORAGE_KEY, Date.now().toString())
  }

  const iosSteps = [
    { icon: '⬆️', text: 'Натисни кнопку «Поділитися»', sub: 'Внизу Safari (квадрат зі стрілкою)' },
    { icon: '➕', text: 'Вибери «На початковий екран»', sub: 'Прокрути список дій вниз' },
    { icon: '✅', text: 'Натисни «Додати»', sub: 'Додаток з\'явиться на головному екрані' },
  ]

  if (!show || !platform) return null

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={dismiss}
        style={{
          position: 'fixed', inset: 0,
          background: 'rgba(0,0,0,.55)',
          zIndex: 800,
          backdropFilter: 'blur(4px)',
          animation: hiding ? 'fadeOut .3s ease forwards' : 'fadeIn .3s ease forwards',
        }}
      />

      {/* Prompt sheet */}
      <div style={{
        position: 'fixed',
        bottom: 0,
        left: '50%',
        transform: 'translateX(-50%)',
        width: '100%',
        maxWidth: 430,
        background: '#131720',
        borderRadius: '24px 24px 0 0',
        border: '1px solid #2A3045',
        borderBottom: 'none',
        zIndex: 801,
        paddingBottom: 'max(24px, env(safe-area-inset-bottom, 24px))',
        boxShadow: '0 -8px 40px rgba(0,0,0,.6)',
        animation: hiding ? 'slideDown .3s ease forwards' : 'slideUp .35s cubic-bezier(.34,1.2,.64,1) forwards',
      }}>
        {/* Handle */}
        <div style={{ width: 40, height: 4, background: '#2A3045', borderRadius: 2, margin: '14px auto 0' }} />

        {/* App preview header */}
        <div style={{ padding: '20px 24px 0', display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 56, height: 56, borderRadius: 16, background: 'linear-gradient(135deg,#FF6B1A,#FFB020)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, flexShrink: 0, boxShadow: '0 4px 16px rgba(255,107,26,.4)' }}>🏢</div>
          <div>
            <div style={{ fontSize: 17, fontWeight: 700, color: '#fff' }}>Простір Коштує</div>
            <div style={{ fontSize: 13, color: '#A0A8BC', marginTop: 2 }}>Встановити як додаток</div>
          </div>
          <button onClick={dismiss} style={{ marginLeft: 'auto', background: 'rgba(255,255,255,.08)', border: 'none', borderRadius: 10, width: 32, height: 32, cursor: 'pointer', color: '#6B7280', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>✕</button>
        </div>

        {/* Benefits */}
        <div style={{ display: 'flex', gap: 8, padding: '16px 24px', overflowX: 'auto', scrollbarWidth: 'none' }}>
          {[
            { icon: '⚡', text: 'Швидший запуск' },
            { icon: '📵', text: 'Без браузера' },
            { icon: '🔔', text: 'Сповіщення' },
          ].map(b => (
            <div key={b.text} style={{ background: '#1A1F2E', borderRadius: 12, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, border: '1px solid #2A3045' }}>
              <span style={{ fontSize: 16 }}>{b.icon}</span>
              <span style={{ fontSize: 12, color: '#A0A8BC', whiteSpace: 'nowrap' }}>{b.text}</span>
            </div>
          ))}
        </div>

        <div style={{ height: '1px', background: '#1E2334', margin: '0 24px' }} />

        {/* Platform-specific instructions */}
        <div style={{ padding: '16px 24px 0' }}>
          {platform === 'ios' ? (
            <>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#A0A8BC', marginBottom: 14, textTransform: 'uppercase' as const, letterSpacing: '.5px' }}>
                Як встановити на iPhone
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {iosSteps.map((s, i) => (
                  <div key={i} style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
                    <div style={{
                      width: 36, height: 36, borderRadius: 12, flexShrink: 0,
                      background: i === step ? 'linear-gradient(135deg,#FF6B1A,#FF8C3A)' : '#1A1F2E',
                      border: `1px solid ${i === step ? '#FF6B1A' : '#2A3045'}`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 18, transition: 'all .2s',
                    }}>{s.icon}</div>
                    <div style={{ flex: 1, paddingTop: 2 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, color: i === step ? '#fff' : '#A0A8BC', transition: 'color .2s' }}>{s.text}</div>
                      <div style={{ fontSize: 12, color: '#6B7280', marginTop: 2 }}>{s.sub}</div>
                    </div>
                    {i < iosSteps.length - 1 && (
                      <div style={{ width: 20, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#2A3045', flexShrink: 0, marginTop: 8 }}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Step dots */}
              <div style={{ display: 'flex', gap: 6, justifyContent: 'center', marginTop: 16 }}>
                {iosSteps.map((_, i) => (
                  <button key={i} onClick={() => setStep(i)} style={{ width: i === step ? 20 : 6, height: 6, borderRadius: 3, background: i === step ? '#FF6B1A' : '#2A3045', border: 'none', cursor: 'pointer', padding: 0, transition: 'all .2s' }} />
                ))}
              </div>

              <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
                {step < iosSteps.length - 1 ? (
                  <button onClick={() => setStep(s => s + 1)} style={{ flex: 1, padding: '14px', background: 'linear-gradient(135deg,#FF6B1A,#FF8C3A)', border: 'none', borderRadius: 14, color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer', boxShadow: '0 4px 16px rgba(255,107,26,.3)' }}>
                    Далі →
                  </button>
                ) : (
                  <button onClick={dismiss} style={{ flex: 1, padding: '14px', background: 'linear-gradient(135deg,#22C55E,#16A34A)', border: 'none', borderRadius: 14, color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer' }}>
                    ✅ Готово!
                  </button>
                )}
                <button onClick={dismiss} style={{ padding: '14px 18px', background: '#1A1F2E', border: '1px solid #2A3045', borderRadius: 14, color: '#6B7280', fontSize: 14, cursor: 'pointer' }}>
                  Пізніше
                </button>
              </div>
            </>
          ) : (
            <>
              {/* Android */}
              <div style={{ fontSize: 13, fontWeight: 600, color: '#A0A8BC', marginBottom: 14, textTransform: 'uppercase' as const, letterSpacing: '.5px' }}>
                Як встановити на Android
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
                {[
                  { icon: '⋮', text: 'Натисни меню (три крапки)', sub: 'У правому верхньому куті Chrome' },
                  { icon: '📲', text: 'Вибери «Додати на головний екран»', sub: 'Або «Встановити додаток»' },
                  { icon: '✅', text: 'Підтвердь встановлення', sub: 'Натисни «Додати» у діалозі' },
                ].map((s, i) => (
                  <div key={i} style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
                    <div style={{ width: 36, height: 36, borderRadius: 12, flexShrink: 0, background: '#1A1F2E', border: '1px solid #2A3045', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: i === 0 ? 22 : 18, fontWeight: 700, color: '#FF6B1A' }}>{s.icon}</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, color: '#fff' }}>{s.text}</div>
                      <div style={{ fontSize: 12, color: '#6B7280', marginTop: 2 }}>{s.sub}</div>
                    </div>
                  </div>
                ))}
              </div>

              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={dismiss} style={{ flex: 1, padding: '14px', background: 'linear-gradient(135deg,#FF6B1A,#FF8C3A)', border: 'none', borderRadius: 14, color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer', boxShadow: '0 4px 16px rgba(255,107,26,.3)' }}>
                  Зрозуміло!
                </button>
                <button onClick={dismiss} style={{ padding: '14px 18px', background: '#1A1F2E', border: '1px solid #2A3045', borderRadius: 14, color: '#6B7280', fontSize: 14, cursor: 'pointer' }}>
                  Пізніше
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      <style>{`
        @keyframes slideUp {
          from { transform: translateX(-50%) translateY(100%); opacity: 0; }
          to { transform: translateX(-50%) translateY(0); opacity: 1; }
        }
        @keyframes slideDown {
          from { transform: translateX(-50%) translateY(0); opacity: 1; }
          to { transform: translateX(-50%) translateY(100%); opacity: 0; }
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes fadeOut {
          from { opacity: 1; }
          to { opacity: 0; }
        }
      `}</style>
    </>
  )
}
