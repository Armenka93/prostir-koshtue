/**
 * СИСТЕМА ЛОГІКИ ОГОЛОШЕНЬ
 * ─────────────────────────────────────────────────────────────
 *
 * НОВІ (novi)
 *   - Оголошення опубліковане менше NOVA_TTL_DAYS тому
 *   - Значок "НОВИЙ" на картці
 *   - Автоматично пропадає після закінчення терміну
 *
 * ПОПУЛЯРНІ (populyarni)
 *   - Сортування за score = views*1 + likes*3 + saves*5 + comments*2
 *   - Мінімум MIN_VIEWS переглядів щоб потрапити
 *   - Топ POPULAR_LIMIT оголошень
 *
 * РЕКОМЕНДОВАНІ (rekomendovani)
 *   - isPromoted = true (платне просування)
 *   - Майбутні тарифи: "Підняти", "VIP", "Банер"
 *   - promotedUntil — дата завершення просування
 *   - Якщо promoted закінчився — автоматично прибирається
 *
 * ЗВИЧАЙНІ (all)
 *   - Всі активні оголошення відсортовані за датою
 *   - Фільтрується за типом, районом, ціною, площею
 *
 * МАЙБУТНЄ РОЗШИРЕННЯ:
 *   - Додати поле `plan: 'free' | 'boost' | 'vip' | 'banner'`
 *   - boost = підняти в пошуку на 7 днів
 *   - vip = виділення кольором + значок
 *   - banner = топ сторінки
 * ─────────────────────────────────────────────────────────────
 */

import type { ListingData, FeedData } from '@/types'

// Константи
export const NOVA_TTL_DAYS = 7          // скільки днів оголошення вважається новим
export const POPULAR_MIN_SCORE = 0      // мінімальний score для "популярних"
export const POPULAR_LIMIT = 10         // максимум в секції "популярні"
export const RECOMMENDED_LIMIT = 10     // максимум в секції "рекомендовані"
export const FEED_NEW_LIMIT = 8         // максимум в секції "нові"

/**
 * Обчислює score для сортування популярних
 */
export function calcScore(l: ListingData): number {
  const views = l.views ?? 0
  const likes = l.likes ?? 0
  const score = l.score ?? 0
  // Якщо score вже прорахований на бекенді — використовуємо
  if (score > 0) return score
  // Інакше рахуємо локально
  return views * 1 + likes * 3
}

/**
 * Перевіряє чи оголошення є "новим"
 */
export function isNewListing(l: ListingData): boolean {
  if (!l.createdAt) return false
  const created = new Date(l.createdAt).getTime()
  const now = Date.now()
  const diffDays = (now - created) / (1000 * 60 * 60 * 24)
  return diffDays <= NOVA_TTL_DAYS
}

/**
 * Перевіряє чи просування ще активне
 */
export function isPromotionActive(l: ListingData): boolean {
  if (!l.isPromoted) return false
  if (!l.promotedUntil) return true // безстрокове
  return new Date(l.promotedUntil).getTime() > Date.now()
}

/**
 * Будує фід для головної сторінки
 */
export function buildFeed(listings: ListingData[]): FeedData {
  const active = listings.filter(l => l.isActive !== false)
  
  // Sort all by date — newest first
  const byDate = [...active].sort((a, b) => 
    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  )

  // РЕКОМЕНДОВАНІ — платне просування
  const rekomendovani = active
    .filter(l => isPromotionActive(l))
    .sort((a, b) => calcScore(b) - calcScore(a))
    .slice(0, RECOMMENDED_LIMIT)

  // ПОПУЛЯРНІ — за score (mock listings мають views > 0, нові = 0)
  // Показуємо топ за переглядами але мінімум 5 записів
  const promotedIds = new Set(rekomendovani.map(l => l.id))
  const populyarni = active
    .filter(l => !promotedIds.has(l.id) && (l.views || 0) > 0)
    .sort((a, b) => calcScore(b) - calcScore(a))
    .slice(0, POPULAR_LIMIT)

  // НОВІ — всі оголошення за останні 30 днів, відсортовані за датою
  // (розширено з 7 до 30 днів щоб нові DB записи завжди були видні)
  const thirtyDaysAgo = Date.now() - 30 * 24 * 3600000
  const novi = byDate
    .filter(l => new Date(l.createdAt).getTime() > thirtyDaysAgo)
    .slice(0, FEED_NEW_LIMIT)

  return { rekomendovani, populyarni, novi }
}

/**
 * Додає мітки до оголошення після публікації
 */
export function enrichNewListing(l: ListingData): ListingData {
  return {
    ...l,
    isNew: true,           // автоматично — по даті
    isFeatured: false,     // false поки не куплено просування
    isPromoted: false,     // false поки не куплено
    views: 0,
    likes: 0,
    score: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}
