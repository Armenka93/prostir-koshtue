/**
 * DATABASE LAYER — Supabase
 * Full CRUD + Realtime for listings, accounts, feedback
 */
import { createClient } from '@supabase/supabase-js'
import type { ListingData } from '@/types'

// Create client with error handling
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false },
  realtime: { params: { eventsPerSecond: 10 } },
})

export function isSupabaseReady(): boolean {
  return !!(supabaseUrl && supabaseKey)
}

// ── LISTINGS ──────────────────────────────────────────────────

export async function dbGetListings(): Promise<ListingData[]> {
  if (!isSupabaseReady()) return []
  try {
    const { data, error } = await supabase
      .from('listings')
      .select('*')
      .eq('is_active', true)
      .order('created_at', { ascending: false })
    if (error) { console.error('[dbGetListings]', error.message); return [] }
    return (data || []).map(rowToListing)
  } catch (e) { console.error('[dbGetListings] catch:', e); return [] }
}

export async function dbPublishListing(listing: Partial<ListingData>): Promise<ListingData | null> {
  if (!isSupabaseReady()) { console.error('Supabase not configured'); return null }
  const row = listingToRow(listing)
  console.log('[dbPublishListing] inserting row:', JSON.stringify(row).slice(0, 200))
  try {
    const { data, error } = await supabase
      .from('listings')
      .insert(row)
      .select()
      .single()
    if (error) {
      console.error('[dbPublishListing] error:', error.message, error.details, error.hint)
      return null
    }
    console.log('[dbPublishListing] success, id:', data?.id)
    return rowToListing(data)
  } catch (e) { console.error('[dbPublishListing] catch:', e); return null }
}

export async function dbDeleteListing(id: number): Promise<boolean> {
  if (!isSupabaseReady()) return false
  try {
    const { error } = await supabase.from('listings').delete().eq('id', id)
    if (error) { console.error('[dbDeleteListing]', error.message); return false }
    return true
  } catch (e) { console.error('[dbDeleteListing] catch:', e); return false }
}

// ── ACCOUNTS ──────────────────────────────────────────────────

export interface DbAccount {
  id: string
  name: string
  email: string
  phone: string
  role: string
  password_hash: string
  created_at: string
}

export async function dbGetAccounts(): Promise<DbAccount[]> {
  if (!isSupabaseReady()) return []
  try {
    const { data, error } = await supabase
      .from('accounts')
      .select('id, name, email, phone, role, created_at')
      .order('created_at', { ascending: false })
    if (error) { console.error('[dbGetAccounts]', error.message); return [] }
    return data || []
  } catch (e) { console.error('[dbGetAccounts] catch:', e); return [] }
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
  } catch (e) { console.error('[dbFindAccount] catch:', e); return null }
}

export async function dbCreateAccount(acc: DbAccount): Promise<{ ok: boolean; error?: string }> {
  if (!isSupabaseReady()) return { ok: false, error: 'Supabase not configured' }
  try {
    const { error } = await supabase.from('accounts').insert(acc)
    if (error) {
      console.error('[dbCreateAccount]', error.message)
      return { ok: false, error: error.message }
    }
    return { ok: true }
  } catch (e: any) { return { ok: false, error: e?.message || 'Unknown error' } }
}

export async function dbUpdateAccount(id: string, updates: Partial<DbAccount>): Promise<boolean> {
  if (!isSupabaseReady()) return false
  try {
    const { error } = await supabase.from('accounts').update(updates).eq('id', id)
    if (error) { console.error('[dbUpdateAccount]', error.message); return false }
    return true
  } catch (e) { console.error('[dbUpdateAccount] catch:', e); return false }
}

// ── FEEDBACK ──────────────────────────────────────────────────

export interface DbFeedback {
  id?: number
  name: string
  email: string
  message: string
  is_read?: boolean
  created_at?: string
}

export async function dbGetFeedbacks(): Promise<DbFeedback[]> {
  if (!isSupabaseReady()) return []
  try {
    const { data, error } = await supabase
      .from('feedback')
      .select('*')
      .order('created_at', { ascending: false })
    if (error) { console.error('[dbGetFeedbacks]', error.message); return [] }
    return data || []
  } catch (e) { console.error('[dbGetFeedbacks] catch:', e); return [] }
}

export async function dbSaveFeedback(fb: DbFeedback): Promise<boolean> {
  if (!isSupabaseReady()) return false
  try {
    const { error } = await supabase.from('feedback').insert({
      name: fb.name,
      email: fb.email || '',
      message: fb.message,
    })
    if (error) { console.error('[dbSaveFeedback]', error.message); return false }
    return true
  } catch (e) { console.error('[dbSaveFeedback] catch:', e); return false }
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
  const channel = supabase
    .channel('listings_realtime_' + Date.now())
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'listings' },
      (payload) => {
        console.log('[realtime] new listing:', payload.new?.id)
        onInsert(rowToListing(payload.new))
      }
    )
    .on(
      'postgres_changes',
      { event: 'DELETE', schema: 'public', table: 'listings' },
      (payload) => {
        console.log('[realtime] deleted listing:', payload.old?.id)
        onDelete?.(payload.old?.id)
      }
    )
    .subscribe((status) => {
      console.log('[realtime] subscription status:', status)
    })
  return channel
}

export function subscribeToAccounts(onUpdate: () => void) {
  return supabase
    .channel('accounts_realtime_' + Date.now())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'accounts' }, () => onUpdate())
    .subscribe()
}

export function subscribeFeedback(onUpdate: () => void) {
  return supabase
    .channel('feedback_realtime_' + Date.now())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'feedback' }, () => onUpdate())
    .subscribe()
}

// ── CONVERTERS ────────────────────────────────────────────────

function rowToListing(row: any): ListingData {
  return {
    id: row.id,
    userId: row.user_id || '',
    ownerName: row.owner_name || null,
    ownerPhone: row.owner_phone || null,
    title: row.title || '',
    type: row.type || 'Офіс',
    price: Number(row.price) || 0,
    area: Number(row.area) || 0,
    floor: row.floor ? Number(row.floor) : null,
    totalFloors: row.total_floors ? Number(row.total_floors) : null,
    district: row.district || '',
    address: row.address || '',
    city: row.city || 'Одеса',
    condition: row.condition || null,
    parking: row.parking ?? false,
    separateEntrance: row.separate_entrance ?? false,
    description: row.description || null,
    images: Array.isArray(row.images) ? row.images : [],
    features: Array.isArray(row.features) ? row.features : [],
    isActive: row.is_active ?? true,
    isNew: row.is_new ?? true,
    isPromoted: row.is_promoted ?? false,
    isFeatured: row.is_featured ?? false,
    views: Number(row.views) || 0,
    likes: Number(row.likes) || 0,
    score: Number(row.score) || 0,
    promotedUntil: row.promoted_until || null,
    createdAt: row.created_at || new Date().toISOString(),
    updatedAt: row.updated_at || new Date().toISOString(),
  }
}

function listingToRow(l: Partial<ListingData>) {
  // Only include fields that exist in the DB schema
  return {
    user_id: l.userId || 'anonymous',
    owner_name: l.ownerName || null,
    owner_phone: l.ownerPhone || null,
    title: l.title || '',
    type: l.type || 'Офіс',
    price: Number(l.price) || 0,
    area: Number(l.area) || 0,
    floor: l.floor ? Number(l.floor) : null,
    total_floors: l.totalFloors ? Number(l.totalFloors) : null,
    district: l.district || '',
    address: l.address || '',
    city: l.city || 'Одеса',
    condition: l.condition || null,
    parking: l.parking ?? false,
    separate_entrance: l.separateEntrance ?? false,
    description: l.description || null,
    images: l.images || [],
    features: l.features || [],
    is_active: true,
    is_new: true,
    is_promoted: false,
    is_featured: false,
    views: 0,
    likes: 0,
    score: 0,
  }
}
