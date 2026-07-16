'use client'
import { useState, useRef } from 'react'
import type { ListingData, User } from '@/types'
import { PROPERTY_TYPES, CONDITIONS, DISTRICTS } from '@/types'
import { enrichNewListing } from '@/lib/listing-logic'
import { dbUploadListingImage } from '@/lib/db'

interface Props {
  user: User | null
  onBack: () => void
  onCreated: (data: Partial<ListingData>) => void
  onGoProfile?: () => void
  // When set, the form opens pre-filled with this listing's data and
  // submitting calls onUpdated (an UPDATE) instead of onCreated (an INSERT).
  editListing?: ListingData
  onUpdated?: (id: number, data: Partial<ListingData>) => void
}

const FALLBACK_IMGS = [
  'https://images.unsplash.com/photo-1497366216548-37526070297c?w=800&q=80',
  'https://images.unsplash.com/photo-1441986300917-64674bd600d8?w=800&q=80',
  'https://images.unsplash.com/photo-1524758631624-e2822e304c36?w=800&q=80',
  'https://images.unsplash.com/photo-1486325212027-8081e485255e?w=800&q=80',
]

export default function AddListingScreen({ user, onBack, onCreated, onGoProfile, editListing, onUpdated }: Props) {
  const isEdit = !!editListing
  const [title, setTitle] = useState(editListing?.title || '')
  const [type, setType] = useState(editListing?.type || 'Офіс')
  const [price, setPrice] = useState(editListing ? String(editListing.price) : '')
  const [area, setArea] = useState(editListing ? String(editListing.area) : '')
  const [floor, setFloor] = useState(editListing?.floor != null ? String(editListing.floor) : '')
  const [totalFloors, setTotalFloors] = useState(editListing?.totalFloors != null ? String(editListing.totalFloors) : '')
  const [district, setDistrict] = useState(editListing?.district || 'Приморський')
  const [address, setAddress] = useState(editListing?.address || '')
  const [condition, setCondition] = useState(editListing?.condition || 'Євроремонт')
  const [parking, setParking] = useState(editListing?.parking || false)
  const [entrance, setEntrance] = useState(editListing?.separateEntrance || false)
  const [description, setDescription] = useState(editListing?.description || '')
  const [features, setFeatures] = useState(editListing?.features?.join(', ') || '')
  interface PhotoItem { previewUrl: string; uploadedUrl: string | null; uploading: boolean; failed: boolean }
  const [photos, setPhotos] = useState<PhotoItem[]>(() =>
    (editListing?.images || []).map(url => ({ previewUrl: url, uploadedUrl: url, uploading: false, failed: false }))
  )
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const inp: React.CSSProperties = {
    width: '100%', background: '#1A1F2E', border: '1px solid #2A3045',
    borderRadius: 12, padding: '14px 16px', color: '#fff', fontSize: 15,
    fontFamily: 'Inter, sans-serif', outline: 'none', display: 'block',
    boxSizing: 'border-box', WebkitAppearance: 'none' as any,
  }
  const lbl: React.CSSProperties = {
    fontSize: 12, color: '#A0A8BC', marginBottom: 6, fontWeight: 600,
    display: 'block', textTransform: 'uppercase' as const, letterSpacing: '.5px',
  }

  const handleFiles = (files: FileList | null) => {
    if (!files) return
    const remaining = 10 - photos.length
    const MAX_SIZE = 10 * 1024 * 1024 // 10 MB — matches the limit shown in the UI copy below
    Array.from(files).slice(0, remaining).forEach(file => {
      if (file.size > MAX_SIZE) {
        setError(`Файл "${file.name}" більший за 10 MB`)
        return
      }
      // Instant local preview (no network wait) using an object URL, while
      // the real upload to Storage happens in the background.
      const previewUrl = URL.createObjectURL(file)
      const entry: PhotoItem = { previewUrl, uploadedUrl: null, uploading: true, failed: false }
      setPhotos(p => [...p, entry])

      dbUploadListingImage(file, user?.id || 'anonymous').then(url => {
        setPhotos(p => p.map(ph =>
          ph.previewUrl === previewUrl ? { ...ph, uploadedUrl: url, uploading: false, failed: !url } : ph
        ))
      })
    })
  }

  const handleSubmit = () => {
    // Validation
    if (!title.trim()) { setError('Введіть назву об\'єкту'); return }
    if (!price || isNaN(parseInt(price)) || parseInt(price) <= 0) { setError('Введіть коректну ціну'); return }
    if (!area || isNaN(parseInt(area)) || parseInt(area) <= 0) { setError('Введіть коректну площу'); return }
    if (!address.trim()) { setError('Введіть адресу об\'єкту'); return }
    if (photos.some(p => p.uploading)) { setError('Зачекайте, фото ще завантажуються'); return }
    if (photos.some(p => p.failed)) { setError('Деякі фото не вдалося завантажити — видаліть їх або спробуйте ще раз'); return }

    setError('')
    setLoading(true)

    const uploadedPhotoUrls = photos.map(p => p.uploadedUrl).filter((u): u is string => !!u)
    const images = uploadedPhotoUrls.length > 0 ? uploadedPhotoUrls : [FALLBACK_IMGS[Math.floor(Math.random() * FALLBACK_IMGS.length)]]

    const commonFields = {
      title: title.trim(),
      type,
      price: parseInt(price),
      area: parseInt(area),
      floor: floor ? parseInt(floor) : null,
      totalFloors: totalFloors ? parseInt(totalFloors) : null,
      district,
      address: address.trim(),
      city: 'Одеса',
      condition,
      parking,
      separateEntrance: entrance,
      description: description.trim() || null,
      images,
      features: features ? features.split(',').map(f => f.trim()).filter(Boolean) : [],
    }

    if (isEdit && editListing) {
      // Editing: keep everything about the listing's identity/stats/status
      // untouched (id, userId, createdAt, views, likes, isActive, ...) —
      // only the fields the user could actually change in this form.
      onUpdated?.(editListing.id, commonFields)
      // Note: setLoading(false) not needed — component unmounts after onUpdated
      return
    }

    const listingData: Partial<ListingData> = enrichNewListing({
      id: Date.now(),
      userId: user?.id || 'me',
      ...commonFields,
      isActive: true,
      isNew: true,
      isPromoted: false,
      isFeatured: false,
      views: 0, likes: 0, score: 0,
      promotedUntil: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ownerName: user?.name || null,
      ownerPhone: user?.phone || null,
    } as ListingData)

    // Call parent immediately — no async needed (photos are already
    // uploaded to Storage by this point; the listing row only carries
    // their URLs, so this insert is small and fast).
    onCreated(listingData)
    // Note: setLoading(false) not needed — component unmounts after onCreated
  }

  if (!user?.phone) {
    return (
      <div style={{ minHeight: '100dvh', background: '#0F1117', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24, textAlign: 'center' }}>
        <div style={{ fontSize: 48, marginBottom: 20 }}>⚠️</div>
        <div style={{ fontSize: 20, fontWeight: 700, color: '#fff', marginBottom: 12 }}>Потрібен номер телефону</div>
        <div style={{ fontSize: 14, color: '#A0A8BC', lineHeight: 1.6, marginBottom: 24, maxWidth: 300 }}>
          Без номера телефону не можна публікувати об'єкти. Зареєструйтесь з номером телефону.
        </div>
        <button onClick={onBack} style={{ width: '100%', maxWidth: 300, padding: '14px', background: '#1A1F2E', border: '1px solid #2A3045', borderRadius: 14, color: '#A0A8BC', fontSize: 15, cursor: 'pointer', marginBottom: 10 }}>← Назад</button>
        {onGoProfile && <button onClick={onGoProfile} style={{ width: '100%', maxWidth: 300, padding: '14px', background: 'linear-gradient(135deg,#FF6B1A,#FF8C3A)', border: 'none', borderRadius: 14, color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer' }}>Перейти в профіль</button>}
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100dvh', background: '#0F1117' }}>
      {/* Sticky header */}
      <div style={{
        padding: "44px 20px 14px",
        paddingTop: 'max(44px, env(safe-area-inset-top, 44px))',
        background: '#0D1018',
        display: 'flex', alignItems: 'center', gap: 12,
        position: 'sticky', top: 0, zIndex: 10,
        borderBottom: '1px solid #1E2334',
      }}>
        <button onClick={onBack} style={{ background: 'rgba(255,255,255,.08)', border: 'none', borderRadius: 10, width: 36, height: 36, color: '#fff', fontSize: 18, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>←</button>
        <div style={{ fontSize: 18, fontWeight: 700, color: '#fff' }}>{isEdit ? 'Редагувати об\'єкт' : 'Додати об\'єкт'}</div>
      </div>

      {/* Scrollable form */}
      <div style={{
        padding: '16px 20px',
        paddingBottom: 'calc(100px + env(safe-area-inset-bottom, 0px))',
        overflowY: 'auto',
      }}>
        {error && (
          <div style={{ background: '#EF444418', border: '1px solid #EF444440', borderRadius: 12, padding: '12px 14px', marginBottom: 16, color: '#EF4444', fontSize: 14 }}>
            ⚠️ {error}
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Title */}
          <div>
            <label style={lbl}>Назва *</label>
            <input style={inp} value={title} onChange={e => setTitle(e.target.value)} placeholder="Наприклад: Офіс у центрі" />
          </div>

          {/* Type */}
          <div>
            <label style={lbl}>Тип нерухомості *</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {PROPERTY_TYPES.map(t => (
                <button key={t} onClick={() => setType(t)} style={{
                  background: type === t ? '#FF6B1A' : '#1A1F2E',
                  border: `1px solid ${type === t ? '#FF6B1A' : '#2A3045'}`,
                  borderRadius: 20, padding: '7px 14px',
                  color: type === t ? '#fff' : '#A0A8BC',
                  fontSize: 12, fontWeight: type === t ? 600 : 400, cursor: 'pointer',
                  transition: 'all .15s', fontFamily: 'Inter, sans-serif',
                }}>{t}</button>
              ))}
            </div>
          </div>

          {/* Price + Area */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={lbl}>Ціна ₴/міс *</label>
              <input style={inp} type="number" inputMode="numeric" value={price} onChange={e => setPrice(e.target.value)} placeholder="25000" />
            </div>
            <div>
              <label style={lbl}>Площа м² *</label>
              <input style={inp} type="number" inputMode="numeric" value={area} onChange={e => setArea(e.target.value)} placeholder="120" />
            </div>
          </div>

          {/* Floor */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={lbl}>Поверх</label>
              <input style={inp} type="number" inputMode="numeric" value={floor} onChange={e => setFloor(e.target.value)} placeholder="3" />
            </div>
            <div>
              <label style={lbl}>Всього поверхів</label>
              <input style={inp} type="number" inputMode="numeric" value={totalFloors} onChange={e => setTotalFloors(e.target.value)} placeholder="9" />
            </div>
          </div>

          {/* District */}
          <div>
            <label style={lbl}>Район *</label>
            <select style={{ ...inp, appearance: 'none' } as React.CSSProperties} value={district} onChange={e => setDistrict(e.target.value)}>
              {DISTRICTS.filter(d => d !== 'Всі райони').map(d => <option key={d}>{d}</option>)}
            </select>
          </div>

          {/* Address */}
          <div>
            <label style={lbl}>Адреса *</label>
            <input style={inp} value={address} onChange={e => setAddress(e.target.value)} placeholder="вул. Дерибасівська, 18, Одеса" autoComplete="street-address" />
          </div>

          {/* Condition */}
          <div>
            <label style={lbl}>Стан приміщення</label>
            <select style={{ ...inp, appearance: 'none' } as React.CSSProperties} value={condition} onChange={e => setCondition(e.target.value)}>
              {CONDITIONS.map(c => <option key={c}>{c}</option>)}
            </select>
          </div>

          {/* Parking + Entrance */}
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={() => setParking(p => !p)} style={{
              flex: 1, padding: '12px 8px',
              background: parking ? '#FF6B1A22' : '#1A1F2E',
              border: `1px solid ${parking ? '#FF6B1A' : '#2A3045'}`,
              borderRadius: 12, color: parking ? '#FF6B1A' : '#A0A8BC',
              fontSize: 13, cursor: 'pointer', fontFamily: 'Inter, sans-serif',
              transition: 'all .15s',
            }}>🅿️ Паркінг</button>
            <button onClick={() => setEntrance(e => !e)} style={{
              flex: 1, padding: '12px 8px',
              background: entrance ? '#FF6B1A22' : '#1A1F2E',
              border: `1px solid ${entrance ? '#FF6B1A' : '#2A3045'}`,
              borderRadius: 12, color: entrance ? '#FF6B1A' : '#A0A8BC',
              fontSize: 13, cursor: 'pointer', fontFamily: 'Inter, sans-serif',
              transition: 'all .15s',
            }}>🚪 Окремий вхід</button>
          </div>

          {/* Description */}
          <div>
            <label style={lbl}>Опис</label>
            <textarea
              style={{ ...inp, resize: 'none', minHeight: 100 } as React.CSSProperties}
              value={description} onChange={e => setDescription(e.target.value)}
              placeholder="Детальний опис приміщення..."
              rows={4}
            />
          </div>

          {/* Photos */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <label style={{ ...lbl, marginBottom: 0 }}>Фотографії</label>
              <span style={{ fontSize: 12, color: '#6B7280' }}>{photos.length}/10</span>
            </div>
            {photos.length > 0 && (
              <div style={{ display: 'flex', gap: 8, overflowX: 'auto', marginBottom: 8, paddingBottom: 4 }}>
                {photos.map((p, i) => (
                  <div key={i} style={{ position: 'relative', flexShrink: 0 }}>
                    <img src={p.previewUrl} style={{
                      width: 72, height: 72, objectFit: 'cover', borderRadius: 10,
                      opacity: p.uploading ? 0.5 : 1,
                      border: p.failed ? '2px solid #EF4444' : 'none',
                    }} />
                    {p.uploading && (
                      <div style={{
                        position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 20,
                      }}>⏳</div>
                    )}
                    {p.failed && (
                      <div style={{
                        position: 'absolute', bottom: 2, left: 2, right: 2, fontSize: 9, color: '#fff',
                        background: '#EF4444CC', borderRadius: 4, textAlign: 'center', padding: '1px 0',
                      }}>Помилка</div>
                    )}
                    <button onClick={() => setPhotos(ph => ph.filter((_, j) => j !== i))} style={{
                      position: 'absolute', top: -6, right: -6,
                      background: '#EF4444', border: 'none', borderRadius: '50%',
                      width: 20, height: 20, cursor: 'pointer', color: '#fff',
                      fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>✕</button>
                  </div>
                ))}
              </div>
            )}
            <input ref={fileRef} type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={e => handleFiles(e.target.files)} />
            <button onClick={() => fileRef.current?.click()} style={{
              width: '100%', padding: '18px',
              background: '#1A1F2E', border: '1px dashed #FF6B1A44', borderRadius: 12,
              cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
            }}>
              <div style={{ fontSize: 24 }}>📷</div>
              <div style={{ fontSize: 13, color: '#FF6B1A', fontWeight: 600 }}>Додати фото</div>
              <div style={{ fontSize: 11, color: '#6B7280' }}>JPG, PNG, WEBP до 10 MB кожне</div>
            </button>
          </div>

          {/* Features */}
          <div>
            <label style={lbl}>Переваги (через кому)</label>
            <input style={inp} value={features} onChange={e => setFeatures(e.target.value)} placeholder="Ліфт, Кондиціонер, Охорона, Wi-Fi" />
          </div>
        </div>
      </div>

      {/* Fixed submit button — above keyboard on mobile */}
      <div style={{
        position: 'fixed',
        bottom: 0,
        left: '50%',
        transform: 'translateX(-50%)',
        width: '100%',
        maxWidth: 430,
        padding: '12px 20px',
        paddingBottom: 'max(16px, env(safe-area-inset-bottom, 16px))',
        background: 'linear-gradient(transparent, #0F1117 30%)',
        zIndex: 100,
      }}>
        <button
          onClick={handleSubmit}
          disabled={loading || photos.some(p => p.uploading)}
          style={{
            width: '100%',
            padding: '16px',
            background: (loading || photos.some(p => p.uploading)) ? '#4B5563' : 'linear-gradient(135deg,#FF6B1A,#FF8C3A)',
            border: 'none',
            borderRadius: 14,
            color: '#fff',
            fontSize: 16,
            fontWeight: 700,
            cursor: (loading || photos.some(p => p.uploading)) ? 'wait' : 'pointer',
            fontFamily: 'Inter, sans-serif',
            boxShadow: (loading || photos.some(p => p.uploading)) ? 'none' : '0 4px 20px rgba(255,107,26,.35)',
            minHeight: 52,
            touchAction: 'manipulation',
          }}
        >
          {loading
            ? (isEdit ? '⏳ Збереження...' : '⏳ Публікація...')
            : photos.some(p => p.uploading)
              ? '⏳ Завантаження фото...'
              : (isEdit ? '💾 Зберегти зміни' : '✅ Опублікувати об\'єкт')}
        </button>
      </div>
    </div>
  )
}
