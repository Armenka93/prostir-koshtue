'use client'
import { useState, useMemo } from 'react'
import PropertyCard from './PropertyCard'
import type { ListingData, FeedData, User } from '@/types'
import { CATEGORIES, DISTRICTS } from '@/types'
import { buildFeed, isNewListing } from '@/lib/listing-logic'

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
  onShowAll?: (title: string, items: ListingData[]) => void
}

export default function HomeScreen({
  listings, feed, onListing, onFavorite, favorites,
  user, isGuest, onLogin, onAddListing, loading,
  onProfile, onShowAll
}: Props) {
  const [query, setQuery] = useState('')
  const [activeType, setActiveType] = useState('all')
  const [district, setDistrict] = useState('Всі райони')
  const [showFilters, setShowFilters] = useState(false)

  // Build feed from listings using logic system
  const computedFeed = useMemo(() => buildFeed(listings), [listings])
  const { rekomendovani, populyarni, novi } = computedFeed

  // Category filter — inline on main page (no navigation)
  const filteredByCategory = useMemo(() => {
    if (activeType === 'all' && district === 'Всі райони') return null
    let r = [...listings].filter(l => l.isActive !== false)
    if (activeType !== 'all') r = r.filter(l => l.type === activeType)
    if (district !== 'Всі райони') r = r.filter(l => l.district === district)
    r.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    return r
  }, [activeType, district, listings])

  // Search results
  const searchResults = useMemo(() => {
    if (!query.trim()) return null
    const q = query.toLowerCase()
    return listings
      .filter(l => l.isActive !== false)
      .filter(l =>
        l.title.toLowerCase().includes(q) ||
        l.district.toLowerCase().includes(q) ||
        l.type.toLowerCase().includes(q) ||
        (l.address || '').toLowerCase().includes(q) ||
        (l.description || '').toLowerCase().includes(q)
      )
  }, [query, listings])

  const isSearching = !!searchResults
  const isFiltering = !isSearching && !!filteredByCategory

  const btnBase: React.CSSProperties = {
    border: 'none', borderRadius: 24, padding: '7px 14px', fontSize: 13,
    whiteSpace: 'nowrap', cursor: 'pointer', fontWeight: 400,
    flexShrink: 0, transition: 'all .15s', fontFamily: 'Inter, sans-serif',
  }

  const sectionHeader = (icon: string, title: string, onAll: () => void, count?: number) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 20px 10px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 16, fontWeight: 700, color: '#fff' }}>{icon} {title}</span>
        {count !== undefined && <span style={{ background: '#FF6B1A22', color: '#FF6B1A', fontSize: 11, fontWeight: 700, borderRadius: 20, padding: '2px 8px' }}>{count}</span>}
      </div>
      <button onClick={onAll} style={{
        background: 'none', border: 'none', color: '#FF6B1A',
        fontSize: 13, cursor: 'pointer', fontFamily: 'Inter, sans-serif', fontWeight: 500,
      }}>Всі →</button>
    </div>
  )

  return (
    <div style={{ paddingBottom: 80 }}>

      {/* ── HEADER ── */}
      <div style={{
        padding: '44px 20px 16px',
        paddingTop: 'max(44px, env(safe-area-inset-top, 44px))',
        background: 'linear-gradient(180deg,#0D1018,#0F1117)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: 1 }}>
            <img src="/logo-main.png" alt="" loading="eager"
              style={{ width: 40, height: 40, objectFit: 'contain', flexShrink: 0 }}
              onError={e => {
                const t = e.target as HTMLImageElement; t.onerror = null
                t.style.cssText = 'width:40px;height:40px;background:linear-gradient(135deg,#FF6B1A,#FFB020);border-radius:12px;flex-shrink:0'
              }}
            />
            <span style={{ fontFamily: "'Russo One', sans-serif", fontSize: 'clamp(13px,4vw,17px)', color: '#FFB020', letterSpacing: '.3px', whiteSpace: 'nowrap' }}>
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
                padding: '8px 12px', color: '#fff', fontSize: 12,
                fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
              }}>Увійти</button>
            )}
          </div>
        </div>

        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 13, color: '#A0A8BC' }}>
            {user ? `Привіт, ${user.name?.split(' ')[0]} 👋` : 'Доброго дня 👋'}
          </div>
          <div style={{ fontSize: 'clamp(18px,5vw,22px)', fontWeight: 800, color: '#fff', letterSpacing: '-.3px' }}>
            Знайди свій простір
          </div>
        </div>

        {/* Search bar */}
        <div style={{ background: '#1A1F2E', border: '1px solid #2A3045', borderRadius: 14, display: 'flex', alignItems: 'center', padding: '0 14px', gap: 10 }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#6B7280" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Офіс, магазин, склад, район..."
            style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: '#fff', fontSize: 15, fontFamily: 'Inter,sans-serif', padding: '13px 0', minWidth: 0 }}
          />
          {query ? (
            <button onClick={() => setQuery('')} style={{ background: 'none', border: 'none', color: '#6B7280', fontSize: 18, cursor: 'pointer', padding: '0 4px', lineHeight: 1 }}>×</button>
          ) : (
            <button onClick={() => setShowFilters(s => !s)} style={{
              background: showFilters ? '#FF6B1A' : '#1E2334',
              border: `1px solid ${showFilters ? '#FF6B1A' : '#2A3045'}`,
              borderRadius: 10, color: showFilters ? '#fff' : '#A0A8BC',
              padding: '6px 10px', fontSize: 13, cursor: 'pointer', flexShrink: 0,
            }}>⚙️</button>
          )}
        </div>

        {/* District filter */}
        {showFilters && (
          <div style={{ paddingTop: 12 }}>
            <div style={{ fontSize: 11, color: '#A0A8BC', fontWeight: 600, marginBottom: 6, textTransform: 'uppercase' as const, letterSpacing: '.5px' }}>Район</div>
            <select value={district} onChange={e => setDistrict(e.target.value)} style={{
              background: '#1A1F2E', border: '1px solid #2A3045', borderRadius: 10,
              color: '#fff', padding: '10px 14px', fontSize: 14, width: '100%',
              fontFamily: 'Inter, sans-serif', outline: 'none', appearance: 'none',
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
            borderRadius: 14, color: '#FF6B1A', fontSize: 14, fontWeight: 600,
            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          }}>+ Додати своє приміщення</button>
        </div>
      )}

      {/* ── CATEGORY CHIPS — фільтрують на місці ── */}
      <div style={{ display: 'flex', gap: 8, overflowX: 'auto', padding: '14px 20px 4px', scrollbarWidth: 'none', msOverflowStyle: 'none' } as React.CSSProperties}>
        {CATEGORIES.map(c => {
          const isActive = activeType === c.id
          return (
            <button
              key={c.id}
              onClick={() => {
                // Toggle: click same = reset to all
                setActiveType(prev => prev === c.id ? 'all' : c.id)
              }}
              style={{
                ...btnBase,
                background: isActive ? '#FF6B1A' : '#1A1F2E',
                border: `1px solid ${isActive ? '#FF6B1A' : '#2A3045'}`,
                color: isActive ? '#fff' : '#A0A8BC',
                fontWeight: isActive ? 600 : 400,
              }}
            >
              {c.icon} {c.label}
            </button>
          )
        })}
      </div>

      {/* ── SEARCH RESULTS ── */}
      {isSearching && (
        <div style={{ padding: '12px 20px 0' }}>
          <div style={{ fontSize: 13, color: '#A0A8BC', marginBottom: 12 }}>
            Знайдено: <span style={{ color: '#FF6B1A', fontWeight: 700 }}>{searchResults!.length}</span> об'єктів за «{query}»
          </div>
          {searchResults!.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '60px 0' }}>
              <div style={{ fontSize: 48 }}>🔍</div>
              <div style={{ fontSize: 18, fontWeight: 600, color: '#fff', marginTop: 12 }}>Нічого не знайдено</div>
              <div style={{ fontSize: 14, color: '#A0A8BC', marginTop: 8 }}>Спробуйте інший запит</div>
              <button onClick={() => setQuery('')} style={{ marginTop: 16, padding: '10px 20px', background: '#FF6B1A', border: 'none', borderRadius: 12, color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>Скинути</button>
            </div>
          ) : (
            searchResults!.map(l => <PropertyCard key={l.id} listing={l} onPress={onListing} onFavorite={onFavorite} isFavorite={favorites.includes(l.id)} />)
          )}
        </div>
      )}

      {/* ── CATEGORY FILTER RESULTS (inline) ── */}
      {!isSearching && isFiltering && (
        <div style={{ padding: '12px 20px 0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div style={{ fontSize: 13, color: '#A0A8BC' }}>
              {activeType !== 'all' && <span style={{ color: '#fff', fontWeight: 600 }}>{CATEGORIES.find(c => c.id === activeType)?.icon} {CATEGORIES.find(c => c.id === activeType)?.label}</span>}
              {district !== 'Всі райони' && <span> • {district}</span>}
              <span style={{ marginLeft: 6 }}>({filteredByCategory!.length})</span>
            </div>
            <button onClick={() => { setActiveType('all'); setDistrict('Всі райони') }} style={{
              background: 'none', border: 'none', color: '#6B7280', fontSize: 12,
              cursor: 'pointer', fontFamily: 'Inter, sans-serif', textDecoration: 'underline',
            }}>Скинути</button>
          </div>
          {filteredByCategory!.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '60px 0' }}>
              <div style={{ fontSize: 48 }}>🏢</div>
              <div style={{ fontSize: 18, fontWeight: 600, color: '#fff', marginTop: 12 }}>Немає оголошень</div>
              <div style={{ fontSize: 14, color: '#A0A8BC', marginTop: 8 }}>В цій категорії ще немає об'єктів</div>
            </div>
          ) : (
            filteredByCategory!.map(l => <PropertyCard key={l.id} listing={l} onPress={onListing} onFavorite={onFavorite} isFavorite={favorites.includes(l.id)} />)
          )}
        </div>
      )}

      {/* ── MAIN FEED (no search, no category filter) ── */}
      {!isSearching && !isFiltering && (
        <>
          {/* 1. РЕКОМЕНДОВАНІ (promoted — платне) */}
          {rekomendovani.length > 0 && (
            <section style={{ marginTop: 16 }}>
              {sectionHeader('⭐', 'Рекомендовані', () => onShowAll?.('⭐ Рекомендовані', rekomendovani), rekomendovani.length)}
              <div style={{ padding: '0 20px' }}>
                {rekomendovani.slice(0, 3).map(l => <PropertyCard key={l.id} listing={l} onPress={onListing} onFavorite={onFavorite} isFavorite={favorites.includes(l.id)} />)}
              </div>
            </section>
          )}

          {/* 2. ПОПУЛЯРНІ (by score) */}
          {populyarni.length > 0 && (
            <section style={{ marginTop: rekomendovani.length > 0 ? 8 : 16 }}>
              {sectionHeader('🔥', 'Популярні', () => onShowAll?.('🔥 Популярні', [...listings].sort((a, b) => (b.views * 1 + b.likes * 3) - (a.views * 1 + a.likes * 3))), populyarni.length)}
              <div style={{ display: 'flex', gap: 10, overflowX: 'auto', padding: '0 20px 4px', scrollbarWidth: 'none' } as React.CSSProperties}>
                {populyarni.map(l => <PropertyCard key={l.id} listing={l} onPress={onListing} onFavorite={onFavorite} isFavorite={favorites.includes(l.id)} layout="vertical" />)}
              </div>
            </section>
          )}

          {/* 3. НОВІ (by date, last NOVA_TTL_DAYS days) */}
          {novi.length > 0 && (
            <section style={{ marginTop: 16 }}>
              {sectionHeader('✨', 'Нові пропозиції', () => onShowAll?.('✨ Нові пропозиції', listings.filter(l => isNewListing(l)).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())), novi.length)}
              <div style={{ padding: '0 20px' }}>
                {novi.slice(0, 4).map(l => <PropertyCard key={l.id} listing={l} onPress={onListing} onFavorite={onFavorite} isFavorite={favorites.includes(l.id)} />)}
              </div>
            </section>
          )}

          {/* 4. ВСІ ОГОЛОШЕННЯ (by date) */}
          <section style={{ marginTop: 16 }}>
            {sectionHeader('🏢', 'Всі оголошення', () => onShowAll?.('🏢 Всі оголошення', [...listings].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())), listings.filter(l => l.isActive !== false).length)}
            <div style={{ padding: '0 20px' }}>
              {[...listings]
                .filter(l => l.isActive !== false)
                .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
                .slice(0, 6)
                .map(l => <PropertyCard key={l.id} listing={l} onPress={onListing} onFavorite={onFavorite} isFavorite={favorites.includes(l.id)} />)}
            </div>
          </section>
        </>
      )}

      {loading && <div style={{ textAlign: 'center', padding: '40px 0', color: '#A0A8BC', fontSize: 14 }}>⏳ Завантаження...</div>}
    </div>
  )
}
