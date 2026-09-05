export interface User {
  id: string
  name: string
  email: string
  phone?: string
  role?: 'user' | 'landlord' | 'admin'
  image?: string
}

// Lifecycle status — public.listings.status, source of truth for
// moderation/visibility (see supabase/migrations/20260830110000_listing_status_enforce.sql).
// Not applied to the live DB yet — see ListingData.status below.
export type ListingStatus = 'draft' | 'pending_review' | 'active' | 'rejected' | 'paused' | 'archived'

export interface ListingData {
  id: number
  userId: string
  // Supabase Auth uid bridge column (listings.owner_id) — the column RLS
  // ownership checks will use post-STAGE2, kept alongside userId (still
  // the same value in practice) rather than replacing it. See
  // src/lib/db.ts rowToListing()/listingToRow().
  ownerId?: string
  title: string
  type: string
  // price/area/district/address stay non-null here — this is the "complete
  // listing" shape every existing display component assumes (catalog,
  // detail, favorites). A partial draft (wizard step 1 of 5) CAN exist in
  // the DB without them once Migration A is applied (NOT NULL dropped) —
  // represented on the write path as Partial<ListingData> (dbSaveDraft
  // already takes that), not by widening this type. Draft-aware reading/
  // rendering (null-safe "Мої оголошення") is E.2.3 scope, not E.2.1.
  price: number
  area: number
  floor: number | null
  totalFloors: number | null
  district: string
  address: string
  city: string
  condition: string | null
  // "Комунальні платежі" (спека §19) — nullable, plain text, no enum CHECK
  // in the DB (same convention as type/condition/district).
  utilities: string | null
  // "Тип будівлі" (спека §19) — nullable, plain text, no enum CHECK.
  buildingType: string | null
  parking: boolean
  separateEntrance: boolean
  description: string | null
  images: string[]
  features: string[]
  // `null` means the live row predates the status migration or the
  // migration hasn't been applied yet — never derived/defaulted from
  // isActive client-side (see rowToListing() in src/lib/db.ts). Once
  // Migration A/B are applied this is always one of the six real values.
  status: ListingStatus | null
  rejectionReason: string | null
  moderatedAt: string | null
  // Set by enforce_listing_lifecycle() (Migration B) at the exact moment
  // of each real transition — never client-writable, see that file's
  // "Гарантии" comment. `null` until Migration A adds the column AND a
  // real transition has happened since (a draft that's never been
  // submitted has no pending_review_at yet, that's honest, not a bug).
  pendingReviewAt: string | null
  publishedAt: string | null
  archivedAt: string | null
  // is_active stays a purely server-derived read: after Migration B it's
  // computed unconditionally from status by the DB trigger and is never
  // written by the client (see enforce_listing_lifecycle()). Kept as its
  // own field because existing visibility filtering already reads it.
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
// Спека §19 — крок 2 мастера ("Характеристики"). Plain-text values, той же
// принцип без enum CHECK у БД, що й type/condition/district (див.
// supabase/migrations/20260830100000_listing_status_expand.sql, розділ 1.1).
export const UTILITIES_OPTIONS = ['Включено', 'Окремо', 'За домовленістю']
export const BUILDING_TYPES = ['Бізнес-центр', 'Окрема будівля', 'Житловий будинок', 'Інше']

export function maskPhone(raw: string): string {
  const d = raw.replace(/\D/g, '')
  const n = d.length === 12 && d.startsWith('38') ? d.slice(2) : d
  if (n.length < 7) return '*** *** ****'
  const v = n.slice(0, n.length - 4)
  return v.slice(0, 3) + ' ' + v.slice(3) + ' ** **'
}

export function formatPhone(raw: string): string {
  if (!raw) return ''
  const d = raw.replace(/\D/g, '')
  // Get 10-digit Ukrainian number
  const n = d.startsWith('380') ? d.slice(2) : d.startsWith('38') && d.length === 12 ? d.slice(2) : d
  if (n.length !== 10) return raw
  return '(' + n.slice(0, 3) + ') ' + n.slice(3, 6) + ' ' + n.slice(6, 8) + ' ' + n.slice(8)
}

// Returns proper tel: href — always tel:+380XXXXXXXXX
export function telHref(raw: string): string {
  if (!raw) return ''
  const d = raw.replace(/\D/g, '')
  // Already has country code
  if (d.startsWith('380') && d.length === 12) return 'tel:+' + d
  // Has 38 prefix
  if (d.startsWith('38') && d.length === 12) return 'tel:+' + d
  // 10 digits — add +38
  if (d.length === 10) return 'tel:+38' + d
  // 9 digits — add +380
  if (d.length === 9) return 'tel:+380' + d
  // Fallback
  return 'tel:+' + d
}
