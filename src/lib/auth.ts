/**
 * AUTH LAYER — Supabase accounts + localStorage session
 * Акаунти зберігаються в Supabase (глобально)
 * Сесія (хто залогінений) — localStorage (per device)
 */
import { dbFindAccount, dbCreateAccount, dbUpdateAccount, type DbAccount } from './db'
import type { User } from '@/types'

export const ADMIN_EMAIL = 'armen.saakyan9393@gmail.com'

function isAdminEmail(e: string) {
  return e.toLowerCase().trim() === ADMIN_EMAIL.toLowerCase()
}

function hash(s: string): string {
  let h = 0
  for (let i = 0; i < s.length; i++) { h = ((h << 5) - h) + s.charCodeAt(i); h |= 0 }
  return h.toString(36)
}

function accToUser(acc: DbAccount): User {
  return {
    id: acc.id,
    name: acc.name,
    email: acc.email,
    phone: acc.phone,
    role: isAdminEmail(acc.email) ? 'admin' : (acc.role as User['role']),
  }
}

export async function registerAccount(
  name: string, email: string, phone: string, password: string
): Promise<{ ok: boolean; error?: string; user?: User }> {
  const existing = await dbFindAccount(email)
  if (existing) return { ok: false, error: 'Акаунт з таким email вже існує. Увійдіть.' }

  const acc: DbAccount = {
    id: 'u_' + Date.now(),
    name, email: email.toLowerCase(), phone,
    role: isAdminEmail(email) ? 'admin' : 'landlord',
    password_hash: hash(password),
    created_at: new Date().toISOString(),
  }
  const ok = await dbCreateAccount(acc)
  if (!ok) return { ok: false, error: 'Помилка при реєстрації. Спробуйте ще раз.' }

  const user = accToUser(acc)
  saveSession(user)
  return { ok: true, user }
}

export async function loginAccount(
  email: string, password: string
): Promise<{ ok: boolean; error?: string; user?: User }> {
  const acc = await dbFindAccount(email)
  if (!acc) return { ok: false, error: 'Акаунту з таким email не існує. Зареєструйтесь.' }
  if (acc.password_hash !== hash(password)) return { ok: false, error: 'Невірний пароль.' }

  const user = accToUser(acc)
  saveSession(user)
  return { ok: true, user }
}

export async function updateUserProfile(
  userId: string, updates: { name?: string; phone?: string }
): Promise<User | null> {
  const ok = await dbUpdateAccount(userId, {
    name: updates.name,
    phone: updates.phone,
  })
  if (!ok) return null

  const acc = await dbFindAccount(userId).catch(() => null)
  if (!acc) return null
  const user = accToUser(acc)
  saveSession(user)
  return user
}

// ── Session (localStorage — per device) ──────────────────────
const SESSION_KEY = 'pk_session_v2'

export function saveSession(user: User) {
  if (typeof window === 'undefined') return
  try { localStorage.setItem(SESSION_KEY, JSON.stringify(user)) } catch {}
}

export function loadSession(): User | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

export function clearSession() {
  if (typeof window === 'undefined') return
  try { localStorage.removeItem(SESSION_KEY) } catch {}
}
