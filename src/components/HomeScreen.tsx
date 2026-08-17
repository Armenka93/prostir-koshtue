'use client'
import { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import PropertyCard from './PropertyCard'
import type { ListingData, User } from '@/types'
import { usePTR } from '@/hooks/usePTR'
import PTRIndicator from './PTRIndicator'
import { CATEGORIES, DISTRICTS } from '@/types'
import { buildFeed, isNewListing } from '@/lib/listing-logic'
import { pluralizeObjects } from '@/lib/pluralize'

interface Props {
  listings: ListingData[]
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

// PTR via shared hook



export default function HomeScreen({
  listings, onListing, onFavorite, favorites,
  user, isGuest, onLogin, onAddListing, loading,
  onProfile, onRefresh, onShowAll
}: Props) {
  const [query, setQuery] = useState('')
  const [activeType, setActiveType] = useState('all')
  const [district, setDistrict] = useState('Всі райони')
  const [showFilters, setShowFilters] = useState(false)
  const [priceMin, setPriceMin] = useState(0)
  const [priceMax, setPriceMax] = useState(0) // 0 = unlimited
  const [areaMin, setAreaMin] = useState(0)
  const [areaMax, setAreaMax] = useState(0) // 0 = unlimited

  const ptr = usePTR(onRefresh)

  const { rekomendovani, populyarni, novi } = useMemo(() => buildFeed(listings), [listings])

  const filteredByCategory = useMemo(() => {
    const hasFilter = activeType !== 'all' || district !== 'Всі райони' ||
      priceMin > 0 || priceMax > 0 || areaMin > 0 || areaMax > 0
    if (!hasFilter) return null
    return listings
      .filter(l => l.isActive !== false)
      .filter(l => activeType === 'all' || l.type === activeType)
      .filter(l => district === 'Всі райони' || l.district === district)
      .filter(l => priceMin === 0 || l.price >= priceMin)
      .filter(l => priceMax === 0 || l.price <= priceMax)
      .filter(l => areaMin === 0 || l.area >= areaMin)
      .filter(l => areaMax === 0 || l.area <= areaMax)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  }, [activeType, district, priceMin, priceMax, areaMin, areaMax, listings])

  const searchResults = useMemo(() => {
    if (!query.trim()) return null
    const q = query.toLowerCase()
    return listings.filter(l => l.isActive !== false).filter(l =>
      l.title.toLowerCase().includes(q) || l.district.toLowerCase().includes(q) ||
      l.type.toLowerCase().includes(q) || (l.address || '').toLowerCase().includes(q)
    )
  }, [query, listings])

  const isSearching = !!searchResults
  const isFiltering = !isSearching && !!filteredByCategory

  const resetFilters = () => {
    setActiveType('all'); setDistrict('Всі райони')
    setPriceMin(0); setPriceMax(0); setAreaMin(0); setAreaMax(0)
  }

  const numInp: React.CSSProperties = {
    background: '#0F1117', border: '1px solid #2A3045', borderRadius: 10,
    color: '#fff', padding: '10px 12px', fontSize: 14,
    fontFamily: 'Inter,sans-serif', outline: 'none', width: '100%',
    boxSizing: 'border-box' as const,
  }

  return (
    <div style={{ paddingBottom: 90 }}>
      <PTRIndicator state={ptr.state} pullY={ptr.pullY} />

      {/* ── HEADER ── */}
      <div style={{
        padding: "44px 20px 16px",
        paddingTop: 'max(44px, env(safe-area-inset-top, 44px))',
        background: 'linear-gradient(180deg,#0D1018,#0F1117)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1 }}>
            <img src="/logo-horizontal.png" alt="Простір коштує" loading="eager"
              style={{ height: 44, width: 'auto', maxWidth: '100%', objectFit: 'contain', flexShrink: 0 }}
              onError={e => { const t = e.target as HTMLImageElement; t.onerror = null; t.style.cssText = 'height:44px;width:120px;background:linear-gradient(135deg,#FF6B1A,#FFB020);border-radius:12px;flex-shrink:0' }}
            />
          </div>
          <div style={{ flexShrink: 0, marginLeft: 8 }}>
            {user ? (
              <div onClick={onProfile} style={{ width: 36, height: 36, borderRadius: 10, background: 'linear-gradient(135deg,#FF6B1A,#FFB020)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700, color: '#fff', cursor: 'pointer', flexShrink: 0 }}>
                {user.name?.charAt(0)?.toUpperCase() || '?'}
              </div>
            ) : (
              <button onClick={onLogin} style={{ background: '#FF6B1A', border: 'none', borderRadius: 10, padding: '8px 12px', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>Увійти</button>
            )}
          </div>
        </div>

        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 13, color: '#A0A8BC' }}>{user ? `Привіт, ${user.name?.split(' ')[0]} 👋` : 'Доброго дня 👋'}</div>
          <div style={{ fontSize: 'clamp(18px,5vw,22px)', fontWeight: 800, color: '#fff', letterSpacing: '-.3px' }}>Знайди свій простір</div>
        </div>

        {/* Search bar */}
        <div style={{ background: '#1A1F2E', border: '1px solid #2A3045', borderRadius: 14, display: 'flex', alignItems: 'center', padding: '0 14px', gap: 10 }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#6B7280" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Офіс, магазин, склад, район..."
            style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: '#fff', fontSize: 15, fontFamily: 'Inter,sans-serif', padding: '13px 0', minWidth: 0 }} />
          {query
            ? <button onClick={() => setQuery('')} style={{ background: 'none', border: 'none', color: '#6B7280', fontSize: 20, cursor: 'pointer', padding: 0, lineHeight: 1 }}>×</button>
            : <button onClick={() => setShowFilters(s => !s)} style={{ background: showFilters ? '#FF6B1A' : '#1E2334', border: `1px solid ${showFilters ? '#FF6B1A' : '#2A3045'}`, borderRadius: 10, color: showFilters ? '#fff' : '#A0A8BC', padding: '6px 10px', fontSize: 13, cursor: 'pointer', flexShrink: 0 }}>⚙️</button>
          }
        </div>

        {/* ── Filters panel ── */}
        {showFilters && (
          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
            {/* District */}
            <div>
              <div style={{ fontSize: 11, color: '#A0A8BC', fontWeight: 600, marginBottom: 6, textTransform: 'uppercase' as const, letterSpacing: '.5px' }}>Район</div>
              <select value={district} onChange={e => setDistrict(e.target.value)}
                style={{ background: '#1A1F2E', border: '1px solid #2A3045', borderRadius: 10, color: '#fff', padding: '10px 14px', fontSize: 14, width: '100%', fontFamily: 'Inter,sans-serif', outline: 'none', appearance: 'none' }}>
                {DISTRICTS.map(d => <option key={d}>{d}</option>)}
              </select>
            </div>

            {/* Price range */}
            <div>
              <div style={{ fontSize: 11, color: '#A0A8BC', fontWeight: 600, marginBottom: 6, textTransform: 'uppercase' as const, letterSpacing: '.5px' }}>
                Ціна ₴/міс
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <div>
                  <div style={{ fontSize: 10, color: '#6B7280', marginBottom: 4 }}>Від</div>
                  <input type="number" inputMode="numeric" placeholder="0" value={priceMin || ''} onChange={e => setPriceMin(+e.target.value || 0)} style={numInp} />
                </div>
                <div>
                  <div style={{ fontSize: 10, color: '#6B7280', marginBottom: 4 }}>До</div>
                  <input type="number" inputMode="numeric" placeholder="Будь-яка" value={priceMax || ''} onChange={e => setPriceMax(+e.target.value || 0)} style={numInp} />
                </div>
              </div>
            </div>

            {/* Area range */}
            <div>
              <div style={{ fontSize: 11, color: '#A0A8BC', fontWeight: 600, marginBottom: 6, textTransform: 'uppercase' as const, letterSpacing: '.5px' }}>
                Площа м²
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <div>
                  <div style={{ fontSize: 10, color: '#6B7280', marginBottom: 4 }}>Від</div>
                  <input type="number" inputMode="numeric" placeholder="0" value={areaMin || ''} onChange={e => setAreaMin(+e.target.value || 0)} style={numInp} />
                </div>
                <div>
                  <div style={{ fontSize: 10, color: '#6B7280', marginBottom: 4 }}>До</div>
                  <input type="number" inputMode="numeric" placeholder="Будь-яка" value={areaMax || ''} onChange={e => setAreaMax(+e.target.value || 0)} style={numInp} />
                </div>
              </div>
            </div>

            {(district !== 'Всі райони' || priceMin > 0 || priceMax > 0 || areaMin > 0 || areaMax > 0) && (
              <button onClick={resetFilters} style={{ background: 'none', border: '1px solid #2A3045', borderRadius: 10, padding: '9px', color: '#A0A8BC', fontSize: 13, cursor: 'pointer' }}>
                Скинути фільтри
              </button>
            )}
          </div>
        )}
      </div>

      {/* Add listing btn */}
      {user && (
        <div style={{ padding: '10px 20px 0' }}>
          <button onClick={onAddListing} style={{ width: '100%', padding: '13px', background: 'rgba(255,107,26,.08)', border: '1px solid rgba(255,107,26,.3)', borderRadius: 14, color: '#FF6B1A', fontSize: 14, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            + Додати своє приміщення
          </button>
        </div>
      )}

      {/* Category chips */}
      <div style={{ display: 'flex', gap: 8, overflowX: 'auto', padding: '14px 20px 4px', scrollbarWidth: 'none', msOverflowStyle: 'none' } as React.CSSProperties}>
        {CATEGORIES.map(c => {
          const active = activeType === c.id
          return (
            <button key={c.id} onClick={() => setActiveType(p => p === c.id ? 'all' : c.id)} style={{
              background: active ? '#FF6B1A' : '#1A1F2E',
              border: `1px solid ${active ? '#FF6B1A' : '#2A3045'}`,
              borderRadius: 24, padding: '7px 14px',
              color: active ? '#fff' : '#A0A8BC',
              fontSize: 13, whiteSpace: 'nowrap', cursor: 'pointer',
              fontWeight: active ? 600 : 400, flexShrink: 0, transition: 'all .15s',
            }}>{c.icon} {c.label}</button>
          )
        })}
      </div>

      {/* ── SEARCH RESULTS ── */}
      {isSearching && (
        <div style={{ padding: '12px 20px 0' }}>
          <div style={{ fontSize: 13, color: '#A0A8BC', marginBottom: 12 }}>
            Знайдено: <span style={{ color: '#FF6B1A', fontWeight: 700 }}>{searchResults!.length}</span> {pluralizeObjects(searchResults!.length)}
          </div>
          {searchResults!.length === 0
            ? <div style={{ textAlign: 'center', padding: '60px 0' }}><div style={{ fontSize: 40 }}>🔍</div><div style={{ fontSize: 16, fontWeight: 600, color: '#fff', marginTop: 12 }}>Нічого не знайдено</div><button onClick={() => setQuery('')} style={{ marginTop: 16, padding: '10px 20px', background: '#FF6B1A', border: 'none', borderRadius: 12, color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>Скинути</button></div>
            : searchResults!.map(l => <PropertyCard key={l.id} listing={l} onPress={onListing} onFavorite={onFavorite} isFavorite={favorites.includes(l.id)} />)
          }
        </div>
      )}

      {/* ── CATEGORY / FILTER RESULTS (inline) ── */}
      {!isSearching && isFiltering && (
        <div style={{ padding: '12px 20px 0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div style={{ fontSize: 13, color: '#A0A8BC' }}>
              <span style={{ color: '#fff', fontWeight: 600 }}>
                {activeType !== 'all' ? `${CATEGORIES.find(c => c.id === activeType)?.icon} ${CATEGORIES.find(c => c.id === activeType)?.label}` : 'Фільтр'}
              </span>
              <span style={{ marginLeft: 6 }}>({filteredByCategory!.length})</span>
            </div>
            <button onClick={resetFilters} style={{ background: 'none', border: 'none', color: '#FF6B1A', fontSize: 12, cursor: 'pointer', fontFamily: 'Inter,sans-serif' }}>Скинути</button>
          </div>
          {filteredByCategory!.length === 0
            ? <div style={{ textAlign: 'center', padding: '40px 0' }}><div style={{ fontSize: 40 }}>🏢</div><div style={{ fontSize: 16, fontWeight: 600, color: '#fff', marginTop: 12 }}>Нічого не знайдено</div></div>
            : filteredByCategory!.map(l => <PropertyCard key={l.id} listing={l} onPress={onListing} onFavorite={onFavorite} isFavorite={favorites.includes(l.id)} />)
          }
        </div>
      )}

      {/* ── MAIN FEED ── */}
      {!isSearching && !isFiltering && (
        <>
          {/* Рекомендовані */}
          {rekomendovani.length > 0 && (
            <section style={{ marginTop: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 20px 10px' }}>
                <span style={{ fontSize: 16, fontWeight: 700, color: '#fff' }}>⭐ Рекомендовані</span>
                <button onClick={() => onShowAll?.('⭐ Рекомендовані', rekomendovani)} style={{ background: 'none', border: 'none', color: '#FF6B1A', fontSize: 13, cursor: 'pointer' }}>Всі →</button>
              </div>
              <div style={{ padding: '0 20px' }}>{rekomendovani.slice(0, 3).map(l => <PropertyCard key={l.id} listing={l} onPress={onListing} onFavorite={onFavorite} isFavorite={favorites.includes(l.id)} />)}</div>
            </section>
          )}

          {/* Популярні */}
          {populyarni.length > 0 && (
            <section style={{ marginTop: rekomendovani.length > 0 ? 8 : 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 20px 10px' }}>
                <span style={{ fontSize: 16, fontWeight: 700, color: '#fff' }}>🔥 Популярні</span>
                <button onClick={() => onShowAll?.('🔥 Популярні', [...listings].sort((a, b) => (b.views * 1 + b.likes * 3) - (a.views * 1 + a.likes * 3)))} style={{ background: 'none', border: 'none', color: '#FF6B1A', fontSize: 13, cursor: 'pointer' }}>Всі →</button>
              </div>
              <div style={{ display: 'flex', gap: 10, overflowX: 'auto', padding: '0 20px 4px', scrollbarWidth: 'none' } as React.CSSProperties}>
                {populyarni.map(l => <PropertyCard key={l.id} listing={l} onPress={onListing} onFavorite={onFavorite} isFavorite={favorites.includes(l.id)} layout="vertical" />)}
              </div>
            </section>
          )}

          {/* Нові */}
          {novi.length > 0 && (
            <section style={{ marginTop: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 20px 10px' }}>
                <span style={{ fontSize: 16, fontWeight: 700, color: '#fff' }}>✨ Нові пропозиції</span>
                <button onClick={() => onShowAll?.('✨ Нові пропозиції', listings.filter(l => isNewListing(l)))} style={{ background: 'none', border: 'none', color: '#FF6B1A', fontSize: 13, cursor: 'pointer' }}>Всі →</button>
              </div>
              <div style={{ padding: '0 20px' }}>{novi.slice(0, 4).map(l => <PropertyCard key={l.id} listing={l} onPress={onListing} onFavorite={onFavorite} isFavorite={favorites.includes(l.id)} />)}</div>
            </section>
          )}

          {/* Всі оголошення */}
          <section style={{ marginTop: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 20px 10px' }}>
              <span style={{ fontSize: 16, fontWeight: 700, color: '#fff' }}>🏢 Всі оголошення</span>
              <button onClick={() => onShowAll?.('🏢 Всі оголошення', [...listings].filter(l => l.isActive !== false).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()))} style={{ background: 'none', border: 'none', color: '#FF6B1A', fontSize: 13, cursor: 'pointer' }}>Всі →</button>
            </div>
            <div style={{ padding: '0 20px' }}>
              {[...listings].filter(l => l.isActive !== false)
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
