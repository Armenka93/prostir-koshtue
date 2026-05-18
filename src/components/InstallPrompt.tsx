'use client'
import { useState, useEffect } from 'react'

// ── Browser / OS detection ────────────────────────────────────
function getUA() {
  return typeof navigator !== 'undefined' ? navigator.userAgent : ''
}

function getOS(): 'ios' | 'android' | null {
  const ua = getUA()
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios'
  if (/Android/i.test(ua)) return 'android'
  return null
}

// Detect Telegram in-app browser
function isTelegramBrowser(): boolean {
  const ua = getUA()
  return /Telegram|TelegramBot/i.test(ua) || /\bTelegram\b/i.test(ua)
}

// Detect any in-app browser (not native Safari/Chrome)
function isInAppBrowser(): boolean {
  const ua = getUA()
  return (
    isTelegramBrowser() ||
    /Instagram|FBAN|FBAV|LinkedIn|Twitter|Snapchat|Pinterest|WeChat|Line/i.test(ua) ||
    // iOS: in-app if no "Safari" token but has "AppleWebKit"
    (/iPhone|iPad/i.test(ua) && /AppleWebKit/i.test(ua) && !/Safari/i.test(ua) && !/CriOS/i.test(ua) && !/FxiOS/i.test(ua)) ||
    false
  )
}

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  return (
    (window.navigator as any).standalone === true ||
    window.matchMedia('(display-mode: standalone)').matches
  )
}

function isMobile(): boolean {
  return /iPhone|iPad|iPod|Android/i.test(getUA())
}

const KEY_INSTALL = 'pk_install_v3'
const KEY_INAPP = 'pk_inapp_v1'
const COOLDOWN_DAYS = 5

export default function InstallPrompt() {
  const [mode, setMode] = useState<'inapp' | 'install' | null>(null)
  const [hiding, setHiding] = useState(false)
  const [os, setOs] = useState<'ios' | 'android' | null>(null)
  const [step, setStep] = useState(0)

  useEffect(() => {
    if (isStandalone() || !isMobile()) return

    const currentOs = getOS()
    setOs(currentOs)

    const inApp = isInAppBrowser()
    const telegram = isTelegramBrowser()

    // 1. Check if we're in an in-app browser (Telegram etc.)
    if (inApp || telegram) {
      const dismissed = localStorage.getItem(KEY_INAPP)
      if (!dismissed || (Date.now() - parseInt(dismissed)) > COOLDOWN_DAYS * 86400000) {
        setTimeout(() => setMode('inapp'), 1500)
        return
      }
    }

    // 2. Show install prompt for native browsers
    const dismissed = localStorage.getItem(KEY_INSTALL)
    if (!dismissed || (Date.now() - parseInt(dismissed)) > COOLDOWN_DAYS * 86400000) {
      setTimeout(() => setMode('install'), 3000)
    }
  }, [])

  const closeInApp = () => {
    setHiding(true)
    setTimeout(() => { setMode(null); setHiding(false) }, 300)
    localStorage.setItem(KEY_INAPP, Date.now().toString())
  }

  const closeInstall = () => {
    setHiding(true)
    setTimeout(() => { setMode(null); setHiding(false) }, 300)
    localStorage.setItem(KEY_INSTALL, Date.now().toString())
  }

  if (!mode) return null

  const animStyle = hiding
    ? 'slideDown .3s ease forwards'
    : 'slideUp .4s cubic-bezier(.34,1.1,.64,1) forwards'

  // ── IN-APP BROWSER: "Відкрий в Safari / Chrome" ──────────────
  if (mode === 'inapp') {
    const browserName = os === 'ios' ? 'Safari' : 'Chrome'
    const browserIcon = os === 'ios' ? '🧭' : '🌐'

    return (
      <>
        <div onClick={closeInApp} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.65)', zIndex: 900, backdropFilter: 'blur(6px)', animation: hiding ? 'fadeOut .3s forwards' : 'fadeIn .3s forwards' }} />
        <div style={{ position: 'fixed', bottom: 0, left: '50%', transform: 'translateX(-50%)', width: '100%', maxWidth: 430, background: '#131720', borderRadius: '24px 24px 0 0', border: '1px solid #2A3045', borderBottom: 'none', paddingBottom: 'max(24px,env(safe-area-inset-bottom,24px))', zIndex: 901, boxShadow: '0 -12px 48px rgba(0,0,0,.7)', animation: animStyle }}>

          <div style={{ width: 40, height: 4, background: '#2A3045', borderRadius: 2, margin: '14px auto 0' }} />

          {/* Header */}
          <div style={{ padding: '18px 24px 0', display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ width: 52, height: 52, borderRadius: 14, background: 'linear-gradient(135deg,#FF6B1A,#FFB020)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26, flexShrink: 0 }}>🏢</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#fff' }}>Відкрий у {browserName}</div>
              <div style={{ fontSize: 13, color: '#A0A8BC', marginTop: 2 }}>Для встановлення на екран</div>
            </div>
            <button onClick={closeInApp} style={{ width: 30, height: 30, background: 'rgba(255,255,255,.08)', border: 'none', borderRadius: 8, cursor: 'pointer', color: '#6B7280', fontSize: 15, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>✕</button>
          </div>

          {/* Why message */}
          <div style={{ margin: '16px 24px 0', background: '#FF6B1A11', border: '1px solid #FF6B1A33', borderRadius: 14, padding: '12px 14px', display: 'flex', alignItems: 'flex-start', gap: 10 }}>
            <span style={{ fontSize: 20, flexShrink: 0 }}>ℹ️</span>
            <div style={{ fontSize: 13, color: '#A0A8BC', lineHeight: 1.55 }}>
              Ви відкрили посилання через Telegram. Щоб встановити додаток на телефон, потрібно відкрити його у рідному браузері.
            </div>
          </div>

          {/* Steps */}
          <div style={{ padding: '16px 24px 0', display: 'flex', flexDirection: 'column', gap: 10 }}>
            {os === 'ios' ? [
              { emoji: '⬆️', title: 'Натисни «...» або кнопку меню', sub: 'У правому куті браузера Telegram' },
              { emoji: browserIcon, title: `Вибери «Відкрити в ${browserName}»`, sub: 'Сторінка відкриється в Safari' },
              { emoji: '📲', title: 'Встанови додаток', sub: 'Натисни ⬆️ → «На початковий екран»' },
            ] : [
              { emoji: '⬆️', title: 'Натисни «...» або меню', sub: 'У правому куті браузера Telegram' },
              { emoji: browserIcon, title: `Вибери «Відкрити в ${browserName}»`, sub: 'Сторінка відкриється у Chrome' },
              { emoji: '📲', title: 'Встанови додаток', sub: 'Chrome: меню ⋮ → «Додати на екран»' },
            ]}.map((s, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', background: '#1A1F2E', borderRadius: 12, border: '1px solid #2A3045' }}>
                <div style={{ width: 36, height: 36, borderRadius: 10, background: i === 0 ? 'linear-gradient(135deg,#FF6B1A,#FF8C3A)' : '#0F1117', border: '1px solid #2A3045', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0 }}>{s.emoji}</div>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: '#fff' }}>{s.title}</div>
                  <div style={{ fontSize: 12, color: '#6B7280', marginTop: 1 }}>{s.sub}</div>
                </div>
              </div>
            ))}
          </div>

          <div style={{ padding: '16px 24px 0', display: 'flex', gap: 8 }}>
            <button onClick={closeInApp} style={{ flex: 1, padding: '14px', background: 'linear-gradient(135deg,#FF6B1A,#FF8C3A)', border: 'none', borderRadius: 14, color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer' }}>
              Зрозуміло!
            </button>
            <button onClick={closeInApp} style={{ padding: '14px 16px', background: '#1A1F2E', border: '1px solid #2A3045', borderRadius: 14, color: '#6B7280', fontSize: 14, cursor: 'pointer' }}>
              Пізніше
            </button>
          </div>
        </div>

        <style>{`
          @keyframes slideUp{from{transform:translateX(-50%) translateY(110%)}to{transform:translateX(-50%) translateY(0)}}
          @keyframes slideDown{from{transform:translateX(-50%) translateY(0)}to{transform:translateX(-50%) translateY(110%)}}
          @keyframes fadeIn{from{opacity:0}to{opacity:1}}
          @keyframes fadeOut{from{opacity:1}to{opacity:0}}
        `}</style>
      </>
    )
  }

  // ── INSTALL PROMPT (native browser) ──────────────────────────
  const iosSteps = [
    { emoji: '⬆️', title: 'Натисни «Поділитися»', sub: 'Кнопка внизу Safari (□ зі стрілкою)' },
    { emoji: '➕', title: '«На початковий екран»', sub: 'Прокрути список і знайди цей пункт' },
    { emoji: '✅', title: 'Натисни «Додати»', sub: 'Додаток з\'явиться на головному екрані' },
  ]

  return (
    <>
      <div onClick={closeInstall} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', zIndex: 900, backdropFilter: 'blur(4px)', animation: hiding ? 'fadeOut .3s forwards' : 'fadeIn .3s forwards' }} />

      <div style={{ position: 'fixed', bottom: 0, left: '50%', transform: 'translateX(-50%)', width: '100%', maxWidth: 430, background: 'linear-gradient(160deg,#131720,#0F1117)', borderRadius: '24px 24px 0 0', border: '1px solid #2A3045', borderBottom: 'none', paddingBottom: 'max(24px,env(safe-area-inset-bottom,24px))', zIndex: 901, boxShadow: '0 -12px 48px rgba(0,0,0,.7)', animation: animStyle }}>

        <div style={{ width: 40, height: 4, background: '#2A3045', borderRadius: 2, margin: '14px auto 0' }} />

        <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '18px 24px 0' }}>
          <div style={{ width: 54, height: 54, borderRadius: 16, background: 'linear-gradient(135deg,#FF6B1A,#FFB020)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, flexShrink: 0, boxShadow: '0 4px 16px rgba(255,107,26,.4)' }}>🏢</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 17, fontWeight: 700, color: '#fff' }}>Простір Коштує</div>
            <div style={{ fontSize: 13, color: '#A0A8BC', marginTop: 2 }}>Встановити на телефон</div>
          </div>
          <button onClick={closeInstall} style={{ width: 30, height: 30, background: 'rgba(255,255,255,.08)', border: 'none', borderRadius: 8, cursor: 'pointer', color: '#6B7280', fontSize: 15, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>✕</button>
        </div>

        {/* Benefits */}
        <div style={{ display: 'flex', gap: 8, padding: '14px 24px', overflowX: 'auto', scrollbarWidth: 'none' }}>
          {[{ i: '⚡', t: 'Швидкий запуск' }, { i: '📵', t: 'Без браузера' }, { i: '💾', t: 'Завжди під рукою' }].map(b => (
            <div key={b.t} style={{ background: '#1A1F2E', borderRadius: 12, padding: '9px 14px', display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, border: '1px solid #2A3045' }}>
              <span style={{ fontSize: 15 }}>{b.i}</span>
              <span style={{ fontSize: 12, color: '#A0A8BC', whiteSpace: 'nowrap' }}>{b.t}</span>
            </div>
          ))}
        </div>

        <div style={{ height: 1, background: '#1E2334', margin: '0 24px' }} />
        <div style={{ padding: '16px 24px 0' }}>

          {os === 'ios' ? (
            <>
              <div style={{ fontSize: 11, color: '#6B7280', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '.6px', marginBottom: 10 }}>Кроки для Safari</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
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
              <div style={{ display: 'flex', gap: 5, justifyContent: 'center', marginBottom: 14 }}>
                {iosSteps.map((_, i) => <button key={i} onClick={() => setStep(i)} style={{ width: i === step ? 20 : 6, height: 6, borderRadius: 3, background: i === step ? '#FF6B1A' : '#2A3045', border: 'none', cursor: 'pointer', padding: 0, transition: 'all .2s' }} />)}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                {step < 2
                  ? <button onClick={() => setStep(s => s + 1)} style={{ flex: 1, padding: '14px', background: 'linear-gradient(135deg,#FF6B1A,#FF8C3A)', border: 'none', borderRadius: 14, color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer' }}>Далі →</button>
                  : <button onClick={closeInstall} style={{ flex: 1, padding: '14px', background: 'linear-gradient(135deg,#22C55E,#16A34A)', border: 'none', borderRadius: 14, color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer' }}>✅ Готово!</button>
                }
                <button onClick={closeInstall} style={{ padding: '14px 16px', background: '#1A1F2E', border: '1px solid #2A3045', borderRadius: 14, color: '#6B7280', fontSize: 14, cursor: 'pointer' }}>Пізніше</button>
              </div>
            </>
          ) : (
            <>
              <div style={{ fontSize: 11, color: '#6B7280', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '.6px', marginBottom: 10 }}>Кроки для Android</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
                {[
                  { emoji: '⋮', title: 'Натисни меню Chrome (⋮)', sub: 'Три крапки у правому верхньому куті' },
                  { emoji: '📲', title: 'Вибери «Додати на екран»', sub: 'Або «Встановити додаток»' },
                  { emoji: '✅', title: 'Підтвердь встановлення', sub: 'Натисни «Встановити» у діалозі' },
                ].map((s, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', background: '#1A1F2E', borderRadius: 12, border: '1px solid #2A3045' }}>
                    <div style={{ width: 36, height: 36, borderRadius: 10, background: '#0F1117', border: '1px solid #2A3045', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: i === 0 ? 22 : 18, fontWeight: 700, color: '#FF6B1A', flexShrink: 0 }}>{s.emoji}</div>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 600, color: '#fff' }}>{s.title}</div>
                      <div style={{ fontSize: 12, color: '#6B7280', marginTop: 1 }}>{s.sub}</div>
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={closeInstall} style={{ flex: 1, padding: '14px', background: 'linear-gradient(135deg,#FF6B1A,#FF8C3A)', border: 'none', borderRadius: 14, color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer' }}>Зрозуміло!</button>
                <button onClick={closeInstall} style={{ padding: '14px 16px', background: '#1A1F2E', border: '1px solid #2A3045', borderRadius: 14, color: '#6B7280', fontSize: 14, cursor: 'pointer' }}>Пізніше</button>
              </div>
            </>
          )}
        </div>
      </div>

      <style>{`
        @keyframes slideUp{from{transform:translateX(-50%) translateY(110%)}to{transform:translateX(-50%) translateY(0)}}
        @keyframes slideDown{from{transform:translateX(-50%) translateY(0)}to{transform:translateX(-50%) translateY(110%)}}
        @keyframes fadeIn{from{opacity:0}to{opacity:1}}
        @keyframes fadeOut{from{opacity:1}to{opacity:0}}
      `}</style>
    </>
  )
}
