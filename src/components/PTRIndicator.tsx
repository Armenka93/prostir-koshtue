'use client'

type State = 'idle' | 'pulling' | 'ready' | 'refreshing'

interface Props { state: State; pullY: number }

export default function PTRIndicator({ state, pullY }: Props) {
  if (state === 'idle') return null
  const pct = Math.min(pullY / 64, 1)
  const isRefreshing = state === 'refreshing'
  const isReady = state === 'ready'

  return (
    <div style={{
      position: 'fixed',
      top: 'max(10px, env(safe-area-inset-top, 10px))',
      left: '50%', transform: 'translateX(-50%)',
      zIndex: 400, pointerEvents: 'none',
      opacity: isRefreshing ? 1 : Math.max(pct, 0.25),
      transition: isRefreshing ? 'opacity .2s' : 'none',
    }}>
      <div style={{
        background: '#1A1F2E',
        border: `1px solid ${isReady ? '#FF6B1A' : '#2A3045'}`,
        borderRadius: 20, padding: '7px 14px',
        display: 'flex', alignItems: 'center', gap: 8,
        boxShadow: '0 4px 20px rgba(0,0,0,.6)',
        transition: 'border-color .2s',
      }}>
        {isRefreshing ? (
          <>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#FF6B1A" strokeWidth="2.5" strokeLinecap="round" style={{ animation: 'ptr_spin .7s linear infinite' }}>
              <style>{'@keyframes ptr_spin{to{transform:rotate(360deg)}}'}</style>
              <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>
            </svg>
            <span style={{ fontSize: 12, color: '#A0A8BC', fontFamily: 'Inter,sans-serif', whiteSpace: 'nowrap' }}>Оновлення...</span>
          </>
        ) : (
          <>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={isReady ? '#FF6B1A' : '#6B7280'} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
              style={{ transform: `rotate(${isReady ? 180 : Math.round(pct * 160)}deg)`, transition: 'transform .15s, stroke .2s' }}>
              <line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/>
            </svg>
            <span style={{ fontSize: 12, color: isReady ? '#FF6B1A' : '#A0A8BC', fontFamily: 'Inter,sans-serif', transition: 'color .2s', whiteSpace: 'nowrap' }}>
              {isReady ? 'Відпустіть' : 'Потягніть вниз'}
            </span>
          </>
        )}
      </div>
    </div>
  )
}
