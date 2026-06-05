'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import type { User } from '@/types'
import {
  getUserChats, getChatMessages, sendMessage,
  markChatRead, deleteChat, subscribeToMessages,
  subscribeToUserChats,
  type ChatRecord, type MessageRecord,
} from '@/lib/chats-db'

interface Props {
  user: User | null
  isGuest: boolean
  onLogin: () => void
  onRefresh?: () => Promise<void>
}

function timeAgo(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000
  if (diff < 60) return 'щойно'
  if (diff < 3600) return Math.floor(diff / 60) + ' хв'
  const d = new Date(iso)
  if (diff < 86400) return d.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' })
  return d.toLocaleDateString('uk-UA', { day: 'numeric', month: 'short' })
}

// ── Swipeable chat row ────────────────────────────────────────
function ChatRow({ chat, userId, onOpen, onDelete }: {
  chat: ChatRecord; userId: string
  onOpen: () => void; onDelete: () => void
}) {
  const isMe = chat.buyer_id === userId
  const otherName = isMe ? chat.seller_name : chat.buyer_name
  const unread = isMe ? chat.unread_buyer : chat.unread_seller
  const startX = useRef(0)
  const [offset, setOffset] = useState(0)
  const [swiping, setSwiping] = useState(false)
  const THRESHOLD = 80

  const onTS = (e: React.TouchEvent) => {
    startX.current = e.touches[0].clientX
    setSwiping(true)
  }
  const onTM = (e: React.TouchEvent) => {
    if (!swiping) return
    const dx = e.touches[0].clientX - startX.current
    if (dx < 0) setOffset(Math.max(dx, -THRESHOLD * 1.2))
  }
  const onTE = () => {
    setSwiping(false)
    if (offset < -THRESHOLD) {
      setOffset(-THRESHOLD)
    } else {
      setOffset(0)
    }
  }

  return (
    <div style={{ position: 'relative', overflow: 'hidden', borderBottom: '1px solid #1A1F2E' }}>
      {/* Delete button revealed on swipe */}
      <div style={{
        position: 'absolute', right: 0, top: 0, bottom: 0,
        width: THRESHOLD, background: '#EF4444',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        cursor: 'pointer',
      }} onClick={onDelete}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="3 6 5 6 21 6"/>
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
        </svg>
      </div>

      {/* Main row */}
      <div
        onClick={() => { if (offset === 0) onOpen() }}
        onTouchStart={onTS}
        onTouchMove={onTM}
        onTouchEnd={onTE}
        style={{
          transform: `translateX(${offset}px)`,
          transition: swiping ? 'none' : 'transform .25s ease',
          background: unread > 0 ? 'rgba(255,107,26,.05)' : '#0F1117',
          padding: '14px 18px',
          display: 'flex', gap: 14, alignItems: 'center',
          cursor: 'pointer', userSelect: 'none',
          WebkitUserSelect: 'none',
        }}
      >
        {/* Avatar */}
        <div style={{ width: 52, height: 52, borderRadius: '50%', flexShrink: 0, background: 'linear-gradient(135deg,#FF6B1A,#FFB020)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, fontWeight: 700, color: '#fff', position: 'relative' }}>
          {otherName.charAt(0).toUpperCase()}
          {unread > 0 && (
            <span style={{ position: 'absolute', top: -3, right: -3, background: '#EF4444', color: '#fff', borderRadius: 10, fontSize: 10, fontWeight: 700, padding: '2px 6px', lineHeight: 1.3, minWidth: 18, textAlign: 'center' }}>
              {unread}
            </span>
          )}
        </div>

        {/* Text */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
            <div style={{ fontSize: 15, fontWeight: unread > 0 ? 700 : 600, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '65%' }}>
              {otherName}
            </div>
            <div style={{ fontSize: 11, color: '#6B7280', flexShrink: 0 }}>{timeAgo(chat.last_at)}</div>
          </div>
          <div style={{ fontSize: 12, color: '#FF6B1A', marginBottom: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            📍 {chat.listing_title}
          </div>
          <div style={{ fontSize: 13, color: unread > 0 ? '#CBD5E1' : '#6B7280', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: unread > 0 ? 500 : 400 }}>
            {chat.last_message || 'Почніть розмову...'}
          </div>
        </div>

        {/* Swipe hint */}
        {offset === 0 && (
          <div style={{ color: '#2A3045', flexShrink: 0 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
          </div>
        )}
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
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const chatRef = useRef(chat)
  chatRef.current = chat

  const otherName = chat.buyer_id === user.id ? chat.seller_name : chat.buyer_name

  const scrollToBottom = useCallback((smooth = true) => {
    bottomRef.current?.scrollIntoView({ behavior: smooth ? 'smooth' : 'instant' })
  }, [])

  useEffect(() => {
    getChatMessages(chat.id).then(msgs => {
      setMessages(msgs)
      setLoading(false)
      setTimeout(() => scrollToBottom(false), 50)
    })
    markChatRead(chat.id, user.id, chat)

    // Realtime subscription
    const sub = subscribeToMessages(chat.id, (newMsg) => {
      setMessages(prev => {
        if (prev.find(m => m.id === newMsg.id)) return prev
        return [...prev, newMsg]
      })
      setTimeout(() => scrollToBottom(), 100)
      // Play notification sound
      try {
        const ctx = new AudioContext()
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.connect(gain); gain.connect(ctx.destination)
        osc.frequency.value = 880
        gain.gain.setValueAtTime(0.1, ctx.currentTime)
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3)
        osc.start(); osc.stop(ctx.currentTime + 0.3)
      } catch {}
    })

    return () => { sub.unsubscribe() }
  }, [chat.id, user.id, scrollToBottom])

  // Fix: when keyboard opens on iOS, scroll to bottom
  useEffect(() => {
    const onResize = () => setTimeout(() => scrollToBottom(false), 100)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [scrollToBottom])

  const handleSend = async () => {
    const trimmed = text.trim()
    if (!trimmed || sending) return
    setSending(true)
    setText('')

    const temp: MessageRecord = {
      id: -Date.now(), chat_id: chat.id,
      sender_id: user.id, sender_name: user.name,
      text: trimmed, created_at: new Date().toISOString(),
    }
    setMessages(prev => [...prev, temp])
    setTimeout(() => scrollToBottom(), 50)

    const saved = await sendMessage(chat.id, user.id, user.name, trimmed, chatRef.current)
    if (saved) {
      setMessages(prev => prev.map(m => m.id === temp.id ? saved : m))
    }
    setSending(false)
    inputRef.current?.focus()
  }

  const handleDelete = async () => {
    if (!confirm('Видалити цей чат і всі повідомлення?')) return
    await deleteChat(chat.id)
    onDeleted()
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 200,
      display: 'flex', flexDirection: 'column',
      background: '#0F1117',
    }}>
      {/* Header */}
      <div style={{
        flexShrink: 0, background: '#0D1018',
        borderBottom: '1px solid #1E2334',
        paddingTop: 'max(44px, env(safe-area-inset-top, 44px))',
        paddingBottom: 12, paddingLeft: 8, paddingRight: 8,
        display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', padding: '8px 10px', display: 'flex', alignItems: 'center', flexShrink: 0 }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
        </button>

        <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'linear-gradient(135deg,#FF6B1A,#FFB020)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17, fontWeight: 700, color: '#fff', flexShrink: 0 }}>
          {otherName.charAt(0).toUpperCase()}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{otherName}</div>
          <div style={{ fontSize: 11, color: '#FF6B1A', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>📍 {chat.listing_title}</div>
        </div>

        <button onClick={handleDelete} style={{ background: 'none', border: 'none', color: '#EF4444', cursor: 'pointer', padding: '8px 10px', display: 'flex', alignItems: 'center', flexShrink: 0 }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
          </svg>
        </button>
      </div>

      {/* Messages */}
      <div
        ref={containerRef}
        style={{
          flex: 1, overflowY: 'auto', overflowX: 'hidden',
          padding: '16px 16px 8px',
          display: 'flex', flexDirection: 'column', gap: 10,
        }}
      >
        {loading && <div style={{ textAlign: 'center', color: '#6B7280', fontSize: 13, paddingTop: 40 }}>⏳ Завантаження...</div>}

        {!loading && messages.length === 0 && (
          <div style={{ textAlign: 'center', color: '#6B7280', fontSize: 13, paddingTop: 40, lineHeight: 1.8 }}>
            👋 Привіт! Почніть розмову<br/>
            <span style={{ fontSize: 12 }}>Повідомлення доставляються в реальному часі</span>
          </div>
        )}

        {messages.map(msg => {
          const isMe = msg.sender_id === user.id
          return (
            <div key={msg.id} style={{ display: 'flex', justifyContent: isMe ? 'flex-end' : 'flex-start', gap: 8, alignItems: 'flex-end' }}>
              {/* Avatar for other person */}
              {!isMe && (
                <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'linear-gradient(135deg,#FF6B1A,#FFB020)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: '#fff', flexShrink: 0, marginBottom: 2 }}>
                  {msg.sender_name.charAt(0).toUpperCase()}
                </div>
              )}

              <div style={{ maxWidth: '72%', display: 'flex', flexDirection: 'column', alignItems: isMe ? 'flex-end' : 'flex-start', gap: 2 }}>
                {!isMe && (
                  <div style={{ fontSize: 11, color: '#FF6B1A', fontWeight: 600, paddingLeft: 4 }}>{msg.sender_name}</div>
                )}
                <div style={{
                  background: isMe ? 'linear-gradient(135deg,#FF6B1A,#FF8C3A)' : '#1E2334',
                  borderRadius: isMe ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
                  padding: '10px 14px',
                  border: isMe ? 'none' : '1px solid #2A3045',
                  opacity: msg.id < 0 ? 0.6 : 1,
                  boxShadow: isMe ? '0 2px 8px rgba(255,107,26,.3)' : 'none',
                }}>
                  <div style={{ fontSize: 15, color: '#fff', lineHeight: 1.5, wordBreak: 'break-word' }}>{msg.text}</div>
                </div>
                <div style={{ fontSize: 10, color: '#4B5563', paddingLeft: isMe ? 0 : 4, paddingRight: isMe ? 4 : 0 }}>
                  {msg.id < 0 ? '⏳ відправляється...' : timeAgo(msg.created_at)}
                  {isMe && msg.id > 0 && ' ✓'}
                </div>
              </div>
            </div>
          )
        })}
        <div ref={bottomRef} style={{ height: 4 }} />
      </div>

      {/* Input bar — stays above keyboard */}
      <div style={{
        flexShrink: 0,
        background: '#0D1018',
        borderTop: '1px solid #1E2334',
        padding: '10px 16px',
        paddingBottom: 'max(14px, env(safe-area-inset-bottom, 14px))',
        display: 'flex', gap: 10, alignItems: 'center',
      }}>
        <input
          ref={inputRef}
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
          onFocus={() => setTimeout(() => scrollToBottom(false), 300)}
          placeholder="Написати повідомлення..."
          style={{
            flex: 1, background: '#1A1F2E',
            border: '1.5px solid #2A3045',
            borderRadius: 24, padding: '12px 18px',
            color: '#fff', fontSize: 16,
            fontFamily: 'Inter, sans-serif', outline: 'none',
            minWidth: 0, display: 'block',
            WebkitAppearance: 'none' as any,
          }}
        />
        <button
          onClick={handleSend}
          disabled={!text.trim() || sending}
          style={{
            width: 48, height: 48, borderRadius: '50%', flexShrink: 0, border: 'none',
            background: text.trim() ? 'linear-gradient(135deg,#FF6B1A,#FF8C3A)' : '#1E2334',
            cursor: text.trim() ? 'pointer' : 'default',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'background .2s',
            boxShadow: text.trim() ? '0 3px 12px rgba(255,107,26,.4)' : 'none',
            touchAction: 'manipulation',
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

// ── Main ChatsScreen ──────────────────────────────────────────
export default function ChatsScreen({ user, isGuest, onLogin }: Props) {
  const [chats, setChats] = useState<ChatRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [activeChat, setActiveChat] = useState<ChatRecord | null>(null)

  const loadChats = useCallback(async () => {
    if (!user) return
    const data = await getUserChats(user.id)
    setChats(data)
    setLoading(false)
  }, [user])

  useEffect(() => {
    if (!user) { setLoading(false); return }
    loadChats()
    // Auto-refresh on new messages
    const sub = subscribeToUserChats(user.id, () => loadChats())
    return () => { sub.unsubscribe() }
  }, [user, loadChats])

  if (!user) {
    return (
      <div style={{ paddingBottom: 90 }}>
        <div style={{ padding: '48px 20px 16px', paddingTop: 'max(48px,env(safe-area-inset-top,48px))', background: '#0D1018', borderBottom: '1px solid #1E2334' }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#fff' }}>Повідомлення</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '80px 24px', gap: 16, textAlign: 'center' }}>
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#2A3045" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          <div style={{ fontSize: 18, fontWeight: 600, color: '#fff' }}>Увійдіть щоб писати</div>
          <div style={{ fontSize: 14, color: '#6B7280', maxWidth: 260, lineHeight: 1.6 }}>Авторизовані користувачі можуть вести переписку з власниками</div>
          <button onClick={onLogin} style={{ background: 'linear-gradient(135deg,#FF6B1A,#FF8C3A)', border: 'none', borderRadius: 14, padding: '14px 36px', color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer', boxShadow: '0 4px 16px rgba(255,107,26,.35)' }}>
            Увійти
          </button>
        </div>
      </div>
    )
  }

  if (activeChat) {
    return (
      <ChatWindow
        chat={activeChat}
        user={user}
        onBack={() => { setActiveChat(null); loadChats() }}
        onDeleted={() => { setActiveChat(null); loadChats() }}
      />
    )
  }

  const totalUnread = chats.reduce((s, c) => s + (c.buyer_id === user.id ? c.unread_buyer : c.unread_seller), 0)

  return (
    <div style={{ paddingBottom: 90 }}>
      {/* Header */}
      <div style={{ padding: '48px 20px 16px', paddingTop: 'max(48px,env(safe-area-inset-top,48px))', background: '#0D1018', borderBottom: '1px solid #1E2334', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontSize: 22, fontWeight: 700, color: '#fff' }}>Повідомлення</div>
        {totalUnread > 0 && (
          <span style={{ background: '#EF4444', color: '#fff', fontSize: 12, fontWeight: 700, borderRadius: 20, padding: '3px 10px' }}>
            {totalUnread} нових
          </span>
        )}
      </div>

      {/* Swipe hint */}
      {chats.length > 0 && (
        <div style={{ padding: '8px 20px', display: 'flex', alignItems: 'center', gap: 6 }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#4B5563" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
          <span style={{ fontSize: 11, color: '#4B5563' }}>Проведіть вліво щоб видалити</span>
        </div>
      )}

      {loading && <div style={{ textAlign: 'center', padding: '60px 0', color: '#6B7280', fontSize: 14 }}>⏳ Завантаження...</div>}

      {!loading && chats.length === 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '60px 24px', gap: 14, textAlign: 'center' }}>
          <div style={{ width: 72, height: 72, borderRadius: 22, background: '#1A1F2E', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid #2A3045' }}>
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#2A3045" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          </div>
          <div style={{ fontSize: 17, fontWeight: 600, color: '#fff' }}>Поки немає повідомлень</div>
          <div style={{ fontSize: 13, color: '#6B7280', lineHeight: 1.7, maxWidth: 260 }}>
            Натисніть 💬 на картці оголошення, щоб написати власнику
          </div>
        </div>
      )}

      {!loading && chats.map(chat => (
        <ChatRow
          key={chat.id}
          chat={chat}
          userId={user.id}
          onOpen={() => setActiveChat(chat)}
          onDelete={async () => {
            if (!confirm('Видалити цей чат?')) return
            await deleteChat(chat.id)
            loadChats()
          }}
        />
      ))}
    </div>
  )
}
