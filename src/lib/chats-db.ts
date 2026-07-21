import { supabase } from './supabase'

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
  image_url?: string | null
  created_at: string
}

const CHAT_IMAGES_BUCKET = 'chat-images'

export async function uploadChatImage(file: File, chatId: string): Promise<string | null> {
  try {
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg'
    const path = `${chatId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
    const { error } = await supabase.storage
      .from(CHAT_IMAGES_BUCKET)
      .upload(path, file, { cacheControl: '3600', upsert: false, contentType: file.type || 'image/jpeg' })
    if (error) { console.error('[uploadChatImage]', error.message); return null }
    const { data } = supabase.storage.from(CHAT_IMAGES_BUCKET).getPublicUrl(path)
    return data.publicUrl
  } catch (e: any) {
    console.error('[uploadChatImage] CATCH:', e?.message)
    return null
  }
}

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

// Immediately reset unread to 0 when user reads chat
export async function markChatRead(chatId: string, userId: string, chat: ChatRecord): Promise<void> {
  const isBuyer = chat.buyer_id === userId
  const field = isBuyer ? 'unread_buyer' : 'unread_seller'
  const current = isBuyer ? (chat.unread_buyer || 0) : (chat.unread_seller || 0)
  if (current === 0) return
  const { error } = await supabase.from('chats').update({ [field]: 0 }).eq('id', chatId)
  if (error) console.error('[markChatRead]', error.message)
}

export async function deleteChat(chatId: string): Promise<void> {
  const { error } = await supabase.from('chats').delete().eq('id', chatId)
  if (error) console.error('[deleteChat]', error.message)
}

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
  text: string, chat: ChatRecord, imageUrl?: string | null
): Promise<MessageRecord | null> {
  const { data, error } = await supabase
    .from('messages')
    .insert({ chat_id: chatId, sender_id: senderId, sender_name: senderName, text, image_url: imageUrl || null })
    .select().single()
  if (error) { console.error('[sendMessage]', error.message); return null }

  // Increment unread ONLY for the other person
  const isBuyer = senderId === chat.buyer_id
  const updateData: Record<string, unknown> = {
    last_message: text || (imageUrl ? '📷 Фото' : ''),
    last_at: new Date().toISOString(),
    unread_buyer: isBuyer ? 0 : (chat.unread_buyer || 0) + 1,
    unread_seller: isBuyer ? (chat.unread_seller || 0) + 1 : 0,
  }
  await supabase.from('chats').update(updateData).eq('id', chatId)
  return data
}

// For BottomNav badge
export async function getUnreadCount(userId: string): Promise<number> {
  const { data } = await supabase
    .from('chats')
    .select('unread_buyer, unread_seller, buyer_id')
    .or(`buyer_id.eq.${userId},seller_id.eq.${userId}`)
  if (!data) return 0
  return data.reduce((s, c) =>
    s + (c.buyer_id === userId ? (c.unread_buyer || 0) : (c.unread_seller || 0)), 0)
}

// Realtime subscriptions
export function subscribeToMessages(chatId: string, onNew: (msg: MessageRecord) => void) {
  return supabase
    .channel(`msgs_${chatId}_${Date.now()}`)
    .on('postgres_changes', {
      event: 'INSERT', schema: 'public', table: 'messages',
      filter: `chat_id=eq.${chatId}`,
    }, p => onNew(p.new as MessageRecord))
    .subscribe()
}

export function subscribeToUserChats(userId: string, onUpdate: () => void) {
  return supabase
    .channel(`uchats_${userId}_${Date.now()}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'chats' }, onUpdate)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, onUpdate)
    .subscribe()
}
