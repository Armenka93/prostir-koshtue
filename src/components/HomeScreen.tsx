'use client'
import { useState, useMemo } from 'react'
import PropertyCard from './PropertyCard'
import type { ListingData, FeedData, User } from '@/types'
import { CATEGORIES, DISTRICTS } from '@/types'

interface Props {
  listings: ListingData[]
  feed?: FeedData | null
  onListing: (l: ListingData) => void
  onFavorite: (id: number) => void
  favorites: number[]
  user: User | null
  isGuest: boolean
  onLogin: () => void
  onAddListing: () => void
  loading: boolean
  onProfile?: () => void
  onRefresh?: () => Promise<void>
  onShowAll?: (title: string, items: ListingData[]) => void
}

export default function HomeScreen({ listings, feed, onListing, onFavorite, favorites, user, isGuest, onLogin, onAddListing, loading, onProfile, onShowAll }: Props) {
  const [query, setQuery] = useState('')
  const [activeType, setActiveType] = useState('all')
  const [showFilters, setShowFilters] = useState(false)
  const [district, setDistrict] = useState('Всі райони')

  const popular = feed?.populyarni?.slice(0, 6) ?? [...listings].sort((a, b) => b.views - a.views).slice(0, 6)
  const fresh = feed?.novi?.slice(0, 6) ?? listings.filter(l => l.isNew).slice(0, 6)
  const recommended = feed?.rekomendovani?.slice(0, 6) ?? listings.filter(l => l.isFeatured).slice(0, 6)

  const searchResults = useMemo(() => {
    if (!query.trim() && activeType === 'all' && district === 'Всі райони') return null
    let r = [...listings]
    if (query) {
      const q = query.toLowerCase()
      r = r.filter(l => l.title.toLowerCase().includes(q) || l.district.toLowerCase().includes(q) || l.type.toLowerCase().includes(q))
    }
    if (activeType !== 'all') r = r.filter(l => l.type === activeType)
    if (district !== 'Всі райони') r = r.filter(l => l.district === district)
    return r
  }, [query, activeType, district, listings])

  const isSearching = searchResults !== null

  const handleCatClick = (id: string) => {
    setActiveType(id)
    if (id !== 'all') {
      const cat = CATEGORIES.find(c => c.id === id)
      const items = listings.filter(l => l.type === id)
      if (onShowAll && items.length > 0) {
        onShowAll(`${cat?.icon || ''} ${cat?.label || id}`, items)
      }
    }
  }

  return (
    <div style={{ paddingBottom: 80, minHeight: '100dvh' }}>
      {/* Header */}
      <div style={{ padding: 'env(safe-area-inset-top, 44px) 20px 16px', paddingTop: 'max(44px, env(safe-area-inset-top, 44px))', background: 'linear-gradient(180deg,#0D1018,#0F1117)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            <img src="/logo-main.png" alt="" loading="eager" style={{ width: 40, height: 40, objectFit: 'contain', flexShrink: 0 }}
              onError={e => { const t = e.target as HTMLImageElement; t.onerror = null; t.style.cssText = 'width:40px;height:40px;background:linear-gradient(135deg,#FF6B1A,#FFB020);border-radius:12px;object-fit:contain;flex-shrink:0' }} />
            <span style={{ fontFamily: "'Russo One', sans-serif", fontSize: 'clamp(14px, 4vw, 18px)', color: '#FFB020', letterSpacing: '.3px', whiteSpace: 'nowrap' }}>
              ПРОСТІР КОШТУЄ
            </span>
          </div>
          <div style={{ flexShrink: 0, marginLeft: 8 }}>
            {user ? (
              <div onClick={onProfile} style={{
                width: 36, height: 36, borderRadius: 10, flexShrink: 0,
                background: 'linear-gradient(135deg,#FF6B1A,#FFB020)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 14, fontWeight: 700, color: '#fff', cursor: 'pointer',
              }}>
                {user.name?.charAt(0)?.toUpperCase() || '?'}
              </div>
            ) : (
              <button onClick={onLogin} style={{
                background: '#FF6B1A', border: 'none', borderRadius: 10,
                padding: '8px 12px', color: '#fff', fontSize: 12, fontWeight: 600,
                cursor: 'pointer', whiteSpace: 'nowrap',
              }}>Увійти</button>
            )}
          </div>
        </div>

        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 13, color: '#A0A8BC' }}>
            {user ? `Привіт, ${user.name?.split(' ')[0]} 👋` : 'Доброго дня 👋'}
          </div>
          <div style={{ fontSize: 'clamp(18px, 5vw, 22px)', fontWeight: 800, color: '#fff', letterSpacing: '-.3px' }}>
            Знайди свій простір
          </div>
        </div>

        {/* Search */}
        <div style={{ background: '#1A1F2E', border: '1px solid #2A3045', borderRadius: 14, display: 'flex', alignItems: 'center', padding: '0 14px', gap: 10 }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#6B7280" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Офіс, магазин, склад, район..."
            style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: '#fff', fontSize: 15, fontFamily: 'Inter,sans-serif', padding: '13px 0', minWidth: 0 }}
          />
          <button onClick={() => setShowFilters(s => !s)} style={{
            background: showFilters ? '#FF6B1A' : '#1E2334',
            border: `1px solid ${showFilters ? '#FF6B1A' : '#2A3045'}`,
            borderRadius: 10, color: showFilters ? '#fff' : '#A0A8BC',
            padding: '6px 10px', fontSize: 13, cursor: 'pointer', flexShrink: 0,
          }}>⚙️</button>
        </div>

        {showFilters && (
          <div style={{ paddingTop: 12 }}>
            <div style={{ fontSize: 11, color: '#A0A8BC', fontWeight: 600, marginBottom: 6, textTransform: 'uppercase' as const, letterSpacing: '.5px' }}>Район</div>
            <select value={district} onChange={e => setDistrict(e.target.value)} style={{
              background: '#1A1F2E', border: '1px solid #2A3045', borderRadius: 10,
              color: '#fff', padding: '10px 14px', fontSize: 14, width: '100%',
              fontFamily: 'Inter, sans-serif', outline: 'none',
            }}>
              {DISTRICTS.map(d => <option key={d}>{d}</option>)}
            </select>
          </div>
        )}
      </div>

      {/* Add listing btn */}
      {user && (
        <div style={{ padding: '10px 20px 0' }}>
          <button onClick={onAddListing} style={{
            width: '100%', padding: '13px',
            background: 'rgba(255,107,26,.08)', border: '1px solid rgba(255,107,26,.3)',
            borderRadius: 14, color: '#FF6B1A', fontSize: 14, fontWeight: 600, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          }}>+ Додати своє приміщення</button>
        </div>
      )}

      {/* Category chips */}
      <div style={{ display: 'flex', gap: 8, overflowX: 'auto', padding: '14px 20px 4px', scrollbarWidth: 'none', msOverflowStyle: 'none' } as React.CSSProperties}>
        {CATEGORIES.map(c => (
          <button key={c.id} onClick={() => c.id === 'all' ? (setActiveType('all')) : handleCatClick(c.id)} style={{
            background: activeType === c.id ? '#FF6B1A' : '#1A1F2E',
            border: `1px solid ${activeType === c.id ? '#FF6B1A' : '#2A3045'}`,
            borderRadius: 24, padding: '7px 14px',
            color: activeType === c.id ? '#fff' : '#A0A8BC',
            fontSize: 13, whiteSpace: 'nowrap', cursor: 'pointer',
            fontWeight: activeType === c.id ? 600 : 400, flexShrink: 0, transition: 'all .15s',
          }}>{c.icon} {c.label}</button>
        ))}
      </div>

      {/* Search results */}
      {isSearching ? (
        <div style={{ padding: '12px 20px 0' }}>
          <div style={{ fontSize: 13, color: '#A0A8BC', marginBottom: 12 }}>
            Знайдено: <span style={{ color: '#FF6B1A', fontWeight: 700 }}>{searchResults!.length}</span> об'єктів
          </div>
          {searchResults!.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '60px 0' }}>
              <div style={{ fontSize: 48 }}>🏢</div>
              <div style={{ fontSize: 18, fontWeight: 600, color: '#fff', marginTop: 12 }}>Нічого не знайдено</div>
              <div style={{ fontSize: 14, color: '#A0A8BC', marginTop: 8 }}>Спробуйте змінити параметри</div>
              <button onClick={() => { setQuery(''); setActiveType('all'); setDistrict('Всі райони') }} style={{ marginTop: 16, padding: '10px 20px', background: '#FF6B1A', border: 'none', borderRadius: 12, color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>Скинути фільтри</button>
            </div>
          ) : (
            searchResults!.map(l => <PropertyCard key={l.id} listing={l} onPress={onListing} onFavorite={onFavorite} isFavorite={favorites.includes(l.id)} />)
          )}
        </div>
      ) : (
        <>
          {/* Popular */}
          {popular.length > 0 && (
            <section style={{ marginTop: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 20px 10px' }}>
                <span style={{ fontSize: 16, fontWeight: 700, color: '#fff' }}>🔥 Популярні</span>
                <button style={{ background: 'none', border: 'none', color: '#FF6B1A', fontSize: 13, cursor: 'pointer', fontFamily: 'Inter, sans-serif' }}
                  onClick={() => onShowAll?.('🔥 Популярні', [...listings].sort((a, b) => b.views - a.views))}>
                  Всі →
                </button>
              </div>
              <div style={{ display: 'flex', gap: 10, overflowX: 'auto', padding: '0 20px 4px', scrollbarWidth: 'none' } as React.CSSProperties}>
                {popular.map(l => <PropertyCard key={l.id} listing={l} onPress={onListing} onFavorite={onFavorite} isFavorite={favorites.includes(l.id)} layout="vertical" />)}
              </div>
            </section>
          )}

          {/* New */}
          {fresh.length > 0 && (
            <section style={{ marginTop: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 20px 10px' }}>
                <span style={{ fontSize: 16, fontWeight: 700, color: '#fff' }}>✨ Нові пропозиції</span>
                <button style={{ background: 'none', border: 'none', color: '#FF6B1A', fontSize: 13, cursor: 'pointer', fontFamily: 'Inter, sans-serif' }}
                  onClick={() => onShowAll?.('✨ Нові пропозиції', listings.filter(l => l.isNew))}>
                  Всі →
                </button>
              </div>
              <div style={{ padding: '0 20px' }}>
                {fresh.map(l => <PropertyCard key={l.id} listing={l} onPress={onListing} onFavorite={onFavorite} isFavorite={favorites.includes(l.id)} />)}
              </div>
            </section>
          )}

          {/* Recommended */}
          {recommended.length > 0 && (
            <section style={{ marginTop: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 20px 10px' }}>
                <span style={{ fontSize: 16, fontWeight: 700, color: '#fff' }}>⭐ Рекомендовані</span>
                <button style={{ background: 'none', border: 'none', color: '#FF6B1A', fontSize: 13, cursor: 'pointer', fontFamily: 'Inter, sans-serif' }}
                  onClick={() => onShowAll?.('⭐ Рекомендовані', listings.filter(l => l.isFeatured || l.isPromoted))}>
                  Всі →
                </button>
              </div>
              <div style={{ padding: '0 20px' }}>
                {recommended.map(l => <PropertyCard key={l.id} listing={l} onPress={onListing} onFavorite={onFavorite} isFavorite={favorites.includes(l.id)} />)}
              </div>
            </section>
          )}
        </>
      )}

      {loading && <div style={{ textAlign: 'center', padding: '40px 0', color: '#A0A8BC', fontSize: 14 }}>⏳ Завантаження...</div>}
    </div>
  )
}
