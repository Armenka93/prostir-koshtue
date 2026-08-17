'use client'
import { useState, useMemo } from 'react'
import PropertyCard from './PropertyCard'
import type { ListingData } from '@/types'
import { CATEGORIES, DISTRICTS } from '@/types'
import { pluralizeObjects } from '@/lib/pluralize'

interface Props {
  listings: ListingData[]
  favorites: number[]
  onListing: (l: ListingData) => void
  onFavorite: (id: number) => void
  initialQuery?: string
}

export default function SearchScreen({ listings, favorites, onListing, onFavorite, initialQuery = '' }: Props) {
  const [query, setQuery] = useState(initialQuery)
  const [activeType, setActiveType] = useState('all')
  const [showFilters, setShowFilters] = useState(false)
  const [priceMax, setPriceMax] = useState(100000)
  const [areaMin, setAreaMin] = useState(0)
  const [parking, setParking] = useState(false)
  const [entrance, setEntrance] = useState(false)
  const [sortBy, setSortBy] = useState('default')
  const [district, setDistrict] = useState('Всі райони')

  const filtered = useMemo(() => {
    let r = [...listings]
    if (query) {
      const q = query.toLowerCase()
      r = r.filter(l => l.title.toLowerCase().includes(q) || l.type.toLowerCase().includes(q) || l.district.toLowerCase().includes(q) || (l.description || '').toLowerCase().includes(q))
    }
    if (activeType !== 'all') r = r.filter(l => l.type === activeType)
    if (district !== 'Всі райони') r = r.filter(l => l.district === district)
    r = r.filter(l => l.price <= priceMax && l.area >= areaMin)
    if (parking) r = r.filter(l => l.parking)
    if (entrance) r = r.filter(l => l.separateEntrance)
    if (sortBy === 'price_asc') r.sort((a, b) => a.price - b.price)
    else if (sortBy === 'price_desc') r.sort((a, b) => b.price - a.price)
    else if (sortBy === 'area') r.sort((a, b) => b.area - a.area)
    return r
  }, [listings, query, activeType, district, priceMax, areaMin, parking, entrance, sortBy])

  return (
    <div style={{ paddingBottom: 90 }}>
      <div style={{ padding: '48px 20px 16px', paddingTop: 'max(48px, env(safe-area-inset-top, 48px))', background: '#0D1018' }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: '#fff', marginBottom: 12 }}>Пошук</div>
        <div style={{ background: '#1A1F2E', border: '1px solid #2A3045', borderRadius: 14, display: 'flex', alignItems: 'center', padding: '0 14px', gap: 10 }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#6B7280" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Офіс, магазин, склад..."
            style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: '#fff', fontSize: 15, fontFamily: 'Inter, sans-serif', padding: '14px 0' }} />
          <button onClick={() => setShowFilters(s => !s)} style={{
            background: showFilters ? '#FF6B1A' : '#1E2334', border: `1px solid ${showFilters ? '#FF6B1A' : '#2A3045'}`,
            borderRadius: 10, color: showFilters ? '#fff' : '#A0A8BC', padding: '6px 10px', fontSize: 13, cursor: 'pointer',
          }}>⚙️</button>
        </div>
      </div>

      {showFilters && (
        <div style={{ padding: '0 20px 16px', background: '#0F1117', borderBottom: '1px solid #1E2334' }}>
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, color: '#A0A8BC', fontWeight: 600, marginBottom: 8, textTransform: 'uppercase' as const, letterSpacing: '.5px' }}>Тип</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {CATEGORIES.map(c => (
                <button key={c.id} onClick={() => setActiveType(c.id)} style={{
                  background: activeType === c.id ? '#FF6B1A' : '#1A1F2E',
                  border: `1px solid ${activeType === c.id ? '#FF6B1A' : '#2A3045'}`,
                  borderRadius: 20, padding: '5px 12px',
                  color: activeType === c.id ? '#fff' : '#A0A8BC',
                  fontSize: 12, fontWeight: activeType === c.id ? 600 : 400, cursor: 'pointer',
                }}>{c.label}</button>
              ))}
            </div>
          </div>
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, color: '#A0A8BC', fontWeight: 600, marginBottom: 8, textTransform: 'uppercase' as const }}>Район</div>
            <select value={district} onChange={e => setDistrict(e.target.value)}
              style={{ background: '#1A1F2E', border: '1px solid #2A3045', borderRadius: 10, color: '#fff', padding: '10px 14px', fontSize: 14, width: '100%', fontFamily: 'Inter, sans-serif', outline: 'none' }}>
              {DISTRICTS.map(d => <option key={d}>{d}</option>)}
            </select>
          </div>
          <div style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 11, color: '#A0A8BC', fontWeight: 600, textTransform: 'uppercase' as const }}>Ціна до</span>
              <span style={{ fontSize: 13, color: '#FF6B1A', fontWeight: 700 }}>{priceMax.toLocaleString('uk-UA')} ₴</span>
            </div>
            <input type="range" min="5000" max="100000" step="1000" value={priceMax} onChange={e => setPriceMax(+e.target.value)} />
          </div>
          <div style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 11, color: '#A0A8BC', fontWeight: 600, textTransform: 'uppercase' as const }}>Площа від</span>
              <span style={{ fontSize: 13, color: '#FF6B1A', fontWeight: 700 }}>{areaMin} м²</span>
            </div>
            <input type="range" min="0" max="500" step="10" value={areaMin} onChange={e => setAreaMin(+e.target.value)} />
          </div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
            <button onClick={() => setParking(p => !p)} style={{ background: parking ? '#FF6B1A22' : '#1A1F2E', border: `1px solid ${parking ? '#FF6B1A' : '#2A3045'}`, borderRadius: 20, padding: '6px 14px', color: parking ? '#FF6B1A' : '#A0A8BC', fontSize: 13, cursor: 'pointer' }}>🅿️ Паркінг</button>
            <button onClick={() => setEntrance(e => !e)} style={{ background: entrance ? '#FF6B1A22' : '#1A1F2E', border: `1px solid ${entrance ? '#FF6B1A' : '#2A3045'}`, borderRadius: 20, padding: '6px 14px', color: entrance ? '#FF6B1A' : '#A0A8BC', fontSize: 13, cursor: 'pointer' }}>🚪 Окремий вхід</button>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {[['default','За замовч.'],['price_asc','Ціна ↑'],['price_desc','Ціна ↓'],['area','Площа ↓']].map(([id, label]) => (
              <button key={id} onClick={() => setSortBy(id)} style={{
                background: sortBy === id ? '#FF6B1A' : '#1A1F2E', border: `1px solid ${sortBy === id ? '#FF6B1A' : '#2A3045'}`,
                borderRadius: 20, padding: '5px 10px', color: sortBy === id ? '#fff' : '#A0A8BC', fontSize: 12, cursor: 'pointer',
              }}>{label}</button>
            ))}
          </div>
        </div>
      )}

      <div className="scrollbar-none" style={{ display: 'flex', gap: 8, overflowX: 'auto', padding: '12px 20px' }}>
        {CATEGORIES.map(c => (
          <button key={c.id} onClick={() => setActiveType(c.id)} style={{
            background: activeType === c.id ? '#FF6B1A' : '#1A1F2E',
            border: `1px solid ${activeType === c.id ? '#FF6B1A' : '#2A3045'}`,
            borderRadius: 24, padding: '7px 14px',
            color: activeType === c.id ? '#fff' : '#A0A8BC',
            fontSize: 13, whiteSpace: 'nowrap', cursor: 'pointer', flexShrink: 0, fontWeight: activeType === c.id ? 600 : 400,
          }}>{c.icon} {c.label}</button>
        ))}
      </div>

      <div style={{ padding: '0 20px' }}>
        <div style={{ fontSize: 13, color: '#A0A8BC', marginBottom: 12 }}>
          Знайдено: <span style={{ color: '#FF6B1A', fontWeight: 700 }}>{filtered.length}</span> {pluralizeObjects(filtered.length)}
        </div>
        {filtered.length === 0
          ? <div style={{ textAlign: 'center', padding: '60px 0' }}><div style={{ fontSize: 48 }}>🏢</div><div style={{ fontSize: 18, fontWeight: 600, color: '#fff', marginTop: 12 }}>Нічого не знайдено</div><div style={{ fontSize: 14, color: '#A0A8BC', marginTop: 8 }}>Спробуйте змінити параметри</div></div>
          : filtered.map(l => <PropertyCard key={l.id} listing={l} onPress={onListing} onFavorite={onFavorite} isFavorite={favorites.includes(l.id)} />)
        }
      </div>
    </div>
  )
}
