'use client'
import { useState, useEffect } from 'react'

export default function ClientOnly({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  if (!mounted) return (
    <div style={{ minHeight: '100dvh', background: '#0F1117', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ width: 60, height: 60, borderRadius: 18, background: 'linear-gradient(135deg,#FF6B1A,#FFB020)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, margin: '0 auto 16px' }}>🏢</div>
        <div style={{ fontSize: 14, color: '#A0A8BC', fontFamily: 'Inter,sans-serif' }}>Завантаження...</div>
      </div>
    </div>
  )
  return <>{children}</>
}
