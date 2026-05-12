'use client'

interface Props {
  state: 'idle' | 'pulling' | 'ready' | 'refreshing'
  pullY: number
  threshold?: number
}

export default function PullToRefresh({ state, pullY, threshold = 72 }: Props) {
  if (state === 'idle') return null

  const progress = Math.min(pullY / threshold, 1)
  const isRefreshing = state === 'refreshing'
  const isReady = state === 'ready'

  return (
    <div style={{
      position: 'fixed',
      top: 'max(12px, env(safe-area-inset-top, 12px))',
      left: '50%',
      transform: `translateX(-50%) translateY(${isRefreshing ? 0 : pullY * 0.6}px)`,
      zIndex: 300,
      pointerEvents: 'none',
      transition: isRefreshing ? 'transform .3s ease' : 'none',
    }}>
      <div style={{
        background: '#1A1F2E',
        border: `1px solid ${isReady ? '#FF6B1A' : '#2A3045'}`,
        borderRadius: 24,
        padding: '8px 16px',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
        opacity: isRefreshing ? 1 : Math.max(progress, 0.3),
        transition: 'opacity .15s, border-color .2s',
      }}>
        {isRefreshing ? (
          <>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#FF6B1A" strokeWidth="2.5" strokeLinecap="round" style={{ animation: 'spin 0.7s linear infinite' }}>
              <style>{`@keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}`}</style>
              <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
              <path d="M21 3v5h-5" />
            </svg>
            <span style={{ fontSize: 13, color: '#A0A8BC', fontFamily: 'Inter, sans-serif' }}>Оновлення...</span>
          </>
        ) : (
          <>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={isReady ? '#FF6B1A' : '#6B7280'} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
              style={{ transform: `rotate(${isReady ? 180 : progress * 160}deg)`, transition: 'transform .2s, stroke .2s' }}>
              <line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/>
            </svg>
            <span style={{ fontSize: 13, color: isReady ? '#FF6B1A' : '#A0A8BC', fontFamily: 'Inter, sans-serif', transition: 'color .2s' }}>
              {isReady ? 'Відпустіть для оновлення' : 'Потягніть вниз'}
            </span>
          </>
        )}
      </div>
    </div>
  )
}
