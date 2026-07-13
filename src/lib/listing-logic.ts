import type { ListingData, FeedData } from '@/types'

export const NOVA_TTL_DAYS = 30
export const POPULAR_MIN_SCORE = 0
export const RECOMMENDED_LIMIT = 5
export const POPULAR_LIMIT = 10
export const FEED_NEW_LIMIT = 10

export function calcScore(l: ListingData): number {
  return (l.views || 0) * 1 + (l.likes || 0) * 3
}

export function isPromotionActive(l: ListingData): boolean {
  if (!l.isPromoted || !l.promotedUntil) return false
  return new Date(l.promotedUntil).getTime() > Date.now()
}

export function isNewListing(l: ListingData): boolean {
  if (!l.createdAt) return false
  const diffDays = (Date.now() - new Date(l.createdAt).getTime()) / (1000 * 60 * 60 * 24)
  return diffDays <= NOVA_TTL_DAYS
}

export function buildFeed(listings: ListingData[]): FeedData {
  const active = listings.filter(l => l.isActive !== false)
  const byDate = [...active].sort((a, b) =>
    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  )
  const rekomendovani = active
    .filter(l => isPromotionActive(l))
    .sort((a, b) => calcScore(b) - calcScore(a))
    .slice(0, RECOMMENDED_LIMIT)
  const promotedIds = new Set(rekomendovani.map(l => l.id))
  const populyarni = active
    .filter(l => !promotedIds.has(l.id) && (l.views || 0) > 0)
    .sort((a, b) => calcScore(b) - calcScore(a))
    .slice(0, POPULAR_LIMIT)
  const thirtyDaysAgo = Date.now() - 30 * 24 * 3600000
  const novi = byDate
    .filter(l => new Date(l.createdAt).getTime() > thirtyDaysAgo)
    .slice(0, FEED_NEW_LIMIT)
  return { rekomendovani, populyarni, novi }
}
