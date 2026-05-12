'use client'
import { useState, useRef } from 'react'
import type { ListingData, User } from '@/types'
import { PROPERTY_TYPES, CONDITIONS, DISTRICTS } from '@/types'

interface Props {
  user: User | null
  onBack: () => void
  onCreated: (data: Partial<ListingData>) => void
  onGoProfile?: () => void
}

const inp: React.CSSProperties = {
  width: '100%', background: '#1A1F2E', border: '1px solid #2A3045',
  borderRadius: 12, padding: '13px 14px', color: '#fff', fontSize: 14,
  fontFamily: 'Inter, sans-serif', outline: 'none', boxSizing: 'border-box',
}
const lbl: React.CSSProperties = {
  fontSize: 12, color: '#A0A8BC', marginBottom: 6, fontWeight: 600,
  display: 'block', textTransform: 'uppercase', letterSpacing: '.5px',
}

export default function AddListingScreen({ user, onBack, onCreated, onGoProfile }: Props) {
  const [form, setForm] = useState({
    title: '', type: 'Офіс', price: '', area: '', floor: '', totalFloors: '',
    district: 'Приморський', address: '', condition: 'Євроремонт',
    parking: false, separateEntrance: false, description: '', features: '',
  })
  const [photos, setPhotos] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const update = (key: string, value: any) => setForm(f => ({ ...f, [key]: value }))

  const handleFiles = (files: FileList | null) => {
    if (!files) return
    Array.from(files).slice(0, 10 - photos.length).forEach(file => {
      const reader = new FileReader()
      reader.onload = e => {
        if (e.target?.result) setPhotos(p => [...p, e.target!.result as string])
      }
      reader.readAsDataURL(file)
    })
  }

  const handleSubmit = async () => {
    if (!user?.phone) {
      setError('no_profile')
      return
    }
    if (!form.title || !form.price || !form.area || !form.address) {
      setError("Заповніть обов'язкові поля: назва, ціна, площа, адреса")
      return
    }
    setLoading(true)
    setError('')
    await new Promise(r => setTimeout(r, 500))

    const FALLBACK_IMGS = [
      'https://images.unsplash.com/photo-1497366216548-37526070297c?w=800&q=80',
      'https://images.unsplash.com/photo-1441986300917-64674bd600d8?w=800&q=80',
      'https://images.unsplash.com/photo-1524758631624-e2822e304c36?w=800&q=80',
    ]

    onCreated({
      title: form.title,
      type: form.type,
      price: parseInt(form.price),
      area: parseInt(form.area),
      floor: form.floor ? parseInt(form.floor) : null,
      totalFloors: form.totalFloors ? parseInt(form.totalFloors) : null,
      district: form.district,
      address: form.address,
      condition: form.condition,
      parking: form.parking,
      separateEntrance: form.separateEntrance,
      description: form.description || null,
      images: photos.length ? photos : [FALLBACK_IMGS[Math.floor(Math.random() * FALLBACK_IMGS.length)]],
      features: form.features ? form.features.split(',').map(f => f.trim()).filter(Boolean) : [],
    })
    setLoading(false)
  }

  if (error === 'no_profile') {
    return (
      <div style={{ minHeight: '100dvh', background: '#0F1117', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24, textAlign: 'center' }}>
        <div style={{ fontSize: 48, marginBottom: 20 }}>⚠️</div>
        <div style={{ fontSize: 20, fontWeight: 700, color: '#fff', marginBottom: 12 }}>Потрібен номер телефону</div>
        <div style={{ fontSize: 14, color: '#A0A8BC', lineHeight: 1.6, marginBottom: 24, maxWidth: 300 }}>
          Без номера телефону не можна публікувати об'єкти. Зареєструйтесь з номером.
        </div>
        <button onClick={onBack} style={{ width: '100%', maxWidth: 300, padding: '14px', background: '#1A1F2E', border: '1px solid #2A3045', borderRadius: 14, color: '#A0A8BC', fontSize: 15, cursor: 'pointer', marginBottom: 10 }}>Назад</button>
        {onGoProfile && <button onClick={onGoProfile} style={{ width: '100%', maxWidth: 300, padding: '14px', background: 'linear-gradient(135deg,#FF6B1A,#FF8C3A)', border: 'none', borderRadius: 14, color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer' }}>Перейти в профіль</button>}
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100dvh', background: '#0F1117', paddingBottom: 40 }}>
      <div style={{ padding: '48px 20px 16px', background: '#0D1018', display: 'flex', alignItems: 'center', gap: 12, position: 'sticky', top: 0, zIndex: 10 }}>
        <button onClick={onBack} style={{ background: 'rgba(255,255,255,.08)', border: 'none', borderRadius: 10, width: 36, height: 36, color: '#fff', fontSize: 18, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>←</button>
        <div style={{ fontSize: 18, fontWeight: 700, color: '#fff' }}>Додати об'єкт</div>
      </div>

      <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {error && error !== 'no_profile' && (
          <div style={{ background: '#EF444422', border: '1px solid #EF444440', borderRadius: 12, padding: '12px 14px', color: '#EF4444', fontSize: 14 }}>{error}</div>
        )}

        <div>
          <label style={lbl}>Назва *</label>
          <input style={inp} value={form.title} onChange={e => update('title', e.target.value)} placeholder="Офіс у центрі" />
        </div>

        <div>
          <label style={lbl}>Тип нерухомості *</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {PROPERTY_TYPES.map(t => (
              <button key={t} onClick={() => update('type', t)} style={{
                background: form.type === t ? '#FF6B1A' : '#1A1F2E',
                border: `1px solid ${form.type === t ? '#FF6B1A' : '#2A3045'}`,
                borderRadius: 20, padding: '7px 14px',
                color: form.type === t ? '#fff' : '#A0A8BC',
                fontSize: 12, fontWeight: form.type === t ? 600 : 400, cursor: 'pointer',
                transition: 'all .15s',
              }}>{t}</button>
            ))}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div><label style={lbl}>Ціна ₴/міс *</label><input style={inp} type="number" value={form.price} onChange={e => update('price', e.target.value)} placeholder="25000" /></div>
          <div><label style={lbl}>Площа м² *</label><input style={inp} type="number" value={form.area} onChange={e => update('area', e.target.value)} placeholder="120" /></div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div><label style={lbl}>Поверх</label><input style={inp} type="number" value={form.floor} onChange={e => update('floor', e.target.value)} placeholder="3" /></div>
          <div><label style={lbl}>Всього поверхів</label><input style={inp} type="number" value={form.totalFloors} onChange={e => update('totalFloors', e.target.value)} placeholder="9" /></div>
        </div>

        <div>
          <label style={lbl}>Район *</label>
          <select style={{ ...inp, appearance: 'none' } as React.CSSProperties} value={form.district} onChange={e => update('district', e.target.value)}>
            {DISTRICTS.filter(d => d !== 'Всі райони').map(d => <option key={d}>{d}</option>)}
          </select>
        </div>

        <div>
          <label style={lbl}>Адреса *</label>
          <input style={inp} value={form.address} onChange={e => update('address', e.target.value)} placeholder="вул. Дерибасівська, 18, Одеса" />
        </div>

        <div>
          <label style={lbl}>Стан приміщення</label>
          <select style={{ ...inp, appearance: 'none' } as React.CSSProperties} value={form.condition} onChange={e => update('condition', e.target.value)}>
            {CONDITIONS.map(c => <option key={c}>{c}</option>)}
          </select>
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={() => update('parking', !form.parking)} style={{
            flex: 1, padding: '12px 8px',
            background: form.parking ? '#FF6B1A22' : '#1A1F2E',
            border: `1px solid ${form.parking ? '#FF6B1A' : '#2A3045'}`,
            borderRadius: 12, color: form.parking ? '#FF6B1A' : '#A0A8BC', fontSize: 13, cursor: 'pointer',
          }}>🅿️ Паркінг</button>
          <button onClick={() => update('separateEntrance', !form.separateEntrance)} style={{
            flex: 1, padding: '12px 8px',
            background: form.separateEntrance ? '#FF6B1A22' : '#1A1F2E',
            border: `1px solid ${form.separateEntrance ? '#FF6B1A' : '#2A3045'}`,
            borderRadius: 12, color: form.separateEntrance ? '#FF6B1A' : '#A0A8BC', fontSize: 13, cursor: 'pointer',
          }}>🚪 Окремий вхід</button>
        </div>

        <div>
          <label style={lbl}>Опис</label>
          <textarea style={{ ...inp, resize: 'none' } as React.CSSProperties} value={form.description} onChange={e => update('description', e.target.value)} placeholder="Детальний опис приміщення..." rows={4} />
        </div>

        {/* Photos */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <label style={lbl}>Фотографії</label>
            <span style={{ fontSize: 12, color: '#6B7280' }}>{photos.length}/10</span>
          </div>
          {photos.length > 0 && (
            <div style={{ display: 'flex', gap: 8, overflowX: 'auto', marginBottom: 8 }}>
              {photos.map((p, i) => (
                <div key={i} style={{ position: 'relative', flexShrink: 0 }}>
                  <img src={p} style={{ width: 80, height: 80, objectFit: 'cover', borderRadius: 10 }} />
                  <button onClick={() => setPhotos(ph => ph.filter((_, j) => j !== i))} style={{ position: 'absolute', top: -6, right: -6, background: '#EF4444', border: 'none', borderRadius: '50%', width: 20, height: 20, cursor: 'pointer', color: '#fff', fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
                </div>
              ))}
            </div>
          )}
          <input ref={fileRef} type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={e => handleFiles(e.target.files)} />
          <button onClick={() => fileRef.current?.click()} style={{
            width: '100%', padding: '20px',
            background: '#1A1F2E', border: '1px dashed #FF6B1A44', borderRadius: 12,
            cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
          }}>
            <div style={{ fontSize: 24 }}>📷</div>
            <div style={{ fontSize: 13, color: '#FF6B1A', fontWeight: 600 }}>Додати фото</div>
            <div style={{ fontSize: 11, color: '#6B7280' }}>Оберіть до 10 фото — JPG, PNG, WEBP до 10 MB</div>
          </button>
        </div>

        <div>
          <label style={lbl}>Переваги (через кому)</label>
          <input style={inp} value={form.features} onChange={e => update('features', e.target.value)} placeholder="Ліфт, Кондиціонер, Охорона" />
        </div>

        <button onClick={handleSubmit} disabled={loading} style={{
          width: '100%', padding: '16px', marginTop: 4,
          background: loading ? '#6B7280' : 'linear-gradient(135deg,#FF6B1A,#FF8C3A)',
          border: 'none', borderRadius: 14, color: '#fff', fontSize: 16, fontWeight: 700,
          cursor: loading ? 'not-allowed' : 'pointer', boxShadow: loading ? 'none' : '0 4px 20px rgba(255,107,26,.3)',
        }}>
          {loading ? '⏳ Публікація...' : '✅ Опублікувати об\'єкт'}
        </button>
      </div>
    </div>
  )
}
