'use client'
import { useState, useMemo } from 'react'
import type { ListingData } from '@/types'
import { TYPE_COLORS, CATEGORIES, DISTRICTS } from '@/types'
import PropertyCard from './PropertyCard'
import EmptyState from './EmptyState'
import FilterChips, { type FilterChip } from './FilterChips'
import { pluralizeObjects } from '@/lib/pluralize'
import { useDraftFilters, isRangeInvalid, clampNonNegative } from '@/hooks/useDraftFilters'

export interface CatalogFilters {
  type: string
  district: string
  priceMin: number
  priceMax: number // 0 = unlimited
  areaMin: number
  areaMax: number // 0 = unlimited
}

export const BASE_CATALOG_FILTERS: CatalogFilters = {
  type: 'all', district: 'Всі райони', priceMin: 0, priceMax: 0, areaMin: 0, areaMax: 0,
}

interface Props {
  title: string
  listings: ListingData[]
  allListings: ListingData[]
  favorites: number[]
  onListing: (l: ListingData) => void
  onFavorite: (id: number) => void
  onBack: () => void
  appliedFilters: CatalogFilters
  onAppliedFiltersChange: (f: CatalogFilters) => void
  sortBy: string
  onSortByChange: (s: string) => void
  searchQuery: string
  onSearchQueryChange: (q: string) => void
}

function applyCatalogFilters(listings: ListingData[], f: CatalogFilters): ListingData[] {
  let r = [...listings]
  if (f.type !== 'all') r = r.filter(l => l.type === f.type)
  if (f.district !== 'Всі райони') r = r.filter(l => l.district === f.district)
  r = r
    .filter(l => f.priceMin === 0 || l.price >= f.priceMin)
    .filter(l => f.priceMax === 0 || l.price <= f.priceMax)
    .filter(l => f.areaMin === 0 || l.area >= f.areaMin)
    .filter(l => f.areaMax === 0 || l.area <= f.areaMax)
  return r
}

const rangeChipLabel = (min: number, max: number, unit: string) => {
  if (min > 0 && max > 0) return `${min.toLocaleString('uk-UA')}–${max.toLocaleString('uk-UA')} ${unit}`
  if (min > 0) return `від ${min.toLocaleString('uk-UA')} ${unit}`
  return `до ${max.toLocaleString('uk-UA')} ${unit}`
}

export default function AllListingsScreen({
  title, listings, allListings, favorites, onListing, onFavorite, onBack,
  appliedFilters, onAppliedFiltersChange, sortBy, onSortByChange, searchQuery, onSearchQueryChange,
}: Props) {
  // Local per-keystroke draft — appliedQuery (lifted to page.tsx) only
  // changes on Enter / the search button / clear.
  const [searchDraft, setSearchDraft] = useState(searchQuery)
  const { draft, setDraft, isOpen, open, close, apply, resetDraft } =
    useDraftFilters(appliedFilters, onAppliedFiltersChange, BASE_CATALOG_FILTERS)

  const submitSearch = () => onSearchQueryChange(searchDraft.trim())
  const clearSearch = () => { setSearchDraft(''); onSearchQueryChange('') }

  // The result list is driven only by appliedFilters — editing the draft
  // inside the open panel never touches it until "Показати" is pressed.
  const filtered = useMemo(() => {
    let r = applyCatalogFilters(listings, appliedFilters)
    const q = searchQuery.trim().toLowerCase()
    if (q) {
      r = r.filter(l => l.title.toLowerCase().includes(q) || l.district.toLowerCase().includes(q) || l.type.toLowerCase().includes(q))
    }
    if (sortBy === 'date') r.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    else if (sortBy === 'views') r.sort((a, b) => (b.views || 0) - (a.views || 0))
    else if (sortBy === 'price_asc') r.sort((a, b) => a.price - b.price)
    else if (sortBy === 'price_desc') r.sort((a, b) => b.price - a.price)
    else if (sortBy === 'area') r.sort((a, b) => b.area - a.area)
    return r
  }, [listings, appliedFilters, searchQuery, sortBy])

  // "Показати N об'єктів" is computed from the DRAFT — a preview of what
  // applying it right now would show, before the user commits. Blocked
  // (button shows the error instead) when "від" exceeds "до".
  const priceInvalid = isRangeInvalid(draft.priceMin, draft.priceMax)
  const areaInvalid = isRangeInvalid(draft.areaMin, draft.areaMax)
  const draftInvalid = priceInvalid || areaInvalid
  const draftPreviewCount = useMemo(() => applyCatalogFilters(listings, draft).length, [listings, draft])

  const activeFilterCount =
    (appliedFilters.type !== BASE_CATALOG_FILTERS.type ? 1 : 0) +
    (appliedFilters.district !== BASE_CATALOG_FILTERS.district ? 1 : 0) +
    (appliedFilters.priceMin > 0 || appliedFilters.priceMax > 0 ? 1 : 0) +
    (appliedFilters.areaMin > 0 || appliedFilters.areaMax > 0 ? 1 : 0)

  // Quick category chips (always visible, outside the panel) act like an
  // instant shortcut — same as the home page category row — not a draft
  // edit. They commit to appliedFilters immediately and keep the draft in
  // sync so reopening the panel doesn't show a stale value.
  const selectType = (id: string) => {
    const next = { ...appliedFilters, type: id }
    onAppliedFiltersChange(next)
    setDraft(d => ({ ...d, type: id }))
  }

  const removeFilter = (patch: Partial<CatalogFilters>) => {
    const next = { ...appliedFilters, ...patch }
    onAppliedFiltersChange(next)
    setDraft(next)
  }

  const resetAppliedNow = () => {
    onAppliedFiltersChange(BASE_CATALOG_FILTERS)
    setDraft(BASE_CATALOG_FILTERS)
  }

  const chips: FilterChip[] = []
  if (appliedFilters.type !== BASE_CATALOG_FILTERS.type) {
    const cat = CATEGORIES.find(c => c.id === appliedFilters.type)
    chips.push({ key: 'type', label: cat?.label || appliedFilters.type, onRemove: () => removeFilter({ type: BASE_CATALOG_FILTERS.type }) })
  }
  if (appliedFilters.district !== BASE_CATALOG_FILTERS.district) {
    chips.push({ key: 'district', label: appliedFilters.district, onRemove: () => removeFilter({ district: BASE_CATALOG_FILTERS.district }) })
  }
  if (appliedFilters.priceMin > 0 || appliedFilters.priceMax > 0) {
    chips.push({ key: 'price', label: rangeChipLabel(appliedFilters.priceMin, appliedFilters.priceMax, '₴'), onRemove: () => removeFilter({ priceMin: 0, priceMax: 0 }) })
  }
  if (appliedFilters.areaMin > 0 || appliedFilters.areaMax > 0) {
    chips.push({ key: 'area', label: rangeChipLabel(appliedFilters.areaMin, appliedFilters.areaMax, 'м²'), onRemove: () => removeFilter({ areaMin: 0, areaMax: 0 }) })
  }

  const pill = (key: string, label: string, active: boolean, onClick: () => void) => (
    <button key={key} onClick={onClick} style={{
      background: active ? '#FF6B1A' : '#1A1F2E',
      border: `1px solid ${active ? '#FF6B1A' : '#2A3045'}`,
      borderRadius: 20, padding: '6px 14px',
      color: active ? '#fff' : '#A0A8BC',
      fontSize: 12, fontWeight: active ? 600 : 400,
      cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
      fontFamily: 'Inter, sans-serif', transition: 'all .15s',
    }}>{label}</button>
  )

  const numInp = (invalid: boolean): React.CSSProperties => ({
    background: '#0F1117', border: `1px solid ${invalid ? '#EF4444' : '#2A3045'}`, borderRadius: 10,
    color: '#fff', padding: '10px 12px', fontSize: 14,
    fontFamily: 'Inter, sans-serif', outline: 'none', width: '100%', boxSizing: 'border-box' as const,
  })
  const errMsg: React.CSSProperties = { fontSize: 11, color: '#EF4444', marginTop: 4 }

  return (
    <div className="desktop-wide-screen">
    <div className="desktop-wide-screen-inner" style={{ minHeight: '100dvh', background: '#0F1117', paddingBottom: 80 }}>
      {/* Header */}
      <div className="catalog-sticky-header" style={{ padding: '44px 20px 16px', paddingTop: 'max(44px, env(safe-area-inset-top, 44px))', background: '#0D1018', position: 'sticky', top: 0, zIndex: 50 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
          <button onClick={onBack} style={{
            background: 'rgba(255,255,255,.08)', border: 'none', borderRadius: 10,
            width: 36, height: 36, color: '#fff', fontSize: 18, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}>←</button>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#fff' }}>{title}</div>
          <span style={{ marginLeft: 'auto', background: '#FF6B1A22', color: '#FF6B1A', fontSize: 12, fontWeight: 700, borderRadius: 20, padding: '3px 10px' }}>
            {filtered.length}
          </span>
        </div>

        {/* Search — applies only on Enter / the search button, never per keystroke */}
        <div style={{ background: '#1A1F2E', border: '1px solid #2A3045', borderRadius: 14, display: 'flex', alignItems: 'center', padding: '0 14px', gap: 10 }}>
          <button onClick={submitSearch} aria-label="Знайти" style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', display: 'flex', flexShrink: 0 }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#6B7280" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          </button>
          <input
            value={searchDraft}
            onChange={e => setSearchDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') submitSearch() }}
            placeholder="Пошук..."
            style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: '#fff', fontSize: 14, padding: '12px 0', fontFamily: 'Inter, sans-serif' }}
          />
          {searchDraft || searchQuery
            ? <button onClick={clearSearch} aria-label="Очистити пошук" style={{ background: 'none', border: 'none', color: '#6B7280', fontSize: 20, cursor: 'pointer', padding: 0, lineHeight: 1 }}>×</button>
            : <button className="catalog-mobile-only" onClick={() => (isOpen ? close() : open())} style={{
                position: 'relative',
                background: isOpen ? '#FF6B1A' : '#1E2334',
                border: `1px solid ${isOpen ? '#FF6B1A' : '#2A3045'}`,
                borderRadius: 10, color: isOpen ? '#fff' : '#A0A8BC',
                padding: '6px 10px', fontSize: 13, cursor: 'pointer',
              }}>
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
      </div>

      <div className="catalog-desktop-grid">
      {/* Filters panel — editable draft, does not touch results until
          "Показати". Always mounted (not conditionally rendered) so the
          1024px+ CSS override can force it visible as a persistent
          sidebar; below 1024px, `isOpen` still fully controls it exactly
          as before via this inline display. */}
      <aside className="catalog-sidebar-panel" style={{ display: isOpen ? 'block' : 'none' }}>
        <div style={{ padding: '12px 20px 16px', background: '#0F1117', borderBottom: '1px solid #1E2334' }}>
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, color: '#A0A8BC', fontWeight: 600, marginBottom: 8, textTransform: 'uppercase' as const, letterSpacing: '.5px' }}>Тип</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {CATEGORIES.map(c => pill(`type-${c.id}`, c.label, draft.type === c.id, () => setDraft(d => ({ ...d, type: c.id }))))}
            </div>
          </div>
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, color: '#A0A8BC', fontWeight: 600, marginBottom: 8, textTransform: 'uppercase' as const }}>Район</div>
            <select value={draft.district} onChange={e => setDraft(d => ({ ...d, district: e.target.value }))} style={{
              background: '#1A1F2E', border: '1px solid #2A3045', borderRadius: 10,
              color: '#fff', padding: '10px 14px', fontSize: 14, width: '100%',
              fontFamily: 'Inter, sans-serif', outline: 'none',
            }}>
              {DISTRICTS.map(d => <option key={d}>{d}</option>)}
            </select>
          </div>

          {/* Price range */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, color: '#A0A8BC', fontWeight: 600, marginBottom: 8, textTransform: 'uppercase' as const }}>Ціна ₴/міс</div>
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
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, color: '#A0A8BC', fontWeight: 600, marginBottom: 8, textTransform: 'uppercase' as const }}>Площа м²</div>
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

          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
            {[['default','За замовч.'],['date','Найновіші'],['views','Популярні'],['price_asc','Ціна ↑'],['price_desc','Ціна ↓'],['area','Площа ↓']].map(([id, label]) =>
              pill(`sort-${id}`, label, sortBy === id, () => onSortByChange(id))
            )}
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={resetDraft} style={{
              flex: 1, padding: '13px', background: 'none', border: '1px solid #2A3045',
              borderRadius: 12, color: '#A0A8BC', fontSize: 14, fontWeight: 600, cursor: 'pointer',
              fontFamily: 'Inter, sans-serif',
            }}>Скинути</button>
            <button onClick={apply} disabled={draftInvalid} style={{
              flex: 2, padding: '13px', background: draftInvalid ? '#4B5563' : 'linear-gradient(135deg,#FF6B1A,#FF8C3A)',
              border: 'none', borderRadius: 12, color: '#fff', fontSize: 14, fontWeight: 700, cursor: draftInvalid ? 'not-allowed' : 'pointer',
              fontFamily: 'Inter, sans-serif',
            }}>
              {draftInvalid ? 'Виправте діапазон' : draftPreviewCount > 0 ? `Показати ${draftPreviewCount} ${pluralizeObjects(draftPreviewCount)}` : 'Показати результати'}
            </button>
          </div>
        </div>
      </aside>

      <div>
        {/* Type chips — quick access, applies immediately. Redundant with
            the always-visible sidebar's own "Тип" field from 1024px up
            (that one goes through draftFilters like everything else in
            the sidebar), so it's hidden there to avoid two controls for
            the same thing. */}
        <div className="catalog-mobile-only" style={{ display: 'flex', gap: 8, overflowX: 'auto', padding: '12px 20px', scrollbarWidth: 'none' }}>
          {CATEGORIES.map(c => pill(`chip-${c.id}`, `${c.icon} ${c.label}`, appliedFilters.type === c.id, () => selectType(c.id)))}
        </div>

        {/* Applied filter chips */}
        <FilterChips chips={chips} />

        {/* Count */}
        <div style={{ padding: '0 20px 12px', fontSize: 13, color: '#A0A8BC' }}>
          Знайдено: <span style={{ color: '#FF6B1A', fontWeight: 700 }}>{filtered.length}</span> {pluralizeObjects(filtered.length)}
        </div>

        {/* List */}
        <div style={{ padding: '0 20px' }}>
          {filtered.length === 0 ? (
            <EmptyState
              icon="🏢"
              title="За вашими параметрами нічого не знайдено"
              subtitle="Спробуйте змінити параметри пошуку або скинути фільтри"
              primaryAction={{ label: 'Змінити параметри', onClick: open }}
              secondaryAction={(activeFilterCount > 0 || searchQuery) ? { label: 'Скинути фільтри', onClick: () => { resetAppliedNow(); clearSearch() } } : undefined}
            />
          ) : (
            <div className="listing-grid">
              {filtered.map(l => (
                <PropertyCard
                  key={l.id}
                  listing={l}
                  onPress={onListing}
                  onFavorite={onFavorite}
                  isFavorite={favorites.includes(l.id)}
                  layout="horizontal"
                />
              ))}
            </div>
          )}
        </div>
      </div>
      </div>
    </div>
    </div>
  )
}
