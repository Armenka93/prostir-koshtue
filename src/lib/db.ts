/**
 * DATABASE LAYER — Supabase
 * Замінює localStorage для listings, accounts, feedback
 * Auth/session/favs залишаються в localStorage (per-user device state)
 */
import { supabase } from './supabase'
import type { ListingData, User } from '@/types'

// ── LISTINGS ──────────────────────────────────────────────────

export async function dbGetListings(): Promise<ListingData[]> {
  const { data, error } = await supabase
    .from('listings')
    .select('*')
    .eq('is_active', true)
    .order('created_at', { ascending: false })

  if (error) { console.error('dbGetListings:', error); return [] }
  return (data || []).map(rowToListing)
}

export async function dbPublishListing(listing: Omit<ListingData, 'id'>): Promise<ListingData | null> {
  const { data, error } = await supabase
    .from('listings')
    .insert(listingToRow(listing))
    .select()
    .single()

  if (error) { console.error('dbPublishListing:', error); return null }
  return rowToListing(data)
}

export async function dbDeleteListing(id: number): Promise<boolean> {
  const { error } = await supabase
    .from('listings')
    .delete()
    .eq('id', id)
  return !error
}

export async function dbIncrementViews(id: number) {
  await supabase.rpc('increment_views', { listing_id: id }).catch(() => {})
}

// ── ACCOUNTS ──────────────────────────────────────────────────

export interface DbAccount {
  id: string; name: string; email: string; phone: string
  role: string; password_hash: string; created_at: string
}

export async function dbGetAccounts(): Promise<DbAccount[]> {
  const { data, error } = await supabase
    .from('accounts')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) { console.error('dbGetAccounts:', error); return [] }
  return data || []
}

export async function dbFindAccount(email: string): Promise<DbAccount | null> {
  const { data, error } = await supabase
    .from('accounts')
    .select('*')
    .eq('email', email.toLowerCase())
    .single()
  if (error) return null
  return data
}

export async function dbCreateAccount(acc: DbAccount): Promise<boolean> {
  const { error } = await supabase.from('accounts').insert(acc)
  return !error
}

export async function dbUpdateAccount(id: string, updates: Partial<DbAccount>): Promise<boolean> {
  const { error } = await supabase.from('accounts').update(updates).eq('id', id)
  return !error
}

// ── FEEDBACK ──────────────────────────────────────────────────

export interface DbFeedback {
  id?: number; name: string; email: string; message: string
  is_read?: boolean; created_at?: string
}

export async function dbGetFeedbacks(): Promise<DbFeedback[]> {
  const { data, error } = await supabase
    .from('feedback')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) { console.error('dbGetFeedbacks:', error); return [] }
  return data || []
}

export async function dbSaveFeedback(fb: DbFeedback): Promise<boolean> {
  const { error } = await supabase.from('feedback').insert(fb)
  return !error
}

export async function dbMarkFeedbackRead(id: number): Promise<boolean> {
  const { error } = await supabase.from('feedback').update({ is_read: true }).eq('id', id)
  return !error
}

// ── REALTIME SUBSCRIPTION ─────────────────────────────────────

export function subscribeToListings(onNew: (l: ListingData) => void) {
  return supabase
    .channel('listings_changes')
    .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'listings' },
      payload => { onNew(rowToListing(payload.new)) }
    )
    .subscribe()
}

// ── ROW CONVERTERS ────────────────────────────────────────────

function rowToListing(row: any): ListingData {
  return {
    id: row.id,
    userId: row.user_id,
    ownerName: row.owner_name,
    ownerPhone: row.owner_phone,
    title: row.title,
    type: row.type,
    price: row.price,
    area: row.area,
    floor: row.floor,
    totalFloors: row.total_floors,
    district: row.district,
    address: row.address,
    city: row.city || 'Одеса',
    condition: row.condition,
    parking: row.parking,
    separateEntrance: row.separate_entrance,
    description: row.description,
    images: row.images || [],
    features: row.features || [],
    isActive: row.is_active,
    isNew: row.is_new,
    isPromoted: row.is_promoted,
    isFeatured: row.is_featured,
    views: row.views || 0,
    likes: row.likes || 0,
    score: row.score || 0,
    promotedUntil: row.promoted_until,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function listingToRow(l: Partial<ListingData>) {
  return {
    user_id: l.userId,
    owner_name: l.ownerName,
    owner_phone: l.ownerPhone,
    title: l.title,
    type: l.type,
    price: l.price,
    area: l.area,
    floor: l.floor,
    total_floors: l.totalFloors,
    district: l.district,
    address: l.address,
    city: l.city || 'Одеса',
    condition: l.condition,
    parking: l.parking ?? false,
    separate_entrance: l.separateEntrance ?? false,
    description: l.description,
    images: l.images || [],
    features: l.features || [],
    is_active: l.isActive ?? true,
    is_new: l.isNew ?? true,
    is_promoted: l.isPromoted ?? false,
    is_featured: l.isFeatured ?? false,
    views: l.views ?? 0,
    likes: l.likes ?? 0,
    score: l.score ?? 0,
    promoted_until: l.promotedUntil,
  }
}
