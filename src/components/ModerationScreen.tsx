'use client'
import { useState, useEffect, useRef } from 'react'
import type { ListingData, User } from '@/types'
import { isAdmin } from '@/lib/auth'
import { dbGetPendingReviewListings, dbApproveListing, dbRejectListing, ListingLifecycleError } from '@/lib/db'
import { getStatusMeta, messageForLifecycleError } from '@/lib/listingStatus'
import { MIGRATION_B_LIVE } from '@/lib/featureFlags'
import type { PendingReviewCursor } from '@/lib/pendingReviewCursor'
import ConfirmModal from './ConfirmModal'

// ============================================================================
// E.2.4 — кабінет модератора (черга pending_review).
//
// Доступ: requirement 1 — це UX-затвор, не захист. isAdmin(user) (accounts.
// role, той самий стовпець, що перевіряє public.is_admin() на сервері)
// вирішує лише, чи РЕНДЕРИТЬСЯ цей екран взагалі — щоразу, включно з прямою
// спробою відкрити його в обхід кнопки "Модерація" (page.tsx перевіряє це
// незалежно, перш ніж навіть змонтувати цей компонент). Реальний захист —
// RLS ("admin can update/delete/read any listing") і, після Migration B,
// enforce_listing_lifecycle()'s admin-гілка. Жодного service-role ключа тут
// немає і не буде — усі виклики йдуть через звичайний supabase (anon key),
// той самий клієнт, що й решта застосунку.
// ============================================================================

const REJECT_PRESETS = [
  'Фото не відповідають опису приміщення',
  'Неповна або недостовірна інформація',
  'Схоже на дублікат іншого оголошення',
  'Порушення правил сервісу',
]

const PHOTO_PLACEHOLDER = '/no-photo.png'

interface Props {
  user: User | null
  onBack: () => void
  showToast: (msg: string, opts?: { action?: { label: string; onClick: () => void }; duration?: number }) => void
}

type Phase = 'checking' | 'denied' | 'locked' | 'loading' | 'error' | 'ready'

function fmtDateTime(iso: string): string {
  try { return new Date(iso).toLocaleString('uk-UA', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) }
  catch { return iso }
}

// E.2.4 correction — this must show the REAL server-set pending_review_at
// (Migration B's enforce_listing_lifecycle()), never updatedAt or any other
// substitute field. `null` is honest and shown as such: either the schema
// predates Migration B, or (post-B) this is one of the rare anomalous rows
// dbGetPendingReviewListings' anomalousNullCount tracks separately — never
// silently replaced with a different timestamp that would misrepresent
// when the listing actually entered the queue.
function fmtPendingReviewAt(l: ListingData): string {
  return l.pendingReviewAt ? fmtDateTime(l.pendingReviewAt) : '— (немає мітки часу)'
}

export default function ModerationScreen({ user, onBack, showToast }: Props) {
  // Requirement 1: checked FIRST, before any data fetch — a non-admin (or
  // a session that somehow lost its role) never even calls
  // dbGetPendingReviewListings, let alone sees a queue card.
  const admin = isAdmin(user)
  // E.2.4 requirement 3: checked right after the admin gate, still before
  // any data fetch — during the A→B rollout window this screen must not
  // be usable at all, not just show a warning label alongside a working
  // queue. dbApproveListing/dbRejectListing also refuse independently
  // (the real, code-level block); this just avoids ever loading the queue
  // UI in the first place when it can't safely be acted on.
  const [phase, setPhase] = useState<Phase>(!admin ? 'denied' : !MIGRATION_B_LIVE ? 'locked' : 'loading')
  const [items, setItems] = useState<ListingData[]>([])
  const [cursor, setCursor] = useState<PendingReviewCursor | null>(null)
  const [anomalousNullCount, setAnomalousNullCount] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [busyIds, setBusyIds] = useState<Set<number>>(new Set())
  const [selected, setSelected] = useState<ListingData | null>(null)
  const [showApproveConfirm, setShowApproveConfirm] = useState(false)
  const [rejectTarget, setRejectTarget] = useState<ListingData | null>(null)
  const [rejectPreset, setRejectPreset] = useState('')
  const [rejectComment, setRejectComment] = useState('')
  const [rejectSubmitting, setRejectSubmitting] = useState(false)
  const [rejectError, setRejectError] = useState('')

  async function loadFirstPage() {
    setPhase('loading')
    const page = await dbGetPendingReviewListings()
    // A completely empty AND errored fetch both return {items:[],hasMore:
    // false} from dbGetPendingReviewListings — genuinely can't tell them
    // apart from the result alone (it already logs the real reason to
    // console). Given this is an admin-only, low-traffic screen, treating
    // "nothing came back" as the error/retry state (rather than silently
    // showing an empty queue that might just be a failed fetch) is the
    // safer default — an admin who sees "Помилка" and hits refresh loses
    // nothing if the queue really was empty.
    if (page.items.length === 0) {
      setPhase('error')
      return
    }
    setItems(page.items)
    setCursor(page.nextCursor)
    setHasMore(page.hasMore)
    setAnomalousNullCount(page.anomalousNullCount ?? 0)
    setPhase('ready')
  }

  async function loadMore() {
    if (loadingMore || !hasMore) return
    setLoadingMore(true)
    const page = await dbGetPendingReviewListings(cursor)
    setItems(prev => [...prev, ...page.items])
    setCursor(page.nextCursor)
    setHasMore(page.hasMore)
    setLoadingMore(false)
  }

  useEffect(() => {
    if (!admin) { setPhase('denied'); return }
    if (!MIGRATION_B_LIVE) { setPhase('locked'); return }
    loadFirstPage()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [admin])

  async function runBusy(id: number, action: () => Promise<boolean>) {
    if (busyIds.has(id)) return
    setBusyIds(prev => new Set(prev).add(id))
    try { await action() }
    finally { setBusyIds(prev => { const n = new Set(prev); n.delete(id); return n }) }
  }

  async function doApprove(listing: ListingData): Promise<boolean> {
    try {
      const updated = await dbApproveListing(listing.id)
      if (!updated) { showToast('⚠️ Не вдалося опублікувати оголошення.'); return false }
      // Requirement 4: remove from the local queue using the DB's
      // confirmation, not an optimistic guess — `updated` IS that
      // confirmation (status really is 'active' now, server-side).
      setItems(prev => prev.filter(l => l.id !== listing.id))
      setSelected(null)
      showToast('✅ Оголошення опубліковано')
      return true
    } catch (e) {
      if (e instanceof ListingLifecycleError && e.code === 'LISTING_UPDATE_CONFLICT') {
        showToast(messageForLifecycleError(e.code), { action: { label: '🔄 Оновити чергу', onClick: loadFirstPage }, duration: 6000 })
      } else {
        showToast(e instanceof ListingLifecycleError ? messageForLifecycleError(e.code) : '⚠️ Не вдалося опублікувати оголошення.')
      }
      return false
    }
  }

  function openRejectModal(listing: ListingData) {
    setRejectTarget(listing)
    setRejectPreset('')
    setRejectComment('')
    setRejectError('')
  }

  const finalReason = [rejectPreset, rejectComment.trim()].filter(Boolean).join(rejectPreset && rejectComment.trim() ? ' — ' : '')

  async function submitReject() {
    if (!rejectTarget) return
    const reason = finalReason.trim()
    if (!reason) { setRejectError("Вкажіть причину відхилення — це обов'язково"); return }
    if (busyIds.has(rejectTarget.id)) return
    setRejectSubmitting(true)
    setRejectError('')
    setBusyIds(prev => new Set(prev).add(rejectTarget.id))
    try {
      const updated = await dbRejectListing(rejectTarget.id, reason)
      if (!updated) {
        setRejectError('⚠️ Не вдалося відхилити оголошення. Текст причини збережено — спробуйте ще раз.')
        return
      }
      setItems(prev => prev.filter(l => l.id !== rejectTarget.id))
      setSelected(null)
      setRejectTarget(null)
      showToast('🚫 Оголошення відхилено')
    } catch (e) {
      if (e instanceof ListingLifecycleError && e.code === 'LISTING_UPDATE_CONFLICT') {
        setRejectError(messageForLifecycleError(e.code))
      } else {
        // Requirement 5: the typed reason is NEVER lost on error — no
        // field is cleared here, the modal stays open with everything the
        // moderator already typed intact.
        setRejectError(e instanceof ListingLifecycleError ? messageForLifecycleError(e.code) : '⚠️ Сталася помилка. Текст причини збережено — спробуйте ще раз.')
      }
    } finally {
      setRejectSubmitting(false)
      setBusyIds(prev => { const n = new Set(prev); if (rejectTarget) n.delete(rejectTarget.id); return n })
    }
  }

  // ── Access gate (requirement 1) ─────────────────────────────────
  if (phase === 'denied') {
    return (
      <div style={{ minHeight: '100dvh', background: '#0F1117', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24, textAlign: 'center' }}>
        <div style={{ fontSize: 48, marginBottom: 20 }}>🚫</div>
        <div style={{ fontSize: 20, fontWeight: 700, color: '#fff', marginBottom: 12 }}>Доступ заборонено</div>
        <div style={{ fontSize: 14, color: '#A0A8BC', lineHeight: 1.6, marginBottom: 24, maxWidth: 320 }}>
          Цей розділ доступний лише адміністраторам.
        </div>
        <button onClick={onBack} style={{ width: '100%', maxWidth: 300, padding: '14px', background: 'linear-gradient(135deg,#FF6B1A,#FF8C3A)', border: 'none', borderRadius: 14, color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer' }}>← Назад</button>
      </div>
    )
  }

  // ── A→B rollout lockout (requirement 3) — real block, not just a label:
  // the queue is never loaded/rendered while MIGRATION_B_LIVE is false, and
  // approve/reject would refuse independently even if this screen were
  // somehow reached (see dbApproveListing/dbRejectListing).
  if (phase === 'locked') {
    return (
      <div style={{ minHeight: '100dvh', background: '#0F1117', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24, textAlign: 'center' }}>
        <div style={{ fontSize: 48, marginBottom: 20 }}>🚧</div>
        <div style={{ fontSize: 20, fontWeight: 700, color: '#fff', marginBottom: 12 }}>Модерація тимчасово недоступна</div>
        <div style={{ fontSize: 14, color: '#A0A8BC', lineHeight: 1.6, marginBottom: 24, maxWidth: 320 }}>
          Технічні роботи з переходу на нову схему бази даних. Спробуйте пізніше.
        </div>
        <button onClick={onBack} style={{ width: '100%', maxWidth: 300, padding: '14px', background: 'linear-gradient(135deg,#FF6B1A,#FF8C3A)', border: 'none', borderRadius: 14, color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer' }}>← Назад</button>
      </div>
    )
  }

  // ── Detail view (requirement 3) ─────────────────────────────────
  if (selected) {
    const l = selected
    const meta = getStatusMeta(l.status)
    const busy = busyIds.has(l.id)
    return (
      <div className="desktop-wide-screen">
      <div className="desktop-wide-screen-inner">
      <div className="wizard-inner" style={{ minHeight: '100dvh', background: '#0F1117' }}>
        <div style={{ padding: '44px 20px 14px', paddingTop: 'max(44px, env(safe-area-inset-top, 44px))', background: '#0D1018', display: 'flex', alignItems: 'center', gap: 12, position: 'sticky', top: 0, zIndex: 10, borderBottom: '1px solid #1E2334' }}>
          <button onClick={() => setSelected(null)} style={{ background: '#1A1F2E', border: 'none', borderRadius: 10, width: 36, height: 36, color: '#fff', fontSize: 18, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>←</button>
          <span style={{ fontSize: 18, fontWeight: 700, color: '#fff' }}>Перегляд оголошення</span>
          <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 700, color: meta.color, background: meta.bg, borderRadius: 20, padding: '4px 10px', flexShrink: 0 }}>{meta.label}</span>
        </div>

        {/* E.2.4 correction: read-only is achieved by simply not rendering
            any editable control below (no inputs, no onChange handlers) —
            NOT by disabling pointer events on the whole container, which
            would also have blocked scrolling, text selection, and tapping
            into photos to view them full-size. */}
        <div style={{ padding: '20px 20px 140px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ fontSize: 12, color: '#6B7280' }}>Надіслано на модерацію: {fmtPendingReviewAt(l)}</div>

          {l.images && l.images.filter(u => u && u !== PHOTO_PLACEHOLDER).length > 0 ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {l.images.filter(u => u && u !== PHOTO_PLACEHOLDER).map((url, i) => (
                <img key={i} src={url} style={{ width: 110, height: 110, objectFit: 'cover', borderRadius: 10 }} />
              ))}
            </div>
          ) : (
            <div style={{ padding: 16, background: '#1A1F2E', border: '1px solid #EF444444', borderRadius: 12, color: '#EF4444', fontSize: 13 }}>⚠️ Немає фото</div>
          )}

          <div style={{ background: '#1A1F2E', border: '1px solid #2A3045', borderRadius: 14, padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#fff' }}>{l.title || '(без назви)'}</div>
            <div style={{ fontSize: 13, color: '#A0A8BC' }}>{l.type} · {l.district} · {l.address}</div>
            <div style={{ fontSize: 13, color: '#A0A8BC' }}>{l.price ? `${l.price.toLocaleString('uk-UA')} ₴/міс` : '—'} · {l.area ? `${l.area} м²` : '—'}{l.floor ? ` · ${l.floor}${l.totalFloors ? `/${l.totalFloors}` : ''} поверх` : ''}</div>
            <div style={{ fontSize: 13, color: '#A0A8BC' }}>{l.condition || '—'}{l.utilities ? ` · Комунальні: ${l.utilities}` : ''}{l.buildingType ? ` · ${l.buildingType}` : ''}</div>
            <div style={{ fontSize: 13, color: '#A0A8BC' }}>{l.parking ? '🅿️ Паркінг' : ''} {l.separateEntrance ? '🚪 Окремий вхід' : ''}</div>
            {l.features && l.features.length > 0 && <div style={{ fontSize: 13, color: '#A0A8BC' }}>Переваги: {l.features.join(', ')}</div>}
            {l.description && <div style={{ fontSize: 13, color: '#A0A8BC', lineHeight: 1.5 }}>{l.description}</div>}
          </div>

          <div style={{ background: '#1A1F2E', border: '1px solid #2A3045', borderRadius: 14, padding: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 8 }}>Власник</div>
            <div style={{ fontSize: 14, color: '#fff' }}>{l.ownerName || '—'}</div>
            <div style={{ fontSize: 13, color: '#A0A8BC' }}>{l.ownerPhone || '—'}</div>
          </div>
        </div>

        <div className="wizard-footer" style={{ position: 'fixed', bottom: 0, left: '50%', transform: 'translateX(-50%)', width: '100%', padding: '12px 20px', paddingBottom: 'max(16px, env(safe-area-inset-bottom, 16px))', background: 'linear-gradient(transparent, #0F1117 30%)', zIndex: 100, display: 'flex', gap: 10 }}>
          <button
            onClick={() => openRejectModal(l)}
            disabled={busy}
            style={{ flex: 1, padding: '16px', background: busy ? '#4B5563' : '#EF444422', border: '1px solid #EF4444', borderRadius: 14, color: busy ? '#8A93A6' : '#EF4444', fontSize: 15, fontWeight: 700, cursor: busy ? 'default' : 'pointer' }}
          >🚫 Відхилити</button>
          <button
            onClick={() => setShowApproveConfirm(true)}
            disabled={busy}
            style={{ flex: 1, padding: '16px', background: busy ? '#4B5563' : 'linear-gradient(135deg,#22C55E,#16A34A)', border: 'none', borderRadius: 14, color: '#fff', fontSize: 15, fontWeight: 700, cursor: busy ? 'default' : 'pointer' }}
          >{busy ? '⏳…' : '✅ Опублікувати'}</button>
        </div>

        {showApproveConfirm && (
          <ConfirmModal
            title="Опублікувати оголошення?"
            message="Оголошення стане видимим у публічному каталозі."
            confirmLabel="Опублікувати"
            cancelLabel="Скасувати"
            onCancel={() => setShowApproveConfirm(false)}
            onConfirm={() => { setShowApproveConfirm(false); runBusy(l.id, () => doApprove(l)) }}
          />
        )}

        {rejectTarget && (
          <div
            onClick={() => { if (!rejectSubmitting) setRejectTarget(null) }}
            style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,.65)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 24px' }}
          >
            <div onClick={e => e.stopPropagation()} style={{ background: '#141928', border: '1px solid #252D45', borderRadius: 20, padding: '24px 20px', width: '100%', maxWidth: 420, maxHeight: '85vh', overflowY: 'auto' }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: '#fff', marginBottom: 4 }}>Відхилити оголошення</div>
              <div style={{ fontSize: 13, color: '#A0A8BC', marginBottom: 16 }}>«{rejectTarget.title || 'без назви'}»</div>

              <div style={{ fontSize: 12, fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 8 }}>Типова причина</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
                {REJECT_PRESETS.map(p => (
                  <button
                    key={p}
                    onClick={() => setRejectPreset(prev => prev === p ? '' : p)}
                    style={{
                      padding: '7px 12px', borderRadius: 20, border: 'none', cursor: 'pointer',
                      background: rejectPreset === p ? '#EF4444' : '#1A1F2E',
                      color: rejectPreset === p ? '#fff' : '#A0A8BC',
                      fontSize: 12, fontFamily: 'Inter, sans-serif',
                    }}
                  >{p}</button>
                ))}
              </div>

              <div style={{ fontSize: 12, fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 8 }}>Коментар власнику {rejectPreset ? '(необов\'язково)' : ''}</div>
              <textarea
                value={rejectComment}
                onChange={e => { setRejectComment(e.target.value); if (rejectError) setRejectError('') }}
                placeholder="Поясніть детальніше, що потрібно виправити..."
                rows={3}
                style={{ width: '100%', background: '#1A1F2E', border: '1px solid #2A3045', borderRadius: 12, padding: '12px 14px', color: '#fff', fontSize: 14, fontFamily: 'Inter, sans-serif', resize: 'none', outline: 'none', boxSizing: 'border-box', marginBottom: 10 }}
              />

              {finalReason && (
                <div style={{ fontSize: 12, color: '#6B7280', marginBottom: 10, lineHeight: 1.4 }}>
                  Власник побачить: <span style={{ color: '#A0A8BC' }}>«{finalReason}»</span>
                </div>
              )}
              {rejectError && <div style={{ fontSize: 12, color: '#EF4444', marginBottom: 10, lineHeight: 1.4 }}>⚠ {rejectError}</div>}

              <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
                <button onClick={() => setRejectTarget(null)} disabled={rejectSubmitting} style={{ flex: 1, padding: '13px', background: '#1E2438', border: '1px solid #2A3045', borderRadius: 12, color: '#A0A8BC', fontSize: 15, fontWeight: 600, cursor: rejectSubmitting ? 'default' : 'pointer', fontFamily: 'Inter, sans-serif' }}>Скасувати</button>
                <button
                  onClick={submitReject}
                  disabled={rejectSubmitting || !finalReason.trim()}
                  style={{
                    flex: 1, padding: '13px',
                    background: (rejectSubmitting || !finalReason.trim()) ? '#4B5563' : 'linear-gradient(135deg,#EF4444,#DC2626)',
                    border: 'none', borderRadius: 12, color: '#fff', fontSize: 15, fontWeight: 700,
                    cursor: (rejectSubmitting || !finalReason.trim()) ? 'default' : 'pointer', fontFamily: 'Inter, sans-serif',
                  }}
                >{rejectSubmitting ? 'Надсилання…' : 'Відхилити'}</button>
              </div>
            </div>
          </div>
        )}
      </div>
      </div>
      </div>
    )
  }

  // ── Queue ─────────────────────────────────────────────────────
  return (
    <div className="desktop-wide-screen">
    <div className="desktop-wide-screen-inner">
    <div style={{ paddingBottom: 60 }}>
      <div style={{ padding: '48px 20px 16px', paddingTop: 'max(48px,env(safe-area-inset-top,48px))', background: '#0D1018', display: 'flex', alignItems: 'center', gap: 10 }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', padding: '4px 4px 4px 0', display: 'flex', alignItems: 'center' }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <div>
          <div style={{ fontSize: 22, fontWeight: 800, color: '#fff' }}>Модерація</div>
          <div style={{ fontSize: 12, color: '#A0A8BC' }}>{phase === 'ready' ? `${items.length} на розгляді` : ''}</div>
        </div>
      </div>

      {phase === 'ready' && anomalousNullCount > 0 && (
        <div style={{ margin: '10px 20px 0', padding: '10px 14px', background: '#FFB02022', border: '1px solid #FFB02066', borderRadius: 12, color: '#FFB020', fontSize: 12, lineHeight: 1.5 }}>
          ⚠️ Ще {anomalousNullCount} {anomalousNullCount === 1 ? 'оголошення' : 'оголошень'} на модерації без мітки часу подачі (застарілі дані) — не показані в цьому списку, потребують окремої перевірки.
        </div>
      )}

      <div style={{ padding: '4px 20px' }}>
        {phase === 'loading' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {[0, 1, 2].map(i => (
              <div key={i} style={{ height: 100, borderRadius: 16, background: '#1A1F2E', border: '1px solid #2A3045', opacity: 0.6 }} />
            ))}
          </div>
        )}

        {phase === 'error' && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '60px 24px', textAlign: 'center' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>⚠️</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#fff', marginBottom: 8 }}>Не вдалося завантажити чергу</div>
            <div style={{ fontSize: 13, color: '#A0A8BC', marginBottom: 20 }}>Перевірте підключення і спробуйте ще раз</div>
            <button onClick={loadFirstPage} style={{ padding: '12px 24px', background: 'linear-gradient(135deg,#FF6B1A,#FF8C3A)', border: 'none', borderRadius: 12, color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>🔄 Спробувати ще раз</button>
          </div>
        )}

        {phase === 'ready' && items.length === 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '60px 24px', textAlign: 'center' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>✨</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#fff', marginBottom: 8 }}>Черга порожня</div>
            <div style={{ fontSize: 13, color: '#A0A8BC' }}>Немає оголошень, що очікують модерації</div>
          </div>
        )}

        {phase === 'ready' && items.length > 0 && (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {items.map(l => {
                const busy = busyIds.has(l.id)
                const photoCount = (l.images || []).filter(u => u && u !== PHOTO_PLACEHOLDER).length
                return (
                  <div key={l.id} onClick={() => !busy && setSelected(l)} style={{ background: '#1A1F2E', borderRadius: 16, border: '1px solid #2A3045', padding: 12, display: 'flex', gap: 12, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1 }}>
                    <img src={l.images?.[0] || PHOTO_PLACEHOLDER} style={{ width: 84, height: 84, objectFit: 'cover', borderRadius: 10, flexShrink: 0 }} loading="lazy" />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, color: '#fff', marginBottom: 2 }}>{l.title || '(без назви)'}</div>
                      <div style={{ fontSize: 12, color: '#A0A8BC', marginBottom: 2 }}>{l.type} · {l.district}</div>
                      <div style={{ fontSize: 12, color: '#A0A8BC', marginBottom: 4 }}>{l.price ? `${l.price.toLocaleString('uk-UA')} ₴/міс` : '—'} · {l.area ? `${l.area} м²` : '—'} · {photoCount} фото</div>
                      <div style={{ fontSize: 11, color: '#6B7280' }}>👤 {l.ownerName || '—'} · 🕐 {fmtPendingReviewAt(l)}</div>
                    </div>
                    {busy && <div style={{ alignSelf: 'center', fontSize: 18 }}>⏳</div>}
                  </div>
                )
              })}
            </div>
            {hasMore && (
              <div style={{ display: 'flex', justifyContent: 'center', marginTop: 16 }}>
                <button onClick={loadMore} disabled={loadingMore} style={{ padding: '10px 20px', background: '#1A1F2E', border: '1px solid #2A3045', borderRadius: 12, color: '#A0A8BC', fontSize: 13, fontWeight: 600, cursor: loadingMore ? 'default' : 'pointer' }}>
                  {loadingMore ? '⏳ Завантаження…' : 'Завантажити ще'}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
    </div>
    </div>
  )
}
