'use client'
import { useState, useRef, useEffect } from 'react'
import { usePTR } from '@/hooks/usePTR'
import PTRIndicator from './PTRIndicator'
import ConfirmModal from './ConfirmModal'
import EmptyState from './EmptyState'
import { getStatusMeta, isLifecycleActionable } from '@/lib/listingStatus'
import type { ListingData, User } from '@/types'

interface Props {
  user: User | null
  isGuest: boolean
  listings: ListingData[]
  onLogin: () => void
  onAddListing: () => void
  onListing: (l: ListingData) => void            // public DetailScreen — active listings only
  onViewReadOnly: (l: ListingData) => void        // pending_review — EditListingForm in read-only mode
  onEdit: (l: ListingData) => void                // active/paused/archived/rejected — EditListingForm, editable
  onContinueDraft: (l: ListingData) => void        // AddListingWizard pinned to this draft's id
  onDeleteDraft: (l: ListingData) => Promise<boolean>
  onPause: (id: number) => Promise<boolean>
  onArchive: (id: number) => Promise<boolean>      // active/paused → archived
  onRestore: (id: number) => Promise<boolean>      // paused/archived → active
  onDeleteArchived: (l: ListingData) => Promise<boolean>
  onRefresh?: () => Promise<void>
  onBack?: () => void
}

// A single, unambiguous confirmation request — one ConfirmModal instance
// for the whole screen (requirement 7), never one per card.
type ConfirmState =
  | { type: 'archive'; id: number }
  | { type: 'delete-draft'; listing: ListingData }
  | { type: 'delete-archived'; listing: ListingData }
  | null

interface ActionItem {
  key: string
  label: string
  onClick: () => void
  danger?: boolean
  color?: string
}

// Desktop-only per-card "⋮" management menu (see .requests-desktop-only) —
// mobile keeps its own always-visible button row (see below). Closes on
// Escape, on an outside click, and (via the shared onClick wrapper each
// item already goes through) right after any action fires.
function ManageMenu({ items, disabled }: { items: ActionItem[]; disabled?: boolean }) {
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
  if (items.length === 0) return null
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={e => { e.stopPropagation(); if (!disabled) setOpen(o => !o) }}
        disabled={disabled}
        aria-label="Керувати оголошенням" aria-haspopup="menu" aria-expanded={open}
        style={{ width: 32, height: 32, borderRadius: 8, background: 'rgba(15,17,23,.8)', border: 'none', color: disabled ? '#4B5563' : '#fff', fontSize: 16, cursor: disabled ? 'default' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      >{disabled ? '⏳' : '⋮'}</button>
      {open && (
        <div role="menu" style={{ position: 'absolute', top: 38, right: 0, background: '#1A1F2E', border: '1px solid #2A3045', borderRadius: 12, padding: 6, minWidth: 210, boxShadow: '0 8px 24px rgba(0,0,0,.4)', zIndex: 5 }}>
          {items.map(item => (
            <button
              key={item.key} role="menuitem"
              onClick={e => { e.stopPropagation(); setOpen(false); item.onClick() }}
              style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', color: item.danger ? '#EF4444' : (item.color || '#fff'), fontSize: 14, padding: '10px 12px', borderRadius: 8, cursor: 'pointer' }}
            >{item.label}</button>
          ))}
        </div>
      )}
    </div>
  )
}

export default function RequestsScreen({
  user, isGuest, listings, onLogin, onAddListing, onListing, onViewReadOnly, onEdit,
  onContinueDraft, onDeleteDraft, onPause, onArchive, onRestore, onDeleteArchived,
  onRefresh, onBack,
}: Props) {
  const ptr = usePTR(onRefresh)
  const [tab, setTab] = useState<'active' | 'archive'>('active')
  const [confirmState, setConfirmState] = useState<ConfirmState>(null)
  // Requirement 8: per-card busy tracking — the ONLY thing that disables a
  // card's own buttons/menu; no other card is affected, and a second click
  // on the same card while its own action is in flight is a no-op (see
  // runBusy below), not a second request.
  const [busyIds, setBusyIds] = useState<Set<number>>(new Set())

  async function runBusy(id: number, action: () => Promise<boolean>) {
    if (busyIds.has(id)) return
    setBusyIds(prev => new Set(prev).add(id))
    try {
      await action()
    } finally {
      setBusyIds(prev => { const n = new Set(prev); n.delete(id); return n })
    }
  }

  const mineAll = listings.filter(l => {
    if (!user) return false
    // ownerId (listings.owner_id) is the primary check going forward —
    // userId/'me'/ownerName stay as fallbacks for compatibility.
    return l.ownerId === user.id || l.userId === user.id || l.userId === 'me' || l.ownerName === user.name
  })

  // status-driven grouping (requirement 1/7) — NOT the old plain is_active
  // split. Every non-archived status (draft/pending_review/rejected/
  // active/paused) lives in the "active" tab together, each rendered with
  // its own status pill and its own allowed actions; only 'archived' goes
  // to the archive tab. A row whose status is still null (pre-Migration-A
  // / not yet backfilled) falls back to the legacy isActive signal so it
  // at least lands in a sensible tab, but see getStatusMeta/
  // isLifecycleActionable below — it never gets lifecycle BUTTONS either
  // way.
  function tabOf(l: ListingData): 'active' | 'archive' {
    if (l.status === 'archived') return 'archive'
    if (l.status != null) return 'active'
    return l.isActive === false ? 'archive' : 'active'
  }
  const mine = mineAll.filter(l => tabOf(l) === 'active')
  const archived = mineAll.filter(l => tabOf(l) === 'archive')

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

  // Requirement 1/6 — the full action matrix, one place. Returns [] for a
  // status this screen has nothing to offer for (pending_review — view
  // only, handled separately below; unknown/null status — lifecycle
  // actions refused outright per requirement 6).
  function buildActions(l: ListingData): ActionItem[] {
    if (!isLifecycleActionable(l.status)) return []
    const busy = busyIds.has(l.id)
    const act = (fn: () => Promise<boolean>) => () => runBusy(l.id, fn)
    switch (l.status) {
      case 'draft':
        return [
          { key: 'continue', label: '✏️ Продовжити заповнення', onClick: () => onContinueDraft(l) },
          { key: 'delete', label: '🗑️ Видалити чернетку', danger: true, onClick: () => setConfirmState({ type: 'delete-draft', listing: l }) },
        ]
      case 'rejected':
        return [
          { key: 'fix', label: '✏️ Виправити', onClick: () => onEdit(l) },
        ]
      case 'active':
        return [
          { key: 'view', label: '👁️ Переглянути', onClick: () => onListing(l) },
          { key: 'edit', label: '✏️ Редагувати', onClick: () => onEdit(l) },
          { key: 'pause', label: '⏸️ Призупинити', onClick: act(() => onPause(l.id)) },
          { key: 'archive', label: '📦 Архівувати', danger: true, onClick: () => setConfirmState({ type: 'archive', id: l.id }) },
        ].map(a => busy ? { ...a, onClick: () => {} } : a)
      case 'paused':
        return [
          { key: 'view', label: '👁️ Переглянути', onClick: () => onListing(l) },
          { key: 'edit', label: '✏️ Редагувати', onClick: () => onEdit(l) },
          { key: 'restore', label: '♻️ Відновити', color: '#22C55E', onClick: act(() => onRestore(l.id)) },
          { key: 'archive', label: '📦 Архівувати', danger: true, onClick: () => setConfirmState({ type: 'archive', id: l.id }) },
        ].map(a => busy ? { ...a, onClick: () => {} } : a)
      case 'archived':
        // "Переглянути" here is deliberately the READ-ONLY view (same
        // callback pending_review uses), not the public DetailScreen — an
        // archived listing is off the market, viewing it must stay inside
        // the owner's own cabinet (requirement 1: "не как публичное
        // объявление").
        return [
          { key: 'view', label: '👁️ Переглянути', onClick: () => onViewReadOnly(l) },
          { key: 'edit', label: '✏️ Редагувати', onClick: () => onEdit(l) },
          { key: 'restore', label: '♻️ Відновити', color: '#22C55E', onClick: act(() => onRestore(l.id)) },
          { key: 'delete', label: '🗑️ Видалити назавжди', danger: true, onClick: () => setConfirmState({ type: 'delete-archived', listing: l }) },
        ].map(a => busy ? { ...a, onClick: () => {} } : a)
      default:
        return []
    }
  }

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
            const meta = getStatusMeta(listing.status)
            const busy = busyIds.has(listing.id)
            const actions = buildActions(listing)
            const isPendingReview = listing.status === 'pending_review'
            return (
              <div key={listing.id} style={{ background: '#1A1F2E', borderRadius: 16, overflow: 'hidden', marginBottom: 14, border: '1px solid #2A3045', opacity: meta.unknown ? 0.6 : 1 }}>
                <div style={{ display: 'flex', gap: 12, padding: 12 }}>
                  <img src={img} alt={listing.title} style={{ width: 90, height: 90, objectFit: 'cover', borderRadius: 10, flexShrink: 0, filter: listing.status === 'archived' ? 'grayscale(60%)' : 'none' }} loading="lazy" />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: '#fff', marginBottom: 4 }}>{listing.title || '(без назви)'}</div>
                    <div style={{ fontSize: 12, color: '#A0A8BC', marginBottom: 4 }}>📍 {listing.district || '—'} {listing.area ? `• ${listing.area} м²` : ''}</div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: '#FF6B1A', marginBottom: 8 }}>{listing.price ? `${listing.price.toLocaleString('uk-UA')} ₴/міс` : '—'}</div>
                    <span style={{ background: meta.bg, color: meta.color, fontSize: 11, fontWeight: 600, borderRadius: 20, padding: '2px 8px' }}>{meta.label}</span>
                  </div>
                </div>
                {listing.status === 'rejected' && listing.rejectionReason && (
                  <div style={{ padding: '0 12px 10px', fontSize: 12, color: '#EF4444', lineHeight: 1.4 }}>
                    Причина: {listing.rejectionReason}
                  </div>
                )}
                {isPendingReview ? (
                  <button onClick={() => onViewReadOnly(listing)} style={{ width: '100%', padding: '10px', background: 'none', border: 'none', borderTop: '1px solid #2A3045', color: '#2A9FD6', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                    👁️ Переглянути (тільки перегляд)
                  </button>
                ) : actions.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', borderTop: '1px solid #2A3045' }}>
                    {actions.map((a, i) => (
                      <button key={a.key} onClick={a.onClick} disabled={busy} style={{
                        flex: '1 1 50%', minWidth: '50%', padding: '10px',
                        background: 'none', border: 'none',
                        borderLeft: i % 2 === 1 ? '1px solid #2A3045' : 'none',
                        borderTop: i >= 2 ? '1px solid #2A3045' : 'none',
                        color: busy ? '#4B5563' : (a.danger ? '#EF4444' : (a.color || '#FFB020')),
                        fontSize: 13, fontWeight: 600, cursor: busy ? 'default' : 'pointer',
                      }}>
                        {busy ? '⏳…' : a.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        <div className="requests-desktop-only">
        {list.map(listing => {
            const img = listing.images?.[0] || '/no-photo.png'
            const meta = getStatusMeta(listing.status)
            const busy = busyIds.has(listing.id)
            const actions = buildActions(listing)
            const isPendingReview = listing.status === 'pending_review'
            return (
              <div key={listing.id} style={{ background: '#1A1F2E', borderRadius: 16, overflow: 'hidden', border: '1px solid #2A3045', opacity: meta.unknown ? 0.6 : 1, position: 'relative' }}>
                <img src={img} alt={listing.title} style={{ width: '100%', height: 160, objectFit: 'cover', filter: listing.status === 'archived' ? 'grayscale(60%)' : 'none' }} loading="lazy" />
                <div style={{ position: 'absolute', top: 10, right: 10 }}>
                  {isPendingReview ? (
                    <button onClick={() => onViewReadOnly(listing)} aria-label="Переглянути" style={{ width: 32, height: 32, borderRadius: 8, background: 'rgba(15,17,23,.8)', border: 'none', color: '#2A9FD6', fontSize: 16, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>👁️</button>
                  ) : (
                    <ManageMenu items={actions} disabled={busy} />
                  )}
                </div>
                <div style={{ padding: '14px 14px 16px' }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: '#fff', marginBottom: 4 }}>{listing.title || '(без назви)'}</div>
                  <div style={{ fontSize: 12, color: '#A0A8BC', marginBottom: 4 }}>📍 {listing.district || '—'} {listing.area ? `• ${listing.area} м²` : ''}</div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: '#FF6B1A', marginBottom: 8 }}>{listing.price ? `${listing.price.toLocaleString('uk-UA')} ₴/міс` : '—'}</div>
                  <span style={{ background: meta.bg, color: meta.color, fontSize: 11, fontWeight: 600, borderRadius: 20, padding: '2px 8px' }}>{meta.label}</span>
                  {listing.status === 'rejected' && listing.rejectionReason && (
                    <div style={{ marginTop: 8, fontSize: 12, color: '#EF4444', lineHeight: 1.4 }}>Причина: {listing.rejectionReason}</div>
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
          title={
            confirmState.type === 'archive' ? '📦 Перенести в архів?' :
            confirmState.type === 'delete-draft' ? '🗑️ Видалити чернетку?' :
            '🗑️ Видалити назавжди?'
          }
          message={
            confirmState.type === 'archive'
              ? 'Оголошення зникне з пошуку, але ви зможете відновити його пізніше з архіву.'
              : confirmState.type === 'delete-draft'
                ? 'Чернетка та всі завантажені фото будуть видалені без можливості відновлення.'
                : 'Цю дію не можна скасувати — оголошення та його фото будуть видалені назавжди.'
          }
          confirmLabel={confirmState.type === 'archive' ? 'Архівувати' : 'Видалити'}
          danger={confirmState.type !== 'archive'}
          onCancel={() => setConfirmState(null)}
          onConfirm={() => {
            const st = confirmState
            setConfirmState(null)
            if (!st) return
            if (st.type === 'archive') runBusy(st.id, () => onArchive(st.id))
            else if (st.type === 'delete-draft') runBusy(st.listing.id, () => onDeleteDraft(st.listing))
            else runBusy(st.listing.id, () => onDeleteArchived(st.listing))
          }}
        />
      )}
    </div>
    </div>
    </div>
  )
}
