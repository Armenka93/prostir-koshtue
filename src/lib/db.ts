/**
 * DATABASE LAYER — Supabase
 * Full CRUD + Realtime + Debug logging
 */
import { supabase } from './supabase'
import type { ListingData } from '@/types'

export function isSupabaseReady(): boolean {
  const ready = !!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
  if (!ready) console.warn('[db] Supabase not configured! Check env vars.')
  return ready
}

// ── LISTINGS ──────────────────────────────────────────────────

export async function dbGetListings(): Promise<ListingData[]> {
  if (!isSupabaseReady()) return []
  try {
    // NO is_active filter — get ALL listings, let frontend filter
    // This fixes the issue where is_active might be null in DB
    const { data, error, status, statusText } = await supabase
      .from('listings')
      .select('*')
      .order('created_at', { ascending: false })

    console.log(`[dbGetListings] status=${status} count=${data?.length ?? 0} error=${error?.message || 'none'}`)

    if (error) {
      console.error('[dbGetListings] ERROR:', error.message, error.details, error.code)
      return []
    }

    const listings = (data || []).map(rowToListing)
    console.log('[dbGetListings] IDs:', listings.map(l => l.id).join(', '))
    return listings
  } catch (e: any) {
    console.error('[dbGetListings] CATCH:', e?.message)
    return []
  }
}

// ── STORAGE (listing photos) ───────────────────────────────────
// Photos are uploaded as real files to a Storage bucket and only the
// resulting short public URL is stored in listings.images. Previously the
// app stored full base64-encoded photos directly in that column, which:
//  - made every publish take ~20s (multi-MB text payload per photo)
//  - made every feed load slow (every listing row carries its full photos)
//  - could outright fail ("Помилка збереження") once the base64 payload
//    crossed the API gateway's request-size limit
// This bucket must exist and be public — see MIGRATION NOTE at bottom of
// this file for the one-time setup SQL if it hasn't been created yet.
const LISTING_IMAGES_BUCKET = 'listing-images'

export async function dbUploadListingImage(file: File, userId: string): Promise<string | null> {
  if (!isSupabaseReady()) return null
  try {
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg'
    const path = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
    const { error } = await supabase.storage
      .from(LISTING_IMAGES_BUCKET)
      .upload(path, file, { cacheControl: '3600', upsert: false, contentType: file.type || 'image/jpeg' })
    if (error) { console.error('[dbUploadListingImage]', error.message); return null }
    const { data } = supabase.storage.from(LISTING_IMAGES_BUCKET).getPublicUrl(path)
    return data.publicUrl
  } catch (e: any) {
    console.error('[dbUploadListingImage] CATCH:', e?.message)
    return null
  }
}

export async function dbPublishListing(listing: Partial<ListingData>): Promise<ListingData | null> {
  if (!isSupabaseReady()) {
    console.error('[dbPublishListing] Supabase not ready')
    return null
  }

  const row = listingToRow(listing)
  console.log('[dbPublishListing] Inserting:', JSON.stringify(row).slice(0, 300))

  try {
    const { data, error, status } = await supabase
      .from('listings')
      .insert(row)
      .select()
      .single()

    console.log(`[dbPublishListing] status=${status} id=${data?.id} error=${error?.message || 'none'}`)

    if (error) {
      console.error('[dbPublishListing] ERROR:', error.message, error.details, error.hint, error.code)
      return null
    }

    const result = rowToListing(data)
    console.log('[dbPublishListing] SUCCESS, new listing id:', result.id)
    return result
  } catch (e: any) {
    console.error('[dbPublishListing] CATCH:', e?.message)
    return null
  }
}

export async function dbDeleteListing(id: number): Promise<boolean> {
  if (!isSupabaseReady()) return false
  try {
    const { error } = await supabase.from('listings').delete().eq('id', id)
    if (error) { console.error('[dbDeleteListing]', error.message); return false }
    return true
  } catch (e: any) { console.error('[dbDeleteListing] CATCH:', e?.message); return false }
}

// ── ACCOUNTS ──────────────────────────────────────────────────

export interface DbAccount {
  id: string; name: string; email: string; phone: string
  role: string; password_hash: string; created_at: string
}

export async function dbGetAccounts(): Promise<DbAccount[]> {
  if (!isSupabaseReady()) return []
  try {
    const { data, error } = await supabase
      .from('accounts')
      .select('id, name, email, phone, role, created_at')
      .order('created_at', { ascending: false })
    if (error) { console.error('[dbGetAccounts]', error.message); return [] }
    console.log('[dbGetAccounts] count:', data?.length)
    return data || []
  } catch (e: any) { console.error('[dbGetAccounts] CATCH:', e?.message); return [] }
}

export async function dbFindAccount(email: string): Promise<DbAccount | null> {
  if (!isSupabaseReady()) return null
  try {
    const { data, error } = await supabase
      .from('accounts')
      .select('*')
      .eq('email', email.toLowerCase().trim())
      .maybeSingle()
    if (error) { console.error('[dbFindAccount]', error.message); return null }
    return data
  } catch (e: any) { console.error('[dbFindAccount] CATCH:', e?.message); return null }
}

export async function dbCreateAccount(acc: DbAccount): Promise<{ ok: boolean; error?: string }> {
  if (!isSupabaseReady()) return { ok: false, error: 'Supabase not configured' }
  try {
    const { error } = await supabase.from('accounts').insert(acc)
    if (error) { console.error('[dbCreateAccount]', error.message); return { ok: false, error: error.message } }
    console.log('[dbCreateAccount] SUCCESS, id:', acc.id)
    return { ok: true }
  } catch (e: any) { return { ok: false, error: e?.message || 'Unknown' } }
}

export async function dbUpdateAccount(id: string, updates: Partial<DbAccount>): Promise<boolean> {
  if (!isSupabaseReady()) return false
  try {
    const { error } = await supabase.from('accounts').update(updates).eq('id', id)
    if (error) { console.error('[dbUpdateAccount]', error.message); return false }
    return true
  } catch (e: any) { console.error('[dbUpdateAccount] CATCH:', e?.message); return false }
}

// ── FEEDBACK ──────────────────────────────────────────────────

export interface DbFeedback {
  id?: number; name: string; email: string; message: string
  is_read?: boolean; created_at?: string
}

export async function dbGetFeedbacks(): Promise<DbFeedback[]> {
  if (!isSupabaseReady()) return []
  try {
    const { data, error } = await supabase
      .from('feedback')
      .select('*')
      .order('created_at', { ascending: false })
    if (error) { console.error('[dbGetFeedbacks]', error.message); return [] }
    console.log('[dbGetFeedbacks] count:', data?.length)
    return data || []
  } catch (e: any) { console.error('[dbGetFeedbacks] CATCH:', e?.message); return [] }
}

export async function dbSaveFeedback(fb: Omit<DbFeedback, 'id' | 'created_at' | 'is_read'>): Promise<boolean> {
  if (!isSupabaseReady()) return false
  try {
    const { error } = await supabase.from('feedback').insert({
      name: fb.name, email: fb.email || '', message: fb.message,
    })
    if (error) { console.error('[dbSaveFeedback]', error.message); return false }
    return true
  } catch (e: any) { console.error('[dbSaveFeedback] CATCH:', e?.message); return false }
}

export async function dbMarkFeedbackRead(id: number): Promise<boolean> {
  if (!isSupabaseReady()) return false
  try {
    const { error } = await supabase.from('feedback').update({ is_read: true }).eq('id', id)
    return !error
  } catch { return false }
}

// ── REALTIME ──────────────────────────────────────────────────

export function subscribeToListings(
  onInsert: (l: ListingData) => void,
  onDelete?: (id: number) => void
) {
  console.log('[realtime] subscribing to listings...')
  const channel = supabase
    .channel('db_listings_' + Date.now())
    .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'listings' },
      (payload) => {
        console.log('[realtime] INSERT listing:', payload.new?.id)
        onInsert(rowToListing(payload.new))
      }
    )
    .on('postgres_changes',
      { event: 'DELETE', schema: 'public', table: 'listings' },
      (payload) => {
        console.log('[realtime] DELETE listing:', payload.old?.id)
        onDelete?.(payload.old?.id)
      }
    )
    .subscribe((status) => {
      console.log('[realtime] listings channel status:', status)
    })
  return channel
}

export function subscribeToAccounts(onUpdate: () => void) {
  return supabase
    .channel('db_accounts_' + Date.now())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'accounts' }, () => {
      console.log('[realtime] accounts updated')
      onUpdate()
    })
    .subscribe()
}

export function subscribeFeedback(onUpdate: () => void) {
  return supabase
    .channel('db_feedback_' + Date.now())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'feedback' }, () => {
      console.log('[realtime] feedback updated')
      onUpdate()
    })
    .subscribe()
}

// ── ROW CONVERTERS ────────────────────────────────────────────

export function rowToListing(row: any): ListingData {
  if (!row) { console.warn('[rowToListing] null row'); return {} as ListingData }
  return {
    id: Number(row.id),
    userId: row.user_id || '',
    ownerName: row.owner_name || null,
    ownerPhone: row.owner_phone || null,
    title: row.title || '',
    type: row.type || 'Офіс',
    price: Number(row.price) || 0,
    area: Number(row.area) || 0,
    floor: row.floor != null ? Number(row.floor) : null,
    totalFloors: row.total_floors != null ? Number(row.total_floors) : null,
    district: row.district || '',
    address: row.address || '',
    city: row.city || 'Одеса',
    condition: row.condition || null,
    parking: Boolean(row.parking),
    separateEntrance: Boolean(row.separate_entrance),
    description: row.description || null,
    images: Array.isArray(row.images) ? row.images.filter(Boolean) : [],
    features: Array.isArray(row.features) ? row.features.filter(Boolean) : [],
    isActive: row.is_active !== false, // default true if null
    isNew: row.is_new !== false,
    isPromoted: Boolean(row.is_promoted),
    isFeatured: Boolean(row.is_featured),
    views: Number(row.views) || 0,
    likes: Number(row.likes) || 0,
    score: Number(row.score) || 0,
    promotedUntil: row.promoted_until || null,
    createdAt: row.created_at || new Date().toISOString(),
    updatedAt: row.updated_at || row.created_at || new Date().toISOString(),
  }
}

function listingToRow(l: Partial<ListingData>) {
  return {
    user_id: l.userId || 'anonymous',
    owner_name: l.ownerName || null,
    owner_phone: l.ownerPhone || null,
    title: (l.title || '').trim(),
    type: l.type || 'Офіс',
    price: Number(l.price) || 0,
    area: Number(l.area) || 0,
    floor: l.floor ? Number(l.floor) : null,
    total_floors: l.totalFloors ? Number(l.totalFloors) : null,
    district: l.district || '',
    address: (l.address || '').trim(),
    city: l.city || 'Одеса',
    condition: l.condition || null,
    parking: Boolean(l.parking),
    separate_entrance: Boolean(l.separateEntrance),
    description: l.description || null,
    images: Array.isArray(l.images) ? l.images.filter(Boolean) : [],
    features: Array.isArray(l.features) ? l.features.filter(Boolean) : [],
    is_active: true,
    is_new: true,
    is_promoted: false,
    is_featured: false,
    views: 0,
    likes: 0,
    score: 0,
  }
}
export async function dbIncrementViews(id: number): Promise<void> {
  if (!isSupabaseReady()) return
  try {
    const { error } = await supabase.rpc('increment_listing_views', { listing_id: id })
    if (error) {
      console.error('[dbIncrementViews] RPC error:', error.message)
      const { data } = await supabase.from('listings').select('views').eq('id', id).single()
      if (data) {
        await supabase.from('listings').update({ views: (data.views || 0) + 1 }).eq('id', id)
      }
    }
  } catch (e) {
    console.error('[dbIncrementViews] catch:', e)
  }
}

export async function dbAdjustLikes(id: number, delta: 1 | -1): Promise<void> {
  if (!isSupabaseReady()) return
  try {
    const { error } = await supabase.rpc('adjust_listing_likes', { listing_id: id, delta })
    if (error) {
      console.error('[dbAdjustLikes] RPC error:', error.message)
      const { data } = await supabase.from('listings').select('likes').eq('id', id).single()
      if (data) {
        const newLikes = Math.max(0, (data.likes || 0) + delta)
        await supabase.from('listings').update({ likes: newLikes }).eq('id', id)
      }
    }
  } catch (e) {
    console.error('[dbAdjustLikes] catch:', e)
  }
}

// ── FAVORITES (per-user, persisted in Supabase) ───────────────
// The `favorites` table stores one row per (user_id, listing_id). The
// listings.likes counter is kept in sync automatically by a DB trigger
// (favorites_sync_likes), so the frontend must NOT also call
// adjust_listing_likes — that would double-count.

export async function dbGetUserFavorites(userId: string): Promise<number[]> {
  if (!isSupabaseReady() || !userId) return []
  try {
    const { data, error } = await supabase
      .from('favorites')
      .select('listing_id')
      .eq('user_id', userId)
    if (error) { console.error('[dbGetUserFavorites]', error.message); return [] }
    return (data || []).map(r => Number(r.listing_id))
  } catch (e: any) {
    console.error('[dbGetUserFavorites] CATCH:', e?.message)
    return []
  }
}

export async function dbAddFavorite(userId: string, listingId: number): Promise<boolean> {
  if (!isSupabaseReady() || !userId) return false
  try {
    // upsert so a double-tap can't error on the unique (user_id, listing_id) key
    const { error } = await supabase
      .from('favorites')
      .upsert({ user_id: userId, listing_id: listingId }, { onConflict: 'user_id,listing_id', ignoreDuplicates: true })
    if (error) { console.error('[dbAddFavorite]', error.message); return false }
    return true
  } catch (e: any) {
    console.error('[dbAddFavorite] CATCH:', e?.message)
    return false
  }
}

export async function dbRemoveFavorite(userId: string, listingId: number): Promise<boolean> {
  if (!isSupabaseReady() || !userId) return false
  try {
    const { error } = await supabase
      .from('favorites')
      .delete()
      .eq('user_id', userId)
      .eq('listing_id', listingId)
    if (error) { console.error('[dbRemoveFavorite]', error.message); return false }
    return true
  } catch (e: any) {
    console.error('[dbRemoveFavorite] CATCH:', e?.message)
    return false
  }
}

export async function dbGetListingCounters(id: number): Promise<{ views: number; likes: number } | null> {
  if (!isSupabaseReady()) return null
  try {
    const { data, error } = await supabase
      .from('listings')
      .select('views, likes')
      .eq('id', id)
      .single()
    if (error || !data) return null
    return { views: data.views || 0, likes: data.likes || 0 }
  } catch {
    return null
  }
}
