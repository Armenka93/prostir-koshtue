'use client'
import { useState, useRef, useEffect } from 'react'
import { usePTR } from '@/hooks/usePTR'
import PTRIndicator from './PTRIndicator'
import ConfirmModal from './ConfirmModal'
import EmptyState from './EmptyState'
import type { ListingData, User } from '@/types'

interface Props {
  user: User | null
  isGuest: boolean
  listings: ListingData[]
  onLogin: () => void
  onAddListing: () => void
  onListing: (l: ListingData) => void
  onDelete: (id: number) => void
  onRestore: (id: number) => void
  onPermanentDelete: (id: number) => void
  onEdit: (l: ListingData) => void
  onRefresh?: () => Promise<void>
  onBack?: () => void
}

type ConfirmState = { type: 'archive' | 'permanent'; id: number } | null

// Desktop-only per-card "⋮" management menu (see .requests-desktop-only) —
// mobile keeps its existing always-visible three-button row untouched.
function ManageMenu({ items }: { items: { label: string; onClick: () => void; danger?: boolean }[] }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDocClick = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDocClick); document.removeEventListener('keydown', onKey) }
  }, [open])
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={e => { e.stopPropagation(); setOpen(o => !o) }}
        aria-label="Керувати оголошенням" aria-haspopup="menu" aria-expanded={open}
        style={{ width: 32, height: 32, borderRadius: 8, background: 'rgba(15,17,23,.8)', border: 'none', color: '#fff', fontSize: 16, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      >⋮</button>
      {open && (
        <div role="menu" style={{ position: 'absolute', top: 38, right: 0, background: '#1A1F2E', border: '1px solid #2A3045', borderRadius: 12, padding: 6, minWidth: 190, boxShadow: '0 8px 24px rgba(0,0,0,.4)', zIndex: 5 }}>
          {items.map(item => (
            <button
              key={item.label} role="menuitem"
              onClick={e => { e.stopPropagation(); setOpen(false); item.onClick() }}
              style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', color: item.danger ? '#EF4444' : '#fff', fontSize: 14, padding: '10px 12px', borderRadius: 8, cursor: 'pointer' }}
            >{item.label}</button>
          ))}
        </div>
      )}
    </div>
  )
}

export default function RequestsScreen({ user, isGuest, listings, onLogin, onAddListing, onListing, onDelete, onRestore, onPermanentDelete, onEdit, onRefresh, onBack }: Props) {
  const ptr = usePTR(onRefresh)
  const [tab, setTab] = useState<'active' | 'archive'>('active')
  const [confirmState, setConfirmState] = useState<ConfirmState>(null)
  const mineAll = listings.filter(l => {
    if (!user) return false
    // ownerId (listings.owner_id) is the primary check going forward —
    // userId/'me'/ownerName stay as fallbacks for compatibility.
    return l.ownerId === user.id || l.userId === user.id || l.userId === 'me' || l.ownerName === user.name
  })
  const mine = mineAll.filter(l => l.isActive !== false)
  const archived = mineAll.filter(l => l.isActive === false)

  if (!user) {
    return (
      <div className="desktop-wide-screen">
      <div className="desktop-wide-screen-inner">
      <div style={{ paddingBottom: 90 }}>
        <PTRIndicator state={ptr.state} pullY={ptr.pullY} />
        <div style={{ padding: "48px 20px 16px", paddingTop: 'max(48px,env(safe-area-inset-top,48px))', background: '#0D1018', display: 'flex', alignItems: 'center', gap: 10 }}>
          {onBack && (
            <button onClick={onBack} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', padding: '4px 4px 4px 0', display: 'flex', alignItems: 'center' }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
            </button>
          )}
          <div style={{ fontSize: 22, fontWeight: 800, color: '#fff' }}>Мої оголошення</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '60px 24px', textAlign: 'center' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🏢</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#fff', marginBottom: 8 }}>Увійдіть щоб керувати оголошеннями</div>
          <div style={{ fontSize: 14, color: '#A0A8BC', marginBottom: 24, lineHeight: 1.5 }}>Зареєстровані користувачі можуть додавати свої приміщення</div>
          <button onClick={onLogin} style={{ padding: '16px 32px', background: 'linear-gradient(135deg,#FF6B1A,#FF8C3A)', border: 'none', borderRadius: 14, color: '#fff', fontSize: 16, fontWeight: 700, cursor: 'pointer' }}>
            Увійти / Зареєструватись
          </button>
        </div>
      </div>
      </div>
      </div>
    )
  }

  const list = tab === 'active' ? mine : archived

  return (
    <div className="desktop-wide-screen">
    <div className="desktop-wide-screen-inner">
    <div style={{ paddingBottom: 90 }}>
      <PTRIndicator state={ptr.state} pullY={ptr.pullY} />

      <div style={{ padding: "48px 20px 16px", paddingTop: 'max(48px,env(safe-area-inset-top,48px))', background: '#0D1018' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
          {onBack && (
            <button onClick={onBack} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', padding: '4px 4px 4px 0', display: 'flex', alignItems: 'center' }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
            </button>
          )}
          <div style={{ fontSize: 22, fontWeight: 800, color: '#fff' }}>Мої оголошення</div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
          <div>
            <div style={{ fontSize: 13, color: '#A0A8BC', marginTop: 4 }}>
              {mineAll.length > 0 ? `${mine.length} активних` : 'Додайте своє перше приміщення'}
            </div>
          </div>
          {list.length > 0 && (
            <button onClick={onAddListing} style={{ background: 'linear-gradient(135deg,#FF6B1A,#FF8C3A)', border: 'none', borderRadius: 12, color: '#fff', fontSize: 13, fontWeight: 700, padding: '9px 14px', cursor: 'pointer' }}>
              + Додати
            </button>
          )}
        </div>

        {/* Active / Archive tabs — only worth showing once there's something archived */}
        {archived.length > 0 && (
          <div style={{ display: 'flex', gap: 6, marginTop: 14 }}>
            <button onClick={() => setTab('active')} style={{ flex: 1, padding: '8px', background: tab === 'active' ? '#FF6B1A' : '#1A1F2E', border: `1px solid ${tab === 'active' ? '#FF6B1A' : '#2A3045'}`, borderRadius: 10, color: tab === 'active' ? '#fff' : '#A0A8BC', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
              Активні ({mine.length})
            </button>
            <button onClick={() => setTab('archive')} style={{ flex: 1, padding: '8px', background: tab === 'archive' ? '#FF6B1A' : '#1A1F2E', border: `1px solid ${tab === 'archive' ? '#FF6B1A' : '#2A3045'}`, borderRadius: 10, color: tab === 'archive' ? '#fff' : '#A0A8BC', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
              📦 Архів ({archived.length})
            </button>
          </div>
        )}
      </div>

      <div style={{ padding: '4px 20px' }}>
        {list.length === 0 ? (
          tab === 'active' ? (
            <EmptyState
              icon="📋"
              title="Ще немає оголошень"
              subtitle="Додайте приміщення — і орендарі зможуть його знайти"
              primaryAction={{ label: '➕ Додати приміщення', onClick: onAddListing }}
            />
          ) : (
            <EmptyState
              icon="📦"
              title="Архів порожній"
              subtitle="Видалені оголошення потрапляють сюди — їх можна відновити"
            />
          )
        ) : (
        <>
        <div className="requests-mobile-only">
        {list.map(listing => {
            const img = listing.images?.[0] || '/no-photo.png'
            const isArchived = tab === 'archive'
            return (
              <div key={listing.id} style={{ background: '#1A1F2E', borderRadius: 16, overflow: 'hidden', marginBottom: 14, border: '1px solid #2A3045', opacity: isArchived ? 0.75 : 1 }}>
                <div style={{ display: 'flex', gap: 12, padding: 12 }}>
                  <img src={img} alt={listing.title} style={{ width: 90, height: 90, objectFit: 'cover', borderRadius: 10, flexShrink: 0, filter: isArchived ? 'grayscale(60%)' : 'none' }} loading="lazy" />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: '#fff', marginBottom: 4 }}>{listing.title}</div>
                    <div style={{ fontSize: 12, color: '#A0A8BC', marginBottom: 4 }}>📍 {listing.district} • {listing.area} м²</div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: '#FF6B1A', marginBottom: 8 }}>{listing.price.toLocaleString('uk-UA')} ₴/міс</div>
                    {isArchived ? (
                      <span style={{ background: '#6B728022', color: '#A0A8BC', fontSize: 11, fontWeight: 600, borderRadius: 20, padding: '2px 8px' }}>📦 В архіві</span>
                    ) : (
                      <span style={{ background: '#22C55E22', color: '#22C55E', fontSize: 11, fontWeight: 600, borderRadius: 20, padding: '2px 8px' }}>✅ Активне</span>
                    )}
                  </div>
                </div>
                <div style={{ display: 'flex', borderTop: '1px solid #2A3045' }}>
                  {isArchived ? (
                    <>
                      <button onClick={() => onRestore(listing.id)} style={{ flex: 1, padding: '10px', background: 'none', border: 'none', color: '#22C55E', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                        ♻️ Відновити
                      </button>
                      <button onClick={() => setConfirmState({ type: 'permanent', id: listing.id })} style={{ flex: 1, padding: '10px', background: 'none', border: 'none', borderLeft: '1px solid #2A3045', color: '#EF4444', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                        🗑️ Видалити назавжди
                      </button>
                    </>
                  ) : (
                    <>
                      <button onClick={() => onListing(listing)} style={{ flex: 1, padding: '10px', background: 'none', border: 'none', color: '#2A9FD6', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                        👁️ Переглянути
                      </button>
                      <button onClick={() => onEdit(listing)} style={{ flex: 1, padding: '10px', background: 'none', border: 'none', borderLeft: '1px solid #2A3045', color: '#FFB020', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                        ✏️ Редагувати
                      </button>
                      <button onClick={() => setConfirmState({ type: 'archive', id: listing.id })} style={{ flex: 1, padding: '10px', background: 'none', border: 'none', borderLeft: '1px solid #2A3045', color: '#EF4444', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                        📦 Архівувати
                      </button>
                    </>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        <div className="requests-desktop-only">
        {list.map(listing => {
            const img = listing.images?.[0] || '/no-photo.png'
            const isArchived = tab === 'archive'
            return (
              <div key={listing.id} style={{ background: '#1A1F2E', borderRadius: 16, overflow: 'hidden', border: '1px solid #2A3045', opacity: isArchived ? 0.75 : 1, position: 'relative' }}>
                <img src={img} alt={listing.title} style={{ width: '100%', height: 160, objectFit: 'cover', filter: isArchived ? 'grayscale(60%)' : 'none' }} loading="lazy" />
                <div style={{ position: 'absolute', top: 10, right: 10 }}>
                  <ManageMenu items={isArchived ? [
                    { label: '♻️ Відновити', onClick: () => onRestore(listing.id) },
                    { label: '🗑️ Видалити назавжди', onClick: () => setConfirmState({ type: 'permanent', id: listing.id }), danger: true },
                  ] : [
                    { label: '👁️ Переглянути', onClick: () => onListing(listing) },
                    { label: '✏️ Редагувати', onClick: () => onEdit(listing) },
                    { label: '📦 Архівувати', onClick: () => setConfirmState({ type: 'archive', id: listing.id }), danger: true },
                  ]} />
                </div>
                <div style={{ padding: '14px 14px 16px' }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: '#fff', marginBottom: 4 }}>{listing.title}</div>
                  <div style={{ fontSize: 12, color: '#A0A8BC', marginBottom: 4 }}>📍 {listing.district} • {listing.area} м²</div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: '#FF6B1A', marginBottom: 8 }}>{listing.price.toLocaleString('uk-UA')} ₴/міс</div>
                  {isArchived ? (
                    <span style={{ background: '#6B728022', color: '#A0A8BC', fontSize: 11, fontWeight: 600, borderRadius: 20, padding: '2px 8px' }}>📦 В архіві</span>
                  ) : (
                    <span style={{ background: '#22C55E22', color: '#22C55E', fontSize: 11, fontWeight: 600, borderRadius: 20, padding: '2px 8px' }}>✅ Активне</span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
        </>
        )}
      </div>

      {confirmState && (
        <ConfirmModal
          title={confirmState.type === 'archive' ? '📦 Перенести в архів?' : '🗑️ Видалити назавжди?'}
          message={confirmState.type === 'archive'
            ? 'Оголошення зникне з пошуку, але ви зможете відновити його пізніше з архіву.'
            : 'Цю дію не можна скасувати — оголошення буде видалено назавжди.'}
          confirmLabel={confirmState.type === 'archive' ? 'Архівувати' : 'Видалити'}
          danger={confirmState.type === 'permanent'}
          onCancel={() => setConfirmState(null)}
          onConfirm={() => {
            if (confirmState.type === 'archive') onDelete(confirmState.id)
            else onPermanentDelete(confirmState.id)
            setConfirmState(null)
          }}
        />
      )}
    </div>
    </div>
    </div>
  )
}
