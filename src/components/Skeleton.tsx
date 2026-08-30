'use client'

// Spec §05/§30: first load shows a skeleton matching the real structure,
// not a spinner or blank screen. Reuses the `pulse` keyframe already
// defined in globals.css.
const block = (h: number, w: string | number = '100%'): React.CSSProperties => ({
  height: h, width: w, background: '#1A1F2E', borderRadius: 8,
  animation: 'pulse 1.4s ease-in-out infinite',
})

export function SkeletonCard() {
  return (
    <div style={{ background: '#1A1F2E', borderRadius: 16, overflow: 'hidden', marginBottom: 14, border: '1px solid #2A3045' }}>
      <div style={{ ...block(140), borderRadius: 0 }} />
      <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={block(14, '40%')} />
        <div style={block(18, '80%')} />
        <div style={block(13, '55%')} />
      </div>
    </div>
  )
}

export default function Skeleton({ count = 3 }: { count?: number }) {
  return (
    <div>
      {Array.from({ length: count }).map((_, i) => <SkeletonCard key={i} />)}
    </div>
  )
}
