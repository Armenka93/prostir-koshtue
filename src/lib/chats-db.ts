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
  listingId: number, listingTitle: string,
  buyerId: string, buyerName: string,
  sellerId: string, sellerName: string
): Promise<ChatRecord | null> {
  // Check existing
  const { data: existing } = await supabase
    .from('chats').select('*')
    .eq('listing_id', listingId)
    .eq('buyer_id', buyerId)
    .eq('seller_id', sellerId)
    .maybeSingle()
  if (existing) return existing

  const chatId = `chat_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
  const { data, error } = await supabase
    .from('chats').insert({
      id: chatId, listing_id: listingId, listing_title: listingTitle,
      buyer_id: buyerId, buyer_name: buyerName,
      seller_id: sellerId, seller_name: sellerName,
      last_message: '', last_at: new Date().toISOString(),
      unread_buyer: 0, unread_seller: 0,
    }).select().single()
  if (error) { console.error('[getOrCreateChat]', error.message); return null }
  return data
}

// Reset unread to 0 for the viewer
export async function markChatRead(chatId: string, userId: string, chat: ChatRecord) {
  const isBuyer = chat.buyer_id === userId
  const field = isBuyer ? 'unread_buyer' : 'unread_seller'
  const current = isBuyer ? chat.unread_buyer : chat.unread_seller
  if (current === 0) return // already read
  await supabase.from('chats').update({ [field]: 0 }).eq('id', chatId)
}

export async function deleteChat(chatId: string) {
  // messages cascade on delete due to FK
  const { error } = await supabase.from('chats').delete().eq('id', chatId)
  if (error) console.error('[deleteChat]', error.message)
}

// ── MESSAGES ──────────────────────────────────────────────────

export async function getChatMessages(chatId: string): Promise<MessageRecord[]> {
  const { data, error } = await supabase
    .from('messages').select('*')
    .eq('chat_id', chatId)
    .order('created_at', { ascending: true })
  if (error) { console.error('[getChatMessages]', error.message); return [] }
  return data || []
}

export async function sendMessage(
  chatId: string, senderId: string, senderName: string,
  text: string, chat: ChatRecord
): Promise<MessageRecord | null> {
  // Insert message
  const { data, error } = await supabase
    .from('messages')
    .insert({ chat_id: chatId, sender_id: senderId, sender_name: senderName, text })
    .select().single()
  if (error) { console.error('[sendMessage]', error.message); return null }

  // Update chat: last_message + increment unread for the OTHER person only
  const isBuyer = senderId === chat.buyer_id
  const updateData: Record<string, any> = {
    last_message: text,
    last_at: new Date().toISOString(),
  }
  // Increment unread for receiver, keep sender's unread as-is
  if (isBuyer) {
    updateData.unread_seller = (chat.unread_seller || 0) + 1
    // buyer is sending — their own unread stays 0
    updateData.unread_buyer = 0
  } else {
    updateData.unread_buyer = (chat.unread_buyer || 0) + 1
    updateData.unread_seller = 0
  }

  await supabase.from('chats').update(updateData).eq('id', chatId)
  return data
}

// Total unread for a user (for BottomNav badge)
export async function getUnreadCount(userId: string): Promise<number> {
  const { data } = await supabase
    .from('chats').select('unread_buyer, unread_seller, buyer_id')
    .or(`buyer_id.eq.${userId},seller_id.eq.${userId}`)
  if (!data) return 0
  return data.reduce((sum, c) => {
    return sum + (c.buyer_id === userId ? (c.unread_buyer || 0) : (c.unread_seller || 0))
  }, 0)
}

// ── REALTIME ──────────────────────────────────────────────────

export function subscribeToMessages(chatId: string, onNew: (msg: MessageRecord) => void) {
  return supabase
    .channel(`msgs_${chatId}_${Date.now()}`)
    .on('postgres_changes', {
      event: 'INSERT', schema: 'public', table: 'messages',
      filter: `chat_id=eq.${chatId}`,
    }, payload => onNew(payload.new as MessageRecord))
    .subscribe()
}

export function subscribeToUserChats(userId: string, onUpdate: () => void) {
  return supabase
    .channel(`user_chats_${userId}_${Date.now()}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'chats' },
      () => onUpdate())
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' },
      () => onUpdate())
    .subscribe()
}
