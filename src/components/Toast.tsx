'use client'

interface Props { msg: string }

export default function Toast({ msg }: Props) {
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
      padding: '12px 20px',
      fontSize: 14,
      fontWeight: 500,
      color: '#fff',
      zIndex: 1000,
      whiteSpace: 'nowrap',
      maxWidth: '90vw',
      textAlign: 'center',
      boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
      pointerEvents: 'none',
    }}>
      {msg}
    </div>
  )
}
