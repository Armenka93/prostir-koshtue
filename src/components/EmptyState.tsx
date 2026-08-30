'use client'

interface Action {
  label: string
  onClick: () => void
}

interface Props {
  icon: string
  title: string
  subtitle?: string
  primaryAction?: Action
  secondaryAction?: Action
}

// Unified empty-state contract (spec §25/§30): every "nothing here" screen
// uses this shape instead of ad-hoc markup, so copy/spacing/actions stay
// consistent across favorites, chats, my-listings, notifications, etc.
export default function EmptyState({ icon, title, subtitle, primaryAction, secondaryAction }: Props) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '70px 24px', gap: 14, textAlign: 'center' }}>
      <div style={{
        width: 80, height: 80, background: '#1A1F2E', borderRadius: 24,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 36, border: '1px solid #2A3045',
      }}>{icon}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: '#fff' }}>{title}</div>
      {subtitle && (
        <div style={{ fontSize: 14, color: '#A0A8BC', lineHeight: 1.6, maxWidth: 280 }}>{subtitle}</div>
      )}
      {(primaryAction || secondaryAction) && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%', maxWidth: 280, marginTop: 6 }}>
          {primaryAction && (
            <button onClick={primaryAction.onClick} style={{
              padding: '13px', background: 'linear-gradient(135deg,#FF6B1A,#FF8C3A)',
              border: 'none', borderRadius: 12, color: '#fff', fontSize: 15, fontWeight: 700,
              cursor: 'pointer', fontFamily: 'Inter, sans-serif',
            }}>{primaryAction.label}</button>
          )}
          {secondaryAction && (
            <button onClick={secondaryAction.onClick} style={{
              padding: '13px', background: 'none', border: '1px solid #2A3045',
              borderRadius: 12, color: '#A0A8BC', fontSize: 14, fontWeight: 600,
              cursor: 'pointer', fontFamily: 'Inter, sans-serif',
            }}>{secondaryAction.label}</button>
          )}
        </div>
      )}
    </div>
  )
}
