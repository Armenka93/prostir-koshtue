'use client'

interface ToastAction { label: string; onClick: () => void }
interface Props { msg: string; action?: ToastAction | null }

export default function Toast({ msg, action }: Props) {
  if (!msg) return null
  return (
    <div className="fade-in" style={{
      position: 'fixed',
      bottom: 96,
      left: '50%',
      transform: 'translateX(-50%)',
      background: '#1A1F2E',
      border: '1px solid #2A3045',
      borderRadius: 14,
      padding: '12px 16px 12px 20px',
      fontSize: 14,
      fontWeight: 500,
      color: '#fff',
      zIndex: 1000,
      display: 'flex',
      alignItems: 'center',
      gap: 14,
      maxWidth: '90vw',
      textAlign: 'center',
      boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
      pointerEvents: action ? 'auto' : 'none',
    }}>
      <span style={{ whiteSpace: 'nowrap' }}>{msg}</span>
      {action && (
        <button onClick={action.onClick} style={{
          background: 'none', border: 'none', color: '#FF6B1A', fontWeight: 700,
          fontSize: 14, cursor: 'pointer', padding: 0, flexShrink: 0, whiteSpace: 'nowrap',
        }}>{action.label}</button>
      )}
    </div>
  )
}
