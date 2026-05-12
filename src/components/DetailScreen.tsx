'use client'
import { useState, useCallback } from 'react'
import type { ListingData, User } from '@/types'
import { TYPE_COLORS, maskPhone, formatPhone } from '@/types'
import ImageGallery from './ImageGallery'

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
}

function FavBtn({ id, isFav, onFav, style, size = 18 }: { id: number; isFav: boolean; onFav: (id: number) => void; style?: React.CSSProperties; size?: number }) {
  const [scale, setScale] = useState(1)
  const click = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    setScale(0.75); setTimeout(() => setScale(1.15), 80); setTimeout(() => setScale(1), 180)
    onFav(id)
  }, [id, onFav])
  return (
    <button onClick={click} style={{ ...style, transform: `scale(${scale})`, transition: scale === 1 ? 'transform .15s ease-out' : 'transform .08s ease-in', willChange: 'transform' }}>
      <span style={{ fontSize: size }}>{isFav ? '❤️' : '🤍'}</span>
    </button>
  )
}

export default function DetailScreen({ listing, onBack, onFavorite, isFavorite, onSimilar, allListings, isGuest, onLogin, user, showToast }: Props) {
  const [showPhone, setShowPhone] = useState(false)
  const [showMessage, setShowMessage] = useState(false)
  const [msgForm, setMsgForm] = useState({ name: user?.name || '', phone: user?.phone || '', message: '' })
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)

  const data = listing
  const tc = TYPE_COLORS[data.type] || '#FF6B1A'
  const similar = allListings.filter(l => l.id !== listing.id && l.type === listing.type).slice(0, 3)
  const images = data.images?.length ? data.images : ['https://images.unsplash.com/photo-1497366216548-37526070297c?w=800&q=80']
  const isLoggedIn = !!user
  const hasPhone = !!data.ownerPhone
  const isOwn = !!user && data.userId === user.id
  const maskedPhone = data.ownerPhone ? maskPhone(data.ownerPhone) : '*** *** ****'
  const displayPhone = data.ownerPhone ? formatPhone(data.ownerPhone) : ''

  const handleReveal = () => {
    if (!isLoggedIn) { onLogin?.(); return }
    setShowPhone(true)
  }

  const handleSend = async () => {
    if (!msgForm.name || !msgForm.phone) { showToast('Заповніть ім\'я і телефон'); return }
    setSending(true)
    await new Promise(r => setTimeout(r, 800))
    setSent(true)
    setSending(false)
  }

  return (
    <div style={{ paddingBottom: 110 }}>
      {/* Image gallery with swipe */}
      <ImageGallery
        images={images}
        title={data.title}
        height={300}
        topLeft={
          <button onClick={onBack} style={{
            position: 'absolute', top: 48, left: 16,
            background: 'rgba(15,17,23,0.75)', border: 'none', borderRadius: 12,
            width: 40, height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', fontSize: 18, backdropFilter: 'blur(6px)', color: '#fff', zIndex: 10,
          }}>←</button>
        }
        topRight={
          <FavBtn id={listing.id} isFav={isFavorite} onFav={onFavorite} size={18} style={{
            position: 'absolute', top: 48, right: 16,
            background: 'rgba(15,17,23,0.75)', border: 'none', borderRadius: 12,
            width: 40, height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', backdropFilter: 'blur(6px)', padding: 0, zIndex: 10,
          }} />
        }
      />

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
            <div style={{ width: 44, height: 44, borderRadius: 14, background: 'linear-gradient(135deg, #FF6B1A, #FFB020)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, fontWeight: 700, color: '#fff', flexShrink: 0 }}>
              {(data.ownerName || 'В').charAt(0).toUpperCase()}
            </div>
            <div>
              <div style={{ fontSize: 15, fontWeight: 600, color: '#fff' }}>{data.ownerName || 'Власник'}</div>
              <div style={{ fontSize: 12, color: '#A0A8BC' }}>Власник приміщення</div>
            </div>
          </div>
          {!hasPhone ? (
            <div style={{ width: '100%', padding: '14px', background: '#1A1F2E', border: '1px dashed #2A3045', borderRadius: 12, color: '#6B7280', fontSize: 13, textAlign: 'center' }}>
              Контактний номер недоступний
            </div>
          ) : showPhone ? (
            <a href={`tel:${data.ownerPhone!.replace(/\D/g, '')}`} className="fade-in" style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              width: '100%', padding: '14px', background: 'linear-gradient(135deg, #22C55E, #16A34A)',
              border: 'none', borderRadius: 12, color: '#fff', fontSize: 18, fontWeight: 700,
              textDecoration: 'none', boxShadow: '0 4px 16px rgba(34,197,94,0.3)',
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

        {/* Stats row */}
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

        {/* Specs grid */}
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

        {/* Views/likes */}
        <div style={{ display: 'flex', gap: 16, marginBottom: 20, fontSize: 12, color: '#6B7280' }}>
          <span>👁 {data.views || 0} переглядів</span>
          <span>❤️ {data.likes || 0} вподобань</span>
        </div>

        {/* Similar */}
        {similar.length > 0 && (
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#fff', marginBottom: 10 }}>Схожі об'єкти</div>
            <div className="scrollbar-none" style={{ display: 'flex', gap: 10, overflowX: 'auto' }}>
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
      <div style={{ position: 'fixed', bottom: 0, left: '50%', transform: 'translateX(-50%)', width: '100%', maxWidth: 430, padding: '12px 20px 24px', background: 'linear-gradient(transparent, #0F1117 30%)', zIndex: 50 }}>
        <div style={{ display: 'flex', gap: 10 }}>
          {showPhone ? (
            <a href={`tel:${data.ownerPhone?.replace(/\D/g, '')}`} style={{ flex: 1, padding: '15px', textAlign: 'center', textDecoration: 'none', background: 'linear-gradient(135deg, #22C55E, #16A34A)', border: 'none', borderRadius: 14, color: '#fff', fontSize: 15, fontWeight: 700, display: 'block' }}>
              📞 {displayPhone}
            </a>
          ) : (
            <button onClick={handleReveal} style={{ flex: 1, padding: '15px', background: 'linear-gradient(135deg, #FF6B1A, #FF8C3A)', border: 'none', borderRadius: 14, color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer', boxShadow: '0 4px 20px rgba(255,107,26,0.35)' }}>
              📞 Показати номер
            </button>
          )}
          {isOwn ? (
            <div style={{ padding: '15px 14px', background: '#1A1F2E', border: '1px solid #2A3045', borderRadius: 14, fontSize: 11, color: '#6B7280', textAlign: 'center', lineHeight: 1.2 }}>Ваше<br/>оголошення</div>
          ) : (
            <button onClick={() => { if (!isLoggedIn) { onLogin?.(); return } setShowMessage(true) }} style={{ padding: '15px 18px', background: '#1A1F2E', border: '1px solid #2A3045', borderRadius: 14, fontSize: 15, cursor: 'pointer', color: '#fff' }}>💬</button>
          )}
          <FavBtn id={data.id} isFav={isFavorite} onFav={onFavorite} size={18} style={{ padding: '15px 18px', background: '#1A1F2E', border: '1px solid #2A3045', borderRadius: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }} />
        </div>
      </div>

      {/* Message modal */}
      {showMessage && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'flex-end', zIndex: 200, backdropFilter: 'blur(4px)' }} onClick={() => setShowMessage(false)}>
          <div onClick={e => e.stopPropagation()} style={{ width: '100%', background: '#1A1F2E', borderRadius: '24px 24px 0 0', padding: '24px 24px 48px', border: '1px solid #2A3045' }}>
            <div style={{ width: 40, height: 4, background: '#2A3045', borderRadius: 2, margin: '0 auto 24px' }} />
            {sent ? (
              <div style={{ textAlign: 'center', padding: '20px 0' }}>
                <div style={{ fontSize: 48, marginBottom: 16 }}>✅</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: '#fff', marginBottom: 8 }}>Повідомлення надіслано!</div>
                <div style={{ fontSize: 14, color: '#A0A8BC' }}>Власник отримає ваш запит</div>
                <button onClick={() => { setShowMessage(false); setSent(false) }} style={{ marginTop: 20, padding: '14px 24px', background: '#FF6B1A', border: 'none', borderRadius: 12, color: '#fff', fontSize: 15, fontWeight: 600, cursor: 'pointer' }}>Закрити</button>
              </div>
            ) : (
              <>
                <div style={{ fontSize: 18, fontWeight: 700, color: '#fff', marginBottom: 6 }}>Написати власнику</div>
                <div style={{ fontSize: 14, color: '#A0A8BC', marginBottom: 20 }}>{data.title}</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 16 }}>
                  <input placeholder="Ваше ім'я *" value={msgForm.name} onChange={e => setMsgForm(f => ({ ...f, name: e.target.value }))}
                    style={{ width: '100%', background: '#0F1117', border: '1px solid #2A3045', borderRadius: 12, padding: '13px 14px', color: '#fff', fontSize: 14, fontFamily: 'Inter, sans-serif', outline: 'none' }} />
                  <input placeholder="Телефон *" value={msgForm.phone} onChange={e => setMsgForm(f => ({ ...f, phone: e.target.value }))}
                    style={{ width: '100%', background: '#0F1117', border: '1px solid #2A3045', borderRadius: 12, padding: '13px 14px', color: '#fff', fontSize: 14, fontFamily: 'Inter, sans-serif', outline: 'none' }} />
                  <textarea placeholder="Повідомлення" value={msgForm.message} onChange={e => setMsgForm(f => ({ ...f, message: e.target.value }))} rows={3}
                    style={{ width: '100%', background: '#0F1117', border: '1px solid #2A3045', borderRadius: 12, padding: '13px 14px', color: '#fff', fontSize: 14, fontFamily: 'Inter, sans-serif', outline: 'none', resize: 'none' }} />
                </div>
                <button onClick={handleSend} disabled={!msgForm.name || !msgForm.phone || sending} style={{
                  width: '100%', padding: '16px',
                  background: (!msgForm.name || !msgForm.phone || sending) ? '#6B7280' : 'linear-gradient(135deg, #FF6B1A, #FF8C3A)',
                  border: 'none', borderRadius: 14, color: '#fff', fontSize: 16, fontWeight: 700,
                  cursor: (!msgForm.name || !msgForm.phone || sending) ? 'not-allowed' : 'pointer',
                }}>{sending ? '⏳ ...' : '📨 Надіслати'}</button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
