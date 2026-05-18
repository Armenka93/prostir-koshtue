'use client'
import { usePTR } from '@/hooks/usePTR'
import PTRIndicator from './PTRIndicator'
import type { ListingData } from '@/types'
import { TYPE_COLORS } from '@/types'

interface Props {
  favorites: number[]
  allListings: ListingData[]
  onListing: (l: ListingData) => void
  onFavorite: (id: number) => void
  onRefresh?: () => Promise<void>
}

export default function FavoritesScreen({ favorites, allListings, onListing, onFavorite, onRefresh }: Props) {
  const ptr = usePTR(onRefresh)
  const saved = allListings.filter(l => favorites.includes(l.id))

  return (
    <div style={{ paddingBottom: 90 }}>
      <PTRIndicator state={ptr.state} pullY={ptr.pullY} />

      <div style={{ padding: "48px 20px 16px", paddingTop: 'max(48px,env(safe-area-inset-top,48px))', background: '#0D1018' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: '#fff' }}>Збережені об'єкти</div>
          {saved.length > 0 && (
            <span style={{ background: '#FF6B1A', color: '#fff', fontSize: 12, fontWeight: 700, borderRadius: 20, padding: '2px 8px' }}>
              {saved.length}
            </span>
          )}
        </div>
        <div style={{ fontSize: 13, color: '#A0A8BC' }}>Ваші обрані комерційні приміщення</div>
      </div>

      <div style={{ padding: '4px 20px' }}>
        {saved.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 80, textAlign: 'center' }}>
            <div style={{ width: 80, height: 80, background: '#1A1F2E', borderRadius: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 36, marginBottom: 20, border: '1px solid #2A3045' }}>🤍</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: '#fff', marginBottom: 8 }}>Список порожній</div>
            <div style={{ fontSize: 14, color: '#A0A8BC', lineHeight: 1.6, maxWidth: 260 }}>
              Натискайте ❤️ на об'єктах, щоб зберегти
            </div>
          </div>
        ) : (
          saved.map(listing => {
            const tc = TYPE_COLORS[listing.type] || '#FF6B1A'
            const img = listing.images?.[0] || 'https://images.unsplash.com/photo-1497366216548-37526070297c?w=800&q=80'
            return (
              <div key={listing.id} style={{ background: '#1A1F2E', borderRadius: 16, overflow: 'hidden', marginBottom: 14, border: '1px solid #2A3045', position: 'relative' }}>
                <img src={img} alt={listing.title} style={{ width: '100%', height: 160, objectFit: 'cover' }} loading="lazy" />
                <button
                  onClick={e => { e.stopPropagation(); onFavorite(listing.id) }}
                  style={{ position: 'absolute', top: 10, right: 10, background: 'rgba(15,17,23,.8)', border: 'none', borderRadius: 10, width: 36, height: 36, fontSize: 18, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                >❤️</button>
                <div style={{ padding: '14px 14px 10px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                    <span style={{ background: tc + '22', color: tc, fontSize: 11, fontWeight: 600, borderRadius: 20, padding: '2px 8px' }}>{listing.type}</span>
                    <span style={{ fontSize: 18, fontWeight: 700, color: '#FF6B1A' }}>{listing.price.toLocaleString('uk-UA')} ₴/міс</span>
                  </div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: '#fff', marginBottom: 4 }}>{listing.title}</div>
                  <div style={{ fontSize: 12, color: '#A0A8BC', marginBottom: 12 }}>📍 {listing.district} • {listing.area} м²</div>
                  <button onClick={() => onListing(listing)} style={{ width: '100%', padding: 11, background: 'linear-gradient(135deg,#FF6B1A,#FF8C3A)', border: 'none', borderRadius: 10, color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
                    Переглянути →
                  </button>
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
