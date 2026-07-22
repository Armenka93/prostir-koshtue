'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import type { User } from '@/types'
import {
  getUserChats, getChatMessages, sendMessage, markChatRead,
  deleteChat, subscribeToMessages, subscribeToUserChats, uploadChatImage,
  type ChatRecord, type MessageRecord,
} from '@/lib/chats-db'
import { usePTR } from '@/hooks/usePTR'
import PTRIndicator from './PTRIndicator'

interface Props {
  user: User | null
  isGuest: boolean
  onLogin: () => void
  onRefresh?: () => Promise<void>
  initialChatId?: string
  // Called right after initialChatId has been used to auto-open a chat.
  // The parent (page.tsx) uses this to clear its initialChatId state back
  // to undefined — otherwise it stays set for the rest of the session and
  // silently re-opens that same conversation every time this screen remounts
  // (e.g. leaving the "Чати" tab and coming back to it).
  onInitialChatConsumed?: () => void
}

function timeStr(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000
  if (diff < 60) return 'щойно'
  if (diff < 3600) return Math.floor(diff / 60) + ' хв'
  const d = new Date(iso)
  if (diff < 86400) return d.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' })
  return d.toLocaleDateString('uk-UA', { day: 'numeric', month: 'short' })
}

// ── Sound (inline, no external file) ─────────────────────────
function playReceiveSound() {
  try {
    const ctx = new ((window as any).AudioContext || (window as any).webkitAudioContext)()
    const g = ctx.createGain(); g.connect(ctx.destination)
    ;[880, 1100].forEach((freq, i) => {
      const o = ctx.createOscillator(); o.connect(g)
      o.type = 'sine'; o.frequency.value = freq
      const t = ctx.currentTime + i * 0.12
      g.gain.setValueAtTime(0.09, t)
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.2)
      o.start(t); o.stop(t + 0.2)
    })
    setTimeout(() => ctx.close(), 600)
  } catch {}
}

function playSentSound() {
  try {
    const ctx = new ((window as any).AudioContext || (window as any).webkitAudioContext)()
    const o = ctx.createOscillator(); const g = ctx.createGain()
    o.connect(g); g.connect(ctx.destination)
    o.type = 'sine'; o.frequency.value = 1200
    g.gain.setValueAtTime(0.06, ctx.currentTime)
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.1)
    o.start(); o.stop(ctx.currentTime + 0.1)
    setTimeout(() => ctx.close(), 200)
  } catch {}
}

// ── Swipe-to-delete row (NO visible delete button) ───────────
function ChatRow({ chat, userId, onOpen, onDelete }: {
  chat: ChatRecord; userId: string; onOpen: () => void; onDelete: () => void
}) {
  const isMe = chat.buyer_id === userId
  const otherName = isMe ? chat.seller_name : chat.buyer_name
  const unread = isMe ? (chat.unread_buyer || 0) : (chat.unread_seller || 0)
  const startX = useRef(0)
  const [offset, setOffset] = useState(0)
  const dragging = useRef(false)
  const SNAP = 72

  // Reset swipe position whenever chat data changes (new message, reorder, etc.)
  // Prevents the delete button from staying visible after a new message arrives
  useEffect(() => {
    setOffset(0)
  }, [chat.last_message, chat.last_at])

  return (
    <div style={{ position: 'relative', overflow: 'hidden', borderBottom: '1px solid #1A1F2E' }}>
      {/* Delete zone — only visible after swipe */}
      <div
        onClick={onDelete}
        style={{
          position: 'absolute', right: 0, top: 0, bottom: 0, width: SNAP,
          background: '#EF4444', display: 'flex', alignItems: 'center',
          justifyContent: 'center', cursor: 'pointer',
          zIndex: 1,
        }}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="3 6 5 6 21 6"/>
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
        </svg>
      </div>

      {/* Main row — slides left to reveal delete */}
      <div
        onClick={() => Math.abs(offset) < 8 && onOpen()}
        onTouchStart={e => {
          startX.current = e.touches[0].clientX
          dragging.current = true
        }}
        onTouchMove={e => {
          if (!dragging.current) return
          const dx = e.touches[0].clientX - startX.current
          if (dx < 0) setOffset(Math.max(dx, -SNAP))
          else setOffset(Math.min(dx * 0.1, 2)) // resist right swipe
        }}
        onTouchEnd={() => {
          dragging.current = false
          setOffset(p => p < -SNAP * 0.5 ? -SNAP : 0)
        }}
        style={{
          transform: `translateX(${offset}px)`,
          transition: dragging.current ? 'none' : 'transform .22s ease',
          background: unread > 0 ? '#1A140D' : '#0F1117',
          padding: '14px 18px',
          display: 'flex', gap: 14, alignItems: 'center',
          cursor: 'pointer',
          userSelect: 'none',
          WebkitUserSelect: 'none' as any,
          width: '100%',
          boxSizing: 'border-box' as const,
          position: 'relative',
          zIndex: 2,
        }}
      >
        {/* Avatar with unread badge */}
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <div style={{
            width: 52, height: 52, borderRadius: '50%',
            background: 'linear-gradient(135deg,#FF6B1A,#FFB020)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 20, fontWeight: 700, color: '#fff',
          }}>
            {otherName.charAt(0).toUpperCase()}
          </div>
          {unread > 0 && (
            <div style={{
              position: 'absolute', top: -3, right: -3,
              background: '#EF4444', color: '#fff',
              borderRadius: 12, fontSize: 10, fontWeight: 800,
              padding: '2px 6px', minWidth: 18, textAlign: 'center',
              lineHeight: 1.4, border: '2px solid #0F1117',
            }}>
              {unread}
            </div>
          )}
        </div>

        {/* Text info */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
            <span style={{
              fontSize: 15, fontWeight: unread > 0 ? 700 : 600,
              color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis',
              whiteSpace: 'nowrap', maxWidth: '65%',
            }}>{otherName}</span>
            <span style={{ fontSize: 11, color: '#6B7280', flexShrink: 0 }}>{timeStr(chat.last_at)}</span>
          </div>
          <div style={{ fontSize: 12, color: '#FF6B1A', marginBottom: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            📍 {chat.listing_title}
          </div>
          <div style={{
            fontSize: 13,
            color: unread > 0 ? '#CBD5E1' : '#6B7280',
            fontWeight: unread > 0 ? 500 : 400,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {chat.last_message || 'Почніть розмову...'}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Chat Window ───────────────────────────────────────────────
// Waits for the DELETE to actually finish in Supabase before telling the
// parent to reload the chat list. Previously deleteChat() was fired without
// awaiting it, so loadChats() could run its SELECT before the delete had
// committed — the just-deleted chat would still show up, get auto-reopened
// (see the initialChatId logic above), and the user had to press delete a
// second time. That race is why it "worked, but sometimes needed 2 tries".
function DeleteChatButton({ chatId, onDeleted }: { chatId: string; onDeleted: () => void }) {
  const [deleting, setDeleting] = useState(false)
  return (
    <button
      disabled={deleting}
      onClick={async () => {
        if (deleting || !confirm('Видалити чат?')) return
        setDeleting(true)
        await deleteChat(chatId)
        onDeleted()
      }}
      style={{ background: 'none', border: 'none', color: '#6B7280', cursor: deleting ? 'wait' : 'pointer', padding: '8px', display: 'flex', alignItems: 'center', flexShrink: 0, opacity: deleting ? 0.5 : 1 }}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
    </button>
  )
}

function ChatWindow({ chat, user, onBack, onDeleted }: {
  chat: ChatRecord; user: User; onBack: () => void; onDeleted: () => void
}) {
  const [messages, setMessages] = useState<MessageRecord[]>([])
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [pendingImage, setPendingImage] = useState<{ previewUrl: string; uploadedUrl: string | null; uploading: boolean; failed: boolean } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [loading, setLoading] = useState(true)
  // The chat panel is pinned to exactly the visible viewport (not the full
  // window), so it's always correctly positioned above the keyboard on
  // mobile. A previous approach tried to compensate for iOS's keyboard
  // scrolling with a manual padding + CSS transform shift, which is fragile
  // and was itself the cause of the input field ending up hidden off-screen
  // while typing. Directly sizing/positioning to the visualViewport is the
  // simpler, more reliable fix — no compensation math needed.
  const [containerTop, setContainerTop] = useState(0)
  const [containerHeight, setContainerHeight] = useState<number | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const chatRef = useRef(chat)
  chatRef.current = chat
  const otherName = chat.buyer_id === user.id ? chat.seller_name : chat.buyer_name

  const scrollDown = useCallback((instant = false) => {
    const el = listRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: instant ? ('instant' as any) : 'smooth' })
  }, [])

  // Keep the chat panel exactly matched to the visible viewport, so the
  // input bar is always visible right above the on-screen keyboard.
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const update = () => {
      setContainerTop(vv.offsetTop)
      setContainerHeight(vv.height)
      setTimeout(() => scrollDown(true), 80)
    }
    update()
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
    }
  }, [scrollDown])

  useEffect(() => {
    getChatMessages(chat.id).then(msgs => {
      setMessages(msgs)
      setLoading(false)
      setTimeout(() => scrollDown(true), 80)
    })
    markChatRead(chat.id, user.id, chatRef.current)

    const sub = subscribeToMessages(chat.id, (msg) => {
      const fromOther = msg.sender_id !== user.id
      setMessages(prev => {
        // Already have this exact message? skip.
        if (prev.find(m => m.id === msg.id)) return prev
        // If this is MY OWN message arriving via realtime, it means
        // the optimistic temp bubble (negative id) is still showing —
        // replace it instead of appending, so we never show both.
        if (!fromOther) {
          const tempIdx = prev.findIndex(m => m.id < 0 && m.text === msg.text && m.sender_id === msg.sender_id && m.image_url === msg.image_url)
          if (tempIdx !== -1) {
            const copy = [...prev]
            copy[tempIdx] = msg
            return copy
          }
        }
        return [...prev, msg]
      })
      setTimeout(() => scrollDown(), 80)
      if (fromOther) {
        playReceiveSound()
        markChatRead(chat.id, user.id, chatRef.current)
      }
    })
    return () => { sub.unsubscribe() }
  }, [chat.id, user.id, scrollDown])

  const handlePickImage = (file: File | undefined) => {
    if (!file) return
    if (file.size > 10 * 1024 * 1024) { return }
    const previewUrl = URL.createObjectURL(file)
    setPendingImage({ previewUrl, uploadedUrl: null, uploading: true, failed: false })
    uploadChatImage(file, chat.id).then(url => {
      setPendingImage(p => p && p.previewUrl === previewUrl ? { ...p, uploadedUrl: url, uploading: false, failed: !url } : p)
    })
  }

  const handleSend = async () => {
    const t = text.trim()
    const img = pendingImage
    if (!t && !img) return
    if (img?.uploading) return // still uploading — wait
    if (sending) return
    setSending(true)
    setText('')
    setPendingImage(null)
    playSentSound()

    const tmp: MessageRecord = {
      id: -Date.now(), chat_id: chat.id,
      sender_id: user.id, sender_name: user.name,
      text: t, image_url: img?.uploadedUrl || img?.previewUrl || null,
      created_at: new Date().toISOString(),
    }
    setMessages(p => [...p, tmp])
    setTimeout(() => scrollDown(), 60)

    const saved = await sendMessage(chat.id, user.id, user.name, t, chatRef.current, img?.uploadedUrl)
    if (saved) {
      setMessages(p => {
        // If realtime already replaced/added it, just make sure no
        // duplicate or leftover temp bubble remains.
        const hasReal = p.find(m => m.id === saved.id)
        if (hasReal) return p.filter(m => m.id !== tmp.id)
        return p.map(m => m.id === tmp.id ? saved : m)
      })
      chatRef.current = {
        ...chatRef.current,
        last_message: t || (img ? '📷 Фото' : ''),
        unread_seller: user.id === chat.buyer_id
          ? (chatRef.current.unread_seller || 0) + 1
          : chatRef.current.unread_seller,
        unread_buyer: user.id === chat.seller_id
          ? (chatRef.current.unread_buyer || 0) + 1
          : chatRef.current.unread_buyer,
      }
    }
    setSending(false)
    setTimeout(() => inputRef.current?.focus(), 50)
  }

  return (
    <div style={{
      position: 'fixed', left: 0, right: 0,
      top: containerTop,
      height: containerHeight ?? '100dvh',
      zIndex: 200,
      display: 'flex', flexDirection: 'column',
      background: '#0F1117',
      boxSizing: 'border-box' as const,
    }}>
      {/* Header */}
      <div style={{
        flexShrink: 0, background: '#0D1018', borderBottom: '1px solid #1E2334',
        paddingTop: 'max(44px,env(safe-area-inset-top,44px))',
        paddingBottom: 10, paddingLeft: 6, paddingRight: 12,
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', padding: '8px 10px', display: 'flex', alignItems: 'center' }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'linear-gradient(135deg,#FF6B1A,#FFB020)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17, fontWeight: 700, color: '#fff', flexShrink: 0 }}>
          {otherName.charAt(0).toUpperCase()}
        </div>
        <div style={{ flex: 1, minWidth: 0, marginLeft: 4 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{otherName}</div>
          <div style={{ fontSize: 11, color: '#FF6B1A', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>📍 {chat.listing_title}</div>
        </div>
        <DeleteChatButton chatId={chat.id} onDeleted={onDeleted} />
      </div>

      {/* Messages — flex:1 scrollable */}
      <div ref={listRef} style={{
        flex: 1, overflowY: 'auto', overflowX: 'hidden',
        padding: '12px 16px 8px',
        display: 'flex', flexDirection: 'column', gap: 8,
        WebkitOverflowScrolling: 'touch' as any,
      }}>
        {loading && <div style={{ textAlign: 'center', paddingTop: 40, color: '#6B7280' }}>⏳</div>}
        {!loading && messages.length === 0 && (
          <div style={{ textAlign: 'center', paddingTop: 60, color: '#6B7280', lineHeight: 1.8 }}>
            👋 Напишіть перше повідомлення
          </div>
        )}
        {messages.map(msg => {
          const mine = msg.sender_id === user.id
          return (
            <div key={msg.id} style={{ display: 'flex', justifyContent: mine ? 'flex-end' : 'flex-start', gap: 8, alignItems: 'flex-end' }}>
              {!mine && (
                <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'linear-gradient(135deg,#FF6B1A,#FFB020)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: '#fff', flexShrink: 0 }}>
                  {msg.sender_name.charAt(0).toUpperCase()}
                </div>
              )}
              <div style={{ maxWidth: '74%' }}>
                {!mine && <div style={{ fontSize: 11, color: '#FF6B1A', fontWeight: 600, paddingLeft: 4, marginBottom: 3 }}>{msg.sender_name}</div>}
                <div style={{
                  background: mine ? 'linear-gradient(135deg,#FF6B1A,#FF8C3A)' : '#1E2334',
                  borderRadius: mine ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
                  padding: msg.image_url ? 6 : '10px 14px',
                  border: mine ? 'none' : '1px solid #2A3045',
                  opacity: msg.id < 0 ? 0.55 : 1,
                }}>
                  {msg.image_url && (
                    <img
                      src={msg.image_url}
                      onClick={() => window.open(msg.image_url!, '_blank')}
                      style={{ display: 'block', maxWidth: '100%', maxHeight: 260, borderRadius: 14, cursor: 'pointer', marginBottom: msg.text ? 6 : 0 }}
                    />
                  )}
                  {msg.text && <div style={{ fontSize: 15, color: '#fff', lineHeight: 1.5, wordBreak: 'break-word', padding: msg.image_url ? '0 6px' : 0 }}>{msg.text}</div>}
                </div>
                <div style={{ fontSize: 10, color: '#4B5563', marginTop: 3, textAlign: mine ? 'right' : 'left', paddingLeft: mine ? 0 : 4, paddingRight: mine ? 4 : 0 }}>
                  {msg.id < 0 ? '⏳' : timeStr(msg.created_at)}{mine && msg.id > 0 ? ' ✓' : ''}
                </div>
              </div>
            </div>
          )
        })}
        <div style={{ height: 4, flexShrink: 0 }} />
      </div>

      {/* Input — always at bottom, NOT affected by keyboard (paddingBottom on parent handles it) */}
      <div style={{
        flexShrink: 0,
        background: '#0D1018',
        borderTop: '1px solid #1E2334',
      }}>
        {pendingImage && (
          <div style={{ padding: '10px 16px 0', display: 'flex' }}>
            <div style={{ position: 'relative' }}>
              <img src={pendingImage.previewUrl} style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 12, opacity: pendingImage.uploading ? 0.5 : 1, border: pendingImage.failed ? '2px solid #EF4444' : 'none' }} />
              {pendingImage.uploading && <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>⏳</div>}
              <button onClick={() => setPendingImage(null)} style={{ position: 'absolute', top: -6, right: -6, background: '#EF4444', border: 'none', borderRadius: '50%', width: 20, height: 20, cursor: 'pointer', color: '#fff', fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
            </div>
          </div>
        )}
        <div style={{
        padding: '10px 16px',
        paddingBottom: 'max(14px,env(safe-area-inset-bottom,14px))',
        display: 'flex', gap: 10, alignItems: 'center',
      }}>
        <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={e => { handlePickImage(e.target.files?.[0]); e.target.value = '' }} />
        <button
          onClick={() => fileRef.current?.click()}
          style={{ width: 40, height: 40, borderRadius: '50%', border: 'none', flexShrink: 0, background: '#1A1F2E', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
        >
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#A0A8BC" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>
        </button>
        <input
          ref={inputRef}
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
          placeholder="Написати повідомлення..."
          style={{
            flex: 1, background: '#1A1F2E',
            border: '1.5px solid #2A3045',
            borderRadius: 24, padding: '11px 18px',
            color: '#fff', fontSize: 16,
            fontFamily: 'Inter,sans-serif',
            outline: 'none', minWidth: 0,
            WebkitAppearance: 'none' as any,
          }}
        />
        <button
          onClick={handleSend}
          disabled={(!text.trim() && !pendingImage) || sending || pendingImage?.uploading}
          style={{
            width: 46, height: 46, borderRadius: '50%', border: 'none', flexShrink: 0,
            background: (text.trim() || pendingImage) ? 'linear-gradient(135deg,#FF6B1A,#FF8C3A)' : '#1E2334',
            cursor: (text.trim() || pendingImage) ? 'pointer' : 'default',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'background .15s', touchAction: 'manipulation',
          }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="22" y1="2" x2="11" y2="13"/>
            <polygon points="22 2 15 22 11 13 2 9 22 2"/>
          </svg>
        </button>
        </div>
      </div>
    </div>
  )
}

// ── Background sound listener (runs on all pages) ─────────────
export function useChatSoundListener(userId: string | undefined) {
  useEffect(() => {
    if (!userId) return
    // Subscribe to ALL new messages for this user
    const { createClient } = require('@supabase/supabase-js')
    const sb = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false } }
    )
    const channel = sb
      .channel(`bg_sound_${userId}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'messages',
      }, (payload: any) => {
        const msg = payload.new
        // Only play if message is NOT from me
        if (msg.sender_id !== userId) {
          playReceiveSound()
        }
      })
      .subscribe()
    return () => { channel.unsubscribe() }
  }, [userId])
}

// ── Main ChatsScreen ──────────────────────────────────────────
export default function ChatsScreen({ user, isGuest, onLogin, initialChatId, onInitialChatConsumed }: Props) {
  const [chats, setChats] = useState<ChatRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [activeChat, setActiveChat] = useState<ChatRecord | null>(null)
  const openedRef = useRef(false)

  const loadChats = useCallback(async () => {
    if (!user) return
    const data = await getUserChats(user.id)
    setChats(data)
    setLoading(false)
    // Auto-open chat if initialChatId provided (from DetailScreen)
    if (initialChatId && !openedRef.current) {
      const target = data.find(c => c.id === initialChatId)
      if (target) { setActiveChat(target); openedRef.current = true }
      // Tell the parent this id has been used, so it clears its state and
      // doesn't keep forcing this same chat open every time we remount.
      onInitialChatConsumed?.()
    }
  }, [user, initialChatId, onInitialChatConsumed])

  useEffect(() => {
    if (!user) { setLoading(false); return }
    loadChats()
    const sub = subscribeToUserChats(user.id, loadChats)
    return () => { sub.unsubscribe() }
  }, [user, loadChats])

  // Pull-to-refresh reloads the chat list itself (not listings — the
  // `onRefresh` prop some other screens use is for the listings feed and
  // would be the wrong data source here).
  const ptr = usePTR(loadChats)

  const totalUnread = chats.reduce((s, c) =>
    s + (c.buyer_id === user?.id ? (c.unread_buyer || 0) : (c.unread_seller || 0)), 0)

  if (!user) {
    return (
      <div style={{ paddingBottom: 90 }}>
        <div style={{ padding: '48px 20px 16px', paddingTop: 'max(48px,env(safe-area-inset-top,48px))', background: '#0D1018', borderBottom: '1px solid #1E2334' }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#fff' }}>Повідомлення</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '80px 24px', gap: 16, textAlign: 'center' }}>
          <div style={{ fontSize: 60 }}>💬</div>
          <div style={{ fontSize: 18, fontWeight: 600, color: '#fff' }}>Увійдіть щоб писати</div>
          <button onClick={onLogin} style={{ background: 'linear-gradient(135deg,#FF6B1A,#FF8C3A)', border: 'none', borderRadius: 14, padding: '14px 36px', color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer' }}>Увійти</button>
        </div>
      </div>
    )
  }

  if (activeChat) {
    return (
      <ChatWindow
        chat={activeChat} user={user}
        // Do NOT reset openedRef here. openedRef exists to make sure a chat
        // opened via `initialChatId` (a deep link from "message seller" on
        // DetailScreen) auto-opens only once per visit to this screen. If we
        // reset it back to false on close, the very next loadChats() call
        // below re-runs that auto-open check while `initialChatId` is still
        // the same prop value, finds the same chat again, and immediately
        // re-opens it — which is exactly why "back" looked broken: the chat
        // closed for an instant and then reopened itself.
        onBack={() => { setActiveChat(null); loadChats() }}
        onDeleted={() => { setActiveChat(null); loadChats() }}
      />
    )
  }

  return (
    <div style={{ paddingBottom: 90 }}>
      <PTRIndicator state={ptr.state} pullY={ptr.pullY} />
      <div style={{ padding: '48px 20px 14px', paddingTop: 'max(48px,env(safe-area-inset-top,48px))', background: '#0D1018', borderBottom: '1px solid #1E2334', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontSize: 22, fontWeight: 700, color: '#fff' }}>Повідомлення</div>
        {totalUnread > 0 && <span style={{ background: '#EF4444', color: '#fff', fontSize: 12, fontWeight: 700, borderRadius: 20, padding: '3px 12px' }}>{totalUnread} нових</span>}
      </div>

      {chats.length > 0 && (
        <div style={{ padding: '7px 18px', borderBottom: '1px solid #1A1F2E' }}>
          <span style={{ fontSize: 11, color: '#4B5563' }}>← Свайп вліво щоб видалити</span>
        </div>
      )}

      {loading && <div style={{ textAlign: 'center', padding: '60px 0', color: '#6B7280' }}>⏳</div>}

      {!loading && chats.length === 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '70px 24px', gap: 14, textAlign: 'center' }}>
          <div style={{ fontSize: 60 }}>💬</div>
          <div style={{ fontSize: 17, fontWeight: 600, color: '#fff' }}>Поки немає повідомлень</div>
          <div style={{ fontSize: 13, color: '#6B7280', maxWidth: 260, lineHeight: 1.7 }}>Натисніть 💬 на картці оголошення</div>
        </div>
      )}

      {!loading && chats.map(chat => (
        <ChatRow
          key={chat.id} chat={chat} userId={user.id}
          onOpen={() => setActiveChat(chat)}
          onDelete={async () => {
            if (!confirm('Видалити чат?')) return
            await deleteChat(chat.id)
            loadChats()
          }}
        />
      ))}
    </div>
  )
}
