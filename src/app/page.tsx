'use client'
import { useState, useCallback, useRef, useEffect } from 'react'
import type { ListingData, FeedData, User } from '@/types'
import { MOCK_LISTINGS, getMockFeed } from '@/lib/mockData'

// Components
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
import Toast from '@/components/Toast'

type Screen = 'home' | 'messages' | 'favorites' | 'requests' | 'profile'
type Phase = 'splash' | 'auth' | 'app'

export default function AppPage() {
  // Phase
  const [phase, setPhase] = useState<Phase>('splash')
  const [user, setUser] = useState<User | null>(null)
  const [isGuest, setIsGuest] = useState(false)

  // Navigation
  const [activeScreen, setActiveScreen] = useState<Screen>('home')
  const [selectedListing, setSelectedListing] = useState<ListingData | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [showFeedback, setShowFeedback] = useState(false)

  // Data
  const [listings, setListings] = useState<ListingData[]>([...MOCK_LISTINGS])
  const [feed, setFeed] = useState<FeedData>(getMockFeed())
  const [favs, setFavs] = useState<number[]>([])
  const [loading, setLoading] = useState(false)

  // Toast
  const [toastMsg, setToastMsg] = useState('')
  const toastTimer = useRef<ReturnType<typeof setTimeout>>()

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg)
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToastMsg(''), 3000)
  }, [])

  // Refresh feed when listings change
  useEffect(() => {
    setFeed({
      populyarni: [...listings].sort((a, b) => b.views - a.views).slice(0, 5),
      novi: listings.filter(l => l.isNew).slice(0, 6),
      rekomendovani: listings.filter(l => l.isFeatured || l.isPromoted).slice(0, 8),
    })
  }, [listings])

  const toggleFav = useCallback((id: number) => {
    setFavs(prev => {
      const next = prev.includes(id) ? prev.filter(f => f !== id) : [...prev, id]
      return next
    })
  }, [])

  const handleLogin = (u: User) => {
    setUser(u)
    setIsGuest(false)
    setPhase('app')
    showToast(`✅ Ви увійшли як ${u.name}`)
  }

  const handleGuest = () => {
    setIsGuest(true)
    setPhase('app')
    showToast('Гостьовий режим')
  }

  const handleLogout = () => {
    setUser(null)
    setIsGuest(false)
    setFavs([])
    setPhase('splash')
  }

  const openListing = (l: ListingData) => {
    setSelectedListing(l)
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior })
  }

  const closeListing = () => setSelectedListing(null)

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
      images: data.images || [],
      features: data.features || [],
      isActive: true,
      views: 0,
      likes: 0,
      score: 0,
      isPromoted: false,
      isNew: true,
      promotedUntil: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ownerName: user?.name || null,
      ownerPhone: user?.phone || null,
    }
    setListings(prev => [newListing, ...prev])
    setShowAdd(false)
    showToast('✅ Оголошення опубліковано!')
    setActiveScreen('requests')
  }

  const handleDeleteListing = (id: number) => {
    setListings(prev => prev.filter(l => l.id !== id))
    showToast('Оголошення видалено')
  }

  // ── RENDER ──────────────────────────────────────────────────
  if (phase === 'splash') {
    return (
      <>
        <SplashScreen onEnter={() => setPhase('auth')} onGuest={handleGuest} />
        <Toast msg={toastMsg} />
      </>
    )
  }

  if (phase === 'auth') {
    return (
      <>
        <AuthScreen onDone={handleLogin} onGuest={handleGuest} />
        <Toast msg={toastMsg} />
      </>
    )
  }

  if (showFeedback) {
    return (
      <>
        <FeedbackScreen onBack={() => setShowFeedback(false)} />
        <Toast msg={toastMsg} />
      </>
    )
  }

  if (showAdd) {
    return (
      <>
        <AddListingScreen
          user={user}
          onBack={() => setShowAdd(false)}
          onCreated={handleAddListing}
          onGoProfile={() => { setShowAdd(false); setActiveScreen('profile') }}
        />
        <Toast msg={toastMsg} />
      </>
    )
  }

  if (selectedListing) {
    return (
      <>
        <DetailScreen
          listing={selectedListing}
          isFavorite={favs.includes(selectedListing.id)}
          onBack={closeListing}
          onFavorite={toggleFav}
          onSimilar={openListing}
          allListings={listings}
          user={user}
          isGuest={isGuest && !user}
          onLogin={() => { setSelectedListing(null); setPhase('auth') }}
          showToast={showToast}
        />
        <Toast msg={toastMsg} />
      </>
    )
  }

  return (
    <>
      <div style={{ paddingBottom: 80 }}>
        {activeScreen === 'home' && (
          <HomeScreen
            listings={listings}
            feed={feed}
            onListing={openListing}
            onFavorite={toggleFav}
            favorites={favs}
            user={user}
            isGuest={isGuest && !user}
            onLogin={() => setPhase('auth')}
            onAddListing={() => {
              if (!user) { setPhase('auth'); return }
              setShowAdd(true)
            }}
            loading={loading}
            onProfile={() => setActiveScreen('profile')}
            onRefresh={async () => {
              await new Promise(r => setTimeout(r, 600))
            }}
          />
        )}

        {activeScreen === 'messages' && (
          <ChatsScreen
            user={user}
            isGuest={isGuest && !user}
            onLogin={() => setPhase('auth')}
          />
        )}

        {activeScreen === 'favorites' && (
          <FavoritesScreen
            favorites={favs}
            allListings={listings}
            onListing={openListing}
            onFavorite={toggleFav}
          />
        )}

        {activeScreen === 'requests' && (
          <RequestsScreen
            user={user}
            isGuest={isGuest && !user}
            listings={listings}
            onLogin={() => setPhase('auth')}
            onAddListing={() => {
              if (!user) { setPhase('auth'); return }
              setShowAdd(true)
            }}
            onListing={openListing}
            onDelete={handleDeleteListing}
          />
        )}

        {activeScreen === 'profile' && (
          <ProfileScreen
            user={user}
            isGuest={isGuest && !user}
            onLogin={() => setPhase('auth')}
            onAddListing={() => {
              if (!user) { setPhase('auth'); return }
              setShowAdd(true)
            }}
            onFeedback={() => setShowFeedback(true)}
            favCount={favs.length}
            onLogout={handleLogout}
            showToast={showToast}
          />
        )}
      </div>

      <BottomNav
        active={activeScreen}
        onChange={setActiveScreen}
        favCount={favs.length}
        unreadMessages={0}
      />

      <Toast msg={toastMsg} />
    </>
  )
}
