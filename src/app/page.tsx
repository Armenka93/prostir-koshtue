'use client'
import React, { useState, useCallback, useRef, useEffect } from 'react'
useEffect(() => {
  if (!user) return
  const update = () => getUnreadCount(user.id).then(setUnreadMsgs)
  update()
  const t = setInterval(update, 8000)
  return () => clearInterval(t)
}, [user])
import type { ListingData, User } from '@/types'
import { MOCK_LISTINGS } from '@/lib/mockData'
import { loadFavs, saveFavs } from '@/lib/storage'
import { loadSession, saveSession, clearSession, registerAccount, loginAccount } from '@/lib/auth'
import {
  dbGetListings, dbPublishListing, dbDeleteListing,
  subscribeToListings, isSupabaseReady,
} from '@/lib/db'
import { getUnreadCount } from '@/lib/chats-db'
import SplashScreen from '@/components/SplashScreen'
import AuthScreen from '@/components/AuthScreen'
import BottomNav from '@/components/BottomNav'
import HomeScreen from '@/components/HomeScreen'
import SearchScreen from '@/components/SearchScreen'
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

const MOCK_IDS = new Set(MOCK_LISTINGS.map(l => l.id))

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
  const [showFeedback, setShowFeedback] = useState(false)
  const [showAll, setShowAll] = useState<{ title: string; items: ListingData[] } | null>(null)

  // DB listings from Supabase (user-published)
  const [dbListings, setDbListings] = useState<ListingData[]>([])
  const [dbLoaded, setDbLoaded] = useState(false)
  const [favs, setFavs] = useState<number[]>([])
  const [refreshTick, setRefreshTick] = useState(0)
  const [unreadMsgs, setUnreadMsgs] = useState(0)
  const [initialChatId, setInitialChatId] = useState<string | undefined>(undefined)

  const [toastMsg, setToastMsg] = useState('')
  const toastTimer = useRef<ReturnType<typeof setTimeout>>()

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg)
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToastMsg(''), 3000)
  }, [])

  // allListings = DB listings (no mocks) + MOCK_LISTINGS
  // DB listings come first so they appear at top of feed
  const allListings = React.useMemo(() => {
    // Filter out any DB entries that accidentally have mock IDs
    const dbOnly = dbListings.filter(l => !MOCK_IDS.has(l.id))
    const combined = [...dbOnly, ...MOCK_LISTINGS]
    console.log(`[allListings] db=${dbOnly.length} mock=${MOCK_LISTINGS.length} total=${combined.length}`)
    return combined
  }, [dbListings])

  // Load ALL listings from Supabase
  const loadListings = useCallback(async () => {
    console.log('[loadListings] fetching from Supabase...')
    const data = await dbGetListings()
    console.log(`[loadListings] received ${data.length} listings from Supabase`)
    if (data.length > 0) {
      console.log('[loadListings] first listing:', data[0]?.title, 'id:', data[0]?.id)
    }
    setDbListings(data)
    setDbLoaded(true)
    setRefreshTick(t => t + 1)
  }, [])

  // Init: auto-login + load listings
  useEffect(() => {
    console.log('[init] starting app, supabaseReady=', isSupabaseReady())
    const savedUser = loadSession()
    if (savedUser) {
      console.log('[init] found session for:', savedUser.email)
      setUser(savedUser)
      setFavs(loadFavs(savedUser.id))
      setPhase('app')
    }
    loadListings()
  }, [loadListings])

  // Realtime: auto-update when new listings are published
  useEffect(() => {
    const channel = subscribeToListings(
      (newListing) => {
        console.log('[realtime] new listing received:', newListing.id, newListing.title)
        setDbListings(prev => {
          if (prev.find(l => l.id === newListing.id)) return prev
          return [newListing, ...prev]
        })
        setRefreshTick(t => t + 1)
      },
      (deletedId) => {
        console.log('[realtime] listing deleted:', deletedId)
        setDbListings(prev => prev.filter(l => l.id !== deletedId))
        setRefreshTick(t => t + 1)
      }
    )
    return () => {
      channel.unsubscribe()
    }
  }, [])

  const handleRefresh = useCallback(async () => {
    await loadListings()
    showToast('✅ Оновлено!')
  }, [loadListings, showToast])

  const toggleFav = useCallback((id: number) => {
    setFavs(prev => {
      const next = prev.includes(id) ? prev.filter(f => f !== id) : [...prev, id]
      if (user) saveFavs(user.id, next)
      return next
    })
  }, [user])

  const handleLogin = async (u: User) => {
    setUser(u)
    setIsGuest(false)
    saveSession(u)
    setFavs(loadFavs(u.id))
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

  const handleLogout = () => {
    clearSession()
    setUser(null)
    setIsGuest(false)
    setFavs([])
    setPhase('splash')
    scrollTop()
  }

  const openListing = (l: ListingData) => {
    setSelectedListing(l)
    setShowAll(null)
    scrollTop()
  }

  const handleAddListing = async (data: Partial<ListingData>) => {
    const toPublish: Partial<ListingData> = {
      userId: user?.id || 'anonymous',
      ownerName: user?.name || null,
      ownerPhone: user?.phone || null,
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
      images: data.images?.length
        ? data.images
        : ['https://images.unsplash.com/photo-1497366216548-37526070297c?w=800&q=80'],
      features: data.features || [],
    }

    console.log('[handleAddListing] publishing:', toPublish.title)

    // Optimistic update — show immediately in UI
    const tempId = Date.now()
    const tempListing: ListingData = {
      ...toPublish as ListingData,
      id: tempId,
      isActive: true, isNew: true, isPromoted: false, isFeatured: false,
      views: 0, likes: 0, score: 0,
      promotedUntil: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    setDbListings(prev => [tempListing, ...prev])

    // Save to Supabase
    const saved = await dbPublishListing(toPublish)

    if (saved) {
      console.log('[handleAddListing] saved to DB with id:', saved.id)
      // Replace temp with real DB entry
      setDbListings(prev => [saved, ...prev.filter(l => l.id !== tempId)])
      showToast('✅ Оголошення опубліковано!')
    } else {
      console.error('[handleAddListing] DB save failed, keeping optimistic entry')
      showToast('⚠️ Збережено локально. Перевірте підключення.')
    }

    setRefreshTick(t => t + 1)
    setShowAdd(false)
    setActiveScreen('requests')
    scrollTop()
  }

  const handleDeleteListing = async (id: number) => {
    // Optimistic removal
    setDbListings(prev => prev.filter(l => l.id !== id))
    setRefreshTick(t => t + 1)
    const ok = await dbDeleteListing(id)
    if (!ok) {
      // Restore if failed
      await loadListings()
      showToast('❌ Помилка видалення')
    } else {
      showToast('Оголошення видалено')
    }
  }

  const goAddListing = () => {
    if (!user) { setPhase('auth'); return }
    setShowAdd(true); scrollTop()
  }
  const goScreen = (s: Screen) => { setActiveScreen(s); scrollTop() }

  // ── Render ─────────────────────────────────────────────────
  if (phase === 'splash') return <><SplashScreen onEnter={() => setPhase('auth')} onGuest={handleGuest} /><Toast msg={toastMsg} /></>
  if (phase === 'auth') return <><AuthScreen onDone={handleLogin} onGuest={handleGuest} /><Toast msg={toastMsg} /></>
  if (showFeedback) return <><FeedbackScreen onBack={() => { setShowFeedback(false); scrollTop() }} /><Toast msg={toastMsg} /></>
  if (showAdd) return <><AddListingScreen user={user} onBack={() => { setShowAdd(false); scrollTop() }} onCreated={handleAddListing} onGoProfile={() => { setShowAdd(false); setActiveScreen('profile'); scrollTop() }} /><Toast msg={toastMsg} /></>
  if (selectedListing) return (
    <><DetailScreen listing={selectedListing} isFavorite={favs.includes(selectedListing.id)} onBack={() => { setSelectedListing(null); scrollTop() }} onFavorite={toggleFav} onSimilar={openListing} allListings={allListings} user={user} isGuest={isGuest && !user} onLogin={() => { setSelectedListing(null); setPhase('auth') }} showToast={showToast} onOpenChat={(chatId) => { setSelectedListing(null); setInitialChatId(chatId); goScreen('messages') }} /></>
  )
  if (showAll) return (
    <><AllListingsScreen title={showAll.title} listings={showAll.items} allListings={allListings} favorites={favs} onListing={openListing} onFavorite={toggleFav} onBack={() => { setShowAll(null); scrollTop() }} /><Toast msg={toastMsg} /></>
  )

  return (
    <>
      <div>
        {activeScreen === 'home' && (
          <HomeScreen
            key={refreshTick}
            listings={allListings}
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
            onShowAll={(title, items) => { setShowAll({ title, items }); scrollTop() }}
          />
        )}
        {activeScreen === 'messages' && <ChatsScreen user={user} isGuest={isGuest && !user} onLogin={() => setPhase('auth')} onRefresh={handleRefresh} initialChatId={initialChatId}/>}
        {activeScreen === 'favorites' && <FavoritesScreen favorites={favs} allListings={allListings} onListing={openListing} onFavorite={toggleFav} onRefresh={handleRefresh} />}
        {activeScreen === 'requests' && <RequestsScreen user={user} isGuest={isGuest && !user} listings={allListings} onLogin={() => setPhase('auth')} onAddListing={goAddListing} onListing={openListing} onDelete={handleDeleteListing} onRefresh={handleRefresh} />}
        {activeScreen === 'profile' && <ProfileScreen user={user} isGuest={isGuest && !user} onLogin={() => setPhase('auth')} onAddListing={goAddListing} onFeedback={() => { setShowFeedback(true); scrollTop() }} favCount={favs.length} onLogout={handleLogout} showToast={showToast} listings={allListings} onListing={openListing} onDeleteListing={handleDeleteListing} onRefresh={handleRefresh} />}
      </div>
      <BottomNav active={activeScreen} onChange={goScreen} favCount={favs.length}unreadMessages={unreadMsgs} />
      <Toast msg={toastMsg} />
      <InstallPrompt />
    </>
  )
}

export default function AppPage() {
  return <ErrorBoundary><AppInner /></ErrorBoundary>
}
