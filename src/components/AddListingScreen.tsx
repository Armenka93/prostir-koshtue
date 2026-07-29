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
  editListing?: ListingData
  onUpdated?: (id: number, data: Partial<ListingData>) => void
}

const FALLBACK_IMGS: string[] = []
const sanitize = (s: string) => s.replace(/<[^>]*>/g, '').trim()

type FieldErrors = {
  title?: string
  price?: string
  area?: string
  address?: string
}

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
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [photoError, setPhotoError] = useState('')
  const [loading, setLoading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  // Refs for scroll-to-first-error
  const titleRef = useRef<HTMLDivElement>(null)
  const priceRef = useRef<HTMLDivElement>(null)
  const areaRef = useRef<HTMLDivElement>(null)
  const addressRef = useRef<HTMLDivElement>(null)

  const clearError = (field: keyof FieldErrors) =>
    setFieldErrors(prev => { const n = { ...prev }; delete n[field]; return n })

  const inpStyle = (hasError: boolean): React.CSSProperties => ({
    width: '100%', background: '#1A1F2E',
    border: `1px solid ${hasError ? '#EF4444' : '#2A3045'}`,
    borderRadius: 12, padding: '14px 16px', color: '#fff', fontSize: 15,
    fontFamily: 'Inter, sans-serif', outline: 'none', display: 'block',
    boxSizing: 'border-box', WebkitAppearance: 'none' as any,
    transition: 'border-color .15s',
  })
  const lbl: React.CSSProperties = {
    fontSize: 12, color: '#A0A8BC', marginBottom: 6, fontWeight: 600,
    display: 'block', textTransform: 'uppercase' as const, letterSpacing: '.5px',
  }
  const errMsg: React.CSSProperties = {
    fontSize: 12, color: '#EF4444', marginTop: 4, display: 'block',
  }

  const handleFiles = (files: FileList | null) => {
    if (!files) return
    const remaining = 10 - photos.length
    const MAX_SIZE = 10 * 1024 * 1024
    Array.from(files).slice(0, remaining).forEach(file => {
      if (file.size > MAX_SIZE) { setPhotoError(`Файл "${file.name}" більший за 10 MB`); return }
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
    // Validate all required fields at once
    const errors: FieldErrors = {}
    if (!title.trim()) errors.title = 'Введіть назву об\'єкту'
    if (!price || isNaN(parseInt(price)) || parseInt(price) <= 0) errors.price = 'Введіть коректну ціну (більше 0)'
    if (!area || isNaN(parseInt(area)) || parseInt(area) <= 0) errors.area = 'Введіть коректну площу (більше 0)'
    if (!address.trim()) errors.address = 'Введіть адресу об\'єкту'

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors)
      // Scroll to and focus the first invalid field
      const firstRef =
        errors.title ? titleRef :
        errors.price ? priceRef :
        errors.area  ? areaRef  :
        errors.address ? addressRef : null
      if (firstRef?.current) {
        firstRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
        firstRef.current.querySelector('input')?.focus()
      }
      return
    }

    if (photos.some(p => p.uploading)) { setPhotoError('Зачекайте, фото ще завантажуються'); return }
    if (photos.some(p => p.failed)) { setPhotoError('Деякі фото не вдалося завантажити — видаліть їх або спробуйте ще раз'); return }

    setFieldErrors({})
    setPhotoError('')
    setLoading(true)

    const uploadedPhotoUrls = photos.map(p => p.uploadedUrl).filter((u): u is string => !!u)
    const images = uploadedPhotoUrls.length > 0 ? uploadedPhotoUrls : ['/no-photo.png']

    const commonFields = {
      title: sanitize(title),
      type,
      price: parseInt(price),
      area: parseInt(area),
      floor: floor ? parseInt(floor) : null,
      totalFloors: totalFloors ? parseInt(totalFloors) : null,
      district,
      address: sanitize(address),
      city: 'Одеса',
      condition,
      parking,
      separateEntrance: entrance,
      description: description.trim() ? sanitize(description) : null,
      images,
      features: features ? features.split(',').map(f => sanitize(f)).filter(Boolean) : [],
    }

    if (isEdit && editListing) {
      onUpdated?.(editListing.id, commonFields)
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

    onCreated(listingData)
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
        <button onClick={onBack} style={{ background: '#1A1F2E', border: 'none', borderRadius: 10, width: 36, height: 36, color: '#fff', fontSize: 18, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>←</button>
        <span style={{ fontSize: 18, fontWeight: 700, color: '#fff' }}>{isEdit ? 'Редагувати об\'єкт' : 'Додати об\'єкт'}</span>
      </div>

      <div style={{ padding: '20px 20px 120px', display: 'flex', flexDirection: 'column', gap: 18 }}>

        {/* Title */}
        <div ref={titleRef}>
          <label style={lbl}>Назва *</label>
          <input
            style={inpStyle(!!fieldErrors.title)}
            value={title}
            onChange={e => { setTitle(e.target.value); if (fieldErrors.title) clearError('title') }}
            placeholder="Наприклад: Офіс у центрі"
          />
          {fieldErrors.title && <span style={errMsg}>⚠ {fieldErrors.title}</span>}
        </div>

        {/* Type */}
        <div>
          <label style={lbl}>Тип нерухомості *</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {PROPERTY_TYPES.map(t => (
              <button key={t} onClick={() => setType(t)} style={{
                padding: '8px 14px', borderRadius: 20, border: 'none', cursor: 'pointer',
                background: type === t ? '#FF6B1A' : '#1A1F2E',
                color: type === t ? '#fff' : '#A0A8BC',
                fontSize: 13, fontFamily: 'Inter, sans-serif', fontWeight: type === t ? 600 : 400,
                transition: 'all .15s',
              }}>{t}</button>
            ))}
          </div>
        </div>

        {/* Price + Area */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div ref={priceRef}>
            <label style={lbl}>Ціна ₴/міс *</label>
            <input
              style={inpStyle(!!fieldErrors.price)}
              type="number" inputMode="numeric"
              value={price}
              onChange={e => { setPrice(e.target.value); if (fieldErrors.price) clearError('price') }}
              placeholder="25000"
            />
            {fieldErrors.price && <span style={errMsg}>⚠ {fieldErrors.price}</span>}
          </div>
          <div ref={areaRef}>
            <label style={lbl}>Площа м² *</label>
            <input
              style={inpStyle(!!fieldErrors.area)}
              type="number" inputMode="numeric"
              value={area}
              onChange={e => { setArea(e.target.value); if (fieldErrors.area) clearError('area') }}
              placeholder="120"
            />
            {fieldErrors.area && <span style={errMsg}>⚠ {fieldErrors.area}</span>}
          </div>
        </div>

        {/* Floor */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div>
            <label style={lbl}>Поверх</label>
            <input style={inpStyle(false)} type="number" inputMode="numeric" value={floor} onChange={e => setFloor(e.target.value)} placeholder="напр. 3" />
          </div>
          <div>
            <label style={lbl}>Всього поверхів</label>
            <input style={inpStyle(false)} type="number" inputMode="numeric" value={totalFloors} onChange={e => setTotalFloors(e.target.value)} placeholder="напр. 9" />
          </div>
        </div>

        {/* District */}
        <div>
          <label style={lbl}>Район *</label>
          <select style={{ ...inpStyle(false), appearance: 'none' } as React.CSSProperties} value={district} onChange={e => setDistrict(e.target.value)}>
            {DISTRICTS.filter(d => d !== 'Всі райони').map(d => <option key={d}>{d}</option>)}
          </select>
        </div>

        {/* Address */}
        <div ref={addressRef}>
          <label style={lbl}>Адреса *</label>
          <input
            style={inpStyle(!!fieldErrors.address)}
            value={address}
            onChange={e => { setAddress(e.target.value); if (fieldErrors.address) clearError('address') }}
            placeholder="вул. Дерибасівська, 18, Одеса"
            autoComplete="street-address"
          />
          {fieldErrors.address && <span style={errMsg}>⚠ {fieldErrors.address}</span>}
        </div>

        {/* Condition */}
        <div>
          <label style={lbl}>Стан приміщення</label>
          <select style={{ ...inpStyle(false), appearance: 'none' } as React.CSSProperties} value={condition} onChange={e => setCondition(e.target.value)}>
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
            fontSize: 13, cursor: 'pointer', fontFamily: 'Inter, sans-serif', transition: 'all .15s',
          }}>🅿️ Паркінг</button>
          <button onClick={() => setEntrance(e => !e)} style={{
            flex: 1, padding: '12px 8px',
            background: entrance ? '#FF6B1A22' : '#1A1F2E',
            border: `1px solid ${entrance ? '#FF6B1A' : '#2A3045'}`,
            borderRadius: 12, color: entrance ? '#FF6B1A' : '#A0A8BC',
            fontSize: 13, cursor: 'pointer', fontFamily: 'Inter, sans-serif', transition: 'all .15s',
          }}>🚪 Окремий вхід</button>
        </div>

        {/* Description */}
        <div>
          <label style={lbl}>Опис</label>
          <textarea
            style={{ ...inpStyle(false), resize: 'none', minHeight: 100 } as React.CSSProperties}
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
                    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>⏳</div>
                  )}
                  {p.failed && (
                    <div style={{ position: 'absolute', bottom: 2, left: 2, right: 2, fontSize: 9, color: '#fff', background: '#EF4444CC', borderRadius: 4, textAlign: 'center', padding: '1px 0' }}>Помилка</div>
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
          {photoError && <span style={{ ...errMsg, display: 'block', marginBottom: 6 }}>⚠ {photoError}</span>}
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
          <input style={inpStyle(false)} value={features} onChange={e => setFeatures(e.target.value)} placeholder="Ліфт, Кондиціонер, Охорона, Wi-Fi" />
        </div>
      </div>

      {/* Fixed submit button */}
      <div style={{
        position: 'fixed', bottom: 0, left: '50%', transform: 'translateX(-50%)',
        width: '100%', maxWidth: 430,
        padding: '12px 20px',
        paddingBottom: 'max(16px, env(safe-area-inset-bottom, 16px))',
        background: 'linear-gradient(transparent, #0F1117 30%)',
        zIndex: 100,
      }}>
        <button
          onClick={handleSubmit}
          disabled={loading || photos.some(p => p.uploading)}
          style={{
            width: '100%', padding: '16px',
            background: (loading || photos.some(p => p.uploading)) ? '#4B5563' : 'linear-gradient(135deg,#FF6B1A,#FF8C3A)',
            border: 'none', borderRadius: 14, color: '#fff', fontSize: 16, fontWeight: 700,
            cursor: (loading || photos.some(p => p.uploading)) ? 'wait' : 'pointer',
            fontFamily: 'Inter, sans-serif',
            boxShadow: (loading || photos.some(p => p.uploading)) ? 'none' : '0 4px 20px rgba(255,107,26,.35)',
            minHeight: 52, touchAction: 'manipulation',
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
