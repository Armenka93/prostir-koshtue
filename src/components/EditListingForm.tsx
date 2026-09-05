'use client'
import { useState, useRef } from 'react'
import type { ListingData, User } from '@/types'
import { PROPERTY_TYPES, CONDITIONS, DISTRICTS, UTILITIES_OPTIONS, BUILDING_TYPES } from '@/types'
import { dbUploadListingImage } from '@/lib/db'
import { getStatusMeta } from '@/lib/listingStatus'

// Editing an ALREADY-PUBLISHED listing (active/paused/archived/rejected) —
// deliberately NOT the E.2.2 five-step wizard. That wizard (AddListingWizard)
// owns the draft → pending_review lifecycle (autosave, recovery, delete);
// this form is the pre-existing single-screen editor, kept working for
// RequestsScreen/ProfileScreen/DetailScreen's "Редагувати" entry points.
//
// E.2.3: this screen now sends ONLY the fields that actually changed (see
// computeChangedFields below), never a blind full-row payload, and never
// calls onUpdated at all if nothing changed (page.tsx's handleUpdateListing
// is what actually routes to dbUpdateListingForReview for active/paused/
// archived, or dbSubmitListingForReview for rejected — this component
// doesn't need to know which; it just hands over the diff and lets the
// caller decide based on editListing.status, which it already has).
//
// `readOnly` — used for pending_review's "Переглянути" (E.2.3 requirement
// 1: view-only, no edit/delete/archive/resubmit while a listing is being
// moderated). Deliberately implemented as a CSS-level lock (pointer-events:
// none + no footer submit bar) rather than a `disabled` prop threaded
// through every single input — this is a UX affordance for viewing, not a
// security boundary (RLS/the trigger are what actually enforce it
// server-side), so the lighter implementation is proportionate here.

interface Props {
  user: User | null
  editListing: ListingData
  onBack: () => void
  onUpdated: (id: number, data: Partial<ListingData>) => void
  readOnly?: boolean
}

const sanitize = (s: string) => s.replace(/<[^>]*>/g, '').trim()

type FieldErrors = {
  title?: string
  price?: string
  area?: string
  address?: string
}

// The subset of ListingData this form can actually change, in one
// comparable shape — used to detect "nothing actually changed" (E.2.3
// requirement 2: never send an empty/no-op UPDATE, never force
// pending_review for a no-op "edit").
interface ComparableFields {
  title: string; type: string; price: number; area: number
  floor: number | null; totalFloors: number | null
  district: string; address: string; city: string
  condition: string | null; utilities: string | null; buildingType: string | null
  parking: boolean; separateEntrance: boolean
  description: string | null
  images: string[]; features: string[]
}

function arraysEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i])
}

// Returns only the fields that differ, in ListingData's own key names —
// null if nothing changed at all.
function computeChangedFields(original: ComparableFields, current: ComparableFields): Partial<ListingData> | null {
  const changed: Partial<ListingData> = {}
  let any = false
  const setIfDiff = <K extends keyof ComparableFields>(key: K, listingKey: keyof ListingData) => {
    const a = original[key]
    const b = current[key]
    const same = Array.isArray(a) && Array.isArray(b) ? arraysEqual(a, b) : a === b
    if (!same) { (changed as any)[listingKey] = b; any = true }
  }
  setIfDiff('title', 'title')
  setIfDiff('type', 'type')
  setIfDiff('price', 'price')
  setIfDiff('area', 'area')
  setIfDiff('floor', 'floor')
  setIfDiff('totalFloors', 'totalFloors')
  setIfDiff('district', 'district')
  setIfDiff('address', 'address')
  setIfDiff('city', 'city')
  setIfDiff('condition', 'condition')
  setIfDiff('utilities', 'utilities')
  setIfDiff('buildingType', 'buildingType')
  setIfDiff('parking', 'parking')
  setIfDiff('separateEntrance', 'separateEntrance')
  setIfDiff('description', 'description')
  setIfDiff('images', 'images')
  setIfDiff('features', 'features')
  return any ? changed : null
}

export default function EditListingForm({ user, editListing, onBack, onUpdated, readOnly }: Props) {
  const status = editListing.status
  const isRejected = status === 'rejected'
  const isPublished = status === 'active' || status === 'paused' || status === 'archived'
  const statusMeta = getStatusMeta(status)
  // Captured ONCE, at mount — the baseline every later render's live field
  // state is diffed against to detect "did anything actually change".
  const [original] = useState<ComparableFields>(() => ({
    title: editListing.title || '', type: editListing.type || 'Офіс',
    price: editListing.price || 0, area: editListing.area || 0,
    floor: editListing.floor ?? null, totalFloors: editListing.totalFloors ?? null,
    district: editListing.district || '', address: editListing.address || '', city: editListing.city || 'Одеса',
    condition: editListing.condition || null, utilities: editListing.utilities || null, buildingType: editListing.buildingType || null,
    parking: editListing.parking || false, separateEntrance: editListing.separateEntrance || false,
    description: editListing.description || null,
    images: (editListing.images || []).filter(u => u !== '/no-photo.png'),
    features: editListing.features || [],
  }))
  const [title, setTitle] = useState(editListing.title || '')
  const [type, setType] = useState(editListing.type || 'Офіс')
  const [price, setPrice] = useState(String(editListing.price ?? ''))
  const [area, setArea] = useState(String(editListing.area ?? ''))
  const [floor, setFloor] = useState(editListing.floor != null ? String(editListing.floor) : '')
  const [totalFloors, setTotalFloors] = useState(editListing.totalFloors != null ? String(editListing.totalFloors) : '')
  const [district, setDistrict] = useState(editListing.district || 'Приморський')
  const [address, setAddress] = useState(editListing.address || '')
  const [condition, setCondition] = useState(editListing.condition || 'Євроремонт')
  const [utilities, setUtilities] = useState(editListing.utilities || '')
  const [buildingType, setBuildingType] = useState(editListing.buildingType || '')
  const [parking, setParking] = useState(editListing.parking || false)
  const [entrance, setEntrance] = useState(editListing.separateEntrance || false)
  const [description, setDescription] = useState(editListing.description || '')
  const [features, setFeatures] = useState(editListing.features?.join(', ') || '')
  interface PhotoItem { previewUrl: string; uploadedUrl: string | null; uploading: boolean; failed: boolean }
  const [photos, setPhotos] = useState<PhotoItem[]>(() =>
    (editListing.images || []).map(url => ({ previewUrl: url, uploadedUrl: url, uploading: false, failed: false }))
  )
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [photoError, setPhotoError] = useState('')
  const [loading, setLoading] = useState(false)
  const [noChangesNotice, setNoChangesNotice] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  // Same synchronous double-submit guard as the wizard — see
  // AddListingWizard.tsx for the full reasoning (React state's `disabled`
  // isn't guaranteed to commit before a second native click fires).
  const submittingRef = useRef(false)

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
    if (!files || !user) return
    const remaining = 10 - photos.length
    const MAX_SIZE = 10 * 1024 * 1024
    Array.from(files).slice(0, remaining).forEach(file => {
      if (file.size > MAX_SIZE) { setPhotoError(`Файл "${file.name}" більший за 10 MB`); return }
      const previewUrl = URL.createObjectURL(file)
      const entry: PhotoItem = { previewUrl, uploadedUrl: null, uploading: true, failed: false }
      setPhotos(p => [...p, entry])
      dbUploadListingImage(file, user.id).then(url => {
        setPhotos(p => p.map(ph =>
          ph.previewUrl === previewUrl ? { ...ph, uploadedUrl: url, uploading: false, failed: !url } : ph
        ))
      })
    })
  }

  const handleSubmit = () => {
    if (submittingRef.current) return

    const errors: FieldErrors = {}
    const trimmedTitle = title.trim()
    if (!trimmedTitle) errors.title = 'Введіть назву об\'єкту'
    else if (/(.)\1{2,}/i.test(trimmedTitle)) errors.title = 'Назва виглядає некоректно — забагато однакових символів поспіль'

    const priceNum = parseInt(price)
    if (!price || isNaN(priceNum) || priceNum < 100) errors.price = 'Ціна має бути не менше 100 ₴'

    const areaNum = parseInt(area)
    if (!area || isNaN(areaNum) || areaNum < 1 || areaNum > 50000) errors.area = 'Площа має бути від 1 до 50 000 м²'

    if (!address.trim()) errors.address = 'Введіть адресу об\'єкту'

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors)
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
    setNoChangesNotice(false)

    const uploadedPhotoUrls = photos.map(p => p.uploadedUrl).filter((u): u is string => !!u)
    const current: ComparableFields = {
      title: sanitize(title), type,
      price: parseInt(price), area: parseInt(area),
      floor: floor ? parseInt(floor) : null, totalFloors: totalFloors ? parseInt(totalFloors) : null,
      district, address: sanitize(address), city: 'Одеса',
      condition, utilities: utilities || null, buildingType: buildingType || null,
      parking, separateEntrance: entrance,
      description: description.trim() ? sanitize(description) : null,
      images: uploadedPhotoUrls,
      features: features ? features.split(',').map(f => sanitize(f)).filter(Boolean) : [],
    }

    // E.2.3 requirement 2: nothing to send — never an empty UPDATE, never
    // a forced pending_review for a no-op "edit".
    const changed = computeChangedFields(original, current)
    if (!changed) {
      setNoChangesNotice(true)
      return
    }
    // images specifically needs the '/no-photo.png' placeholder restored
    // for the actual payload if the edit really did empty the list — the
    // diff itself compares against the placeholder-free list (matching
    // `original`) so removing-then-not-replacing photos still counts as a
    // real change.
    if (changed.images) changed.images = changed.images.length > 0 ? changed.images : ['/no-photo.png']

    submittingRef.current = true
    setLoading(true)
    onUpdated(editListing.id, changed)
  }

  return (
    <div style={{ minHeight: '100dvh', background: '#0F1117' }}>
      <div style={{
        padding: "44px 20px 14px",
        paddingTop: 'max(44px, env(safe-area-inset-top, 44px))',
        background: '#0D1018',
        display: 'flex', alignItems: 'center', gap: 12,
        position: 'sticky', top: 0, zIndex: 10,
        borderBottom: '1px solid #1E2334',
      }}>
        <button onClick={onBack} style={{ background: '#1A1F2E', border: 'none', borderRadius: 10, width: 36, height: 36, color: '#fff', fontSize: 18, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>←</button>
        <span style={{ fontSize: 18, fontWeight: 700, color: '#fff' }}>{readOnly ? "Перегляд об'єкту" : "Редагувати об'єкт"}</span>
        <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 700, color: statusMeta.color, background: statusMeta.bg, borderRadius: 20, padding: '4px 10px', flexShrink: 0 }}>{statusMeta.label}</span>
      </div>

      <div style={{ padding: '20px 20px 120px', display: 'flex', flexDirection: 'column', gap: 18, ...(readOnly ? { pointerEvents: 'none' as const, opacity: 0.7 } : {}) }}>
        {isRejected && editListing.rejectionReason && (
          <div style={{ background: '#EF444418', border: '1px solid #EF444444', borderRadius: 12, padding: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#EF4444', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '.5px' }}>Причина відхилення</div>
            <div style={{ fontSize: 14, color: '#fff', lineHeight: 1.5 }}>{editListing.rejectionReason}</div>
          </div>
        )}
        {isPublished && !readOnly && (
          <div style={{ background: '#FFB02018', border: '1px solid #FFB02044', borderRadius: 12, padding: 14, fontSize: 13, color: '#FFB020', lineHeight: 1.5 }}>
            ⚠️ Після збереження оголошення буде повторно надіслано на модерацію та тимчасово зникне з каталогу.
          </div>
        )}
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

        <div>
          <label style={lbl}>Район *</label>
          <select style={{ ...inpStyle(false), appearance: 'none' } as React.CSSProperties} value={district} onChange={e => setDistrict(e.target.value)}>
            {DISTRICTS.filter(d => d !== 'Всі райони').map(d => <option key={d}>{d}</option>)}
          </select>
        </div>

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

        <div>
          <label style={lbl}>Стан приміщення</label>
          <select style={{ ...inpStyle(false), appearance: 'none' } as React.CSSProperties} value={condition} onChange={e => setCondition(e.target.value)}>
            {CONDITIONS.map(c => <option key={c}>{c}</option>)}
          </select>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div>
            <label style={lbl}>Комунальні платежі</label>
            <select style={{ ...inpStyle(false), appearance: 'none' } as React.CSSProperties} value={utilities} onChange={e => setUtilities(e.target.value)}>
              <option value="">—</option>
              {UTILITIES_OPTIONS.map(u => <option key={u}>{u}</option>)}
            </select>
          </div>
          <div>
            <label style={lbl}>Тип будівлі</label>
            <select style={{ ...inpStyle(false), appearance: 'none' } as React.CSSProperties} value={buildingType} onChange={e => setBuildingType(e.target.value)}>
              <option value="">—</option>
              {BUILDING_TYPES.map(b => <option key={b}>{b}</option>)}
            </select>
          </div>
        </div>

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

        <div>
          <label style={lbl}>Опис</label>
          <textarea
            style={{ ...inpStyle(false), resize: 'none', minHeight: 100 } as React.CSSProperties}
            value={description} onChange={e => setDescription(e.target.value)}
            placeholder="Детальний опис приміщення..."
            rows={4}
          />
        </div>

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

        <div>
          <label style={lbl}>Переваги (через кому)</label>
          <input style={inpStyle(false)} value={features} onChange={e => setFeatures(e.target.value)} placeholder="Ліфт, Кондиціонер, Охорона, Wi-Fi" />
        </div>
      </div>

      {readOnly ? (
        <div style={{
          position: 'fixed', bottom: 0, left: '50%', transform: 'translateX(-50%)',
          width: '100%', maxWidth: 430,
          padding: '12px 20px',
          paddingBottom: 'max(16px, env(safe-area-inset-bottom, 16px))',
          background: 'linear-gradient(transparent, #0F1117 30%)',
          zIndex: 100,
        }}>
          <div style={{ width: '100%', padding: '16px', background: '#1A1F2E', border: '1px solid #2A3045', borderRadius: 14, color: '#A0A8BC', fontSize: 14, fontWeight: 600, textAlign: 'center' }}>
            👁️ На модерації — редагування недоступне
          </div>
        </div>
      ) : (
        <div style={{
          position: 'fixed', bottom: 0, left: '50%', transform: 'translateX(-50%)',
          width: '100%', maxWidth: 430,
          padding: '12px 20px',
          paddingBottom: 'max(16px, env(safe-area-inset-bottom, 16px))',
          background: 'linear-gradient(transparent, #0F1117 30%)',
          zIndex: 100,
        }}>
          {noChangesNotice && <div style={{ textAlign: 'center', fontSize: 12, color: '#A0A8BC', marginBottom: 8 }}>Немає змін для збереження</div>}
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
              ? (isRejected ? '⏳ Надсилання...' : '⏳ Збереження...')
              : photos.some(p => p.uploading)
                ? '⏳ Завантаження фото...'
                : (isRejected ? '📤 Повторно надіслати на модерацію' : '💾 Зберегти зміни')}
          </button>
        </div>
      )}
    </div>
  )
}
