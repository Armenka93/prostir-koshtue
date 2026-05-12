export interface User {
  id: string
  name: string
  email: string
  phone?: string
  role?: 'user' | 'landlord' | 'admin'
  image?: string
}

export interface ListingData {
  id: number
  userId: string
  title: string
  type: string
  price: number
  area: number
  floor: number | null
  totalFloors: number | null
  district: string
  address: string
  city: string
  condition: string | null
  parking: boolean
  separateEntrance: boolean
  description: string | null
  images: string[]
  features: string[]
  isActive: boolean
  views: number
  likes: number
  score: number
  isPromoted: boolean
  isNew?: boolean
  isFeatured?: boolean
  promotedUntil: string | null
  createdAt: string
  updatedAt: string
  ownerName?: string | null
  ownerPhone?: string | null
}

export interface FeedData {
  novi: ListingData[]
  populyarni: ListingData[]
  rekomendovani: ListingData[]
}

export interface ChatData {
  id: number
  listingId: number | null
  buyerId: string
  sellerId: string
  lastMessage: string | null
  lastMessageAt: string | null
  buyerUnread: number
  sellerUnread: number
  createdAt: string
  otherUserName?: string
  listingTitle?: string | null
  unread?: number
}

export interface ChatMessageData {
  id: number
  chatId: number
  senderId: string
  text: string
  createdAt: string
  senderName?: string
  isMe?: boolean
}

export const TYPE_COLORS: Record<string, string> = {
  'Офіс': '#2A9FD6',
  'Рітейл': '#22C55E',
  'Склад': '#8B5CF6',
  'Кафе/Ресторан': '#FFB020',
  'Салон': '#EC4899',
  'Шоурум': '#F97316',
  'Гнучкий простір': '#14B8A6',
}

export const CATEGORIES = [
  { id: 'all', label: 'Всі', icon: '🏢' },
  { id: 'Офіс', label: 'Офіси', icon: '💼' },
  { id: 'Рітейл', label: 'Рітейл', icon: '🛍️' },
  { id: 'Склад', label: 'Склади', icon: '📦' },
  { id: 'Кафе/Ресторан', label: 'Кафе', icon: '☕' },
  { id: 'Салон', label: 'Салони', icon: '✂️' },
  { id: 'Гнучкий простір', label: 'Гнучкі', icon: '⚡' },
  { id: 'Шоурум', label: 'Шоуруми', icon: '🎨' },
]

export const DISTRICTS = [
  'Всі райони', 'Приморський', 'Київський', 'Суворовський',
  'Малиновський', 'Центр', 'Аркадія', 'Фонтан', 'Таїрова', 'Молдаванка',
]

export const PROPERTY_TYPES = ['Офіс', 'Рітейл', 'Склад', 'Кафе/Ресторан', 'Салон', 'Шоурум', 'Гнучкий простір']
export const CONDITIONS = ['Євроремонт', 'Косметичний ремонт', 'Shell & Core', 'Задовільний', 'Потребує ремонту']

export function maskPhone(raw: string): string {
  const d = raw.replace(/\D/g, '')
  const n = d.length === 12 && d.startsWith('38') ? d.slice(2) : d
  if (n.length < 7) return '*** *** ****'
  const v = n.slice(0, n.length - 4)
  return v.slice(0, 3) + ' ' + v.slice(3) + ' ** **'
}

export function formatPhone(raw: string): string {
  const d = raw.replace(/\D/g, '')
  const n = d.length === 12 && d.startsWith('38') ? d.slice(2) : d
  if (n.length !== 10) return raw
  return n.slice(0, 3) + ' ' + n.slice(3, 6) + ' ' + n.slice(6, 8) + ' ' + n.slice(8)
}
