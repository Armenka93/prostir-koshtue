'use client'
import React, { useState, useCallback, useRef, useEffect } from 'react'
import type { ListingData, User } from '@/types'
import { MOCK_LISTINGS, MOCK_IDS, isMockListingId } from '@/lib/mockData'
import { loadFavs, saveFavs } from '@/lib/storage'
import { getSessionUser, subscribeAuthChanges, signOut, isAdmin } from '@/lib/auth'
import {
  dbGetListings, dbUpdateListing, dbUpdateListingForReview, dbSubmitListingForReview,
  dbArchiveListing, dbRestoreListing, dbPauseListing,
  dbDeleteDraftListing, dbDeleteArchivedListing, dbDeleteListing, dbDeleteListingImageDetailed,
  subscribeToListings, isSupabaseReady,
  dbGetUserFavorites, dbAddFavorite, dbRemoveFavorite,
  ListingLifecycleError,
} from '@/lib/db'
import { messageForLifecycleError } from '@/lib/listingStatus'
import { flushImageDeletesWithRetry } from '@/lib/imageDeleteRetry'
import { getUnreadCount, type ChatRecord } from '@/lib/chats-db'
import { useChatSoundListener } from '@/components/ChatsScreen'

import SplashScreen from '@/components/SplashScreen'
import AuthScreen from '@/components/AuthScreen'
import BottomNav from '@/components/BottomNav'
import HomeScreen, { BASE_HOME_FILTERS, type HomeFilters } from '@/components/HomeScreen'
import FavoritesScreen from '@/components/FavoritesScreen'
import ChatsScreen from '@/components/ChatsScreen'
import RequestsScreen from '@/components/RequestsScreen'
import ProfileScreen from '@/components/ProfileScreen'
import ModerationScreen from '@/components/ModerationScreen'
import DetailScreen from '@/components/DetailScreen'
import AddListingWizard from '@/components/AddListingWizard'
import EditListingForm from '@/components/EditListingForm'
import FeedbackScreen from '@/components/FeedbackScreen'
import AllListingsScreen, { BASE_CATALOG_FILTERS, type CatalogFilters } from '@/components/AllListingsScreen'
import DesktopHeader from '@/components/DesktopHeader'
import Toast from '@/components/Toast'
import InstallPrompt from '@/components/InstallPrompt'

type Screen = 'home' | 'messages' | 'favorites' | 'requests' | 'profile'
type Phase = 'splash' | 'auth' | 'app'

function scrollTop() {
  if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior })
}

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: string | null }> {
  constructor(p: { children: React.ReactNode }) { super(p); this.state = { error: null } }
  static getDerivedStateFromError(e: Error) { return { error: e.message } }
  render() {
    if (this.state.error) return (
      <div style={{ minHeight: '100dvh', background: '#0F1117', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24, textAlign: 'center' }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>⚠️</div>
        <div style={{ fontSize: 18, fontWeight: 700, color: '#fff', marginBottom: 8 }}>Щось пішло не так</div>
        <div style={{ fontSize: 13, color: '#A0A8BC', marginBottom: 24 }}>{this.state.error}</div>
        <button onClick={() => window.location.reload()} style={{ padding: '14px 28px', background: '#FF6B1A', border: 'none', borderRadius: 12, color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer' }}>Перезавантажити</button>
      </div>
    )
    return this.props.children
  }
}

function AppInner() {
  const [phase, setPhase] = useState<Phase>('splash')
  const [user, setUser] = useState<User | null>(null)
  const [isGuest, setIsGuest] = useState(false)
  const [activeScreen, setActiveScreen] = useState<Screen>('home')
  const [selectedListing, setSelectedListing] = useState<ListingData | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  // E.2.3 requirement 5 — set only when opening the wizard from a specific
  // draft's own "Продовжити заповнення" (handleContinueDraft below);
  // ordinary "Додати оголошення" (goAddListing) always clears it first, so
  // the generic multi-draft recovery prompt is what runs there.
  const [continuingDraftId, setContinuingDraftId] = useState<number | null>(null)
  const [editingListing, setEditingListing] = useState<ListingData | null>(null)
  const [showFeedback, setShowFeedback] = useState(false)
  const [showModeration, setShowModeration] = useState(false)
  const [showAll, setShowAll] = useState<{ title: string; items: ListingData[] } | null>(null)
  const [dbListings, setDbListings] = useState<ListingData[]>([])
  const [dbLoaded, setDbLoaded] = useState(false)
  // Pre-migration audit fix (3rd round, blocker 1) — guards
  // handleAdminDeleteListing against a repeat click while a delete for
  // that same id is still in flight, and lets AdminDashboard (ProfileScreen)
  // show a busy/disabled state on the specific row instead of the whole
  // panel.
  const [adminDeleteBusyIds, setAdminDeleteBusyIds] = useState<Set<number>>(new Set())
  const [homeLoadError, setHomeLoadError] = useState(false)
  // Lifted up (not local to HomeScreen/AllListingsScreen) so applied
  // filters survive navigating to a listing and back — those screens
  // unmount while DetailScreen is shown, which would otherwise reset them.
  const [homeFilters, setHomeFilters] = useState<HomeFilters>(BASE_HOME_FILTERS)
  const [catalogFilters, setCatalogFilters] = useState<CatalogFilters>(BASE_CATALOG_FILTERS)
  // Sort and applied search query are kept separately for Home vs Catalog —
  // each screen's browsing state is independent, matching the filters above.
  const [homeSortBy, setHomeSortBy] = useState('date')
  const [homeSearchQuery, setHomeSearchQuery] = useState('')
  const [catalogSortBy, setCatalogSortBy] = useState('default')
  const [catalogSearchQuery, setCatalogSearchQuery] = useState('')
  const [favs, setFavs] = useState<number[]>([])
  const [refreshTick, setRefreshTick] = useState(0)
  const [unreadMsgs, setUnreadMsgs] = useState(0)
  const [initialChat, setInitialChat] = useState<ChatRecord | null>(null)
  const [chatOriginListing, setChatOriginListing] = useState<ListingData | null>(null)
  // True only while a single conversation (ChatWindow) is open — used to hide
  // the bottom nav there, but keep it visible on the chat list.
  const [chatWindowOpen, setChatWindowOpen] = useState(false)
  const savedScrollY = useRef(0)
  const savedShowAll = useRef<{ title: string; items: ListingData[] } | null>(null)
  const clearInitialChat = useCallback(() => setInitialChat(null), [])
  const [toastMsg, setToastMsg] = useState('')
  const [toastAction, setToastAction] = useState<{ label: string; onClick: () => void } | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout>>()

  // Keep a ref mirror of favs so toggleFav always reads the LATEST value,
  // never a value captured by a stale closure. This was the root cause
  // of the like counter flickering between different numbers: clicking
  // fast, or clicking right after a re-render, could call toggleFav with
  // an outdated `favs` snapshot.
  const favsRef = useRef<number[]>([])
  useEffect(() => { favsRef.current = favs }, [favs])

  // Background sound for incoming messages on any page
  useChatSoundListener(user?.id)

  const showToast = useCallback((msg: string, opts?: { action?: { label: string; onClick: () => void }; duration?: number }) => {
    setToastMsg(msg)
    setToastAction(opts?.action || null)
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => { setToastMsg(''); setToastAction(null) }, opts?.duration ?? 3000)
  }, [])

  const allListings = React.useMemo(() => {
    const dbOnly = dbListings.filter(l => !MOCK_IDS.has(l.id))
    return [...dbOnly, ...MOCK_LISTINGS]
  }, [dbListings])

  // Archived (isActive:false) listings must stay OUT of every public-facing
  // screen (search, similar listings, favorites, home) — only the owner's
  // own "Мої оголошення" screen is allowed to see them. Public screens use
  // this filtered list; RequestsScreen alone gets the unfiltered allListings.
  const visibleListings = React.useMemo(() =>
    allListings.filter(l => l.isActive !== false),
    [allListings]
  )

  const loadListings = useCallback(async () => {
    let failed = false
    const data = await dbGetListings({ onError: () => { failed = true } })
    setDbListings(data)
    setDbLoaded(true)
    // Only surface the error state when there's nothing to show at all —
    // if we already had listings from a previous successful load, keep
    // showing them rather than blocking the whole home feed (spec §05).
    setHomeLoadError(failed && data.length === 0)
    setRefreshTick(t => t + 1)
  }, [])

  // E.2.3 requirement 8: "LISTING_UPDATE_CONFLICT предлагает обновить
  // список" — every status-lifecycle catch block in this file goes through
  // this so a stale-data conflict always offers an actual "Оновити" action,
  // not just message text telling the user to do it themselves.
  const showLifecycleErrorToast = useCallback((e: unknown, fallbackMsg: string) => {
    if (e instanceof ListingLifecycleError) {
      if (e.code === 'LISTING_UPDATE_CONFLICT') {
        showToast(messageForLifecycleError(e.code), { action: { label: '🔄 Оновити', onClick: loadListings }, duration: 6000 })
      } else {
        showToast(messageForLifecycleError(e.code))
      }
    } else {
      showToast(fallbackMsg)
    }
  }, [showToast, loadListings])

  // Tracks which user id's favorites have already been fetched, so
  // getSessionUser() (on mount), the onAuthStateChange subscription, and
  // handleLogin() — all of which can independently observe the same
  // sign-in — never repeat the favorites round trip for the same session.
  const bootstrappedUserId = useRef<string | null>(null)
  const bootstrapFavorites = useCallback((u: User) => {
    if (bootstrappedUserId.current === u.id) return
    bootstrappedUserId.current = u.id
    // Show cached favorites instantly (from localStorage), then replace
    // with the authoritative list from Supabase. This is what makes the
    // hearts survive logging out / switching device / clearing the browser:
    // the source of truth now lives in the DB, keyed by the account id.
    const cached = loadFavs(u.id)
    setFavs(cached)
    favsRef.current = cached
    dbGetUserFavorites(u.id).then(remote => {
      setFavs(remote)
      favsRef.current = remote
      saveFavs(u.id, remote) // refresh the local cache
    })
  }, [])

  const resetAfterSignOut = useCallback(() => {
    bootstrappedUserId.current = null
    setUser(null)
    setIsGuest(false)
    setFavs([])
    favsRef.current = []
    setUnreadMsgs(0)
  }, [])

  // Init — restore the Supabase Auth session (if any) via getSession(), then
  // keep in sync with subsequent auth changes (sign-in/out from another tab)
  // via onAuthStateChange.
  useEffect(() => {
    let active = true
    // onAuthStateChange fires once immediately with the current session as
    // soon as it's subscribed to, on top of getSessionUser() below already
    // covering that same initial state — skip that one duplicate callback
    // so mount doesn't look up the profile twice.
    let skipFirstAuthEvent = true

    getSessionUser().then(savedUser => {
      if (!active || !savedUser) return
      setUser(savedUser)
      setPhase('app')
      bootstrapFavorites(savedUser)
    })
    loadListings()

    const unsubscribe = subscribeAuthChanges((u) => {
      if (skipFirstAuthEvent) { skipFirstAuthEvent = false; return }
      if (!u) { resetAfterSignOut(); return }
      setUser(u)
      setPhase('app')
      bootstrapFavorites(u)
    })
    return () => { active = false; unsubscribe() }
  }, [loadListings, bootstrapFavorites, resetAfterSignOut])

  // Unread messages badge — update every 8s
  useEffect(() => {
    if (!user) return
    const update = () => getUnreadCount(user.id).then(setUnreadMsgs)
    update()
    const t = setInterval(update, 8000)
    return () => clearInterval(t)
  }, [user])

  // Realtime listings — also keeps views/likes counters fresh across
  // devices: any UPDATE (not just INSERT/DELETE) now merges into the
  // local list, so if someone else likes/views a listing while you're
  // browsing, the numbers update live instead of staying stale until
  // the next full reload.
  useEffect(() => {
    const channel = subscribeToListings(
      (newListing) => {
        setDbListings(prev => prev.find(l => l.id === newListing.id) ? prev : [newListing, ...prev])
        setRefreshTick(t => t + 1)
      },
      (deletedId) => {
        setDbListings(prev => prev.filter(l => l.id !== deletedId))
        setRefreshTick(t => t + 1)
      },
      (updatedListing) => {
        // Merge updated fields (likes, views, etc.) into the existing entry
        setDbListings(prev => prev.map(l => l.id === updatedListing.id ? { ...l, ...updatedListing } : l))
      }
    )
    return () => { channel.unsubscribe() }
  }, [])

  // Desktop wide-shell escape hatch (D.1/D.2): layout.tsx's .app-shell
  // caps every screen at 430px in normal document flow. Screens that
  // have been adapted for desktop get a body class that lifts that cap
  // via CSS — see .app-shell / body.wide-shell in globals.css. Everything
  // else keeps rendering in the untouched 430px column. This toggles a
  // class only — no fixed positioning, so the page keeps a single normal
  // document-flow scroll.
  //
  // E.2.2 — showAdd (the 5-step wizard) is now adapted too: it wraps
  // itself in .desktop-wide-screen/-inner exactly like Home/Catalog/
  // Detail/Requests do. editingListing (EditListingForm, the older
  // single-screen editor for already-published listings) deliberately
  // stays OUT of wide-shell — it isn't part of this stage's scope and its
  // own markup has no wide-layout wrapper, so lifting the 430px cap under
  // it would just stretch it edge-to-edge unstyled.
  const isWideShell = phase === 'auth'
    || showAdd
    || (phase === 'app' && !showFeedback && !showAdd && !editingListing
      && (!!selectedListing || !!showAll || ['home', 'profile', 'messages', 'favorites', 'requests'].includes(activeScreen)))
  useEffect(() => {
    document.body.classList.toggle('wide-shell', isWideShell)
    return () => { document.body.classList.remove('wide-shell') }
  }, [isWideShell])

  const handleRefresh = useCallback(async () => {
    await loadListings()
    showToast('✅ Оновлено!')
  }, [loadListings, showToast])

  // ── Single atomic toggle for favorites ──────────────────────────
  // This is the ONE place that decides whether a listing becomes
  // favorited or unfavorited, and it does both things that need to
  // happen together:
  //   1) update the user's personal favorites list (localStorage)
  //   2) adjust the shared "likes" counter on the listing in Supabase
  // Previously these two were handled in two different components
  // (page.tsx for the favorites list, DetailScreen.tsx for the Supabase
  // counter) using two different snapshots of "is this favorited",
  // which could disagree with each other and cause the displayed
  // number to jump around or fail to persist a removal.
  const toggleFav = useCallback((id: number) => {
    const current = favsRef.current
    const wasFav = current.includes(id)
    const next = wasFav ? current.filter(f => f !== id) : [...current, id]

    // Optimistic update: flip the heart immediately in the UI.
    favsRef.current = next
    setFavs(next)
    if (user) saveFavs(user.id, next) // keep the local cache in step

    // Persist to Supabase so the heart survives logout / other devices.
    // Only for logged-in users (favorites are tied to an account id) and
    // only for real DB listings — mock/demo listings (see MOCK_IDS in
    // src/lib/mockData.ts) have no row to reference. The listings.likes
    // counter is updated automatically by the favorites_sync_likes DB
    // trigger, so we deliberately do NOT touch it here.
    if (user && !isMockListingId(id)) {
      const op = wasFav
        ? dbRemoveFavorite(user.id, id)
        : dbAddFavorite(user.id, id)
      op.then(ok => {
        if (!ok) {
          // Roll back the optimistic change if the write failed, so the UI
          // never claims something is saved when it isn't.
          const reverted = wasFav ? [...favsRef.current, id] : favsRef.current.filter(f => f !== id)
          favsRef.current = reverted
          setFavs(reverted)
          if (user) saveFavs(user.id, reverted)
          showToast('⚠️ Не вдалося зберегти. Спробуйте ще раз.')
        }
      }).catch(e => {
        console.error('[toggleFav] persist failed:', e)
      })
    }

    showToast(wasFav ? '💔 Видалено з обраного' : '❤️ Додано в обране')
  }, [user, showToast])

  const handleLogin = async (u: User) => {
    setUser(u)
    setIsGuest(false)
    // No manual session save — supabase.auth.signUp/signInWithPassword
    // (called inside registerAccount/loginAccount) already persisted the
    // session via the supabase client's own storage (see supabase.ts).
    // bootstrapFavorites is idempotent per user id, so if the
    // onAuthStateChange subscription already picked up this same sign-in
    // first, this is a cheap no-op rather than a second fetch.
    bootstrapFavorites(u)
    await loadListings()
    setPhase('app')
    scrollTop()
    showToast(`✅ Ви увійшли як ${u.name}`)
  }

  const handleGuest = async () => {
    setIsGuest(true)
    setUser(null)
    await loadListings()
    setPhase('app')
    scrollTop()
  }

  const handleLogout = async () => {
    await signOut()
    resetAfterSignOut()
    setPhase('splash')
    scrollTop()
  }

  const openListing = (l: ListingData) => {
    savedScrollY.current = window.scrollY
    savedShowAll.current = showAll  // remember if we came from AllListingsScreen
    setSelectedListing(l)
    setShowAll(null)
    scrollTop()
  }

  // AddListingWizard owns the entire draft → pending_review lifecycle
  // itself (autosave, recovery, submit, delete) — this fires exactly once,
  // after a successful dbSubmitListingForReview, purely to let page.tsx
  // reflect the result in its own listing list and close the wizard.
  const handleListingSubmitted = (listing: ListingData, warning?: { orphanedImageCount: number }) => {
    setDbListings(prev => prev.find(l => l.id === listing.id) ? prev.map(l => l.id === listing.id ? listing : l) : [listing, ...prev])
    setRefreshTick(t => t + 1)
    // A stuck Storage cleanup never blocks/changes the submission itself —
    // publication is already a success at this point regardless. This is
    // purely informational: logged with the listing id and a count only
    // (never a URL, never anything user-identifying beyond the listing's
    // own already-public id) so it's not silently lost, and separately
    // surfaced to the user as a quiet, delayed second toast — deliberately
    // NOT combined with the success toast, and NOT alarming (ℹ️, not ⚠️),
    // since it doesn't affect whether the listing itself is fine. The
    // `warning` value itself lives in this closure (captured the instant
    // AddListingWizard called onSubmitted, before it unmounts on the
    // setShowAdd(false) below), not read back from the unmounted wizard
    // afterward, so there's nothing to lose to that unmount.
    if (warning && warning.orphanedImageCount > 0) {
      console.error(`[page] listing ${listing.id} submitted with ${warning.orphanedImageCount} orphaned Storage image(s) left over from its draft`)
      setTimeout(() => {
        showToast(`ℹ️ Технічна примітка: ${warning.orphanedImageCount} тимчасовий файл(и) не вдалося прибрати — на оголошення це не впливає.`, { duration: 4000 })
      }, 3200)
    }
    showToast('✅ Надіслано на модерацію!')
    setShowAdd(false)
    setActiveScreen('requests')
    scrollTop()
  }

  // Pre-existing admin-dashboard "delete any listing" action
  // (ProfileScreen's AdminDashboard) — unrelated to E.2.3's owner-facing
  // lifecycle (no status guard, permanent, works on any row).
  //
  // Pre-migration audit fix (3rd round, blocker 1): this used to remove the
  // row from `dbListings` OPTIMISTICALLY, before dbDeleteListing even
  // resolved — a failed/conflicting delete would still make the listing
  // vanish app-wide (home feed, catalog, everywhere dbListings is read)
  // until the fallback loadListings() quietly put it back moments later.
  // "This predates E.2.3 and was out of scope for that stage" was true but
  // is not a reason to ship it into production now — fixed to the same
  // non-optimistic shape as every other lifecycle handler in this file:
  // call the DB first, only touch state on a CONFIRMED success (dbDeleteListing
  // now reliably reports 0-rows-deleted as failure, not success — see its
  // own comment in db.ts), leave the card in place on any failure, and
  // guard against a repeat click on the same id while the request is
  // in flight.
  const handleAdminDeleteListing = async (id: number) => {
    if (adminDeleteBusyIds.has(id)) return
    setAdminDeleteBusyIds(prev => new Set(prev).add(id))
    try {
      const ok = await dbDeleteListing(id)
      if (ok) {
        setDbListings(prev => prev.filter(l => l.id !== id))
        setRefreshTick(t => t + 1)
        showToast('Оголошення видалено')
      } else {
        // Nothing was removed from state, so nothing to "revert" — just
        // reconcile with the DB (covers the "someone/something already
        // deleted it" case) and tell the admin plainly that this attempt
        // didn't do anything.
        await loadListings()
        showToast('❌ Не вдалося видалити оголошення. Спробуйте ще раз.')
      }
    } finally {
      setAdminDeleteBusyIds(prev => { const n = new Set(prev); n.delete(id); return n })
    }
  }

  // E.2.3 requirement 2 — routes by the listing's CURRENT status (known
  // from editingListing, already in state when EditListingForm is open):
  //   - rejected: same row, dbSubmitListingForReview — no new draft, this
  //     IS the resubmit action, not a separate "save" step.
  //   - active/paused/archived: dbUpdateListingForReview — explicit
  //     status:'pending_review' + is_active:false dual-write in the same
  //     UPDATE, never relying on the not-yet-live Migration B trigger to
  //     do this for the rollout window.
  //   - anything else (draft — shouldn't reach EditListingForm at all;
  //     pending_review — read-only, no submit button to call this from):
  //     falls back to the plain dbUpdateListing with no status change, a
  //     defensive no-op path rather than silently mismatching an action.
  // `data` here is ALREADY a diff (EditListingForm's computeChangedFields)
  // — never a blind full-row payload, and this function is never called at
  // all when nothing changed (EditListingForm short-circuits that itself).
  const handleUpdateListing = async (id: number, data: Partial<ListingData>) => {
    const status = editingListing?.status
    const originalImages = editingListing?.images || []
    try {
      let updated: ListingData | null = null
      if (status === 'rejected') {
        updated = await dbSubmitListingForReview(id, data)
        if (updated) showToast('📤 Надіслано на повторну модерацію!')
      } else if (status === 'active' || status === 'paused' || status === 'archived') {
        if (!user) { showToast('⚠️ Потрібно увійти'); return }
        updated = await dbUpdateListingForReview(id, data, user.id)
        if (updated) showToast('✅ Збережено, надіслано на повторну модерацію')
      } else {
        updated = await dbUpdateListing(id, data)
        if (updated) showToast('✅ Зміни збережено!')
      }
      if (updated) {
        const updatedListing = updated
        setDbListings(prev => prev.map(l => l.id === id ? updatedListing : l))
        setRefreshTick(t => t + 1)
        // EditListingForm only diffs the DB row — it never touches Storage.
        // Only now, with the row UPDATE confirmed, is it safe to remove
        // whatever photos this edit actually dropped (same row-first-then-
        // Storage ordering as dbDeleteDraftListing/dbDeleteArchivedListing;
        // best-effort, never turns a successful save into a failure — this
        // whole block is fire-and-forget after the save toast above already
        // fired). Matches AddListingWizard's flushPendingImageDeletesWithRetry
        // pattern (bounded retry + a separate toast once retries are spent),
        // but — unlike that one — does NOT retry a 'refused' (ownership/path
        // validation) outcome: that check is deterministic on its input, so
        // retrying it burns attempts on something that cannot change,
        // instead of giving a real transient Storage error more chances.
        if (data.images && user) {
          const removedUrls = originalImages.filter(url => !data.images!.includes(url))
          if (removedUrls.length > 0) {
            const ownerId = user.id
            const maxAttempts = 3
            flushImageDeletesWithRetry(removedUrls, maxAttempts, url => dbDeleteListingImageDetailed(url, ownerId))
              .then(({ refusedCount, remaining }) => {
                if (refusedCount > 0) {
                  console.error(`[handleUpdateListing] ${refusedCount} image(s) refused by ownership/path validation — orphan file(s), not retried`)
                }
                if (remaining.length > 0) {
                  console.error(`[handleUpdateListing] ${remaining.length} image(s) could not be removed from Storage after ${maxAttempts} attempts — orphan file(s)`)
                  showToast(`ℹ️ Технічна примітка: ${remaining.length} файл(и) не вдалося прибрати — на оголошення це не впливає.`, { duration: 4000 })
                }
              })
          }
        }
      } else {
        showToast('⚠️ Помилка збереження. Перевірте підключення.')
      }
    } catch (e) {
      showLifecycleErrorToast(e, '⚠️ Помилка збереження. Перевірте підключення.')
    }
    setEditingListing(null)
    setActiveScreen('requests')
    scrollTop()
  }

  // ── E.2.3 status-lifecycle actions ─────────────────────────────
  // All of these are deliberately NON-optimistic (requirement 8: "при
  // ошибке карточка не меняет статус оптимистично") — dbListings is only
  // updated with the row the DB actually confirmed, never a client
  // assumption made before the request resolves. Each returns a boolean so
  // RequestsScreen can drive its own per-card busy/disabled state and know
  // when to stop showing a spinner, without this file owning any UI state.

  const handlePauseListing = async (id: number): Promise<boolean> => {
    try {
      const updated = await dbPauseListing(id)
      if (!updated) { showToast('⚠️ Не вдалося призупинити оголошення.'); return false }
      setDbListings(prev => prev.map(l => l.id === id ? updated : l))
      setRefreshTick(t => t + 1)
      showToast('⏸️ Оголошення призупинено')
      return true
    } catch (e) {
      showLifecycleErrorToast(e, '⚠️ Не вдалося призупинити оголошення.')
      return false
    }
  }

  const handleArchiveListing = async (id: number): Promise<boolean> => {
    try {
      const updated = await dbArchiveListing(id)
      if (!updated) { showToast('⚠️ Не вдалося перенести в архів.'); return false }
      setDbListings(prev => prev.map(l => l.id === id ? updated : l))
      setRefreshTick(t => t + 1)
      showToast('📦 Перенесено в архів', { action: { label: 'Скасувати', onClick: () => handleRestoreListing(id) }, duration: 5000 })
      return true
    } catch (e) {
      showLifecycleErrorToast(e, '⚠️ Не вдалося перенести в архів.')
      return false
    }
  }

  const handleRestoreListing = async (id: number): Promise<boolean> => {
    try {
      const updated = await dbRestoreListing(id)
      if (!updated) { showToast('⚠️ Не вдалося відновити оголошення.'); return false }
      setDbListings(prev => prev.map(l => l.id === id ? updated : l))
      setRefreshTick(t => t + 1)
      showToast('✅ Оголошення відновлено')
      return true
    } catch (e) {
      showLifecycleErrorToast(e, '⚠️ Не вдалося відновити оголошення.')
      return false
    }
  }

  const handleDeleteDraft = async (listing: ListingData): Promise<boolean> => {
    if (!user) return false
    const result = await dbDeleteDraftListing(listing.id, listing.images || [], user.id)
    if (!result.ok) {
      if (result.code === 'LISTING_UPDATE_CONFLICT') {
        showToast(messageForLifecycleError(result.code), { action: { label: '🔄 Оновити', onClick: loadListings }, duration: 6000 })
      } else {
        showToast(result.code ? messageForLifecycleError(result.code) : '⚠️ Не вдалося видалити чернетку.')
      }
      return false
    }
    setDbListings(prev => prev.filter(l => l.id !== listing.id))
    setRefreshTick(t => t + 1)
    showToast('🗑️ Чернетку видалено')
    return true
  }

  // "Видалити назавжди" for an ARCHIVED listing only — dbDeleteDraftListing
  // is deliberately NOT reused here (see its own comment: different,
  // unrelated source status).
  const handleDeleteArchivedPermanently = async (listing: ListingData): Promise<boolean> => {
    if (!user) return false
    const result = await dbDeleteArchivedListing(listing.id, user.id)
    if (!result.ok) {
      if (result.code === 'LISTING_UPDATE_CONFLICT') {
        showToast(messageForLifecycleError(result.code), { action: { label: '🔄 Оновити', onClick: loadListings }, duration: 6000 })
      } else {
        showToast(result.code ? messageForLifecycleError(result.code) : '⚠️ Не вдалося видалити оголошення.')
      }
      return false
    }
    setDbListings(prev => prev.filter(l => l.id !== listing.id))
    setRefreshTick(t => t + 1)
    showToast('🗑️ Оголошення видалено назавжди')
    return true
  }

  // E.2.3 requirement 5 — "Продовжити заповнення" from a draft's own card:
  // opens the wizard pinned to THIS id (re-verified server-side inside
  // AddListingWizard via dbGetDraftById), skipping the generic recovery
  // prompt. continuingDraftId is cleared whenever the wizard closes so the
  // NEXT ordinary "Додати оголошення" doesn't accidentally reopen it.
  const handleContinueDraft = (listing: ListingData) => {
    setContinuingDraftId(listing.id)
    setShowAdd(true)
    scrollTop()
  }

  const goAddListing = () => {
    if (!user) { setPhase('auth'); return }
    setContinuingDraftId(null)
    setShowAdd(true); scrollTop()
  }
  const goScreen = (s: Screen) => { setActiveScreen(s); scrollTop() }

  if (phase === 'splash') return <><SplashScreen onEnter={() => setPhase('auth')} onGuest={handleGuest} /><Toast msg={toastMsg} action={toastAction} /></>
  if (phase === 'auth') return (
    <>
      <DesktopHeader user={null} onLogin={() => setPhase('auth')} onProfile={() => goScreen('profile')} onAddListing={goAddListing} onGoHome={handleGuest} onComingSoon={(label) => showToast(`🔜 ${label} — скоро буде доступно`)} />
      <AuthScreen onDone={handleLogin} onGuest={handleGuest} />
      <Toast msg={toastMsg} action={toastAction} />
    </>
  )
  if (showFeedback) return <><FeedbackScreen onBack={() => { setShowFeedback(false); scrollTop() }} /><Toast msg={toastMsg} action={toastAction} /></>
  // E.2.4 requirement 1: "при прямой попытке открыть экран обычным
  // пользователем — безопасный отказ и возврат". isAdmin(user) is checked
  // HERE too, independently of ProfileScreen only showing the "Модерація"
  // button to admins — even if showModeration were somehow true for a
  // non-admin session (state left over from a role change, a forged
  // client state, anything), this still refuses to mount ModerationScreen
  // for them and sends them back rather than rendering it and trusting
  // the component's own internal check alone.
  if (showModeration && isAdmin(user)) {
    return (
      <>
        <DesktopHeader user={user} onLogin={() => setPhase('auth')} onProfile={() => goScreen('profile')} onAddListing={goAddListing} onGoHome={() => goScreen('home')} onComingSoon={(label) => showToast(`🔜 ${label} — скоро буде доступно`)} />
        <ModerationScreen user={user} onBack={() => { setShowModeration(false); setActiveScreen('profile'); scrollTop() }} showToast={showToast} />
        <Toast msg={toastMsg} action={toastAction} />
      </>
    )
  }
  // Abandoning the wizard (back / go-to-profile) does NOT delete its draft
  // — AddListingWizard's own dbFindExistingDraft recovery picks it back up
  // next time "Додати оголошення" is opened (requirement: "выход из
  // мастера не удаляет draft молча"). continuingDraftId IS cleared here —
  // it's only meant to pin this ONE open of the wizard to a specific draft,
  // not to keep overriding the generic recovery prompt forever after.
  if (showAdd) return (
    <>
      <DesktopHeader user={user} onLogin={() => setPhase('auth')} onProfile={() => goScreen('profile')} onAddListing={goAddListing} onGoHome={() => goScreen('home')} onComingSoon={(label) => showToast(`🔜 ${label} — скоро буде доступно`)} />
      <AddListingWizard user={user} initialDraftId={continuingDraftId ?? undefined} onBack={() => { setShowAdd(false); setContinuingDraftId(null); scrollTop() }} onSubmitted={(...args) => { setContinuingDraftId(null); handleListingSubmitted(...args) }} onGoProfile={() => { setShowAdd(false); setContinuingDraftId(null); setActiveScreen('profile'); scrollTop() }} />
      <Toast msg={toastMsg} action={toastAction} />
    </>
  )
  if (editingListing) return (
    <>
      <EditListingForm user={user} editListing={editingListing} readOnly={editingListing.status === 'pending_review'} onBack={() => { setEditingListing(null); scrollTop() }} onUpdated={handleUpdateListing} />
      <Toast msg={toastMsg} action={toastAction} />
    </>
  )
  if (selectedListing) return (
    <>
      <DesktopHeader user={user} onLogin={() => setPhase('auth')} onProfile={() => goScreen('profile')} onAddListing={goAddListing} onGoHome={() => { setSelectedListing(null); setShowAll(null); savedShowAll.current = null; goScreen('home') }} onComingSoon={(label) => showToast(`🔜 ${label} — скоро буде доступно`)} />
      <DetailScreen
        onGoHome={() => { setSelectedListing(null); setShowAll(null); savedShowAll.current = null; goScreen('home') }}
        listing={selectedListing}
        isFavorite={favs.includes(selectedListing.id)}
        onBack={() => {
          setSelectedListing(null)
          const prev = savedShowAll.current
          savedShowAll.current = null
          const y = savedScrollY.current
          if (prev) setShowAll(prev) // came from AllListingsScreen — restore it, then scroll back
          // setTimeout(0) instead of requestAnimationFrame: still runs after
          // the DOM commits the screen swap above, but — unlike rAF — isn't
          // gated on an actual paint/compositor frame, so it fires reliably
          // even if the tab is momentarily backgrounded/throttled.
          setTimeout(() => window.scrollTo({ top: y, behavior: 'instant' as ScrollBehavior }), 0)
        }}
        onFavorite={toggleFav}
        onSimilar={openListing}
        allListings={visibleListings}
        user={user}
        isGuest={isGuest && !user}
        onLogin={() => setPhase('auth')}
        showToast={showToast}
        onOpenChat={(chat) => {
          setChatOriginListing(selectedListing)
          setInitialChat(chat)
          // Clear navigation stack first, then switch screen — all in one batch
          setSelectedListing(null)
          setShowAll(null)
          savedShowAll.current = null
          setActiveScreen('messages')
          scrollTop()
        }}
        onEdit={(l) => { setSelectedListing(null); setEditingListing(l); scrollTop() }}
      />
      <Toast msg={toastMsg} action={toastAction} />
    </>
  )
  if (showAll) return (
    <>
      <DesktopHeader user={user} onLogin={() => setPhase('auth')} onProfile={() => goScreen('profile')} onAddListing={goAddListing} onGoHome={() => { setShowAll(null); goScreen('home') }} onComingSoon={(label) => showToast(`🔜 ${label} — скоро буде доступно`)} />
      <AllListingsScreen title={showAll.title} listings={showAll.items} allListings={visibleListings} favorites={favs} onListing={openListing} onFavorite={toggleFav} onBack={() => { const y = savedScrollY.current; setShowAll(null); requestAnimationFrame(() => window.scrollTo({ top: y, behavior: 'instant' as ScrollBehavior })) }} appliedFilters={catalogFilters} onAppliedFiltersChange={setCatalogFilters} sortBy={catalogSortBy} onSortByChange={setCatalogSortBy} searchQuery={catalogSearchQuery} onSearchQueryChange={setCatalogSearchQuery} />
      <Toast msg={toastMsg} action={toastAction} />
    </>
  )

  return (
    <>
      {(activeScreen === 'home' || activeScreen === 'profile' || activeScreen === 'messages' || activeScreen === 'favorites' || activeScreen === 'requests') && (
        <DesktopHeader user={user} onLogin={() => setPhase('auth')} onProfile={() => goScreen('profile')} onAddListing={goAddListing} onGoHome={() => goScreen('home')} onComingSoon={(label) => showToast(`🔜 ${label} — скоро буде доступно`)} />
      )}
      <div>
        {activeScreen === 'home' && (
          <HomeScreen
            key={refreshTick}
            listings={visibleListings}
            onListing={openListing}
            onFavorite={toggleFav}
            favorites={favs}
            user={user}
            isGuest={isGuest && !user}
            onLogin={() => setPhase('auth')}
            onAddListing={goAddListing}
            loading={!dbLoaded}
            loadError={homeLoadError}
            onRetryLoad={loadListings}
            appliedFilters={homeFilters}
            onAppliedFiltersChange={setHomeFilters}
            sortBy={homeSortBy}
            onSortByChange={setHomeSortBy}
            searchQuery={homeSearchQuery}
            onSearchQueryChange={setHomeSearchQuery}
            onProfile={() => goScreen('profile')}
            onRefresh={handleRefresh}
            onShowAll={(title, items) => { savedScrollY.current = window.scrollY; setShowAll({ title, items }); scrollTop() }}
          />
        )}
        {activeScreen === 'messages' && (
          <ChatsScreen
            user={user}
            isGuest={isGuest && !user}
            onLogin={() => setPhase('auth')}
            onRefresh={handleRefresh}
            initialChat={initialChat}
            onInitialChatConsumed={clearInitialChat}
            onBackToListing={chatOriginListing ? () => { setSelectedListing(chatOriginListing); setChatOriginListing(null); scrollTop() } : undefined}
            onChatOpenChange={setChatWindowOpen}
          />
        )}
        {activeScreen === 'favorites' && <FavoritesScreen favorites={favs} allListings={visibleListings} onListing={openListing} onFavorite={toggleFav} onRefresh={handleRefresh} />}
        {activeScreen === 'requests' && <RequestsScreen
          user={user} isGuest={isGuest && !user} listings={allListings}
          onLogin={() => setPhase('auth')} onAddListing={goAddListing}
          onListing={openListing}
          onViewReadOnly={(l) => { setEditingListing(l); scrollTop() }}
          onEdit={(l) => { setEditingListing(l); scrollTop() }}
          onContinueDraft={handleContinueDraft}
          onDeleteDraft={handleDeleteDraft}
          onPause={handlePauseListing}
          onArchive={handleArchiveListing}
          onRestore={handleRestoreListing}
          onDeleteArchived={handleDeleteArchivedPermanently}
          onRefresh={handleRefresh}
          onBack={() => { setActiveScreen('profile'); scrollTop() }}
        />}
        {activeScreen === 'profile' && <ProfileScreen user={user} isGuest={isGuest && !user} onLogin={() => setPhase('auth')} onAddListing={goAddListing} onFeedback={() => { setShowFeedback(true); scrollTop() }} favCount={favs.length} onLogout={handleLogout} showToast={showToast} listings={allListings} onListing={openListing} onDeleteListing={handleAdminDeleteListing} deletingListingIds={adminDeleteBusyIds} onRefresh={handleRefresh} onMyListings={() => { setActiveScreen('requests'); scrollTop() }} onEditListing={(l) => { setEditingListing(l); scrollTop() }} onArchiveListing={handleArchiveListing} onGoFavorites={() => goScreen('favorites')} onGoMessages={() => goScreen('messages')} onOpenModeration={() => { setShowModeration(true); scrollTop() }} />}
      </div>
      {!chatWindowOpen && <BottomNav active={activeScreen} onChange={goScreen} favCount={favs.length} unreadMessages={unreadMsgs} />}
      <Toast msg={toastMsg} action={toastAction} />
      <InstallPrompt />
    </>
  )
}

export default function AppPage() {
  return <ErrorBoundary><AppInner /></ErrorBoundary>
}
