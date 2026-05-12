'use client'
import { useState, useMemo } from 'react'
import type { ListingData } from '@/types'
import { TYPE_COLORS, CATEGORIES, DISTRICTS } from '@/types'
import PropertyCard from './PropertyCard'

interface Props {
  title: string
  listings: ListingData[]
  allListings: ListingData[]
  favorites: number[]
  onListing: (l: ListingData) => void
  onFavorite: (id: number) => void
  onBack: () => void
}

export default function AllListingsScreen({ title, listings, allListings, favorites, onListing, onFavorite, onBack }: Props) {
  const [query, setQuery] = useState('')
  const [activeType, setActiveType] = useState('all')
  const [district, setDistrict] = useState('Всі райони')
  const [priceMax, setPriceMax] = useState(200000)
  const [areaMin, setAreaMin] = useState(0)
  const [sortBy, setSortBy] = useState('default')
  const [showFilters, setShowFilters] = useState(false)

  const filtered = useMemo(() => {
    let r = [...listings]
    if (query) {
      const q = query.toLowerCase()
      r = r.filter(l => l.title.toLowerCase().includes(q) || l.district.toLowerCase().includes(q) || l.type.toLowerCase().includes(q))
    }
    if (activeType !== 'all') r = r.filter(l => l.type === activeType)
    if (district !== 'Всі райони') r = r.filter(l => l.district === district)
    r = r.filter(l => l.price <= priceMax && l.area >= areaMin)
    if (sortBy === 'price_asc') r.sort((a, b) => a.price - b.price)
    else if (sortBy === 'price_desc') r.sort((a, b) => b.price - a.price)
    else if (sortBy === 'area') r.sort((a, b) => b.area - a.area)
    else if (sortBy === 'views') r.sort((a, b) => b.views - a.views)
    return r
  }, [listings, query, activeType, district, priceMax, areaMin, sortBy])

  const pill = (label: string, active: boolean, onClick: () => void) => (
    <button onClick={onClick} style={{
      background: active ? '#FF6B1A' : '#1A1F2E',
      border: `1px solid ${active ? '#FF6B1A' : '#2A3045'}`,
      borderRadius: 20, padding: '6px 14px',
      color: active ? '#fff' : '#A0A8BC',
      fontSize: 12, fontWeight: active ? 600 : 400,
      cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
      fontFamily: 'Inter, sans-serif', transition: 'all .15s',
    }}>{label}</button>
  )

  return (
    <div style={{ minHeight: '100dvh', background: '#0F1117', paddingBottom: 80 }}>
      {/* Header */}
      <div style={{ padding: '44px 20px 16px', background: '#0D1018', position: 'sticky', top: 0, zIndex: 50 }}>
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

        {/* Search */}
        <div style={{ background: '#1A1F2E', border: '1px solid #2A3045', borderRadius: 14, display: 'flex', alignItems: 'center', padding: '0 14px', gap: 10 }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#6B7280" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Пошук..."
            style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: '#fff', fontSize: 14, padding: '12px 0', fontFamily: 'Inter, sans-serif' }}
          />
          <button onClick={() => setShowFilters(s => !s)} style={{
            background: showFilters ? '#FF6B1A' : '#1E2334',
            border: `1px solid ${showFilters ? '#FF6B1A' : '#2A3045'}`,
            borderRadius: 10, color: showFilters ? '#fff' : '#A0A8BC',
            padding: '6px 10px', fontSize: 13, cursor: 'pointer',
          }}>⚙️</button>
        </div>
      </div>

      {/* Filters panel */}
      {showFilters && (
        <div style={{ padding: '12px 20px 16px', background: '#0F1117', borderBottom: '1px solid #1E2334' }}>
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, color: '#A0A8BC', fontWeight: 600, marginBottom: 8, textTransform: 'uppercase' as const, letterSpacing: '.5px' }}>Тип</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {CATEGORIES.map(c => pill(c.label, activeType === c.id, () => setActiveType(c.id)))}
            </div>
          </div>
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, color: '#A0A8BC', fontWeight: 600, marginBottom: 8, textTransform: 'uppercase' as const }}>Район</div>
            <select value={district} onChange={e => setDistrict(e.target.value)} style={{
              background: '#1A1F2E', border: '1px solid #2A3045', borderRadius: 10,
              color: '#fff', padding: '10px 14px', fontSize: 14, width: '100%',
              fontFamily: 'Inter, sans-serif', outline: 'none',
            }}>
              {DISTRICTS.map(d => <option key={d}>{d}</option>)}
            </select>
          </div>
          <div style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 11, color: '#A0A8BC', fontWeight: 600, textTransform: 'uppercase' as const }}>Ціна до</span>
              <span style={{ fontSize: 13, color: '#FF6B1A', fontWeight: 700 }}>{priceMax.toLocaleString('uk-UA')} ₴</span>
            </div>
            <input type="range" min="5000" max="200000" step="1000" value={priceMax} onChange={e => setPriceMax(+e.target.value)} />
          </div>
          <div style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 11, color: '#A0A8BC', fontWeight: 600, textTransform: 'uppercase' as const }}>Площа від</span>
              <span style={{ fontSize: 13, color: '#FF6B1A', fontWeight: 700 }}>{areaMin} м²</span>
            </div>
            <input type="range" min="0" max="500" step="10" value={areaMin} onChange={e => setAreaMin(+e.target.value)} />
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {[['default','За замовч.'],['views','Популярні'],['price_asc','Ціна ↑'],['price_desc','Ціна ↓'],['area','Площа ↓']].map(([id, label]) =>
              pill(label, sortBy === id, () => setSortBy(id))
            )}
          </div>
        </div>
      )}

      {/* Type chips */}
      <div style={{ display: 'flex', gap: 8, overflowX: 'auto', padding: '12px 20px', scrollbarWidth: 'none' }}>
        {CATEGORIES.map(c => pill(`${c.icon} ${c.label}`, activeType === c.id, () => setActiveType(c.id)))}
      </div>

      {/* Count */}
      <div style={{ padding: '0 20px 12px', fontSize: 13, color: '#A0A8BC' }}>
        Знайдено: <span style={{ color: '#FF6B1A', fontWeight: 700 }}>{filtered.length}</span> об'єктів
      </div>

      {/* List */}
      <div style={{ padding: '0 20px' }}>
        {filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 0' }}>
            <div style={{ fontSize: 48 }}>🏢</div>
            <div style={{ fontSize: 18, fontWeight: 600, color: '#fff', marginTop: 12 }}>Нічого не знайдено</div>
            <div style={{ fontSize: 14, color: '#A0A8BC', marginTop: 8 }}>Спробуйте змінити фільтри</div>
          </div>
        ) : (
          filtered.map(l => (
            <PropertyCard
              key={l.id}
              listing={l}
              onPress={onListing}
              onFavorite={onFavorite}
              isFavorite={favorites.includes(l.id)}
              layout="horizontal"
            />
          ))
        )}
      </div>
    </div>
  )
}
