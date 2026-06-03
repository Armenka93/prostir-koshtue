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

// ── CHAT WINDOW ───────────────────────────────────────────────
function ChatWindow({ chat, user, onBack, onDeleted }: {
  chat: ChatRecord; user: User; onBack: () => void; onDeleted: () => void
}) {
  const [messages, setMessages] = useState<MessageRecord[]>([])
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [loading, setLoading] = useState(true)
  const [showMenu, setShowMenu] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const chatRef = useRef(chat)
  chatRef.current = chat

  const otherName = chat.buyer_id === user.id ? chat.seller_name : chat.buyer_name

  const loadMessages = useCallback(async () => {
    const msgs = await getChatMessages(chat.id)
    setMessages(msgs)
    setLoading(false)
    await markChatRead(chat.id, user.id, chat)
  }, [chat.id, user.id])

  useEffect(() => {
    loadMessages()
    const sub = subscribeToMessages(chat.id, (newMsg) => {
      setMessages(prev => prev.find(m => m.id === newMsg.id) ? prev : [...prev, newMsg])
    })
    return () => { sub.unsubscribe() }
  }, [chat.id, loadMessages])

  useEffect(() => {
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 100)
  }, [messages])

  const handleSend = async () => {
    const trimmed = text.trim()
    if (!trimmed || sending) return
    setSending(true)
    setText('')

    // Optimistic
    const temp: MessageRecord = {
      id: -Date.now(), chat_id: chat.id,
      sender_id: user.id, sender_name: user.name,
      text: trimmed, created_at: new Date().toISOString(),
    }
    setMessages(prev => [...prev, temp])

    const saved = await sendMessage(chat.id, user.id, user.name, trimmed, chatRef.current)
    if (saved) {
      setMessages(prev => prev.map(m => m.id === temp.id ? saved : m))
    }
    setSending(false)
    setTimeout(() => inputRef.current?.focus(), 100)
  }

  const handleDelete = async () => {
    setShowMenu(false)
    if (!confirm('Видалити цей чат і всі повідомлення?')) return
    await deleteChat(chat.id)
    onDeleted()
  }

  return (
    <div style={{
      position: 'fixed',
      top: 0, left: 0, right: 0, bottom: 0,
      display: 'flex',
      flexDirection: 'column',
      background: '#0F1117',
      zIndex: 200,
    }}>
      {/* ── Header ── */}
      <div style={{
        flexShrink: 0,
        background: '#0D1018',
        borderBottom: '1px solid #1E2334',
        paddingTop: 'max(44px, env(safe-area-inset-top, 44px))',
        paddingBottom: 12,
        paddingLeft: 16,
        paddingRight: 16,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
      }}>
        <button
          onClick={onBack}
          style={{ background: 'none', border: 'none', color: '#A0A8BC', cursor: 'pointer', padding: '4px 8px 4px 0', display: 'flex', alignItems: 'center', flexShrink: 0 }}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
        </button>

        <div style={{ width: 38, height: 38, borderRadius: '50%', background: 'linear-gradient(135deg,#FF6B1A,#FFB020)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, fontWeight: 700, color: '#fff', flexShrink: 0 }}>
          {otherName.charAt(0).toUpperCase()}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{otherName}</div>
          <div style={{ fontSize: 11, color: '#FF6B1A', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>📍 {chat.listing_title}</div>
        </div>

        {/* Menu */}
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <button
            onClick={() => setShowMenu(m => !m)}
            style={{ background: 'none', border: 'none', color: '#A0A8BC', cursor: 'pointer', padding: 8, display: 'flex', alignItems: 'center', borderRadius: 8 }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/></svg>
          </button>
          {showMenu && (
            <>
              <div style={{ position: 'fixed', inset: 0, zIndex: 10 }} onClick={() => setShowMenu(false)} />
              <div style={{ position: 'absolute', right: 0, top: '100%', background: '#1A1F2E', border: '1px solid #2A3045', borderRadius: 12, overflow: 'hidden', minWidth: 180, zIndex: 20, boxShadow: '0 8px 24px rgba(0,0,0,.6)' }}>
                <button
                  onClick={handleDelete}
                  style={{ width: '100%', padding: '14px 16px', background: 'none', border: 'none', color: '#EF4444', fontSize: 14, cursor: 'pointer', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 10 }}
                >
                  🗑️ Видалити чат
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Messages area ── */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        overflowX: 'hidden',
        padding: '12px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        WebkitOverflowScrolling: 'touch' as any,
      }}>
        {loading && (
          <div style={{ textAlign: 'center', color: '#6B7280', fontSize: 13, marginTop: 40 }}>⏳ Завантаження...</div>
        )}
        {!loading && messages.length === 0 && (
          <div style={{ textAlign: 'center', color: '#6B7280', fontSize: 13, marginTop: 40, lineHeight: 1.8 }}>
            Починайте розмову 👋<br/>
            <span style={{ fontSize: 12 }}>Повідомлення доставляються в реальному часі</span>
          </div>
        )}
        {messages.map(msg => {
          const isMe = msg.sender_id === user.id
          return (
            <div key={msg.id} style={{ display: 'flex', justifyContent: isMe ? 'flex-end' : 'flex-start' }}>
              <div style={{
                maxWidth: '78%',
                background: isMe ? 'linear-gradient(135deg,#FF6B1A,#FF8C3A)' : '#1A1F2E',
                borderRadius: isMe ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                padding: '10px 14px',
                border: isMe ? 'none' : '1px solid #2A3045',
                opacity: msg.id < 0 ? 0.65 : 1,
              }}>
                {!isMe && <div style={{ fontSize: 11, color: '#FF6B1A', marginBottom: 4, fontWeight: 600 }}>{msg.sender_name}</div>}
                <div style={{ fontSize: 15, color: '#fff', lineHeight: 1.45, wordBreak: 'break-word' }}>{msg.text}</div>
                <div style={{ fontSize: 10, color: isMe ? 'rgba(255,255,255,.55)' : '#6B7280', marginTop: 4, textAlign: 'right' }}>
                  {msg.id < 0 ? '⏳' : timeAgo(msg.created_at)}
                </div>
              </div>
            </div>
          )
        })}
        <div ref={bottomRef} style={{ height: 1 }} />
      </div>

      {/* ── Input bar ── */}
      <div style={{
        flexShrink: 0,
        background: '#0D1018',
        borderTop: '1px solid #1E2334',
        paddingTop: 10,
        paddingLeft: 16,
        paddingRight: 16,
        paddingBottom: 'max(16px, env(safe-area-inset-bottom, 16px))',
        display: 'flex',
        gap: 10,
        alignItems: 'center',
      }}>
        <input
          ref={inputRef}
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
          placeholder="Написати повідомлення..."
          style={{
            flex: 1,
            background: '#1A1F2E',
            border: '1px solid #2A3045',
            borderRadius: 22,
            padding: '12px 18px',
            color: '#fff',
            fontSize: 16,
            fontFamily: 'Inter, sans-serif',
            outline: 'none',
            minWidth: 0,
            WebkitAppearance: 'none' as any,
            appearance: 'none' as any,
          }}
        />
        <button
          onClick={handleSend}
          disabled={!text.trim() || sending}
          style={{
            width: 46, height: 46,
            borderRadius: '50%',
            flexShrink: 0,
            border: 'none',
            background: text.trim() ? 'linear-gradient(135deg,#FF6B1A,#FF8C3A)' : '#2A3045',
            cursor: text.trim() ? 'pointer' : 'default',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'background .15s',
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

// ── CHATS LIST ────────────────────────────────────────────────
export default function ChatsScreen({ user, isGuest, onLogin, onRefresh }: Props) {
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
    const sub = subscribeToUserChats(user.id, () => loadChats())
    return () => { sub.unsubscribe() }
  }, [user, loadChats])

  // ── Not logged in ────────────────────────────────────────
  if (!user) {
    return (
      <div style={{ paddingBottom: 90 }}>
        <div style={{ padding: '48px 20px 16px', paddingTop: 'max(48px,env(safe-area-inset-top,48px))', background: '#0D1018', borderBottom: '1px solid #1E2334' }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#fff' }}>Повідомлення</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '80px 24px', gap: 16, textAlign: 'center' }}>
          <svg width="60" height="60" viewBox="0 0 24 24" fill="none" stroke="#2A3045" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          <div style={{ fontSize: 18, fontWeight: 600, color: '#fff' }}>Увійдіть щоб писати</div>
          <button onClick={onLogin} style={{ background: 'linear-gradient(135deg,#FF6B1A,#FF8C3A)', border: 'none', borderRadius: 14, padding: '14px 32px', color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer' }}>
            Увійти
          </button>
        </div>
      </div>
    )
  }

  // ── Active chat window ───────────────────────────────────
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

  // ── Chats list ───────────────────────────────────────────
  return (
    <div style={{ paddingBottom: 90 }}>
      <div style={{
        padding: '48px 20px 16px',
        paddingTop: 'max(48px,env(safe-area-inset-top,48px))',
        background: '#0D1018',
        borderBottom: '1px solid #1E2334',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        <div style={{ fontSize: 22, fontWeight: 700, color: '#fff' }}>Повідомлення</div>
        {chats.length > 0 && (
          <span style={{ background: '#FF6B1A22', color: '#FF6B1A', fontSize: 12, fontWeight: 700, borderRadius: 20, padding: '3px 10px' }}>
            {chats.length}
          </span>
        )}
      </div>

      {loading && (
        <div style={{ textAlign: 'center', padding: '60px 0', color: '#6B7280', fontSize: 14 }}>⏳ Завантаження...</div>
      )}

      {!loading && chats.length === 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '60px 24px', gap: 12, textAlign: 'center' }}>
          <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="#2A3045" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          <div style={{ fontSize: 16, fontWeight: 600, color: '#fff' }}>Поки немає повідомлень</div>
          <div style={{ fontSize: 13, color: '#A0A8BC', lineHeight: 1.6, maxWidth: 260 }}>
            Натисніть 💬 на картці оголошення, щоб почати переписку
          </div>
        </div>
      )}

      {!loading && chats.map(chat => {
        const isMe = chat.buyer_id === user.id
        const otherName = isMe ? chat.seller_name : chat.buyer_name
        const unread = isMe ? chat.unread_buyer : chat.unread_seller

        return (
          <div
            key={chat.id}
            style={{ display: 'flex', alignItems: 'stretch', borderBottom: '1px solid #1A1F2E' }}
          >
            {/* Chat row — tap to open */}
            <div
              onClick={() => setActiveChat(chat)}
              style={{
                flex: 1,
                padding: '14px 16px 14px 20px',
                display: 'flex',
                gap: 12,
                alignItems: 'center',
                cursor: 'pointer',
                background: unread > 0 ? 'rgba(255,107,26,.04)' : 'transparent',
                minWidth: 0,
              }}
            >
              {/* Avatar */}
              <div style={{ width: 50, height: 50, borderRadius: '50%', flexShrink: 0, background: 'linear-gradient(135deg,#FF6B1A,#FF8C3A)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, color: '#fff', fontWeight: 700, position: 'relative' }}>
                {otherName.charAt(0).toUpperCase()}
                {unread > 0 && (
                  <span style={{ position: 'absolute', top: -2, right: -2, background: '#EF4444', color: '#fff', borderRadius: 10, fontSize: 9, fontWeight: 700, padding: '1px 5px', lineHeight: 1.4 }}>
                    {unread}
                  </span>
                )}
              </div>

              {/* Info */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
                  <div style={{ fontSize: 15, fontWeight: unread > 0 ? 700 : 600, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '65%' }}>
                    {otherName}
                  </div>
                  <div style={{ fontSize: 11, color: '#6B7280', flexShrink: 0 }}>{timeAgo(chat.last_at)}</div>
                </div>
                <div style={{ fontSize: 12, color: '#FF6B1A', marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  📍 {chat.listing_title}
                </div>
                <div style={{ fontSize: 13, color: unread > 0 ? '#A0A8BC' : '#6B7280', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {chat.last_message || 'Почніть розмову...'}
                </div>
              </div>
            </div>

            {/* Delete button */}
            <button
              onClick={async () => {
                if (!confirm('Видалити цей чат?')) return
                await deleteChat(chat.id)
                loadChats()
              }}
              style={{
                padding: '0 18px',
                background: 'none',
                border: 'none',
                borderLeft: '1px solid #1A1F2E',
                color: '#EF4444',
                cursor: 'pointer',
                flexShrink: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                touchAction: 'manipulation',
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6"/>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
              </svg>
            </button>
          </div>
        )
      })}
    </div>
  )
}
