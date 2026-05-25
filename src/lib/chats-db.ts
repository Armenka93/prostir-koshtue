/**
 * CHATS & MESSAGES — Supabase layer
 * Real-time messaging between users
 */
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { persistSession: false } }
)

export interface ChatRecord {
  id: string
  listing_id: number
  listing_title: string
  buyer_id: string
  buyer_name: string
  seller_id: string
  seller_name: string
  last_message: string
  last_at: string
  unread_buyer: number
  unread_seller: number
  created_at: string
}

export interface MessageRecord {
  id: number
  chat_id: string
  sender_id: string
  sender_name: string
  text: string
  created_at: string
}

// ── CHATS ─────────────────────────────────────────────────────

export async function getUserChats(userId: string): Promise<ChatRecord[]> {
  const { data, error } = await supabase
    .from('chats')
    .select('*')
    .or(`buyer_id.eq.${userId},seller_id.eq.${userId}`)
    .order('last_at', { ascending: false })
  if (error) { console.error('[getUserChats]', error.message); return [] }
  return data || []
}

export async function getOrCreateChat(
  listingId: number,
  listingTitle: string,
  buyerId: string,
  buyerName: string,
  sellerId: string,
  sellerName: string
): Promise<ChatRecord | null> {
  // Check if chat exists
  const { data: existing } = await supabase
    .from('chats')
    .select('*')
    .eq('listing_id', listingId)
    .eq('buyer_id', buyerId)
    .eq('seller_id', sellerId)
    .maybeSingle()

  if (existing) return existing

  // Create new chat
  const chatId = `chat_${Date.now()}_${Math.random().toString(36).slice(2,7)}`
  const { data, error } = await supabase
    .from('chats')
    .insert({
      id: chatId,
      listing_id: listingId,
      listing_title: listingTitle,
      buyer_id: buyerId,
      buyer_name: buyerName,
      seller_id: sellerId,
      seller_name: sellerName,
      last_message: '',
      last_at: new Date().toISOString(),
      unread_buyer: 0,
      unread_seller: 0,
    })
    .select()
    .single()

  if (error) { console.error('[getOrCreateChat]', error.message); return null }
  return data
}

export async function markChatRead(chatId: string, userId: string, chat: ChatRecord) {
  const field = chat.buyer_id === userId ? 'unread_buyer' : 'unread_seller'
  await supabase.from('chats').update({ [field]: 0 }).eq('id', chatId)
}

export async function deleteChat(chatId: string) {
  await supabase.from('chats').delete().eq('id', chatId)
}

// ── MESSAGES ──────────────────────────────────────────────────

export async function getChatMessages(chatId: string): Promise<MessageRecord[]> {
  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .eq('chat_id', chatId)
    .order('created_at', { ascending: true })
  if (error) { console.error('[getChatMessages]', error.message); return [] }
  return data || []
}

export async function sendMessage(
  chatId: string,
  senderId: string,
  senderName: string,
  text: string,
  chat: ChatRecord
): Promise<MessageRecord | null> {
  // Insert message
  const { data, error } = await supabase
    .from('messages')
    .insert({ chat_id: chatId, sender_id: senderId, sender_name: senderName, text })
    .select()
    .single()

  if (error) { console.error('[sendMessage]', error.message); return null }

  // Update chat last_message and unread count
  const isbuyer = senderId === chat.buyer_id
  await supabase.from('chats').update({
    last_message: text,
    last_at: new Date().toISOString(),
    // Increment unread for the OTHER person
    unread_buyer: isbuyer ? chat.unread_buyer : (chat.unread_buyer + 1),
    unread_seller: isbuyer ? (chat.unread_seller + 1) : chat.unread_seller,
  }).eq('id', chatId)

  return data
}

export async function getUnreadCount(userId: string): Promise<number> {
  const { data } = await supabase
    .from('chats')
    .select('unread_buyer, unread_seller, buyer_id, seller_id')
    .or(`buyer_id.eq.${userId},seller_id.eq.${userId}`)

  if (!data) return 0
  return data.reduce((sum, c) => {
    if (c.buyer_id === userId) return sum + (c.unread_buyer || 0)
    if (c.seller_id === userId) return sum + (c.unread_seller || 0)
    return sum
  }, 0)
}

// ── REALTIME ──────────────────────────────────────────────────

export function subscribeToMessages(chatId: string, onNew: (msg: MessageRecord) => void) {
  return supabase
    .channel(`messages_${chatId}`)
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'messages',
      filter: `chat_id=eq.${chatId}`,
    }, payload => {
      console.log('[realtime] new message in chat', chatId)
      onNew(payload.new as MessageRecord)
    })
    .subscribe()
}

export function subscribeToUserChats(userId: string, onUpdate: () => void) {
  return supabase
    .channel(`user_chats_${userId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'chats' }, () => {
      onUpdate()
    })
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, () => {
      onUpdate()
    })
    .subscribe()
}
