'use client'
import { useState, useCallback } from 'react'
import type { ListingData } from '@/types'
import { TYPE_COLORS } from '@/types'

interface Props {
  listing: ListingData
  onPress: (l: ListingData) => void
  onFavorite: (id: number) => void
  isFavorite: boolean
  layout?: 'horizontal' | 'vertical'
}

function FavBtn({ id, isFav, onFav, size = 18, style }: { id: number; isFav: boolean; onFav: (id: number) => void; size?: number; style?: React.CSSProperties }) {
  const [scale, setScale] = useState(1)
  const click = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    setScale(0.75)
    setTimeout(() => setScale(1.15), 80)
    setTimeout(() => setScale(1), 180)
    onFav(id)
  }, [id, onFav])
  return (
    <button onClick={click} style={{ ...style, transform: `scale(${scale})`, transition: scale === 1 ? 'transform .15s ease-out' : 'transform .08s ease-in', willChange: 'transform' }}>
      <span style={{ fontSize: size }}>{isFav ? '❤️' : '🤍'}</span>
    </button>
  )
}

export default function PropertyCard({ listing: l, onPress, onFavorite, isFavorite, layout = 'horizontal' }: Props) {
  const tc = TYPE_COLORS[l.type] || '#FF6B1A'
  const img = l.images?.[0] || 'https://images.unsplash.com/photo-1497366216548-37526070297c?w=800&q=80'

  if (layout === 'vertical') {
    return (
      <div className="property-card" onClick={() => onPress(l)} style={{
        background: '#1A1F2E', borderRadius: 16, overflow: 'hidden',
        width: 200, flexShrink: 0, border: '1px solid #2A3045', cursor: 'pointer',
      }}>
        <div style={{ position: 'relative' }}>
          <img src={img} alt={l.title} style={{ width: '100%', height: 130, objectFit: 'cover' }} loading="lazy" />
          {(l.isNew || l.isFeatured) && (
            <span style={{
              position: 'absolute', top: 8, left: 8,
              background: l.isNew ? '#FF6B1A' : '#FFB020',
              color: '#fff', fontSize: 10, fontWeight: 700, borderRadius: 20, padding: '3px 8px',
            }}>{l.isNew ? 'НОВИЙ' : 'ТОП'}</span>
          )}
          <FavBtn id={l.id} isFav={isFavorite} onFav={onFavorite} size={14} style={{
            position: 'absolute', top: 8, right: 8,
            background: 'rgba(15,17,23,0.7)', border: 'none', cursor: 'pointer',
            borderRadius: 20, width: 28, height: 28,
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
          }} />
        </div>
        <div style={{ padding: 10 }}>
          <span style={{ background: tc + '22', color: tc, fontSize: 10, fontWeight: 600, borderRadius: 20, padding: '2px 7px', display: 'inline-block', marginBottom: 6 }}>{l.type}</span>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#fff', marginBottom: 3, lineHeight: 1.3 }}>{l.title.length > 28 ? l.title.slice(0, 28) + '…' : l.title}</div>
          <div style={{ fontSize: 11, color: '#A0A8BC', marginBottom: 5 }}>{l.district} • {l.area} м²</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#FF6B1A' }}>{l.price.toLocaleString('uk-UA')} ₴/міс</div>
          {((l.views ?? 0) > 0 || (l.likes ?? 0) > 0) && (
            <div style={{ display: 'flex', gap: 8, marginTop: 5, fontSize: 10, color: '#6B7280' }}>
              {(l.views ?? 0) > 0 && <span>👁 {l.views}</span>}
              {(l.likes ?? 0) > 0 && <span>❤️ {l.likes}</span>}
              {l.isPromoted && <span style={{ color: '#FFB020' }}>⭐</span>}
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="property-card" onClick={() => onPress(l)} style={{
      background: '#1A1F2E', borderRadius: 16, overflow: 'hidden',
      display: 'flex', gap: 12, padding: 12,
      border: '1px solid #2A3045', cursor: 'pointer', marginBottom: 12, position: 'relative',
    }}>
      <img src={img} alt={l.title} style={{ width: 110, height: 110, objectFit: 'cover', borderRadius: 12, flexShrink: 0 }} loading="lazy" />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6, paddingRight: 34 }}>
          <span style={{ background: tc + '22', color: tc, fontSize: 11, fontWeight: 600, borderRadius: 20, padding: '2px 8px' }}>{l.type}</span>
          {l.isNew && <span style={{ background: '#FF6B1A22', color: '#FF6B1A', fontSize: 10, fontWeight: 700, borderRadius: 20, padding: '2px 6px', whiteSpace: 'nowrap' }}>НОВИЙ</span>}
        </div>
        <div style={{ fontSize: 14, fontWeight: 600, color: '#fff', marginBottom: 4, lineHeight: 1.3 }}>
          {l.title.length > 40 ? l.title.slice(0, 40) + '…' : l.title}
        </div>
        <div style={{ fontSize: 12, color: '#A0A8BC', marginBottom: 6 }}>📍 {l.district} • {l.area} м²</div>
        <div style={{ fontSize: 16, fontWeight: 700, color: '#FF6B1A' }}>{l.price.toLocaleString('uk-UA')} ₴/міс</div>
        {l.features && l.features.length > 0 && (
          <div style={{ display: 'flex', gap: 4, marginTop: 6, flexWrap: 'wrap' }}>
            {l.features.slice(0, 2).map(f => (
              <span key={f} style={{ background: '#0F1117', color: '#A0A8BC', fontSize: 10, borderRadius: 6, padding: '2px 6px', border: '1px solid #2A3045', maxWidth: '100%', overflowWrap: 'anywhere', wordBreak: 'break-word' }}>{f}</span>
            ))}
          </div>
        )}
      </div>
      <FavBtn id={l.id} isFav={isFavorite} onFav={onFavorite} size={18} style={{
        position: 'absolute', top: 12, right: 12, background: 'none', border: 'none', cursor: 'pointer', lineHeight: 1, padding: 0,
      }} />
    </div>
  )
}
