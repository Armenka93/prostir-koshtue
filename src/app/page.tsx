'use client'
import React, { useState, useCallback, useRef, useEffect } from 'react'
import type { ListingData, User } from '@/types'
import { MOCK_LISTINGS, MOCK_IDS, isMockListingId } from '@/lib/mockData'
import { loadFavs, saveFavs } from '@/lib/storage'
import { getSessionUser, subscribeAuthChanges, signOut } from '@/lib/auth'
import {
  dbGetListings, dbPublishListing, dbUpdateListing, dbDeleteListing,
  dbArchiveListing, dbRestoreListing,
  subscribeToListings, isSupabaseReady,
  dbGetUserFavorites, dbAddFavorite, dbRemoveFavorite,
} from '@/lib/db'
import { getUnreadCount, type ChatRecord } from '@/lib/chats-db'
import { useChatSoundListener } from '@/components/ChatsScreen'

import SplashScreen from '@/components/SplashScreen'
import AuthScreen from '@/components/AuthScreen'
import BottomNav from '@/components/BottomNav'
import HomeScreen from '@/components/HomeScreen'
import FavoritesScreen from '@/components/FavoritesScreen'
import ChatsScreen from '@/components/ChatsScreen'
import RequestsScreen from '@/components/RequestsScreen'
import ProfileScreen from '@/components/ProfileScreen'
import DetailScreen from '@/components/DetailScreen'
import AddListingScreen from '@/components/AddListingScreen'
import FeedbackScreen from '@/components/FeedbackScreen'
import AllListingsScreen from '@/components/AllListingsScreen'
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
  const [editingListing, setEditingListing] = useState<ListingData | null>(null)
  const [showFeedback, setShowFeedback] = useState(false)
  const [showAll, setShowAll] = useState<{ title: string; items: ListingData[] } | null>(null)
  const [dbListings, setDbListings] = useState<ListingData[]>([])
  const [dbLoaded, setDbLoaded] = useState(false)
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
    const data = await dbGetListings()
    setDbListings(data)
    setDbLoaded(true)
    setRefreshTick(t => t + 1)
  }, [])

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

  const handleAddListing = async (data: Partial<ListingData>) => {
    // No fallback id: publishing without a real authenticated user must be
    // impossible, not silently attributed to a placeholder owner.
    // goAddListing() already keeps the form from opening for a logged-out
    // user — this is the backstop for the session expiring while it's open.
    if (!user) {
      showToast('⚠️ Потрібно увійти, щоб опублікувати оголошення')
      setShowAdd(false)
      setPhase('auth')
      return
    }
    const toPublish: Partial<ListingData> = {
      userId: user.id,
      ownerName: user.name || null,
      ownerPhone: user.phone || null,
      title: data.title || '',
      type: data.type || 'Офіс',
      price: data.price || 0,
      area: data.area || 0,
      floor: data.floor ?? null,
      totalFloors: data.totalFloors ?? null,
      district: data.district || 'Приморський',
      address: data.address || '',
      city: 'Одеса',
      condition: data.condition || 'Євроремонт',
      parking: data.parking || false,
      separateEntrance: data.separateEntrance || false,
      description: data.description || null,
      images: data.images?.length ? data.images : ['/no-photo.png'],
      features: data.features || [],
    }

    // No optimistic temp entry — realtime subscription will add the
    // real DB row the moment Supabase confirms the insert. This avoids
    // the duplicate-then-merge flicker (temp row + realtime row + saved row).
    const saved = await dbPublishListing(toPublish)
    if (saved) {
      // Add immediately in case realtime event hasn't arrived yet.
      // The realtime handler already dedupes by id, so this is safe
      // even if the realtime event fires a moment later.
      setDbListings(prev => prev.find(l => l.id === saved.id) ? prev : [saved, ...prev])
      setRefreshTick(t => t + 1)
      showToast('✅ Оголошення опубліковано!')
    } else {
      showToast('⚠️ Помилка збереження. Перевірте підключення.')
    }

    setShowAdd(false)
    setActiveScreen('requests')
    scrollTop()
  }

  const handleUpdateListing = async (id: number, data: Partial<ListingData>) => {
    const updated = await dbUpdateListing(id, data)
    if (updated) {
      setDbListings(prev => prev.map(l => l.id === id ? updated : l))
      setRefreshTick(t => t + 1)
      showToast('✅ Зміни збережено!')
    } else {
      showToast('⚠️ Помилка збереження. Перевірте підключення.')
    }
    setEditingListing(null)
    setActiveScreen('requests')
    scrollTop()
  }

  // Permanent delete — used by the admin moderation panel only. Removes the
  // row entirely and immediately drops it from local state.
  const handleDeleteListing = async (id: number) => {
    setDbListings(prev => prev.filter(l => l.id !== id))
    setRefreshTick(t => t + 1)
    const ok = await dbDeleteListing(id)
    if (!ok) { await loadListings(); showToast('❌ Помилка видалення') }
    else showToast('Оголошення видалено')
  }

  // Owner-facing "delete" from "Мої оголошення" — archives instead of
  // permanently deleting, so it can be restored or the listing history
  // reviewed later. The row stays in dbListings (isActive:false) rather
  // than being removed, so it can still be found in the archive view.
  const handleArchiveListing = async (id: number) => {
    setDbListings(prev => prev.map(l => l.id === id ? { ...l, isActive: false } : l))
    setRefreshTick(t => t + 1)
    const ok = await dbArchiveListing(id)
    if (!ok) { await loadListings(); showToast('❌ Помилка видалення') }
    else showToast('📦 Перенесено в архів', { action: { label: 'Скасувати', onClick: () => handleRestoreListing(id) }, duration: 5000 })
  }

  const handleRestoreListing = async (id: number) => {
    setDbListings(prev => prev.map(l => l.id === id ? { ...l, isActive: true } : l))
    setRefreshTick(t => t + 1)
    const ok = await dbRestoreListing(id)
    if (!ok) { await loadListings(); showToast('❌ Помилка відновлення') }
    else showToast('✅ Оголошення відновлено')
  }

  const goAddListing = () => {
    if (!user) { setPhase('auth'); return }
    setShowAdd(true); scrollTop()
  }
  const goScreen = (s: Screen) => { setActiveScreen(s); scrollTop() }

  if (phase === 'splash') return <><SplashScreen onEnter={() => setPhase('auth')} onGuest={handleGuest} /><Toast msg={toastMsg} action={toastAction} /></>
  if (phase === 'auth') return <><AuthScreen onDone={handleLogin} onGuest={handleGuest} /><Toast msg={toastMsg} action={toastAction} /></>
  if (showFeedback) return <><FeedbackScreen onBack={() => { setShowFeedback(false); scrollTop() }} /><Toast msg={toastMsg} action={toastAction} /></>
  if (showAdd || editingListing) return <><AddListingScreen user={user} onBack={() => { setShowAdd(false); setEditingListing(null); scrollTop() }} onCreated={handleAddListing} onUpdated={handleUpdateListing} editListing={editingListing || undefined} onGoProfile={() => { setShowAdd(false); setEditingListing(null); setActiveScreen('profile'); scrollTop() }} /><Toast msg={toastMsg} action={toastAction} /></>
  if (selectedListing) return (
    <>
      <DetailScreen
        listing={selectedListing}
        isFavorite={favs.includes(selectedListing.id)}
        onBack={() => {
          setSelectedListing(null)
          const prev = savedShowAll.current
          savedShowAll.current = null
          if (prev) {
            // came from AllListingsScreen — restore it, then scroll back
            setShowAll(prev)
            const y = savedScrollY.current
            requestAnimationFrame(() => window.scrollTo({ top: y, behavior: 'instant' as ScrollBehavior }))
          } else {
            const y = savedScrollY.current
            requestAnimationFrame(() => window.scrollTo({ top: y, behavior: 'instant' as ScrollBehavior }))
          }
        }}
        onFavorite={toggleFav}
        onSimilar={openListing}
        allListings={visibleListings}
        user={user}
        isGuest={isGuest && !user}
        onLogin={() => { setSelectedListing(null); setPhase('auth') }}
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
    <><AllListingsScreen title={showAll.title} listings={showAll.items} allListings={visibleListings} favorites={favs} onListing={openListing} onFavorite={toggleFav} onBack={() => { const y = savedScrollY.current; setShowAll(null); requestAnimationFrame(() => window.scrollTo({ top: y, behavior: 'instant' as ScrollBehavior })) }} /><Toast msg={toastMsg} action={toastAction} /></>
  )

  return (
    <>
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
        {activeScreen === 'requests' && <RequestsScreen user={user} isGuest={isGuest && !user} listings={allListings} onLogin={() => setPhase('auth')} onAddListing={goAddListing} onListing={openListing} onDelete={handleArchiveListing} onRestore={handleRestoreListing} onPermanentDelete={handleDeleteListing} onEdit={(l) => { setEditingListing(l); scrollTop() }} onRefresh={handleRefresh} onBack={() => { setActiveScreen('profile'); scrollTop() }} />}
        {activeScreen === 'profile' && <ProfileScreen user={user} isGuest={isGuest && !user} onLogin={() => setPhase('auth')} onAddListing={goAddListing} onFeedback={() => { setShowFeedback(true); scrollTop() }} favCount={favs.length} onLogout={handleLogout} showToast={showToast} listings={allListings} onListing={openListing} onDeleteListing={handleDeleteListing} onRefresh={handleRefresh} onMyListings={() => { setActiveScreen('requests'); scrollTop() }} onEditListing={(l) => { setEditingListing(l); scrollTop() }} onArchiveListing={handleArchiveListing} />}
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
