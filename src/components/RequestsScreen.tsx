'use client'
import { usePTR } from '@/hooks/usePTR'
import PTRIndicator from './PTRIndicator'
import type { ListingData, User } from '@/types'

interface Props {
  user: User | null
  isGuest: boolean
  listings: ListingData[]
  onLogin: () => void
  onAddListing: () => void
  onListing: (l: ListingData) => void
  onDelete: (id: number) => void
  onRefresh?: () => Promise<void>
}

export default function RequestsScreen({
  const ptr = usePTR(onRefresh) user, isGuest, listings, onLogin, onAddListing, onListing, onDelete }: Props) {
  const mine = listings.filter(l => l.userId === 'me' || l.userId === user?.id)

  if (!user) {
    return (
      <div style={{ paddingBottom: 90 }}>
      <PTRIndicator state={ptr.state} pullY={ptr.pullY} />
        <div style={{ padding: '48px 20px 16px', background: '#0D1018' }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: '#fff' }}>Мої оголошення</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '60px 24px', textAlign: 'center' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🏢</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#fff', marginBottom: 8 }}>Увійдіть щоб керувати оголошеннями</div>
          <div style={{ fontSize: 14, color: '#A0A8BC', marginBottom: 24, lineHeight: 1.5 }}>Зареєстровані користувачі можуть додавати свої приміщення</div>
          <button onClick={onLogin} style={{ padding: '16px 32px', background: 'linear-gradient(135deg,#FF6B1A,#FF8C3A)', border: 'none', borderRadius: 14, color: '#fff', fontSize: 16, fontWeight: 700, cursor: 'pointer', boxShadow: '0 4px 20px rgba(255,107,26,.35)' }}>Увійти / Зареєструватись</button>
        </div>
      </div>
    )
  }

  return (
    <div style={{ paddingBottom: 90 }}>
      <PTRIndicator state={ptr.state} pullY={ptr.pullY} />
      <div style={{ padding: '48px 20px 16px', background: '#0D1018' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
          <div>
            <div style={{ fontSize: 22, fontWeight: 800, color: '#fff' }}>Мої оголошення</div>
            <div style={{ fontSize: 13, color: '#A0A8BC', marginTop: 4 }}>
              {mine.length > 0 ? `${mine.length} об'єктів` : 'Додайте своє перше приміщення'}
            </div>
          </div>
          <button onClick={onAddListing} style={{ background: 'linear-gradient(135deg,#FF6B1A,#FF8C3A)', border: 'none', borderRadius: 12, color: '#fff', fontSize: 13, fontWeight: 700, padding: '9px 14px', cursor: 'pointer' }}>
            + Додати
          </button>
        </div>
      </div>

      <div style={{ padding: '4px 20px' }}>
        {mine.length === 0 ? (
          <div style={{ textAlign: 'center', paddingTop: 40 }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>📋</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#fff', marginBottom: 8 }}>Ще немає оголошень</div>
            <div style={{ fontSize: 14, color: '#A0A8BC', marginBottom: 24, lineHeight: 1.5 }}>Додайте приміщення — і орендарі зможуть його знайти</div>
            <button onClick={onAddListing} style={{ padding: '14px 28px', background: 'linear-gradient(135deg,#FF6B1A,#FF8C3A)', border: 'none', borderRadius: 12, color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer', boxShadow: '0 4px 16px rgba(255,107,26,.3)' }}>
              ➕ Додати приміщення
            </button>
          </div>
        ) : (
          mine.map(listing => {
            const img = listing.images?.[0] || 'https://images.unsplash.com/photo-1497366216548-37526070297c?w=800&q=80'
            return (
              <div key={listing.id} style={{ background: '#1A1F2E', borderRadius: 16, overflow: 'hidden', marginBottom: 14, border: '1px solid #2A3045' }}>
                <div style={{ display: 'flex', gap: 12, padding: 12 }}>
                  <img src={img} alt={listing.title} style={{ width: 90, height: 90, objectFit: 'cover', borderRadius: 10, flexShrink: 0 }} loading="lazy" />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: '#fff', marginBottom: 4 }}>{listing.title}</div>
                    <div style={{ fontSize: 12, color: '#A0A8BC', marginBottom: 4 }}>📍 {listing.district} • {listing.area} м²</div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: '#FF6B1A', marginBottom: 8 }}>{listing.price.toLocaleString('uk-UA')} ₴/міс</div>
                    <span style={{ background: '#22C55E22', color: '#22C55E', fontSize: 11, fontWeight: 600, borderRadius: 20, padding: '2px 8px' }}>✅ Активне</span>
                  </div>
                </div>
                <div style={{ display: 'flex', borderTop: '1px solid #2A3045' }}>
                  <button onClick={() => onListing(listing)} style={{ flex: 1, padding: '10px', background: 'none', border: 'none', color: '#2A9FD6', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>👁️ Переглянути</button>
                  <button onClick={() => { if (confirm('Видалити це оголошення?')) onDelete(listing.id) }} style={{ flex: 1, padding: '10px', background: 'none', border: 'none', borderLeft: '1px solid #2A3045', color: '#EF4444', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>🗑️ Видалити</button>
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
