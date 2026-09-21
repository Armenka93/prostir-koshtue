'use client'
import { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import PropertyCard from './PropertyCard'
import type { ListingData, User } from '@/types'
import { usePTR } from '@/hooks/usePTR'
import PTRIndicator from './PTRIndicator'
import { CATEGORIES, DISTRICTS } from '@/types'
import { buildFeed, isNewListing } from '@/lib/listing-logic'
import { pluralizeObjects } from '@/lib/pluralize'
import Skeleton from './Skeleton'
import ErrorState from './ErrorState'
import EmptyState from './EmptyState'
import FilterChips, { type FilterChip } from './FilterChips'
import { useDraftFilters, isRangeInvalid, clampNonNegative } from '@/hooks/useDraftFilters'

export interface HomeFilters {
  type: string
  district: string
  priceMin: number
  priceMax: number // 0 = unlimited
  areaMin: number
  areaMax: number // 0 = unlimited
}

export const BASE_HOME_FILTERS: HomeFilters = {
  type: 'all', district: 'Всі райони', priceMin: 0, priceMax: 0, areaMin: 0, areaMax: 0,
}

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
  loadError?: boolean
  onRetryLoad?: () => void
  onProfile?: () => void
  onRefresh?: () => Promise<void>
  onShowAll?: (title: string, items: ListingData[]) => void
  appliedFilters: HomeFilters
  onAppliedFiltersChange: (f: HomeFilters) => void
  sortBy: string
  onSortByChange: (s: string) => void
  searchQuery: string
  onSearchQueryChange: (q: string) => void
}

function applyHomeFilters(listings: ListingData[], f: HomeFilters): ListingData[] {
  return listings
    .filter(l => l.isActive !== false)
    .filter(l => f.type === 'all' || l.type === f.type)
    .filter(l => f.district === 'Всі райони' || l.district === f.district)
    .filter(l => f.priceMin === 0 || l.price >= f.priceMin)
    .filter(l => f.priceMax === 0 || l.price <= f.priceMax)
    .filter(l => f.areaMin === 0 || l.area >= f.areaMin)
    .filter(l => f.areaMax === 0 || l.area <= f.areaMax)
}

const hasActiveFilters = (f: HomeFilters) =>
  f.type !== BASE_HOME_FILTERS.type || f.district !== BASE_HOME_FILTERS.district ||
  f.priceMin > 0 || f.priceMax > 0 || f.areaMin > 0 || f.areaMax > 0

export default function HomeScreen({
  listings, onListing, onFavorite, favorites,
  user, isGuest, onLogin, onAddListing, loading, loadError, onRetryLoad,
  onProfile, onRefresh, onShowAll, appliedFilters, onAppliedFiltersChange,
  sortBy, onSortByChange, searchQuery, onSearchQueryChange,
}: Props) {
  // Local, per-keystroke draft — the applied query (lifted to page.tsx, see
  // §C.1) only changes on Enter / the search button / clear, never live.
  const [searchDraft, setSearchDraft] = useState(searchQuery)
  const { draft, setDraft, isOpen, open, close, apply, resetDraft } =
    useDraftFilters(appliedFilters, onAppliedFiltersChange, BASE_HOME_FILTERS)

  const ptr = usePTR(onRefresh)

  const { rekomendovani, populyarni, novi } = useMemo(() => buildFeed(listings), [listings])

  const sortListings = useCallback((arr: ListingData[]) => {
    const r = [...arr]
    if (sortBy === 'views') r.sort((a, b) => (b.views || 0) - (a.views || 0))
    else if (sortBy === 'price_asc') r.sort((a, b) => a.price - b.price)
    else if (sortBy === 'price_desc') r.sort((a, b) => b.price - a.price)
    else if (sortBy === 'area') r.sort((a, b) => b.area - a.area)
    else r.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()) // 'date' / default
    return r
  }, [sortBy])

  // Results are driven only by appliedFilters — editing the open panel's
  // draft never touches them until "Показати" is pressed.
  const filteredByCategory = useMemo(() => {
    if (!hasActiveFilters(appliedFilters)) return null
    return sortListings(applyHomeFilters(listings, appliedFilters))
  }, [appliedFilters, listings, sortListings])

  // Preview count for the apply button — computed from the draft. Blocked
  // (shows an error instead) when a "від" bound exceeds its "до" bound.
  const priceInvalid = isRangeInvalid(draft.priceMin, draft.priceMax)
  const areaInvalid = isRangeInvalid(draft.areaMin, draft.areaMax)
  const draftInvalid = priceInvalid || areaInvalid
  const draftPreviewCount = useMemo(() => applyHomeFilters(listings, draft).length, [listings, draft])

  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return null
    return sortListings(listings.filter(l => l.isActive !== false).filter(l =>
      l.title.toLowerCase().includes(q) || l.district.toLowerCase().includes(q) ||
      l.type.toLowerCase().includes(q) || (l.address || '').toLowerCase().includes(q)
    ))
  }, [searchQuery, listings, sortListings])

  const isSearching = !!searchResults
  const isFiltering = !isSearching && !!filteredByCategory

  const submitSearch = () => onSearchQueryChange(searchDraft.trim())
  const clearSearch = () => { setSearchDraft(''); onSearchQueryChange('') }

  // Quick category chips — instant, same contract as the catalog screen's
  // outer chip row: commits to appliedFilters immediately and keeps the
  // draft in sync so reopening the panel isn't stale.
  const selectType = (id: string) => {
    const next = { ...appliedFilters, type: id }
    onAppliedFiltersChange(next)
    setDraft(d => ({ ...d, type: id }))
  }

  const removeFilter = (patch: Partial<HomeFilters>) => {
    const next = { ...appliedFilters, ...patch }
    onAppliedFiltersChange(next)
    setDraft(next)
  }

  const resetAppliedNow = () => {
    onAppliedFiltersChange(BASE_HOME_FILTERS)
    setDraft(BASE_HOME_FILTERS)
  }

  const activeFilterCount =
    (appliedFilters.type !== BASE_HOME_FILTERS.type ? 1 : 0) +
    (appliedFilters.district !== BASE_HOME_FILTERS.district ? 1 : 0) +
    (appliedFilters.priceMin > 0 || appliedFilters.priceMax > 0 ? 1 : 0) +
    (appliedFilters.areaMin > 0 || appliedFilters.areaMax > 0 ? 1 : 0)

  const rangeChipLabel = (min: number, max: number, unit: string, from: string, to: string) => {
    if (min > 0 && max > 0) return `${min.toLocaleString('uk-UA')}–${max.toLocaleString('uk-UA')} ${unit}`
    if (min > 0) return `${from} ${min.toLocaleString('uk-UA')} ${unit}`
    return `${to} ${max.toLocaleString('uk-UA')} ${unit}`
  }

  const chips: FilterChip[] = []
  if (appliedFilters.type !== BASE_HOME_FILTERS.type) {
    const cat = CATEGORIES.find(c => c.id === appliedFilters.type)
    chips.push({ key: 'type', label: cat?.label || appliedFilters.type, onRemove: () => removeFilter({ type: BASE_HOME_FILTERS.type }) })
  }
  if (appliedFilters.district !== BASE_HOME_FILTERS.district) {
    chips.push({ key: 'district', label: appliedFilters.district, onRemove: () => removeFilter({ district: BASE_HOME_FILTERS.district }) })
  }
  if (appliedFilters.priceMin > 0 || appliedFilters.priceMax > 0) {
    chips.push({
      key: 'price',
      label: rangeChipLabel(appliedFilters.priceMin, appliedFilters.priceMax, '₴', 'від', 'до'),
      onRemove: () => removeFilter({ priceMin: 0, priceMax: 0 }),
    })
  }
  if (appliedFilters.areaMin > 0 || appliedFilters.areaMax > 0) {
    chips.push({
      key: 'area',
      label: rangeChipLabel(appliedFilters.areaMin, appliedFilters.areaMax, 'м²', 'від', 'до'),
      onRemove: () => removeFilter({ areaMin: 0, areaMax: 0 }),
    })
  }

  const SORT_OPTIONS: [string, string][] = [['date', 'Найновіші'], ['views', 'Популярні'], ['price_asc', 'Ціна ↑'], ['price_desc', 'Ціна ↓'], ['area', 'Площа ↓']]
  const sortPills = (
    <div style={{ display: 'flex', gap: 6, overflowX: 'auto', marginBottom: 12, scrollbarWidth: 'none' } as React.CSSProperties}>
      {SORT_OPTIONS.map(([id, label]) => (
        <button key={id} onClick={() => onSortByChange(id)} style={{
          background: sortBy === id ? '#FF6B1A' : '#1A1F2E',
          border: `1px solid ${sortBy === id ? '#FF6B1A' : '#2A3045'}`,
          borderRadius: 20, padding: '5px 12px',
          color: sortBy === id ? '#fff' : '#A0A8BC',
          fontSize: 12, fontWeight: sortBy === id ? 600 : 400,
          cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0, fontFamily: 'Inter,sans-serif',
        }}>{label}</button>
      ))}
    </div>
  )

  const numInp = (invalid: boolean): React.CSSProperties => ({
    background: '#0F1117', border: `1px solid ${invalid ? '#EF4444' : '#2A3045'}`, borderRadius: 10,
    color: '#fff', padding: '10px 12px', fontSize: 14,
    fontFamily: 'Inter,sans-serif', outline: 'none', width: '100%',
    boxSizing: 'border-box' as const,
  })
  const errMsg: React.CSSProperties = { fontSize: 11, color: '#EF4444', marginTop: 4 }

  return (
    <div className="desktop-wide-screen">
    <div className="desktop-wide-screen-inner" style={{ paddingBottom: 90 }}>
      <PTRIndicator state={ptr.state} pullY={ptr.pullY} />

      {/* ── HEADER ── */}
      <div style={{
        padding: "44px 20px 16px",
        paddingTop: 'max(44px, env(safe-area-inset-top, 44px))',
        background: 'linear-gradient(180deg,#0D1018,#0F1117)',
      }}>
        {/* Logo + login/avatar row — mobile only; DesktopHeader replaces it from 768px up */}
        <div className="mobile-header-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
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

        {/* Search bar — applies only on Enter / the search button, never per keystroke */}
        <div className="catalog-search-wrap" style={{ background: '#1A1F2E', border: '1px solid #2A3045', borderRadius: 14, display: 'flex', alignItems: 'center', padding: '0 14px', gap: 10 }}>
          <button
            onClick={submitSearch}
            aria-label="Знайти"
            style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', display: 'flex', flexShrink: 0 }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#6B7280" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          </button>
          <input
            value={searchDraft}
            onChange={e => setSearchDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') submitSearch() }}
            placeholder="Офіс, магазин, склад, район..."
            style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: '#fff', fontSize: 15, fontFamily: 'Inter,sans-serif', padding: '13px 0', minWidth: 0 }} />
          {searchDraft || searchQuery
            ? <button onClick={clearSearch} aria-label="Очистити пошук" style={{ background: 'none', border: 'none', color: '#6B7280', fontSize: 20, cursor: 'pointer', padding: 0, lineHeight: 1 }}>×</button>
            : <button onClick={() => (isOpen ? close() : open())} style={{ position: 'relative', background: isOpen ? '#FF6B1A' : '#1E2334', border: `1px solid ${isOpen ? '#FF6B1A' : '#2A3045'}`, borderRadius: 10, color: isOpen ? '#fff' : '#A0A8BC', padding: '6px 10px', fontSize: 13, cursor: 'pointer', flexShrink: 0 }}>
                ⚙️
                {activeFilterCount > 0 && (
                  <span style={{
                    position: 'absolute', top: -6, right: -6,
                    background: '#FF6B1A', color: '#fff', fontSize: 10, fontWeight: 700,
                    borderRadius: 10, minWidth: 16, height: 16, display: 'flex',
                    alignItems: 'center', justifyContent: 'center', padding: '0 3px',
                    border: '2px solid #0D1018',
                  }}>{activeFilterCount}</span>
                )}
              </button>
          }
        </div>

        {/* ── Filters panel (draft — does not touch results until "Показати") ── */}
        {isOpen && (
          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
            {/* District */}
            <div>
              <div style={{ fontSize: 11, color: '#A0A8BC', fontWeight: 600, marginBottom: 6, textTransform: 'uppercase' as const, letterSpacing: '.5px' }}>Район</div>
              <select value={draft.district} onChange={e => setDraft(d => ({ ...d, district: e.target.value }))}
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
                  <input type="number" inputMode="numeric" min={0} placeholder="0" value={draft.priceMin || ''} onChange={e => setDraft(d => ({ ...d, priceMin: clampNonNegative(e.target.value) }))} style={numInp(priceInvalid)} />
                </div>
                <div>
                  <div style={{ fontSize: 10, color: '#6B7280', marginBottom: 4 }}>До</div>
                  <input type="number" inputMode="numeric" min={0} placeholder="Будь-яка" value={draft.priceMax || ''} onChange={e => setDraft(d => ({ ...d, priceMax: clampNonNegative(e.target.value) }))} style={numInp(priceInvalid)} />
                </div>
              </div>
              {priceInvalid && <div style={errMsg}>Мінімальна ціна не може перевищувати максимальну</div>}
            </div>

            {/* Area range */}
            <div>
              <div style={{ fontSize: 11, color: '#A0A8BC', fontWeight: 600, marginBottom: 6, textTransform: 'uppercase' as const, letterSpacing: '.5px' }}>
                Площа м²
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <div>
                  <div style={{ fontSize: 10, color: '#6B7280', marginBottom: 4 }}>Від</div>
                  <input type="number" inputMode="numeric" min={0} placeholder="0" value={draft.areaMin || ''} onChange={e => setDraft(d => ({ ...d, areaMin: clampNonNegative(e.target.value) }))} style={numInp(areaInvalid)} />
                </div>
                <div>
                  <div style={{ fontSize: 10, color: '#6B7280', marginBottom: 4 }}>До</div>
                  <input type="number" inputMode="numeric" min={0} placeholder="Будь-яка" value={draft.areaMax || ''} onChange={e => setDraft(d => ({ ...d, areaMax: clampNonNegative(e.target.value) }))} style={numInp(areaInvalid)} />
                </div>
              </div>
              {areaInvalid && <div style={errMsg}>Мінімальна площа не може перевищувати максимальну</div>}
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={resetDraft} style={{ flex: 1, background: 'none', border: '1px solid #2A3045', borderRadius: 10, padding: '12px', color: '#A0A8BC', fontSize: 13, cursor: 'pointer', fontFamily: 'Inter,sans-serif' }}>
                Скинути
              </button>
              <button onClick={apply} disabled={draftInvalid} style={{
                flex: 2, background: draftInvalid ? '#4B5563' : 'linear-gradient(135deg,#FF6B1A,#FF8C3A)', border: 'none', borderRadius: 10, padding: '12px',
                color: '#fff', fontSize: 13, fontWeight: 700, cursor: draftInvalid ? 'not-allowed' : 'pointer', fontFamily: 'Inter,sans-serif',
              }}>
                {draftInvalid ? 'Виправте діапазон' : draftPreviewCount > 0 ? `Показати ${draftPreviewCount} ${pluralizeObjects(draftPreviewCount)}` : 'Показати результати'}
              </button>
            </div>
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

      {/* Category chips — quick access, applies immediately */}
      <div style={{ display: 'flex', gap: 8, overflowX: 'auto', padding: '14px 20px 4px', scrollbarWidth: 'none', msOverflowStyle: 'none' } as React.CSSProperties}>
        {CATEGORIES.map(c => {
          const active = appliedFilters.type === c.id
          return (
            <button key={c.id} onClick={() => selectType(active ? 'all' : c.id)} style={{
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

      {/* Applied filter chips (not shown while searching by text) */}
      {!isSearching && <FilterChips chips={chips} />}

      {/* ── SEARCH RESULTS ── */}
      {isSearching && (
        <div style={{ padding: '12px 20px 0' }}>
          <div style={{ fontSize: 13, color: '#A0A8BC', marginBottom: 12 }}>
            Знайдено: <span style={{ color: '#FF6B1A', fontWeight: 700 }}>{searchResults!.length}</span> {pluralizeObjects(searchResults!.length)}
          </div>
          {searchResults!.length > 0 && sortPills}
          {searchResults!.length === 0
            ? <div style={{ textAlign: 'center', padding: '60px 0' }}><div style={{ fontSize: 40 }}>🔍</div><div style={{ fontSize: 16, fontWeight: 600, color: '#fff', marginTop: 12 }}>Нічого не знайдено</div><button onClick={clearSearch} style={{ marginTop: 16, padding: '10px 20px', background: '#FF6B1A', border: 'none', borderRadius: 12, color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>Скинути</button></div>
            : <div className="listing-grid">{searchResults!.map(l => <PropertyCard key={l.id} listing={l} onPress={onListing} onFavorite={onFavorite} isFavorite={favorites.includes(l.id)} />)}</div>
          }
        </div>
      )}

      {/* ── CATEGORY / FILTER RESULTS (inline) ── */}
      {!isSearching && isFiltering && (
        <div style={{ padding: '12px 20px 0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div style={{ fontSize: 13, color: '#A0A8BC' }}>
              Знайдено: <span style={{ color: '#FF6B1A', fontWeight: 700 }}>{filteredByCategory!.length}</span> {pluralizeObjects(filteredByCategory!.length)}
            </div>
            <button onClick={resetAppliedNow} style={{ background: 'none', border: 'none', color: '#FF6B1A', fontSize: 12, cursor: 'pointer', fontFamily: 'Inter,sans-serif' }}>Скинути</button>
          </div>
          {filteredByCategory!.length > 0 && sortPills}
          {filteredByCategory!.length === 0
            ? (
              <EmptyState
                icon="🏢"
                title="За вашими параметрами нічого не знайдено"
                subtitle="Спробуйте змінити параметри пошуку або скинути фільтри"
                primaryAction={{ label: 'Змінити параметри', onClick: open }}
                secondaryAction={{ label: 'Скинути фільтри', onClick: resetAppliedNow }}
              />
            )
            : <div className="listing-grid">{filteredByCategory!.map(l => <PropertyCard key={l.id} listing={l} onPress={onListing} onFavorite={onFavorite} isFavorite={favorites.includes(l.id)} />)}</div>
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
              <div className="listing-grid" style={{ padding: '0 20px' }}>{rekomendovani.slice(0, 3).map(l => <PropertyCard key={l.id} listing={l} onPress={onListing} onFavorite={onFavorite} isFavorite={favorites.includes(l.id)} />)}</div>
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
              <div className="listing-grid" style={{ padding: '0 20px' }}>{novi.slice(0, 4).map(l => <PropertyCard key={l.id} listing={l} onPress={onListing} onFavorite={onFavorite} isFavorite={favorites.includes(l.id)} />)}</div>
            </section>
          )}

          {/* Всі оголошення */}
          <section style={{ marginTop: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 20px 10px' }}>
              <span style={{ fontSize: 16, fontWeight: 700, color: '#fff' }}>🏢 Всі оголошення</span>
              <button onClick={() => onShowAll?.('🏢 Всі оголошення', [...listings].filter(l => l.isActive !== false).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()))} style={{ background: 'none', border: 'none', color: '#FF6B1A', fontSize: 13, cursor: 'pointer' }}>Всі →</button>
            </div>
            <div className="listing-grid" style={{ padding: '0 20px' }}>
              {[...listings].filter(l => l.isActive !== false)
                .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
                .slice(0, 6)
                .map(l => <PropertyCard key={l.id} listing={l} onPress={onListing} onFavorite={onFavorite} isFavorite={favorites.includes(l.id)} />)}
            </div>
          </section>
        </>
      )}

      {loading && listings.length === 0 && (
        <div style={{ padding: '0 20px' }}><Skeleton count={3} /></div>
      )}
      {loading && listings.length > 0 && (
        <div style={{ textAlign: 'center', padding: '20px 0', color: '#A0A8BC', fontSize: 13 }}>⏳ Оновлюємо…</div>
      )}
      {!loading && loadError && listings.length === 0 && onRetryLoad && (
        <ErrorState onRetry={onRetryLoad} />
      )}
    </div>
    </div>
  )
}
