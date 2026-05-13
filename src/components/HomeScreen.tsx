'use client'
import { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import PropertyCard from './PropertyCard'
import type { ListingData, User } from '@/types'
import { CATEGORIES, DISTRICTS } from '@/types'
import { buildFeed, isNewListing } from '@/lib/listing-logic'

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

// ── Pull-to-refresh hook ──────────────────────────────────────
function usePTR(onRefresh: () => Promise<void>) {
  const [pulling, setPulling] = useState(false)
  const [ready, setReady] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [pullY, setPullY] = useState(0)
  const startY = useRef(0)
  const dragging = useRef(false)
  const refreshing_ = useRef(false)
  const fn = useRef(onRefresh)
  useEffect(() => { fn.current = onRefresh }, [onRefresh])

  useEffect(() => {
    const THRESHOLD = 65
    const onTS = (e: TouchEvent) => {
      if (window.scrollY > 2) return
      startY.current = e.touches[0].clientY
      dragging.current = true
    }
    const onTM = (e: TouchEvent) => {
      if (!dragging.current || refreshing_.current) return
      const dy = e.touches[0].clientY - startY.current
      if (dy <= 0) { setPullY(0); setPulling(false); setReady(false); return }
      const clamped = Math.min(dy * 0.4, 100)
      setPullY(clamped)
      setPulling(clamped > 10)
      setReady(clamped >= THRESHOLD)
    }
    const onTE = async () => {
      if (!dragging.current) return
      dragging.current = false
      if (pullY >= THRESHOLD && !refreshing_.current) {
        refreshing_.current = true
        setRefreshing(true)
        setPullY(0)
        setPulling(false)
        setReady(false)
        await fn.current().catch(() => {})
        refreshing_.current = false
        setRefreshing(false)
      } else {
        setPullY(0)
        setPulling(false)
        setReady(false)
      }
    }
    window.addEventListener('touchstart', onTS, { passive: true })
    window.addEventListener('touchmove', onTM, { passive: true })
    window.addEventListener('touchend', onTE)
    return () => {
      window.removeEventListener('touchstart', onTS)
      window.removeEventListener('touchmove', onTM)
      window.removeEventListener('touchend', onTE)
    }
  }, [pullY])

  return { pulling, ready, refreshing, pullY }
}

// ── PTR Indicator ─────────────────────────────────────────────
function PTRIndicator({ pullY, ready, refreshing }: { pullY: number; ready: boolean; refreshing: boolean }) {
  if (!pullY && !refreshing) return null
  return (
    <div style={{
      position: 'fixed',
      top: 'max(10px, env(safe-area-inset-top, 10px))',
      left: '50%', transform: 'translateX(-50%)',
      zIndex: 300, pointerEvents: 'none',
      transition: refreshing ? 'none' : 'opacity .15s',
      opacity: refreshing ? 1 : Math.min(pullY / 50, 1),
    }}>
      <div style={{
        background: '#1A1F2E',
        border: `1px solid ${ready ? '#FF6B1A' : '#2A3045'}`,
        borderRadius: 24,
        padding: '7px 14px',
        display: 'flex', alignItems: 'center', gap: 8,
        boxShadow: '0 4px 16px rgba(0,0,0,.5)',
        transition: 'border-color .2s',
      }}>
        {refreshing ? (
          <>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#FF6B1A" strokeWidth="2.5" strokeLinecap="round" style={{ animation: 'spin .7s linear infinite' }}>
              <style>{'@keyframes spin{to{transform:rotate(360deg)}}'}</style>
              <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>
            </svg>
            <span style={{ fontSize: 12, color: '#A0A8BC', fontFamily: 'Inter,sans-serif' }}>Оновлення...</span>
          </>
        ) : (
          <>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={ready ? '#FF6B1A' : '#6B7280'} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
              style={{ transform: `rotate(${ready ? 180 : 0}deg)`, transition: 'transform .2s, stroke .2s' }}>
              <line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/>
            </svg>
            <span style={{ fontSize: 12, color: ready ? '#FF6B1A' : '#A0A8BC', fontFamily: 'Inter,sans-serif', transition: 'color .2s' }}>
              {ready ? 'Відпустіть' : 'Потягніть вниз'}
            </span>
          </>
        )}
      </div>
    </div>
  )
}

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

  const ptr = usePTR(onRefresh ?? (() => Promise.resolve()))

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
      <PTRIndicator pullY={ptr.pullY} ready={ptr.ready} refreshing={ptr.refreshing} />

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
              onError={e => { const t = e.target as HTMLImageElement; t.onerror = null; t.style.cssText = 'width:40px;height:40px;background:linear-gradient(135deg,#FF6B1A,#FFB020);border-radius:12px;flex-shrink:0' }}
            />
            <span style={{ fontFamily: "'Russo One', sans-serif", fontSize: 'clamp(13px,4vw,17px)', color: '#FFB020', letterSpacing: '.3px', whiteSpace: 'nowrap' }}>
              ПРОСТІР КОШТУЄ
            </span>
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
            Знайдено: <span style={{ color: '#FF6B1A', fontWeight: 700 }}>{searchResults!.length}</span> об'єктів
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
