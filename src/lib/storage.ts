/**
 * DATABASE LAYER — localStorage persistence
 * Всі дані зберігаються тут. Легко замінити на Supabase.
 */
import type { User, ListingData } from '@/types'

export const ADMIN_EMAIL = 'armen.saakyan9393@gmail.com'
const isAdminEmail = (e: string) => e.toLowerCase().trim() === ADMIN_EMAIL.toLowerCase()

const K = {
  SESSION:   'pk_session',
  ACCOUNTS:  'pk_accounts',
  FAVS:      'pk_favs_',
  LISTINGS:  'pk_listings',   // ALL published listings (global)
  CHATS:     'pk_chats',
  MESSAGES:  'pk_msgs_',
  FEEDBACK:  'pk_feedback',
}

function safe_get<T>(key: string, def: T): T {
  if (typeof window === 'undefined') return def
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : def } catch { return def }
}
function safe_set(key: string, val: unknown) {
  if (typeof window === 'undefined') return
  try { localStorage.setItem(key, JSON.stringify(val)) } catch {}
}
function safe_del(key: string) {
  if (typeof window === 'undefined') return
  try { localStorage.removeItem(key) } catch {}
}
function hash(s: string): string {
  let h = 0
  for (let i = 0; i < s.length; i++) { h = ((h << 5) - h) + s.charCodeAt(i); h |= 0 }
  return h.toString(36)
}

// ── ACCOUNTS ─────────────────────────────────────────────────
export interface Account {
  id: string; name: string; email: string; phone: string
  role: 'user' | 'landlord' | 'admin'; passwordHash: string
  createdAt: string; avatar?: string; bio?: string
}

export function getAccounts(): Account[] { return safe_get<Account[]>(K.ACCOUNTS, []) }

export function registerAccount(name: string, email: string, phone: string, password: string): { ok: boolean; error?: string; user?: User } {
  const accounts = getAccounts()
  if (accounts.find(a => a.email.toLowerCase() === email.toLowerCase()))
    return { ok: false, error: 'Акаунт з таким email вже існує. Увійдіть.' }
  const acc: Account = {
    id: 'u_' + Date.now(), name, email, phone,
    role: isAdminEmail(email) ? 'admin' : 'landlord',
    passwordHash: hash(password),
    createdAt: new Date().toISOString(),
  }
  safe_set(K.ACCOUNTS, [...accounts, acc])
  const user: User = { id: acc.id, name, email, phone, role: acc.role }
  saveSession(user)
  return { ok: true, user }
}

export function loginAccount(email: string, password: string): { ok: boolean; error?: string; user?: User } {
  const acc = getAccounts().find(a => a.email.toLowerCase() === email.toLowerCase())
  if (!acc) return { ok: false, error: 'Акаунту з таким email не існує. Зареєструйтесь.' }
  if (acc.passwordHash !== hash(password)) return { ok: false, error: 'Невірний пароль.' }
  const role = isAdminEmail(acc.email) ? 'admin' : acc.role
  const user: User = { id: acc.id, name: acc.name, email: acc.email, phone: acc.phone, role }
  saveSession(user)
  return { ok: true, user }
}

export function updateAccount(userId: string, updates: Partial<Account>): User | null {
  const accounts = getAccounts()
  const idx = accounts.findIndex(a => a.id === userId)
  if (idx === -1) return null
  accounts[idx] = { ...accounts[idx], ...updates }
  safe_set(K.ACCOUNTS, accounts)
  const acc = accounts[idx]
  return { id: acc.id, name: acc.name, email: acc.email, phone: acc.phone, role: acc.role }
}

// ── SESSION ───────────────────────────────────────────────────
export function saveSession(user: User) { safe_set(K.SESSION, user) }
export function loadSession(): User | null { return safe_get<User | null>(K.SESSION, null) }
export function clearSession() { safe_del(K.SESSION) }

// ── FAVOURITES ────────────────────────────────────────────────
export function loadFavs(userId: string): number[] { return safe_get<number[]>(K.FAVS + userId, []) }
export function saveFavs(userId: string, favs: number[]) { safe_set(K.FAVS + userId, favs) }

// ── LISTINGS — GLOBAL PERSISTENCE ────────────────────────────
// All user-published listings stored in ONE key.
// Mock listings from mockData.ts are NOT stored here.

export function getPublishedListings(): ListingData[] {
  return safe_get<ListingData[]>(K.LISTINGS, [])
}

export function publishListing(listing: ListingData): void {
  const all = getPublishedListings()
  // Prevent duplicates
  const without = all.filter(l => l.id !== listing.id)
  safe_set(K.LISTINGS, [listing, ...without])
}

export function deleteListing(id: number): void {
  const all = getPublishedListings()
  safe_set(K.LISTINGS, all.filter(l => l.id !== id))
}

export function updateListing(id: number, updates: Partial<ListingData>): void {
  const all = getPublishedListings()
  safe_set(K.LISTINGS, all.map(l => l.id === id ? { ...l, ...updates } : l))
}

// Legacy (kept for compatibility)
export function loadUserListings(userId: string): ListingData[] {
  return getPublishedListings().filter(l => l.userId === userId)
}
export function saveUserListings(_userId: string, _listings: ListingData[]) {
  // No-op: use publishListing() instead
}

// ── CHATS & MESSAGES ─────────────────────────────────────────
export interface ChatRecord {
  id: string; listingId: number; listingTitle: string
  buyerId: string; buyerName: string; sellerId: string; sellerName: string
  lastMessage: string; lastAt: string
  unreadBuyer: number; unreadSeller: number; createdAt: string
}
export interface MessageRecord {
  id: string; chatId: string; senderId: string; senderName: string
  text: string; createdAt: string
}

export function getChats(): ChatRecord[] { return safe_get<ChatRecord[]>(K.CHATS, []) }
export function saveChats(chats: ChatRecord[]) { safe_set(K.CHATS, chats) }
export function getMessages(chatId: string): MessageRecord[] { return safe_get<MessageRecord[]>(K.MESSAGES + chatId, []) }
export function saveMessages(chatId: string, msgs: MessageRecord[]) { safe_set(K.MESSAGES + chatId, msgs) }

export function sendMessage(listingId: number, listingTitle: string, buyer: User, seller: { id: string; name: string }, text: string): { chat: ChatRecord; message: MessageRecord } {
  const chats = getChats()
  let chat = chats.find(c => c.listingId === listingId && c.buyerId === buyer.id && c.sellerId === seller.id)
  if (!chat) {
    chat = { id: 'chat_' + Date.now(), listingId, listingTitle, buyerId: buyer.id, buyerName: buyer.name, sellerId: seller.id, sellerName: seller.name, lastMessage: text, lastAt: new Date().toISOString(), unreadBuyer: 0, unreadSeller: 1, createdAt: new Date().toISOString() }
    saveChats([...chats, chat])
  } else {
    chat.lastMessage = text; chat.lastAt = new Date().toISOString(); chat.unreadSeller += 1
    saveChats(chats.map(c => c.id === chat!.id ? chat! : c))
  }
  const msg: MessageRecord = { id: 'msg_' + Date.now(), chatId: chat.id, senderId: buyer.id, senderName: buyer.name, text, createdAt: new Date().toISOString() }
  saveMessages(chat.id, [...getMessages(chat.id), msg])
  return { chat, message: msg }
}

export function getUserChats(userId: string): ChatRecord[] {
  return getChats().filter(c => c.buyerId === userId || c.sellerId === userId)
    .sort((a, b) => new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime())
}

export function markChatRead(chatId: string, userId: string) {
  saveChats(getChats().map(c => {
    if (c.id !== chatId) return c
    return c.buyerId === userId ? { ...c, unreadBuyer: 0 } : c.sellerId === userId ? { ...c, unreadSeller: 0 } : c
  }))
}

export function deleteChat(chatId: string) {
  saveChats(getChats().filter(c => c.id !== chatId))
  safe_del(K.MESSAGES + chatId)
}

export function getUnreadCount(userId: string): number {
  return getChats().reduce((s, c) => s + (c.buyerId === userId ? c.unreadBuyer : c.sellerId === userId ? c.unreadSeller : 0), 0)
}

// ── FEEDBACK ─────────────────────────────────────────────────
export interface FeedbackRecord {
  id: string; name: string; email: string; message: string
  createdAt: string; read: boolean
}
export function getFeedbacks(): FeedbackRecord[] { return safe_get<FeedbackRecord[]>(K.FEEDBACK, []) }
export function saveFeedback(fb: Omit<FeedbackRecord, 'id' | 'createdAt' | 'read'>) {
  safe_set(K.FEEDBACK, [...getFeedbacks(), { ...fb, id: 'fb_' + Date.now(), createdAt: new Date().toISOString(), read: false }])
}
export function markFeedbackRead(id: string) {
  safe_set(K.FEEDBACK, getFeedbacks().map(f => f.id === id ? { ...f, read: true } : f))
}
