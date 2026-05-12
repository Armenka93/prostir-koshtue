// LocalStorage-based persistence — simulates real DB for frontend
// Replace with Supabase calls when ready

import type { User, ListingData } from '@/types'

const KEYS = {
  USER: 'pk_user',
  SESSION: 'pk_session',
  FAVS: 'pk_favs',
  LISTINGS: 'pk_listings',
  ACCOUNTS: 'pk_accounts',
}

export interface Account {
  id: string
  name: string
  email: string
  phone: string
  role: 'user' | 'landlord' | 'admin'
  passwordHash: string
  createdAt: string
}

// Simple hash (not secure — use bcrypt on real backend)
function simpleHash(str: string): string {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i)
    hash |= 0
  }
  return hash.toString(36)
}

// ── ACCOUNTS ─────────────────────────────────────────────────
function getAccounts(): Account[] {
  try { return JSON.parse(localStorage.getItem(KEYS.ACCOUNTS) || '[]') } catch { return [] }
}
function saveAccounts(accounts: Account[]) {
  localStorage.setItem(KEYS.ACCOUNTS, JSON.stringify(accounts))
}

export function registerAccount(name: string, email: string, phone: string, password: string): { ok: boolean; error?: string; user?: User } {
  const accounts = getAccounts()
  if (accounts.find(a => a.email.toLowerCase() === email.toLowerCase())) {
    return { ok: false, error: 'Акаунт з таким email вже існує. Увійдіть.' }
  }
  const account: Account = {
    id: 'u_' + Date.now(),
    name, email, phone,
    role: 'landlord',
    passwordHash: simpleHash(password),
    createdAt: new Date().toISOString(),
  }
  accounts.push(account)
  saveAccounts(accounts)
  const user: User = { id: account.id, name, email, phone, role: 'landlord' }
  saveSession(user)
  return { ok: true, user }
}

export function loginAccount(email: string, password: string): { ok: boolean; error?: string; user?: User } {
  const accounts = getAccounts()
  const account = accounts.find(a => a.email.toLowerCase() === email.toLowerCase())
  if (!account) {
    return { ok: false, error: 'Акаунту з таким email не існує. Зареєструйтесь.' }
  }
  if (account.passwordHash !== simpleHash(password)) {
    return { ok: false, error: 'Невірний пароль.' }
  }
  const user: User = { id: account.id, name: account.name, email: account.email, phone: account.phone, role: account.role }
  saveSession(user)
  return { ok: true, user }
}

// ── SESSION ───────────────────────────────────────────────────
export function saveSession(user: User) {
  localStorage.setItem(KEYS.USER, JSON.stringify(user))
  localStorage.setItem(KEYS.SESSION, Date.now().toString())
}

export function loadSession(): User | null {
  try {
    const raw = localStorage.getItem(KEYS.USER)
    if (!raw) return null
    return JSON.parse(raw) as User
  } catch { return null }
}

export function clearSession() {
  localStorage.removeItem(KEYS.USER)
  localStorage.removeItem(KEYS.SESSION)
}

// ── FAVOURITES ────────────────────────────────────────────────
export function loadFavs(userId: string): number[] {
  try { return JSON.parse(localStorage.getItem(KEYS.FAVS + '_' + userId) || '[]') } catch { return [] }
}

export function saveFavs(userId: string, favs: number[]) {
  localStorage.setItem(KEYS.FAVS + '_' + userId, JSON.stringify(favs))
}

// ── USER LISTINGS ─────────────────────────────────────────────
export function loadUserListings(userId: string): ListingData[] {
  try { return JSON.parse(localStorage.getItem(KEYS.LISTINGS + '_' + userId) || '[]') } catch { return [] }
}

export function saveUserListings(userId: string, listings: ListingData[]) {
  localStorage.setItem(KEYS.LISTINGS + '_' + userId, JSON.stringify(listings))
}
