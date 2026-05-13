/**
 * СИСТЕМА РОЛЕЙ — єдине місце для всіх перевірок прав
 * ─────────────────────────────────────────────────────
 * Щоб додати нову роль: додай до UserRole і PERMISSIONS
 */

import type { User } from '@/types'

// ── Константи ────────────────────────────────────────────────
export const ADMIN_EMAIL = 'armen.saakyan9393@gmail.com'
export const ADMIN_USER_ID_PREFIX = 'u_admin'

export type UserRole = 'guest' | 'user' | 'landlord' | 'admin'

// Матриця дозволів — легко розширюється
export const PERMISSIONS = {
  // Перегляд
  viewListings:     ['guest', 'user', 'landlord', 'admin'],
  viewContacts:     ['user', 'landlord', 'admin'],
  viewChats:        ['user', 'landlord', 'admin'],

  // Оголошення
  createListing:    ['landlord', 'admin'],
  editOwnListing:   ['landlord', 'admin'],
  deleteOwnListing: ['landlord', 'admin'],

  // Адмін
  deleteAnyListing: ['admin'],
  viewAllUsers:     ['admin'],
  viewFeedback:     ['admin'],
  viewAdminPanel:   ['admin'],
  manageRoles:      ['admin'],
  viewPlatformStats:['admin'],
} as const

export type Permission = keyof typeof PERMISSIONS

// ── Функції перевірки ─────────────────────────────────────────

/** Перевіряє чи є користувач адміном за email (головна перевірка) */
export function isAdminEmail(email: string | undefined | null): boolean {
  if (!email) return false
  return email.toLowerCase().trim() === ADMIN_EMAIL.toLowerCase()
}

/** Перевіряє чи є User адміном */
export function isAdmin(user: User | null | undefined): boolean {
  if (!user) return false
  return isAdminEmail(user.email) || user.role === 'admin'
}

/** Перевіряє конкретний дозвіл для користувача */
export function can(user: User | null | undefined, permission: Permission): boolean {
  const role = getRole(user)
  return (PERMISSIONS[permission] as readonly string[]).includes(role)
}

/** Повертає роль користувача */
export function getRole(user: User | null | undefined): UserRole {
  if (!user) return 'guest'
  // Завжди перевіряємо email — незалежно від збереженої ролі
  if (isAdminEmail(user.email)) return 'admin'
  return (user.role as UserRole) || 'user'
}

/** Перевіряє чи може редагувати/видаляти конкретне оголошення */
export function canEditListing(user: User | null, listingUserId: string): boolean {
  if (!user) return false
  if (isAdmin(user)) return true
  return user.id === listingUserId || listingUserId === 'me'
}

/** Санітизує User об'єкт перед збереженням — прибирає неправильні ролі */
export function sanitizeUserRole(user: User): User {
  return {
    ...user,
    role: isAdminEmail(user.email) ? 'admin' : (user.role === 'admin' ? 'landlord' : user.role),
  }
}
