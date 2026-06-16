'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import type { User } from '@/types'
import {
  getUserChats, getChatMessages, sendMessage, markChatRead,
  deleteChat, subscribeToMessages, subscribeToUserChats,
  type ChatRecord, type MessageRecord,
} from '@/lib/chats-db'

// ── Inline sound utils (no external file needed) ─────────────
function playSentSound() {
  try {
    const ctx = new ((window as any).AudioContext || (window as any).webkitAudioContext)()
    const o = ctx.createOscillator(); const g = ctx.createGain()
    o.connect(g); g.connect(ctx.destination)
    o.type = 'sine'; o.frequency.value = 1200
    g.gain.setValueAtTime(0.07, ctx.currentTime)
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12)
    o.start(); o.stop(ctx.currentTime + 0.12)
    setTimeout(() => ctx.close(), 200)
  } catch {}
}

function playReceiveSound() {
  try {
    const ctx = new ((window as any).AudioContext || (window as any).webkitAudioContext)()
    const g = ctx.createGain(); g.connect(ctx.destination)
    ;[880, 1100].forEach((freq, i) => {
      const o = ctx.createOscillator(); o.connect(g)
      o.type = 'sine'; o.frequency.value = freq
      const t = ctx.currentTime + i * 0.1
      g.gain.setValueAtTime(0.08, t)
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.18)
      o.start(t); o.stop(t + 0.18)
    })
    setTimeout(() => ctx.close(), 500)
  } catch {}
}

interface Props {
  user: User | null
  isGuest: boolean
  onLogin: () => void
  onRefresh?: () => Promise<void>
  // If set, auto-open this chat when component mounts
  initialChatId?: string
}

function timeStr(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000
  if (diff < 60) return 'щойно'
  if (diff < 3600) return Math.floor(diff / 60) + ' хв'
  const d = new Date(iso)
  if (diff < 86400) return d.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' })
  return d.toLocaleDateString('uk-UA', { day: 'numeric', month: 'short' })
}

// ── Swipe-to-delete row ───────────────────────────────────────
function ChatRow({ chat, userId, onOpen, onDelete }: {
  chat: ChatRecord; userId: string; onOpen: () => void; onDelete: () => void
}) {
  const isMe = chat.buyer_id === userId
  const otherName = isMe ? chat.seller_name : chat.buyer_name
  const unread = isMe ? (chat.unread_buyer || 0) : (chat.unread_seller || 0)
  const startX = useRef(0)
  const [offset, setOffset] = useState(0)
  const dragging = useRef(false)
  const SNAP = 76

  return (
    <div style={{ position: 'relative', overflow: 'hidden', borderBottom: '1px solid #1A1F2E' }}>
      {/* Hidden delete zone */}
      <div onClick={onDelete} style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: SNAP, background: '#EF4444', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
      </div>

      <div
        onClick={() => Math.abs(offset) < 8 && onOpen()}
        onTouchStart={e => { startX.current = e.touches[0].clientX; dragging.current = true }}
        onTouchMove={e => {
          if (!dragging.current) return
          const dx = e.touches[0].clientX - startX.current
          setOffset(dx < 0 ? Math.max(dx, -SNAP) : Math.min(dx * 0.15, 3))
        }}
        onTouchEnd={() => {
          dragging.current = false
          setOffset(p => p < -SNAP / 2 ? -SNAP : 0)
        }}
        style={{
          transform: `translateX(${offset}px)`,
          transition: dragging.current ? 'none' : 'transform .22s ease',
          background: unread > 0 ? 'rgba(255,107,26,.05)' : '#0F1117',
          padding: '14px 16px', display: 'flex', gap: 13, alignItems: 'center',
          cursor: 'pointer', userSelect: 'none', WebkitUserSelect: 'none' as any,
        }}
      >
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <div style={{ width: 50, height: 50, borderRadius: '50%', background: 'linear-gradient(135deg,#FF6B1A,#FFB020)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, fontWeight: 700, color: '#fff' }}>
            {otherName.charAt(0).toUpperCase()}
          </div>
          {unread > 0 && (
            <div style={{ position: 'absolute', top: -3, right: -3, background: '#EF4444', color: '#fff', borderRadius: 12, fontSize: 10, fontWeight: 800, padding: '2px 6px', minWidth: 18, textAlign: 'center', lineHeight: 1.4, border: '2px solid #0F1117' }}>
              {unread}
            </div>
          )}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
            <span style={{ fontSize: 15, fontWeight: unread > 0 ? 700 : 600, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '64%' }}>{otherName}</span>
            <span style={{ fontSize: 11, color: '#6B7280', flexShrink: 0 }}>{timeStr(chat.last_at)}</span>
          </div>
          <div style={{ fontSize: 12, color: '#FF6B1A', marginBottom: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>📍 {chat.listing_title}</div>
          <div style={{ fontSize: 13, color: unread > 0 ? '#CBD5E1' : '#6B7280', fontWeight: unread > 0 ? 500 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {chat.last_message || 'Почніть розмову...'}
          </div>
        </div>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#2A3045" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
      </div>
    </div>
  )
}

// ── Chat Window ───────────────────────────────────────────────
function ChatWindow({ chat, user, onBack, onDeleted }: {
  chat: ChatRecord; user: User; onBack: () => void; onDeleted: () => void
}) {
  const [messages, setMessages] = useState<MessageRecord[]>([])
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [loading, setLoading] = useState(true)
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const chatRef = useRef(chat)
  const otherName = chat.buyer_id === user.id ? chat.seller_name : chat.buyer_name

  const scrollDown = useCallback((instant = false) => {
    const el = listRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: instant ? ('instant' as any) : 'smooth' })
  }, [])

  useEffect(() => {
    // Load messages
    getChatMessages(chat.id).then(msgs => {
      setMessages(msgs)
      setLoading(false)
      setTimeout(() => scrollDown(true), 80)
    })

    // Mark as read immediately on open
    markChatRead(chat.id, user.id, chatRef.current)

    // Realtime — new messages
    const sub = subscribeToMessages(chat.id, (msg) => {
      const fromOther = msg.sender_id !== user.id
      setMessages(prev => {
        if (prev.find(m => m.id === msg.id)) return prev
        return [...prev, msg]
      })
      setTimeout(() => scrollDown(), 80)

      if (fromOther) {
        // Play receive sound
        playReceiveSound()
        // Mark as read since we're viewing this chat
        markChatRead(chat.id, user.id, chatRef.current)
      }
    })

    // Keep chat ref updated
    const chatUpdate = setInterval(async () => {
      const { data } = await import('@supabase/supabase-js').then(() =>
        ({ data: null })
      ).catch(() => ({ data: null }))
    }, 30000)

    return () => {
      sub.unsubscribe()
      clearInterval(chatUpdate)
    }
  }, [chat.id, user.id, scrollDown])

  // Handle keyboard — scroll to bottom when keyboard opens
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const handler = () => setTimeout(() => scrollDown(true), 150)
    vv.addEventListener('resize', handler)
    return () => vv.removeEventListener('resize', handler)
  }, [scrollDown])

  const handleSend = async () => {
    const t = text.trim()
    if (!t || sending) return
    setSending(true)
    setText('')

    // Optimistic
    const tmp: MessageRecord = {
      id: -Date.now(), chat_id: chat.id,
      sender_id: user.id, sender_name: user.name,
      text: t, created_at: new Date().toISOString(),
    }
    setMessages(p => [...p, tmp])
    setTimeout(() => scrollDown(), 60)
    playSentSound()

    const saved = await sendMessage(chat.id, user.id, user.name, t, chatRef.current)
    if (saved) {
      setMessages(p => p.map(m => m.id === tmp.id ? saved : m))
      // Update local chatRef with new unread counts
      const isBuyer = user.id === chat.buyer_id
      chatRef.current = {
        ...chatRef.current,
        last_message: t,
        unread_seller: isBuyer ? (chatRef.current.unread_seller || 0) + 1 : chatRef.current.unread_seller,
        unread_buyer: !isBuyer ? (chatRef.current.unread_buyer || 0) + 1 : chatRef.current.unread_buyer,
      }
    }
    setSending(false)
    setTimeout(() => inputRef.current?.focus(), 50)
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 200,
      display: 'flex', flexDirection: 'column',
      background: '#0F1117',
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
        <button onClick={() => { if (confirm('Видалити чат?')) { deleteChat(chat.id); onDeleted() } }} style={{ background: 'none', border: 'none', color: '#6B7280', cursor: 'pointer', padding: '8px', display: 'flex', alignItems: 'center', flexShrink: 0 }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
        </button>
      </div>

      {/* Messages */}
      <div ref={listRef} style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '12px 16px 4px', display: 'flex', flexDirection: 'column', gap: 8, WebkitOverflowScrolling: 'touch' as any }}>
        {loading && <div style={{ textAlign: 'center', paddingTop: 40, color: '#6B7280' }}>⏳ Завантаження...</div>}
        {!loading && messages.length === 0 && (
          <div style={{ textAlign: 'center', paddingTop: 60, color: '#6B7280', lineHeight: 1.8 }}>
            👋 Привіт!<br/><span style={{ fontSize: 12 }}>Напишіть перше повідомлення</span>
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
                  padding: '10px 14px',
                  border: mine ? 'none' : '1px solid #2A3045',
                  opacity: msg.id < 0 ? 0.55 : 1,
                  boxShadow: mine ? '0 2px 10px rgba(255,107,26,.25)' : 'none',
                }}>
                  <div style={{ fontSize: 15, color: '#fff', lineHeight: 1.5, wordBreak: 'break-word' }}>{msg.text}</div>
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

      {/* Input bar */}
      <div style={{
        flexShrink: 0, background: '#0D1018', borderTop: '1px solid #1E2334',
        padding: '10px 16px',
        paddingBottom: 'max(14px,env(safe-area-inset-bottom,14px))',
        display: 'flex', gap: 10, alignItems: 'center',
      }}>
        <input
          ref={inputRef}
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
          onFocus={() => setTimeout(() => scrollDown(true), 250)}
          placeholder="Написати повідомлення..."
          style={{
            flex: 1, background: '#1A1F2E', border: '1.5px solid #2A3045',
            borderRadius: 24, padding: '11px 18px', color: '#fff', fontSize: 16,
            fontFamily: 'Inter,sans-serif', outline: 'none', minWidth: 0,
            WebkitAppearance: 'none' as any,
          }}
        />
        <button
          onClick={handleSend}
          disabled={!text.trim() || sending}
          style={{
            width: 46, height: 46, borderRadius: '50%', border: 'none', flexShrink: 0,
            background: text.trim() ? 'linear-gradient(135deg,#FF6B1A,#FF8C3A)' : '#1E2334',
            cursor: text.trim() ? 'pointer' : 'default',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'background .15s', touchAction: 'manipulation',
            boxShadow: text.trim() ? '0 2px 12px rgba(255,107,26,.4)' : 'none',
          }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="22" y1="2" x2="11" y2="13"/>
            <polygon points="22 2 15 22 11 13 2 9 22 2"/>
          </svg>
        </button>
      </div>
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────
export default function ChatsScreen({ user, isGuest, onLogin, initialChatId }: Props) {
  const [chats, setChats] = useState<ChatRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [activeChat, setActiveChat] = useState<ChatRecord | null>(null)

  const loadChats = useCallback(async () => {
    if (!user) return
    const data = await getUserChats(user.id)
    setChats(data)
    setLoading(false)
    // Auto-open chat if initialChatId is set
    if (initialChatId) {
      const target = data.find(c => c.id === initialChatId)
      if (target) setActiveChat(target)
    }
  }, [user, initialChatId])

  useEffect(() => {
    if (!user) { setLoading(false); return }
    loadChats()
    const sub = subscribeToUserChats(user.id, loadChats)
    return () => { sub.unsubscribe() }
  }, [user, loadChats])

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
    return <ChatWindow chat={activeChat} user={user}
      onBack={() => { setActiveChat(null); loadChats() }}
      onDeleted={() => { setActiveChat(null); loadChats() }} />
  }

  return (
    <div style={{ paddingBottom: 90 }}>
      <div style={{ padding: '48px 20px 14px', paddingTop: 'max(48px,env(safe-area-inset-top,48px))', background: '#0D1018', borderBottom: '1px solid #1E2334', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontSize: 22, fontWeight: 700, color: '#fff' }}>Повідомлення</div>
        {totalUnread > 0 && <span style={{ background: '#EF4444', color: '#fff', fontSize: 12, fontWeight: 700, borderRadius: 20, padding: '3px 12px' }}>{totalUnread} нових</span>}
      </div>

      {chats.length > 0 && <div style={{ padding: '7px 18px', borderBottom: '1px solid #1A1F2E' }}><span style={{ fontSize: 11, color: '#4B5563' }}>← Свайп вліво щоб видалити</span></div>}

      {loading && <div style={{ textAlign: 'center', padding: '60px 0', color: '#6B7280' }}>⏳ Завантаження...</div>}

      {!loading && chats.length === 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '70px 24px', gap: 14, textAlign: 'center' }}>
          <div style={{ fontSize: 60 }}>💬</div>
          <div style={{ fontSize: 17, fontWeight: 600, color: '#fff' }}>Поки немає повідомлень</div>
          <div style={{ fontSize: 13, color: '#6B7280', maxWidth: 260, lineHeight: 1.7 }}>Натисніть 💬 на картці оголошення, щоб написати власнику</div>
        </div>
      )}

      {!loading && chats.map(chat => (
        <ChatRow key={chat.id} chat={chat} userId={user.id}
          onOpen={() => setActiveChat(chat)}
          onDelete={async () => { if (!confirm('Видалити чат?')) return; await deleteChat(chat.id); loadChats() }} />
      ))}
    </div>
  )
}
