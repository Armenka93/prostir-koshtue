/**
 * LOCAL STORAGE DATABASE
 * Симулює реальну БД — легко замінити на Supabase
 */
import type { User, ListingData } from '@/types'

export const ADMIN_EMAIL = 'armen.saakyan9393@gmail.com'

const K = {
  USER: 'pk_user',
  ACCOUNTS: 'pk_accounts',
  FAVS: 'pk_favs_',
  LISTINGS: 'pk_listings_',
  CHATS: 'pk_chats',
  MESSAGES: 'pk_msgs_',
  FEEDBACK: 'pk_feedback',
}

function get<T>(key: string, def: T): T {
  if (typeof window === 'undefined') return def
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : def } catch { return def }
}
function set(key: string, val: unknown) {
  if (typeof window === 'undefined') return
  try { localStorage.setItem(key, JSON.stringify(val)) } catch {}
}

function hash(s: string): string {
  let h = 0
  for (let i = 0; i < s.length; i++) { h = ((h << 5) - h) + s.charCodeAt(i); h |= 0 }
  return h.toString(36)
}

// ── ACCOUNTS ─────────────────────────────────────────────────
export interface Account {
  id: string; name: string; email: string; phone: string
  role: 'user' | 'landlord' | 'admin'; passwordHash: string; createdAt: string
  avatar?: string; bio?: string
}

export function getAccounts(): Account[] { return get<Account[]>(K.ACCOUNTS, []) }

export function registerAccount(name: string, email: string, phone: string, password: string): { ok: boolean; error?: string; user?: User } {
  const accounts = getAccounts()
  if (accounts.find(a => a.email.toLowerCase() === email.toLowerCase()))
    return { ok: false, error: 'Акаунт з таким email вже існує. Увійдіть.' }
  const isAdmin = email.toLowerCase() === ADMIN_EMAIL.toLowerCase()
  const acc: Account = {
    id: 'u_' + Date.now(),
    name, email, phone,
    role: isAdmin ? 'admin' : 'landlord',
    passwordHash: hash(password),
    createdAt: new Date().toISOString(),
  }
  set(K.ACCOUNTS, [...accounts, acc])
  const user: User = { id: acc.id, name, email, phone, role: acc.role }
  saveSession(user)
  return { ok: true, user }
}

export function loginAccount(email: string, password: string): { ok: boolean; error?: string; user?: User } {
  const acc = getAccounts().find(a => a.email.toLowerCase() === email.toLowerCase())
  if (!acc) return { ok: false, error: 'Акаунту з таким email не існує. Зареєструйтесь.' }
  if (acc.passwordHash !== hash(password)) return { ok: false, error: 'Невірний пароль.' }
  const isAdmin = acc.email.toLowerCase() === ADMIN_EMAIL.toLowerCase()
  const user: User = { id: acc.id, name: acc.name, email: acc.email, phone: acc.phone, role: isAdmin ? 'admin' : acc.role }
  saveSession(user)
  return { ok: true, user }
}

export function updateAccount(userId: string, updates: Partial<Account>): User | null {
  const accounts = getAccounts()
  const idx = accounts.findIndex(a => a.id === userId)
  if (idx === -1) return null
  accounts[idx] = { ...accounts[idx], ...updates }
  set(K.ACCOUNTS, accounts)
  const acc = accounts[idx]
  const user: User = { id: acc.id, name: acc.name, email: acc.email, phone: acc.phone, role: acc.role }
  saveSession(user)
  return user
}

export function getAccount(userId: string): Account | null {
  return getAccounts().find(a => a.id === userId) || null
}

// ── SESSION ───────────────────────────────────────────────────
export function saveSession(user: User) { set(K.USER, user) }
export function loadSession(): User | null { return get<User | null>(K.USER, null) }
export function clearSession() { if (typeof window !== 'undefined') localStorage.removeItem(K.USER) }

// ── FAVOURITES ────────────────────────────────────────────────
export function loadFavs(userId: string): number[] { return get<number[]>(K.FAVS + userId, []) }
export function saveFavs(userId: string, favs: number[]) { set(K.FAVS + userId, favs) }

// ── USER LISTINGS ─────────────────────────────────────────────
export function loadUserListings(userId: string): ListingData[] { return get<ListingData[]>(K.LISTINGS + userId, []) }
export function saveUserListings(userId: string, listings: ListingData[]) { set(K.LISTINGS + userId, listings) }

// ── CHATS & MESSAGES ─────────────────────────────────────────
export interface ChatRecord {
  id: string
  listingId: number
  listingTitle: string
  buyerId: string
  buyerName: string
  sellerId: string
  sellerName: string
  lastMessage: string
  lastAt: string
  unreadBuyer: number
  unreadSeller: number
  createdAt: string
}

export interface MessageRecord {
  id: string
  chatId: string
  senderId: string
  senderName: string
  text: string
  createdAt: string
}

export function getChats(): ChatRecord[] { return get<ChatRecord[]>(K.CHATS, []) }
export function saveChats(chats: ChatRecord[]) { set(K.CHATS, chats) }

export function getMessages(chatId: string): MessageRecord[] { return get<MessageRecord[]>(K.MESSAGES + chatId, []) }
export function saveMessages(chatId: string, msgs: MessageRecord[]) { set(K.MESSAGES + chatId, msgs) }

export function sendMessage(
  listingId: number, listingTitle: string,
  buyer: User, seller: { id: string; name: string },
  text: string
): { chat: ChatRecord; message: MessageRecord } {
  const chats = getChats()
  let chat = chats.find(c => c.listingId === listingId && c.buyerId === buyer.id && c.sellerId === seller.id)

  if (!chat) {
    chat = {
      id: 'chat_' + Date.now(),
      listingId, listingTitle,
      buyerId: buyer.id, buyerName: buyer.name,
      sellerId: seller.id, sellerName: seller.name,
      lastMessage: text, lastAt: new Date().toISOString(),
      unreadBuyer: 0, unreadSeller: 1,
      createdAt: new Date().toISOString(),
    }
    saveChats([...chats, chat])
  } else {
    chat.lastMessage = text
    chat.lastAt = new Date().toISOString()
    chat.unreadSeller += 1
    saveChats(chats.map(c => c.id === chat!.id ? chat! : c))
  }

  const msg: MessageRecord = {
    id: 'msg_' + Date.now(),
    chatId: chat.id,
    senderId: buyer.id, senderName: buyer.name,
    text, createdAt: new Date().toISOString(),
  }
  const msgs = getMessages(chat.id)
  saveMessages(chat.id, [...msgs, msg])

  return { chat, message: msg }
}

export function getUserChats(userId: string): ChatRecord[] {
  return getChats()
    .filter(c => c.buyerId === userId || c.sellerId === userId)
    .sort((a, b) => new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime())
}

export function markChatRead(chatId: string, userId: string) {
  const chats = getChats()
  const updated = chats.map(c => {
    if (c.id !== chatId) return c
    if (c.buyerId === userId) return { ...c, unreadBuyer: 0 }
    if (c.sellerId === userId) return { ...c, unreadSeller: 0 }
    return c
  })
  saveChats(updated)
}

export function getUnreadCount(userId: string): number {
  return getChats().reduce((sum, c) => {
    if (c.buyerId === userId) return sum + c.unreadBuyer
    if (c.sellerId === userId) return sum + c.unreadSeller
    return sum
  }, 0)
}

// ── FEEDBACK ─────────────────────────────────────────────────
export interface FeedbackRecord {
  id: string; name: string; email: string; message: string
  createdAt: string; read: boolean
}
export function getFeedbacks(): FeedbackRecord[] { return get<FeedbackRecord[]>(K.FEEDBACK, []) }
export function saveFeedback(fb: Omit<FeedbackRecord, 'id' | 'createdAt' | 'read'>) {
  const all = getFeedbacks()
  set(K.FEEDBACK, [...all, { ...fb, id: 'fb_' + Date.now(), createdAt: new Date().toISOString(), read: false }])
}
export function markFeedbackRead(id: string) {
  set(K.FEEDBACK, getFeedbacks().map(f => f.id === id ? { ...f, read: true } : f))
}
