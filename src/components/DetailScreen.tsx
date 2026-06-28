'use client'
import { useState, useCallback, useEffect, useRef } from 'react'
import type { ListingData, User } from '@/types'
import { TYPE_COLORS, maskPhone, formatPhone, telHref } from '@/types'
import { getOrCreateChat } from '@/lib/chats-db'
import { dbIncrementViews, dbAdjustLikes, dbGetListingCounters } from '@/lib/db'

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
  onOpenChat?: (chatId: string) => void
}

function FavBtn({ id, isFav, onFav, style, onToast }: {
  id: number; isFav: boolean; onFav: (id: number) => void
  style?: React.CSSProperties; onToast?: (becameFav: boolean) => void
}) {
  const [scale, setScale] = useState(1)
  const click = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    setScale(0.75); setTimeout(() => setScale(1.15), 80); setTimeout(() => setScale(1), 180)
    onFav(id)
    // isFav reflects state BEFORE the toggle, so the new state is !isFav
    onToast?.(!isFav)
  }, [id, onFav, isFav, onToast])
  return (
    <button onClick={click} style={{ ...style, transform: `scale(${scale})`, transition: scale === 1 ? 'transform .15s ease-out' : 'transform .08s ease-in' }}>
      <span style={{ fontSize: 18 }}>{isFav ? '❤️' : '🤍'}</span>
    </button>
  )
}

export default function DetailScreen({
  listing, onBack, onFavorite, isFavorite, onSimilar,
  allListings, isGuest, onLogin, user, showToast, onOpenChat
}: Props) {
  const [showPhone, setShowPhone] = useState(false)
  const [startingChat, setStartingChat] = useState(false)
  // Local optimistic counters so the numbers update instantly without a refetch
  const [localViews, setLocalViews] = useState(listing.views || 0)
  const [localLikes, setLocalLikes] = useState(listing.likes || 0)
  const viewCounted = useRef(false)
  // Tracks whether the user has clicked the like button during this
  // screen visit, so the async initial-load fetch (views/likes from DB)
  // never overwrites a click that happened while it was in flight.
  const likeClicked = useRef(false)

  const data = listing
  const tc = TYPE_COLORS[data.type] || '#FF6B1A'
  const similar = allListings.filter(l => l.id !== listing.id && l.type === listing.type).slice(0, 3)
  const images = data.images?.length ? data.images : ['https://images.unsplash.com/photo-1497366216548-37526070297c?w=800&q=80']
  const isLoggedIn = !!user
  const hasPhone = !!data.ownerPhone
  const isOwn = !!user && (data.userId === user.id || data.userId === 'me')
  const maskedPhone = data.ownerPhone ? maskPhone(data.ownerPhone) : '*** *** ****'
  const displayPhone = data.ownerPhone ? formatPhone(data.ownerPhone) : ''
  const phoneHref = data.ownerPhone ? telHref(data.ownerPhone) : ''
  const isMockListing = data.id < 100 // mock data has small ids, no real DB row to update

  // ── Count a view once per screen visit, then re-sync with the DB ──
  useEffect(() => {
    if (viewCounted.current) return
    viewCounted.current = true

    // Don't count views on your own listing or on mock/demo listings
    if (isOwn || isMockListing) return

    let cancelled = false
    ;(async () => {
      // 1) Record the view in Supabase (atomic RPC — safe for concurrent users)
      await dbIncrementViews(data.id)
      // 2) Re-fetch the real numbers from the DB so what's shown on screen
      //    always matches what every other user/device will see, instead
      //    of trusting a stale `listing.views` prop from the feed list.
      const fresh = await dbGetListingCounters(data.id)
      // Guard: if the user already clicked the like button while this
      // network round-trip was in flight, don't let this stale response
      // overwrite their optimistic like count — that's what caused the
      // counter to flicker between different numbers.
      if (!cancelled && fresh) {
        setLocalViews(fresh.views)
        if (!likeClicked.current) {
          setLocalLikes(fresh.likes)
        }
      }
    })()

    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.id])

  const handleReveal = () => {
    if (!isLoggedIn) { onLogin?.(); return }
    setShowPhone(true)
  }

  const handleFavToast = async (becameFav: boolean) => {
    showToast(becameFav ? '❤️ Додано в обране' : '💔 Видалено з обраного')
    likeClicked.current = true

    // Show the optimistic number immediately — this is the number we
    // trust going forward, since we know the exact delta we just applied.
    setLocalLikes(v => Math.max(0, v + (becameFav ? 1 : -1)))

    // Skip persisting for mock/demo listings — they have no real DB row
    if (isMockListing) return

    try {
      // Fire-and-forget the DB write. We deliberately do NOT re-fetch
      // and overwrite localLikes afterwards — the optimistic value above
      // is already correct, and re-fetching here is exactly what caused
      // the counter to jump around when combined with the initial-load
      // fetch in the effect above.
      await dbAdjustLikes(data.id, becameFav ? 1 : -1)
    } catch (e) {
      console.error('[handleFavToast] failed to persist like:', e)
    }
  }

  // ── Open Supabase chat ────────────────────────────────────
  const handleWriteToSeller = async () => {
    if (!isLoggedIn) { onLogin?.(); return }
    if (isOwn) { showToast('Це ваше оголошення'); return }

    const sellerId = data.userId || 'unknown'
    const sellerName = data.ownerName || 'Власник'

    if (sellerId === 'unknown' || !sellerId) {
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
        onOpenChat?.(chat.id)
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
    <div style={{ paddingBottom: 110 }}>
      {/* Image gallery */}
      <div style={{ position: 'relative', height: 300, overflow: 'hidden', background: '#1A1F2E' }}>
        <img
          src={images[0]}
          alt={data.title}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
        {images.length > 1 && (
          <div style={{ position: 'absolute', bottom: 12, right: 16, background: 'rgba(0,0,0,.6)', borderRadius: 20, padding: '3px 10px', fontSize: 12, color: '#fff' }}>
            1/{images.length}
          </div>
        )}
        <button onClick={onBack} style={{
          position: 'absolute', top: 'max(48px, env(safe-area-inset-top, 48px))', left: 16,
          background: 'rgba(15,17,23,0.75)', border: 'none', borderRadius: 12,
          width: 40, height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', fontSize: 18, backdropFilter: 'blur(6px)', color: '#fff', zIndex: 10,
        }}>←</button>
        <FavBtn id={listing.id} isFav={isFavorite} onFav={onFavorite} onToast={handleFavToast} style={{
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
                {isLoggedIn ? 'Показати' : 'Увійдіть'}
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
            <div style={{ fontSize: 14, color: '#A0A8BC', lineHeight: 1.6 }}>{data.description}</div>
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
                <span key={f} style={{ background: '#1A1F2E', border: '1px solid #FF6B1A44', color: '#FF6B1A', fontSize: 12, fontWeight: 500, borderRadius: 20, padding: '5px 12px' }}>✓ {f}</span>
              ))}
            </div>
          </div>
        )}

        {/* View / like counters — now reflect real-time updates */}
        <div style={{ display: 'flex', gap: 16, marginBottom: 20, fontSize: 12, color: '#6B7280' }}>
          <span>👁 {localViews} переглядів</span>
          <span>❤️ {localLikes} вподобань</span>
        </div>

        {/* Similar */}
        {similar.length > 0 && (
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#fff', marginBottom: 10 }}>Схожі об'єкти</div>
            <div style={{ display: 'flex', gap: 10, overflowX: 'auto', scrollbarWidth: 'none' }}>
              {similar.map(l => (
                <div key={l.id} onClick={() => onSimilar(l)} style={{ flexShrink: 0, width: 160, background: '#1A1F2E', borderRadius: 12, overflow: 'hidden', cursor: 'pointer', border: '1px solid #2A3045' }}>
                  <img src={l.images?.[0]} alt={l.title} style={{ width: '100%', height: 90, objectFit: 'cover' }} />
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
            <div style={{ padding: '15px 14px', background: '#1A1F2E', border: '1px solid #2A3045', borderRadius: 14, fontSize: 11, color: '#6B7280', textAlign: 'center', lineHeight: 1.2 }}>
              Ваше<br/>оголошення
            </div>
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
          <FavBtn id={data.id} isFav={isFavorite} onFav={onFavorite} onToast={handleFavToast} style={{
            padding: '15px 18px', background: '#1A1F2E', border: '1px solid #2A3045',
            borderRadius: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
          }} />
        </div>
      </div>
    </div>
  )
}
