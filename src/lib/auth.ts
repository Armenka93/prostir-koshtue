/**
 * AUTH — Supabase accounts + localStorage session
 */
import { dbFindAccount, dbFindAccountById, dbCreateAccount, dbUpdateAccount, isSupabaseReady, type DbAccount } from './db'
import type { User } from '@/types'

export const ADMIN_EMAIL = 'armen.saakyan9393@gmail.com'

function isAdminEmail(e: string) {
  return e.toLowerCase().trim() === ADMIN_EMAIL.toLowerCase()
}

export function hash(s: string): string {
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
    image: acc.avatar_url || undefined,
  }
}

export async function registerAccount(
  name: string, email: string, phone: string, password: string
): Promise<{ ok: boolean; error?: string; user?: User }> {
  if (!isSupabaseReady()) {
    return { ok: false, error: 'База даних не налаштована. Перевірте налаштування Vercel.' }
  }

  try {
    // Check if already exists
    const existing = await dbFindAccount(email)
    if (existing) return { ok: false, error: 'Акаунт з таким email вже існує. Увійдіть.' }

    const acc: DbAccount = {
      id: 'u_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
      name: name.trim(),
      email: email.toLowerCase().trim(),
      phone: phone.trim(),
      role: isAdminEmail(email) ? 'admin' : 'landlord',
      password_hash: hash(password),
      created_at: new Date().toISOString(),
    }

    const result = await dbCreateAccount(acc)
    if (!result.ok) {
      return { ok: false, error: `Помилка реєстрації: ${result.error}` }
    }

    const user = accToUser(acc)
    saveSession(user)
    return { ok: true, user }
  } catch (e: any) {
    console.error('[registerAccount]', e)
    return { ok: false, error: 'Помилка підключення до бази даних.' }
  }
}

export async function loginAccount(
  email: string, password: string
): Promise<{ ok: boolean; error?: string; user?: User }> {
  if (!isSupabaseReady()) {
    return { ok: false, error: 'База даних не налаштована.' }
  }

  try {
    const acc = await dbFindAccount(email)
    if (!acc) return { ok: false, error: 'Акаунту з таким email не існує. Зареєструйтесь.' }
    if (acc.password_hash !== hash(password)) return { ok: false, error: 'Невірний пароль.' }

    const user = accToUser(acc)
    saveSession(user)
    return { ok: true, user }
  } catch (e: any) {
    console.error('[loginAccount]', e)
    return { ok: false, error: 'Помилка підключення до бази даних.' }
  }
}

export async function changePassword(
  userId: string, currentPassword: string, newPassword: string
): Promise<{ ok: boolean; error?: string }> {
  if (!isSupabaseReady()) return { ok: false, error: 'База даних не налаштована.' }
  try {
    const acc = await dbFindAccountById(userId)
    if (!acc) return { ok: false, error: 'Акаунт не знайдено.' }
    if (acc.password_hash !== hash(currentPassword)) return { ok: false, error: 'Поточний пароль невірний.' }
    if (newPassword.length < 6) return { ok: false, error: 'Новий пароль має містити щонайменше 6 символів.' }
    const ok = await dbUpdateAccount(userId, { password_hash: hash(newPassword) })
    if (!ok) return { ok: false, error: 'Не вдалося зберегти новий пароль.' }
    return { ok: true }
  } catch (e: any) {
    console.error('[changePassword]', e)
    return { ok: false, error: 'Помилка підключення до бази даних.' }
  }
}

export async function changeEmail(
  userId: string, newEmail: string
): Promise<{ ok: boolean; error?: string }> {
  if (!isSupabaseReady()) return { ok: false, error: 'База даних не налаштована.' }
  const email = newEmail.toLowerCase().trim()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: 'Введіть коректний email.' }
  try {
    const existing = await dbFindAccount(email)
    if (existing && existing.id !== userId) return { ok: false, error: 'Цей email вже використовується іншим акаунтом.' }
    const ok = await dbUpdateAccount(userId, { email })
    if (!ok) return { ok: false, error: 'Не вдалося зберегти email.' }
    return { ok: true }
  } catch (e: any) {
    console.error('[changeEmail]', e)
    return { ok: false, error: 'Помилка підключення до бази даних.' }
  }
}
// Session — localStorage per device
const SESSION_KEY = 'pk_session_v3'

export function saveSession(user: User) {
  if (typeof window === 'undefined') return
  try { localStorage.setItem(SESSION_KEY, JSON.stringify(user)) } catch {}
}

export function loadSession(): User | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    if (!raw) return null
    return JSON.parse(raw) as User
  } catch { return null }
}

export function clearSession() {
  if (typeof window === 'undefined') return
  try {
    localStorage.removeItem(SESSION_KEY)
    localStorage.removeItem('pk_session_v2')
    localStorage.removeItem('pk_session')
  } catch {}
}
