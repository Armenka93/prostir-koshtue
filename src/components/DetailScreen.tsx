'use client'
import { useState, useCallback, useEffect, useRef } from 'react'
import type { ListingData, User } from '@/types'
import { TYPE_COLORS, maskPhone, formatPhone, telHref } from '@/types'
import { getOrCreateChat, type ChatRecord } from '@/lib/chats-db'
import { dbIncrementViews, dbGetListingCounters } from '@/lib/db'
import { isMockListingId } from '@/lib/mockData'
import { hasViewedRecently, markViewed } from '@/lib/storage'
import GalleryLightbox from './GalleryLightbox'
import ReportListingModal from './ReportListingModal'

interface Props {
  listing: ListingData
  onBack: () => void
  onFavorite: (id: number) => void
  isFavorite: boolean
  onSimilar: (l: ListingData) => void
  allListings: ListingData[]
  isGuest?: boolean
  onLogin?: () => void
  user?: User | null
  showToast: (m: string) => void
  onOpenChat?: (chat: ChatRecord) => void
  onEdit?: (l: ListingData) => void
  onGoHome?: () => void
}

function FavBtn({ id, isFav, onFav, style }: {
  id: number; isFav: boolean; onFav: (id: number) => void
  style?: React.CSSProperties
}) {
  const [scale, setScale] = useState(1)
  const click = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    setScale(0.75); setTimeout(() => setScale(1.15), 80); setTimeout(() => setScale(1), 180)
    // onFav (= the toggleFav passed down from page.tsx) now handles
    // everything in one atomic place: updating the personal favorites
    // list, writing the +1/-1 delta to Supabase, and showing the toast.
    // DetailScreen no longer needs its own parallel bookkeeping for this.
    onFav(id)
  }, [id, onFav])
  return (
    <button onClick={click} style={{ ...style, transform: `scale(${scale})`, transition: scale === 1 ? 'transform .15s ease-out' : 'transform .08s ease-in' }}>
      <span style={{ fontSize: 18 }}>{isFav ? '❤️' : '🤍'}</span>
    </button>
  )
}

export default function DetailScreen({
  listing, onBack, onFavorite, isFavorite, onSimilar,
  allListings, isGuest, onLogin, user, showToast, onOpenChat, onEdit, onGoHome
}: Props) {
  const [showPhone, setShowPhone] = useState(false)
  const [startingChat, setStartingChat] = useState(false)
  // Local optimistic view count so the number updates instantly without a refetch
  const [localViews, setLocalViews] = useState(listing.views || 0)
  const viewCounted = useRef(false)

  const data = listing
  const tc = TYPE_COLORS[data.type] || '#FF6B1A'
  const similar = allListings.filter(l => l.id !== listing.id && l.type === listing.type).slice(0, 3)
  const images = data.images?.length ? data.images : ['/no-photo.png']
  const isLoggedIn = !!user
  const hasPhone = !!data.ownerPhone
  const isOwn = !!user && (data.ownerId === user.id || data.userId === user.id || data.userId === 'me')
  const maskedPhone = data.ownerPhone ? maskPhone(data.ownerPhone) : '*** *** ****'
  const displayPhone = data.ownerPhone ? formatPhone(data.ownerPhone) : ''
  const phoneHref = data.ownerPhone ? telHref(data.ownerPhone) : ''
  // Uses the shared MOCK_IDS check (see src/lib/mockData.ts) rather than a
  // numeric id threshold. A threshold like `id < 100` wrongly classified
  // real early DB rows (ids 13, 15, ...) as mock, since Postgres's
  // listings_id_seq also starts at 1 — this silently skipped every real
  // view/like write until the sequence happened to pass 100.
  const isMockListing = isMockListingId(data.id)

  // ── Count a view once per screen visit, then re-sync with the DB ──
  // This is the ONLY place that writes/reads from Supabase for this
  // screen now — the like/favorite counter is handled entirely by the
  // parent (page.tsx's toggleFav), so there's nothing here that can
  // race with a button click anymore.
  useEffect(() => {
    if (viewCounted.current) return
    viewCounted.current = true

    // Don't count views on your own listing or on mock/demo listings
    if (isOwn || isMockListing) return

    // Don't count a view from this browser again within 24h — otherwise
    // reloading the page repeatedly inflates the counter meaninglessly.
    if (hasViewedRecently(data.id)) {
      // Still fetch fresh counters even if we don't increment views,
      // so likes shown on open are always accurate from the DB.
      let cancelled = false
      dbGetListingCounters(data.id).then(fresh => {
        if (!cancelled && fresh) {
          setLocalViews(fresh.views)
          baseLikes.current = fresh.likes
          setLikeDelta(0)
        }
      })
      return () => { cancelled = true }
    }
    markViewed(data.id)

    let cancelled = false
    ;(async () => {
      await dbIncrementViews(data.id)
      const fresh = await dbGetListingCounters(data.id)
      if (!cancelled && fresh) {
        setLocalViews(fresh.views)
        baseLikes.current = fresh.likes
        setLikeDelta(0)
      }
    })()

    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.id])

  // Guests are explicitly allowed to reveal the phone number — only
  // starting a chat requires being logged in.
  const handleReveal = () => {
    setShowPhone(true)
  }

  const handleCopyPhone = async () => {
    if (!displayPhone) return
    try {
      await navigator.clipboard.writeText(displayPhone)
      showToast('📋 Номер скопійовано')
    } catch {
      showToast('⚠️ Не вдалося скопіювати номер')
    }
  }

  const handleShare = async () => {
    const url = typeof window !== 'undefined' ? window.location.href : ''
    const shareData = { title: data.title, text: `${data.title} — ${data.price.toLocaleString('uk-UA')} ₴/міс`, url }
    if (typeof navigator !== 'undefined' && navigator.share) {
      try { await navigator.share(shareData) } catch { /* user cancelled — no toast */ }
    } else {
      try {
        await navigator.clipboard.writeText(url)
        showToast('🔗 Посилання скопійовано')
      } catch {
        showToast('⚠️ Не вдалося скопіювати посилання')
      }
    }
  }

  // ── Gallery ──────────────────────────────────────────────────────
  const [activeImageIndex, setActiveImageIndex] = useState(0)
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const galleryOpenerRef = useRef<HTMLElement | null>(null)
  const nextImage = useCallback(() => setActiveImageIndex(i => (i + 1) % images.length), [images.length])
  const prevImage = useCallback(() => setActiveImageIndex(i => (i - 1 + images.length) % images.length), [images.length])
  const openLightbox = (e: React.SyntheticEvent<HTMLElement>) => {
    galleryOpenerRef.current = e.currentTarget
    setLightboxOpen(true)
  }
  const closeLightbox = useCallback(() => {
    setLightboxOpen(false)
    galleryOpenerRef.current?.focus()
  }, [])

  const [reportOpen, setReportOpen] = useState(false)

  // ── Mobile overflow menu (D.2.1) — just "Поскаржитися" for now, kept
  // separate from the main CTAs (back/favorite/phone/chat). Closes on
  // outside click or Escape.
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const mobileMenuRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!mobileMenuOpen) return
    const onDocClick = (e: MouseEvent) => {
      if (mobileMenuRef.current && !mobileMenuRef.current.contains(e.target as Node)) setMobileMenuOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMobileMenuOpen(false) }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [mobileMenuOpen])

  // ── Likes counter ───────────────────────────────────────────────
  // localLikes mirrors `listing.likes` from the DB (the baseline number
  // before any click on this screen), then bumps up/down by exactly one
  // every time `isFavorite` flips. Since `isFavorite` is computed in
  // page.tsx from `favs.includes(id)` — the single source of truth for
  // whether *this* user has favorited the listing — this number can no
  // longer drift out of sync with the actual click that was applied.
  const baseLikes = useRef(listing.likes || 0)
  const prevFav = useRef(isFavorite)
  const [likeDelta, setLikeDelta] = useState(0)
  useEffect(() => {
    if (prevFav.current !== isFavorite) {
      setLikeDelta(d => d + (isFavorite ? 1 : -1))
      prevFav.current = isFavorite
    }
  }, [isFavorite])
  const localLikes = Math.max(0, baseLikes.current + likeDelta)

  // ── Open Supabase chat ────────────────────────────────────
  const handleWriteToSeller = async () => {
    if (!isLoggedIn) { onLogin?.(); return }
    if (isOwn) { showToast('Це ваше оголошення'); return }

    // Prefer ownerId (listings.owner_id, the Supabase Auth uid bridge
    // column) over the old userId — for a listing published before this
    // bridge column existed, userId could be a legacy non-UUID id (or the
    // 'anonymous' placeholder), which would fail to insert into
    // chats.seller_id_uuid (a real uuid column). No 'unknown' placeholder:
    // if there's genuinely no owner, don't create a chat at all.
    const sellerId = data.ownerId || data.userId || ''
    const sellerName = data.ownerName || 'Власник'

    if (!sellerId) {
      showToast('Продавець недоступний')
      return
    }

    setStartingChat(true)
    try {
      const chat = await getOrCreateChat(
        data.id,
        data.title,
        user!.id,
        user!.name,
        sellerId,
        sellerName
      )
      if (chat) {
        showToast('✅ Чат відкрито!')
        onOpenChat?.(chat)
        onBack()
      } else {
        showToast('❌ Помилка створення чату')
      }
    } catch (e) {
      console.error('handleWriteToSeller error:', e)
      showToast('❌ Помилка підключення')
    } finally {
      setStartingChat(false)
    }
  }

  return (
    <div className="desktop-wide-screen">
    <div className="desktop-wide-screen-inner">
    <div className="detail-mobile-only" style={{ paddingBottom: 110 }}>
      {/* Image gallery */}
      <div
        role="button"
        tabIndex={0}
        aria-label="Відкрити фотогалерею"
        onClick={openLightbox}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openLightbox(e) } }}
        style={{ position: 'relative', height: 300, overflow: 'hidden', background: '#1A1F2E', cursor: 'pointer' }}
      >
        <img
          src={images[activeImageIndex]}
          alt={data.title}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
        {images.length > 1 && (
          <div style={{ position: 'absolute', bottom: 12, right: 16, background: 'rgba(0,0,0,.6)', borderRadius: 20, padding: '3px 10px', fontSize: 12, color: '#fff' }}>
            {activeImageIndex + 1}/{images.length}
          </div>
        )}
        <button onClick={(e) => { e.stopPropagation(); onBack() }} style={{
          position: 'absolute', top: 'max(48px, env(safe-area-inset-top, 48px))', left: 16,
          background: 'rgba(15,17,23,0.75)', border: 'none', borderRadius: 12,
          width: 40, height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', fontSize: 18, backdropFilter: 'blur(6px)', color: '#fff', zIndex: 10,
        }}>←</button>
        <div ref={mobileMenuRef} style={{ position: 'absolute', top: 'max(48px, env(safe-area-inset-top, 48px))', right: 64, zIndex: 10 }}>
          <button
            onClick={(e) => { e.stopPropagation(); setMobileMenuOpen(o => !o) }}
            aria-label="Ще дії"
            aria-haspopup="menu"
            aria-expanded={mobileMenuOpen}
            style={{
              background: 'rgba(15,17,23,0.75)', border: 'none', borderRadius: 12,
              width: 40, height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', fontSize: 18, backdropFilter: 'blur(6px)', color: '#fff',
            }}
          >⋯</button>
          {mobileMenuOpen && (
            <div role="menu" style={{ position: 'absolute', top: 46, right: 0, background: '#1A1F2E', border: '1px solid #2A3045', borderRadius: 12, padding: 6, minWidth: 220, boxShadow: '0 8px 24px rgba(0,0,0,.4)' }}>
              <button
                role="menuitem"
                onClick={(e) => { e.stopPropagation(); setMobileMenuOpen(false); setReportOpen(true) }}
                style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', color: '#fff', fontSize: 14, padding: '10px 12px', borderRadius: 8, cursor: 'pointer' }}
              >⚠ Поскаржитися на оголошення</button>
            </div>
          )}
        </div>
        <FavBtn id={listing.id} isFav={isFavorite} onFav={onFavorite} style={{
          position: 'absolute', top: 'max(48px, env(safe-area-inset-top, 48px))', right: 16,
          background: 'rgba(15,17,23,0.75)', border: 'none', borderRadius: 12,
          width: 40, height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', backdropFilter: 'blur(6px)', padding: 0, zIndex: 10,
        }} />
      </div>

      <div style={{ padding: '20px 20px 0' }}>
        {/* Type badge */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
          <span style={{ background: tc + '22', color: tc, fontSize: 12, fontWeight: 600, borderRadius: 20, padding: '3px 10px' }}>{data.type}</span>
          {data.isPromoted && <span style={{ background: '#FFB02022', color: '#FFB020', fontSize: 12, fontWeight: 600, borderRadius: 20, padding: '3px 10px' }}>⭐ ТОП</span>}
        </div>

        <h1 style={{ fontSize: 22, fontWeight: 800, color: '#fff', lineHeight: 1.2, marginBottom: 10 }}>{data.title}</h1>
        <div style={{ fontSize: 26, fontWeight: 900, color: '#FF6B1A', marginBottom: 14 }}>
          {data.price.toLocaleString('uk-UA')} <span style={{ fontSize: 16, fontWeight: 600 }}>₴/міс</span>
        </div>

        {/* Owner card */}
        <div style={{ background: '#1A1F2E', borderRadius: 14, padding: '14px 16px', marginBottom: 16, border: '1px solid #2A3045' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
            <div style={{ width: 44, height: 44, borderRadius: 14, background: 'linear-gradient(135deg,#FF6B1A,#FFB020)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, fontWeight: 700, color: '#fff', flexShrink: 0 }}>
              {(data.ownerName || 'В').charAt(0).toUpperCase()}
            </div>
            <div>
              <div style={{ fontSize: 15, fontWeight: 600, color: '#fff' }}>{data.ownerName || 'Власник'}</div>
              <div style={{ fontSize: 12, color: '#A0A8BC' }}>Власник приміщення</div>
            </div>
          </div>

          {!hasPhone ? (
            <div style={{ width: '100%', padding: '14px', background: '#0F1117', border: '1px dashed #2A3045', borderRadius: 12, color: '#6B7280', fontSize: 13, textAlign: 'center' }}>
              Контактний номер недоступний
            </div>
          ) : showPhone ? (
            <a href={phoneHref} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              width: '100%', padding: '14px', background: 'linear-gradient(135deg,#22C55E,#16A34A)',
              borderRadius: 12, color: '#fff', fontSize: 18, fontWeight: 700, textDecoration: 'none',
              boxShadow: '0 4px 16px rgba(34,197,94,.3)',
            }}>📞 {displayPhone}</a>
          ) : (
            <button onClick={handleReveal} style={{
              width: '100%', padding: '14px', background: '#0F1117', border: '1px solid #2A3045',
              borderRadius: 12, color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            }}>
              <span>📞</span>
              <span style={{ color: '#A0A8BC', letterSpacing: '1px' }}>{maskedPhone}</span>
              <span style={{ background: '#FF6B1A', color: '#fff', fontSize: 11, fontWeight: 700, borderRadius: 6, padding: '2px 8px' }}>
                Показати
              </span>
            </button>
          )}
        </div>

        {/* Stats */}
        <div style={{ background: '#1A1F2E', borderRadius: 14, padding: '12px 16px', display: 'flex', gap: 0, marginBottom: 16, border: '1px solid #2A3045' }}>
          {[
            { icon: '📐', label: 'Площа', value: `${data.area} м²` },
            { icon: '🏗️', label: 'Поверх', value: data.floor ? `${data.floor}/${data.totalFloors}` : '—' },
            { icon: '✨', label: 'Стан', value: data.condition || '—' },
          ].map((item, i) => (
            <div key={item.label} style={{ flex: 1, textAlign: 'center', borderLeft: i > 0 ? '1px solid #2A3045' : 'none' }}>
              <div style={{ fontSize: 18, marginBottom: 3 }}>{item.icon}</div>
              <div style={{ fontSize: 11, color: '#A0A8BC' }}>{item.label}</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#fff' }}>{item.value}</div>
            </div>
          ))}
        </div>

        {/* Address */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 16, padding: '12px 14px', background: '#1A1F2E', borderRadius: 12, border: '1px solid #2A3045' }}>
          <span style={{ fontSize: 16 }}>📍</span>
          <div>
            <div style={{ fontSize: 12, color: '#A0A8BC', marginBottom: 2 }}>Адреса</div>
            <div style={{ fontSize: 14, fontWeight: 500, color: '#fff' }}>{data.address}</div>
          </div>
        </div>

        {/* Description */}
        {data.description && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#fff', marginBottom: 8 }}>Про об'єкт</div>
            <div style={{ fontSize: 14, color: '#A0A8BC', lineHeight: 1.6, overflowWrap: 'anywhere', wordBreak: 'break-word' }}>{data.description}</div>
          </div>
        )}

        {/* Specs */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#fff', marginBottom: 10 }}>Характеристики</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {[
              ['Площа', `${data.area} м²`],
              ['Поверх', data.floor ? `${data.floor} / ${data.totalFloors}` : '—'],
              ['Стан', data.condition || '—'],
              ['Паркінг', data.parking ? '✅ Є' : '❌ Немає'],
              ['Окремий вхід', data.separateEntrance ? '✅ Є' : '❌ Немає'],
              ['Район', data.district],
            ].map(([label, value]) => (
              <div key={label} style={{ background: '#1A1F2E', borderRadius: 10, padding: '10px 12px', border: '1px solid #2A3045' }}>
                <div style={{ fontSize: 11, color: '#6B7280', marginBottom: 3 }}>{label}</div>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#fff' }}>{value}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Features */}
        {data.features?.length > 0 && (
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#fff', marginBottom: 10 }}>Переваги</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {data.features.map(f => (
                <span key={f} style={{ background: '#1A1F2E', border: '1px solid #FF6B1A44', color: '#FF6B1A', fontSize: 12, fontWeight: 500, borderRadius: 20, padding: '5px 12px', maxWidth: '100%', overflowWrap: 'anywhere', wordBreak: 'break-word' }}>✓ {f}</span>
              ))}
            </div>
          </div>
        )}

        {/* View / like counters — now reflect real-time updates */}
        <div style={{ display: 'flex', gap: 16, marginBottom: 20, fontSize: 12, color: '#6B7280' }}>
          <span>👁 {localViews} переглядів</span>
          <span>❤️ {localLikes} вподобань</span>
        </div>

      </div>

      {/* Fixed bottom CTA */}
      <div style={{
        position: 'fixed', bottom: 0, left: '50%', transform: 'translateX(-50%)',
        width: '100%', maxWidth: 430, padding: '12px 20px',
        paddingBottom: 'max(16px, env(safe-area-inset-bottom, 16px))',
        background: 'linear-gradient(transparent, #0F1117 30%)', zIndex: 50,
      }}>
        <div style={{ display: 'flex', gap: 10 }}>
          {/* Phone button */}
          {showPhone ? (
            <a href={phoneHref} style={{ flex: 1, padding: '15px', textAlign: 'center', textDecoration: 'none', background: 'linear-gradient(135deg,#22C55E,#16A34A)', borderRadius: 14, color: '#fff', fontSize: 15, fontWeight: 700, boxShadow: '0 4px 20px rgba(34,197,94,.35)', display: 'block' }}>
              📞 {displayPhone}
            </a>
          ) : (
            <button onClick={handleReveal} style={{ flex: 1, padding: '15px', background: 'linear-gradient(135deg,#FF6B1A,#FF8C3A)', border: 'none', borderRadius: 14, color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer', boxShadow: '0 4px 20px rgba(255,107,26,.35)' }}>
              📞 Показати номер
            </button>
          )}

          {/* Chat button — creates real Supabase chat */}
          {isOwn ? (
            onEdit ? (
              <button onClick={() => onEdit(data)} style={{ padding: '15px 14px', background: '#FFB02022', border: '1px solid #FFB02044', borderRadius: 14, fontSize: 13, color: '#FFB020', fontWeight: 700, textAlign: 'center', lineHeight: 1.2, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
                ✏️ Редагувати
              </button>
            ) : (
              <div style={{ padding: '15px 14px', background: '#1A1F2E', border: '1px solid #2A3045', borderRadius: 14, fontSize: 11, color: '#6B7280', textAlign: 'center', lineHeight: 1.2 }}>
                Ваше<br/>оголошення
              </div>
            )
          ) : (
            <button
              onClick={handleWriteToSeller}
              disabled={startingChat}
              style={{
                padding: '15px 18px', background: startingChat ? '#2A3045' : '#1A1F2E',
                border: '1px solid #2A3045', borderRadius: 14, fontSize: 15,
                cursor: startingChat ? 'default' : 'pointer', color: '#fff',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                minWidth: 52,
              }}
              title="Написати продавцю"
            >
              {startingChat ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#A0A8BC" strokeWidth="2.5" strokeLinecap="round" style={{ animation: 'spin .7s linear infinite' }}>
                  <style>{'@keyframes spin{to{transform:rotate(360deg)}}'}</style>
                  <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>
                </svg>
              ) : '💬'}
            </button>
          )}

          {/* Fav button */}
          <FavBtn id={data.id} isFav={isFavorite} onFav={onFavorite} style={{
            padding: '15px 18px', background: '#1A1F2E', border: '1px solid #2A3045',
            borderRadius: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
          }} />
        </div>
      </div>
    </div>

    {/* ============================================================
        Desktop/tablet layout (>=768px, see .detail-desktop-only in
        globals.css). Shares all state/handlers with the mobile block
        above — only the markup differs. Mobile block above is
        untouched, byte-for-byte, from the pre-D.2 version. */}
    <div className="detail-desktop-only">
      {/* Breadcrumbs + back to catalog */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 0 20px', flexWrap: 'wrap' }}>
        <button onClick={onBack} style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#1A1F2E', border: '1px solid #2A3045', borderRadius: 10, padding: '8px 14px', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
          ← Назад до каталогу
        </button>
        <div style={{ fontSize: 13, color: '#6B7280', display: 'flex', alignItems: 'center', gap: 6 }}>
          {onGoHome && <button onClick={onGoHome} style={{ background: 'none', border: 'none', color: '#6B7280', fontSize: 13, cursor: 'pointer', padding: 0 }}>Головна</button>}
          <span>/</span>
          <button onClick={onBack} style={{ background: 'none', border: 'none', color: '#6B7280', fontSize: 13, cursor: 'pointer', padding: 0 }}>{data.type}</button>
          <span>/</span>
          <span style={{ color: '#A0A8BC', maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{data.title}</span>
        </div>
      </div>

      <div className="detail-desktop-grid">
        {/* Gallery — own grid item so it can be reordered ahead of the
            sidebar on tablet (768-1023px), see .detail-desktop-grid CSS */}
        <div className="detail-gallery-block">
          <div style={{ position: 'relative', borderRadius: 16, overflow: 'hidden', background: '#1A1F2E', marginBottom: images.length > 1 ? 10 : 20 }}>
            <img
              src={images[activeImageIndex]}
              alt={data.title}
              role="button"
              tabIndex={0}
              aria-label="Відкрити фотогалерею"
              onClick={openLightbox}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openLightbox(e) } }}
              style={{ width: '100%', height: 440, objectFit: 'cover', cursor: 'pointer', display: 'block' }}
            />
            <div style={{ position: 'absolute', top: 16, left: 16, display: 'flex', gap: 8 }}>
              <span style={{ background: tc + 'dd', color: '#fff', fontSize: 12, fontWeight: 600, borderRadius: 20, padding: '4px 12px' }}>{data.type}</span>
              {data.isPromoted && <span style={{ background: '#FFB020dd', color: '#fff', fontSize: 12, fontWeight: 600, borderRadius: 20, padding: '4px 12px' }}>⭐ ТОП</span>}
            </div>
            {images.length > 1 && (
              <>
                <button onClick={(e) => { e.stopPropagation(); prevImage() }} aria-label="Попереднє фото" style={{ position: 'absolute', top: '50%', left: 16, transform: 'translateY(-50%)', background: 'rgba(15,17,23,0.75)', border: 'none', borderRadius: 10, width: 40, height: 40, color: '#fff', fontSize: 18, cursor: 'pointer', backdropFilter: 'blur(6px)' }}>‹</button>
                <button onClick={(e) => { e.stopPropagation(); nextImage() }} aria-label="Наступне фото" style={{ position: 'absolute', top: '50%', right: 16, transform: 'translateY(-50%)', background: 'rgba(15,17,23,0.75)', border: 'none', borderRadius: 10, width: 40, height: 40, color: '#fff', fontSize: 18, cursor: 'pointer', backdropFilter: 'blur(6px)' }}>›</button>
                <div style={{ position: 'absolute', bottom: 16, right: 16, background: 'rgba(0,0,0,.6)', borderRadius: 20, padding: '4px 12px', fontSize: 12, color: '#fff' }}>
                  {activeImageIndex + 1}/{images.length}
                </div>
              </>
            )}
          </div>
          {images.length > 1 && (
            <div style={{ display: 'flex', gap: 8, marginBottom: 24, overflowX: 'auto' }}>
              {images.map((src, i) => (
                <img
                  key={i}
                  src={src}
                  alt=""
                  onClick={() => setActiveImageIndex(i)}
                  style={{
                    width: 76, height: 56, objectFit: 'cover', borderRadius: 8, cursor: 'pointer', flexShrink: 0,
                    border: i === activeImageIndex ? '2px solid #FF6B1A' : '2px solid transparent', opacity: i === activeImageIndex ? 1 : 0.6,
                  }}
                />
              ))}
            </div>
          )}
        </div>

        {/* Rest of the content — own grid item, see comment above */}
        <div className="detail-rest-block">
          <h1 style={{ fontSize: 26, fontWeight: 800, color: '#fff', lineHeight: 1.25, marginBottom: 20 }}>{data.title}</h1>

          {/* Stats */}
          <div style={{ background: '#1A1F2E', borderRadius: 14, padding: '14px 18px', display: 'flex', gap: 0, marginBottom: 20, border: '1px solid #2A3045' }}>
            {[
              { icon: '📐', label: 'Площа', value: `${data.area} м²` },
              { icon: '🏗️', label: 'Поверх', value: data.floor ? `${data.floor}/${data.totalFloors}` : '—' },
              { icon: '✨', label: 'Стан', value: data.condition || '—' },
            ].map((item, i) => (
              <div key={item.label} style={{ flex: 1, textAlign: 'center', borderLeft: i > 0 ? '1px solid #2A3045' : 'none' }}>
                <div style={{ fontSize: 20, marginBottom: 4 }}>{item.icon}</div>
                <div style={{ fontSize: 12, color: '#A0A8BC' }}>{item.label}</div>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#fff' }}>{item.value}</div>
              </div>
            ))}
          </div>

          {/* Description */}
          {data.description && (
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 17, fontWeight: 700, color: '#fff', marginBottom: 10 }}>Про об'єкт</div>
              <div style={{ fontSize: 15, color: '#A0A8BC', lineHeight: 1.65, overflowWrap: 'anywhere', wordBreak: 'break-word' }}>{data.description}</div>
            </div>
          )}

          {/* Specs */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 17, fontWeight: 700, color: '#fff', marginBottom: 12 }}>Характеристики</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
              {[
                ['Площа', `${data.area} м²`],
                ['Поверх', data.floor ? `${data.floor} / ${data.totalFloors}` : '—'],
                ['Стан', data.condition || '—'],
                ['Паркінг', data.parking ? '✅ Є' : '❌ Немає'],
                ['Окремий вхід', data.separateEntrance ? '✅ Є' : '❌ Немає'],
                ['Район', data.district],
              ].map(([label, value]) => (
                <div key={label} style={{ background: '#1A1F2E', borderRadius: 10, padding: '12px 14px', border: '1px solid #2A3045' }}>
                  <div style={{ fontSize: 12, color: '#6B7280', marginBottom: 4 }}>{label}</div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: '#fff' }}>{value}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Features */}
          {data.features?.length > 0 && (
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 17, fontWeight: 700, color: '#fff', marginBottom: 12 }}>Переваги</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {data.features.map(f => (
                  <span key={f} style={{ background: '#1A1F2E', border: '1px solid #FF6B1A44', color: '#FF6B1A', fontSize: 13, fontWeight: 500, borderRadius: 20, padding: '6px 14px', maxWidth: '100%', overflowWrap: 'anywhere', wordBreak: 'break-word' }}>✓ {f}</span>
                ))}
              </div>
            </div>
          )}

          {/* Address + map placeholder */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 12, padding: '14px 16px', background: '#1A1F2E', borderRadius: 12, border: '1px solid #2A3045' }}>
              <span style={{ fontSize: 18 }}>📍</span>
              <div>
                <div style={{ fontSize: 12, color: '#A0A8BC', marginBottom: 2 }}>Адреса</div>
                <div style={{ fontSize: 15, fontWeight: 500, color: '#fff' }}>{data.address}</div>
              </div>
            </div>
            <div style={{ height: 220, borderRadius: 12, border: '1px dashed #2A3045', background: '#1A1F2E', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, color: '#6B7280' }}>
              <span style={{ fontSize: 28 }}>🗺️</span>
              <span style={{ fontSize: 13 }}>Карта буде додана пізніше</span>
            </div>
          </div>

          {/* View / like counters */}
          <div style={{ display: 'flex', gap: 16, fontSize: 13, color: '#6B7280' }}>
            <span>👁 {localViews} переглядів</span>
            <span>❤️ {localLikes} вподобань</span>
          </div>
        </div>

        {/* Right column (desktop) / near-top block (tablet) — sticky
            price + contact / management card, see .detail-sidebar-sticky
            and the tablet-only order override in globals.css */}
        <div className="detail-sidebar-sticky">
          <div style={{ background: '#1A1F2E', borderRadius: 16, padding: '22px', border: '1px solid #2A3045' }}>
            <div style={{ fontSize: 28, fontWeight: 900, color: '#FF6B1A', marginBottom: 18 }}>
              {data.price.toLocaleString('uk-UA')} <span style={{ fontSize: 16, fontWeight: 600 }}>₴/міс</span>
            </div>

            {isOwn ? (
              <>
                <div style={{ fontSize: 14, color: '#A0A8BC', marginBottom: 14 }}>Це ваше оголошення</div>
                {onEdit && (
                  <button onClick={() => onEdit(data)} style={{ width: '100%', padding: '14px', background: '#FFB02022', border: '1px solid #FFB02044', borderRadius: 12, fontSize: 14, color: '#FFB020', fontWeight: 700, cursor: 'pointer', marginBottom: 10 }}>
                    ✏️ Редагувати оголошення
                  </button>
                )}
              </>
            ) : (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
                  <div style={{ width: 44, height: 44, borderRadius: 14, background: 'linear-gradient(135deg,#FF6B1A,#FFB020)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, fontWeight: 700, color: '#fff', flexShrink: 0 }}>
                    {(data.ownerName || 'В').charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 600, color: '#fff' }}>{data.ownerName || 'Власник'}</div>
                    <div style={{ fontSize: 12, color: '#A0A8BC' }}>Власник приміщення</div>
                  </div>
                </div>

                {!hasPhone ? (
                  <div style={{ width: '100%', padding: '14px', background: '#0F1117', border: '1px dashed #2A3045', borderRadius: 12, color: '#6B7280', fontSize: 13, textAlign: 'center', marginBottom: 10 }}>
                    Контактний номер недоступний
                  </div>
                ) : showPhone ? (
                  <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                    <a href={phoneHref} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '14px', background: 'linear-gradient(135deg,#22C55E,#16A34A)', borderRadius: 12, color: '#fff', fontSize: 15, fontWeight: 700, textDecoration: 'none' }}>
                      📞 {displayPhone}
                    </a>
                    <button onClick={handleCopyPhone} aria-label="Копіювати номер" title="Копіювати номер" style={{ padding: '14px', background: '#0F1117', border: '1px solid #2A3045', borderRadius: 12, color: '#fff', cursor: 'pointer', fontSize: 16 }}>📋</button>
                  </div>
                ) : (
                  <button onClick={handleReveal} style={{ width: '100%', padding: '14px', background: 'linear-gradient(135deg,#FF6B1A,#FF8C3A)', border: 'none', borderRadius: 12, color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer', marginBottom: 10 }}>
                    📞 Показати номер
                  </button>
                )}

                <button
                  onClick={handleWriteToSeller}
                  disabled={startingChat}
                  style={{ width: '100%', padding: '14px', background: startingChat ? '#2A3045' : '#0F1117', border: '1px solid #2A3045', borderRadius: 12, color: '#fff', fontSize: 14, fontWeight: 600, cursor: startingChat ? 'default' : 'pointer', marginBottom: 10 }}
                >
                  {startingChat ? 'Відкриваємо чат…' : (isLoggedIn ? '💬 Написати продавцю' : '💬 Написати (потрібен вхід)')}
                </button>
              </>
            )}

            <div style={{ display: 'flex', gap: 8 }}>
              <FavBtn id={data.id} isFav={isFavorite} onFav={onFavorite} style={{ flex: 1, padding: '12px', background: '#0F1117', border: '1px solid #2A3045', borderRadius: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }} />
              <button onClick={handleShare} title="Поділитися" style={{ flex: 1, padding: '12px', background: '#0F1117', border: '1px solid #2A3045', borderRadius: 12, color: '#fff', fontSize: 16, cursor: 'pointer' }}>🔗</button>
            </div>

            <button onClick={() => setReportOpen(true)} style={{ width: '100%', marginTop: 14, background: 'none', border: 'none', color: '#6B7280', fontSize: 13, cursor: 'pointer', textAlign: 'center', padding: '4px' }}>
              ⚠ Поскаржитися на оголошення
            </button>
          </div>
        </div>
      </div>
    </div>

    {/* Similar — shared by mobile & desktop, responsive grid */}
    {similar.length > 0 && (
      <div style={{ padding: '0 20px', marginBottom: 20 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: '#fff', marginBottom: 10 }}>Схожі об'єкти</div>
        <div className="detail-similar-row">
          {similar.map(l => (
            <div key={l.id} onClick={() => onSimilar(l)} className="detail-similar-card" style={{ background: '#1A1F2E', borderRadius: 12, overflow: 'hidden', cursor: 'pointer', border: '1px solid #2A3045' }}>
              <img src={l.images?.[0] || '/no-photo.png'} alt={l.title} style={{ width: '100%', height: 90, objectFit: 'cover' }} />
              <div style={{ padding: 8 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#fff', marginBottom: 4, lineHeight: 1.3 }}>{l.title.slice(0, 28)}…</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#FF6B1A' }}>{l.price.toLocaleString('uk-UA')} ₴</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    )}
    </div>

    {lightboxOpen && (
      <GalleryLightbox images={images} initialIndex={activeImageIndex} title={data.title} onIndexChange={setActiveImageIndex} onClose={closeLightbox} />
    )}
    {reportOpen && (
      <ReportListingModal onClose={() => setReportOpen(false)} />
    )}
    </div>
  )
}
