'use client'
import React, { useState, useCallback, useRef, useEffect } from 'react'
import type { ListingData, User } from '@/types'
import { MOCK_LISTINGS } from '@/lib/mockData'
import { buildFeed } from '@/lib/listing-logic'
import {
  loadSession, saveSession, clearSession,
  loadFavs, saveFavs,
  loadUserListings, saveUserListings,
} from '@/lib/storage'

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

// ── Storage key for ALL listings (user-published + mock) ─────
const ALL_LISTINGS_KEY = 'pk_all_user_listings'

function loadAllUserListings(): ListingData[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(ALL_LISTINGS_KEY)
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

function saveAllUserListings(listings: ListingData[]) {
  if (typeof window === 'undefined') return
  try {
    // Only save user-published listings (not mock data)
    const userPublished = listings.filter(l =>
      !MOCK_LISTINGS.find(m => m.id === l.id)
    )
    localStorage.setItem(ALL_LISTINGS_KEY, JSON.stringify(userPublished))
  } catch {}
}

// ── Error Boundary ────────────────────────────────────────────
class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: string | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props)
    this.state = { error: null }
  }
  static getDerivedStateFromError(e: Error) { return { error: e.message } }
  render() {
    if (this.state.error) {
      return (
        <div style={{ minHeight: '100dvh', background: '#0F1117', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24, textAlign: 'center' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>⚠️</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#fff', marginBottom: 8 }}>Щось пішло не так</div>
          <div style={{ fontSize: 13, color: '#A0A8BC', marginBottom: 24 }}>{this.state.error}</div>
          <button onClick={() => window.location.reload()} style={{ padding: '14px 28px', background: '#FF6B1A', border: 'none', borderRadius: 12, color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer' }}>Перезавантажити</button>
        </div>
      )
    }
    return this.props.children
  }
}

// ── Main App ──────────────────────────────────────────────────
function AppInner() {
  const [phase, setPhase] = useState<Phase>('splash')
  const [user, setUser] = useState<User | null>(null)
  const [isGuest, setIsGuest] = useState(false)
  const [activeScreen, setActiveScreen] = useState<Screen>('home')
  const [selectedListing, setSelectedListing] = useState<ListingData | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [showFeedback, setShowFeedback] = useState(false)
  const [showAll, setShowAll] = useState<{ title: string; items: ListingData[] } | null>(null)

  // ── Listings state: mock + user-published ─────────────────
  const [allListings, setAllListings] = useState<ListingData[]>([...MOCK_LISTINGS])
  const [favs, setFavs] = useState<number[]>([])
  const [refreshKey, setRefreshKey] = useState(0)

  const [toastMsg, setToastMsg] = useState('')
  const toastTimer = useRef<ReturnType<typeof setTimeout>>()

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg)
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToastMsg(''), 3000)
  }, [])

  // ── Load listings: mock + everything saved by users ────────
  const initListings = useCallback(() => {
    const userPublished = loadAllUserListings()
    if (userPublished.length > 0) {
      const mockIds = new Set(MOCK_LISTINGS.map(l => l.id))
      const fresh = userPublished.filter(l => !mockIds.has(l.id))
      setAllListings([...fresh, ...MOCK_LISTINGS])
    } else {
      setAllListings([...MOCK_LISTINGS])
    }
  }, [])

  // ── Auto-login on mount ───────────────────────────────────
  useEffect(() => {
    initListings()
    const savedUser = loadSession()
    if (savedUser) {
      setUser(savedUser)
      setFavs(loadFavs(savedUser.id))
      setPhase('app')
    }
  }, [initListings])

  // ── Pull-to-refresh handler ───────────────────────────────
  const handleRefresh = useCallback(async () => {
    await new Promise(r => setTimeout(r, 700))
    initListings()
    setRefreshKey(k => k + 1)
    showToast('✅ Оновлено!')
  }, [initListings, showToast])

  const toggleFav = useCallback((id: number) => {
    setFavs(prev => {
      const next = prev.includes(id) ? prev.filter(f => f !== id) : [...prev, id]
      if (user) saveFavs(user.id, next)
      return next
    })
  }, [user])

  const handleLogin = (u: User) => {
    setUser(u)
    setIsGuest(false)
    saveSession(u)
    setFavs(loadFavs(u.id))
    initListings()
    setPhase('app')
    showToast(`✅ Ви увійшли як ${u.name}`)
  }

  const handleGuest = () => {
    setIsGuest(true)
    setUser(null)
    initListings()
    setPhase('app')
    showToast('Гостьовий режим')
  }

  const handleLogout = () => {
    clearSession()
    setUser(null)
    setIsGuest(false)
    setFavs([])
    setPhase('splash')
  }

  const openListing = (l: ListingData) => {
    setSelectedListing(l)
    setShowAll(null)
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior })
  }

  // ── Add listing — save globally so it persists ────────────
  const handleAddListing = (data: Partial<ListingData>) => {
    const newListing: ListingData = {
      id: Date.now(),
      userId: user?.id || 'me',
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
      images: data.images && data.images.length > 0 ? data.images : [
        'https://images.unsplash.com/photo-1497366216548-37526070297c?w=800&q=80'
      ],
      features: data.features || [],
      isActive: true,
      views: 0, likes: 0, score: 0,
      isPromoted: false, isNew: true, isFeatured: false,
      promotedUntil: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ownerName: user?.name || null,
      ownerPhone: user?.phone || null,
    }

    const updated = [newListing, ...allListings]
    setAllListings(updated)

    // Save: 1) globally (all users see it) 2) per-user
    saveAllUserListings(updated)
    if (user) saveUserListings(user.id, updated.filter(l =>
      l.userId === user.id || l.userId === 'me'
    ))

    setShowAdd(false)
    showToast('✅ Оголошення опубліковано!')
    setActiveScreen('requests')
  }

  const handleDeleteListing = (id: number) => {
    const updated = allListings.filter(l => l.id !== id)
    setAllListings(updated)
    saveAllUserListings(updated)
    if (user) saveUserListings(user.id, updated.filter(l => l.userId === user.id))
    showToast('Оголошення видалено')
  }

  const goAddListing = () => {
    if (!user) { setPhase('auth'); return }
    setShowAdd(true)
  }

  // ── RENDER ────────────────────────────────────────────────
  if (phase === 'splash') return <><SplashScreen onEnter={() => setPhase('auth')} onGuest={handleGuest} /><Toast msg={toastMsg} /></>
  if (phase === 'auth') return <><AuthScreen onDone={handleLogin} onGuest={handleGuest} /><Toast msg={toastMsg} /></>
  if (showFeedback) return <><FeedbackScreen onBack={() => setShowFeedback(false)} /><Toast msg={toastMsg} /></>
  if (showAdd) return (
    <><AddListingScreen user={user} onBack={() => setShowAdd(false)} onCreated={handleAddListing} onGoProfile={() => { setShowAdd(false); setActiveScreen('profile') }} /><Toast msg={toastMsg} /></>
  )
  if (selectedListing) return (
    <><DetailScreen listing={selectedListing} isFavorite={favs.includes(selectedListing.id)} onBack={() => setSelectedListing(null)} onFavorite={toggleFav} onSimilar={openListing} allListings={allListings} user={user} isGuest={isGuest && !user} onLogin={() => { setSelectedListing(null); setPhase('auth') }} showToast={showToast} /><Toast msg={toastMsg} /></>
  )
  if (showAll) return (
    <><AllListingsScreen title={showAll.title} listings={showAll.items} allListings={allListings} favorites={favs} onListing={openListing} onFavorite={toggleFav} onBack={() => setShowAll(null)} /><Toast msg={toastMsg} /></>
  )

  return (
    <>
      <div>
        {activeScreen === 'home' && (
          <HomeScreen
            key={refreshKey}
            listings={allListings}
            onListing={openListing}
            onFavorite={toggleFav}
            favorites={favs}
            user={user}
            isGuest={isGuest && !user}
            onLogin={() => setPhase('auth')}
            onAddListing={goAddListing}
            loading={false}
            onProfile={() => setActiveScreen('profile')}
            onRefresh={handleRefresh}
            onShowAll={(title, items) => setShowAll({ title, items })}
          />
        )}
        {activeScreen === 'messages' && <ChatsScreen user={user} isGuest={isGuest && !user} onLogin={() => setPhase('auth')} />}
        {activeScreen === 'favorites' && <FavoritesScreen favorites={favs} allListings={allListings} onListing={openListing} onFavorite={toggleFav} />}
        {activeScreen === 'requests' && <RequestsScreen user={user} isGuest={isGuest && !user} listings={allListings} onLogin={() => setPhase('auth')} onAddListing={goAddListing} onListing={openListing} onDelete={handleDeleteListing} />}
        {activeScreen === 'profile' && <ProfileScreen user={user} isGuest={isGuest && !user} onLogin={() => setPhase('auth')} onAddListing={goAddListing} onFeedback={() => setShowFeedback(true)} favCount={favs.length} onLogout={handleLogout} showToast={showToast} listings={allListings} onListing={openListing} onDeleteListing={handleDeleteListing} />}
      </div>

      <BottomNav active={activeScreen} onChange={setActiveScreen} favCount={favs.length} unreadMessages={0} />
      <Toast msg={toastMsg} />
      <InstallPrompt />
    </>
  )
}

export default function AppPage() {
  return <ErrorBoundary><AppInner /></ErrorBoundary>
}
