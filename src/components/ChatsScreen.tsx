'use client'
import { usePTR } from '@/hooks/usePTR'
import PTRIndicator from './PTRIndicator'
import { useState, useEffect, useRef, useCallback } from 'react'
import type { User } from '@/types'
import {
  getUserChats, getMessages, sendMessage as dbSend,
  markChatRead, deleteChat,
  type ChatRecord, type MessageRecord
} from '@/lib/storage'

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
  chat: ChatRecord; user: User
  onBack: () => void; onDeleted: () => void
}) {
  const [messages, setMessages] = useState<MessageRecord[]>([])
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [showMenu, setShowMenu] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const pollRef = useRef<ReturnType<typeof setInterval>>()
  const inputRef = useRef<HTMLInputElement>(null)

  const otherName = chat.buyerId === user.id ? chat.sellerName : chat.buyerName

  useEffect(() => {
    setMessages(getMessages(chat.id))
    markChatRead(chat.id, user.id)
    pollRef.current = setInterval(() => setMessages(getMessages(chat.id)), 2000)
    return () => clearInterval(pollRef.current)
  }, [chat.id, user.id])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleSend = () => {
    if (!text.trim() || sending) return
    setSending(true)
    const other = chat.buyerId === user.id
      ? { id: chat.sellerId, name: chat.sellerName }
      : { id: chat.buyerId, name: chat.buyerName }
    dbSend(chat.listingId, chat.listingTitle, user, other, text.trim())
    setMessages(getMessages(chat.id))
    setText('')
    setSending(false)
  }

  const handleDelete = () => {
    if (!confirm('Видалити цей чат?')) return
    deleteChat(chat.id)
    onDeleted()
  }

  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      height: '100dvh', maxHeight: '100dvh',
      background: '#0F1117', overflow: 'hidden',
    }}>
      {/* Header — fixed height */}
      <div style={{
        flexShrink: 0,
        padding: '0 16px',
        paddingTop: 'max(44px, env(safe-area-inset-top, 44px))',
        paddingBottom: 12,
        background: '#0D1018',
        borderBottom: '1px solid #1E2334',
        display: 'flex', alignItems: 'center', gap: 12,
        position: 'relative',
      }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', color: '#A0A8BC', cursor: 'pointer', padding: '4px 8px 4px 0', display: 'flex', alignItems: 'center', flexShrink: 0 }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
        </button>

        <div style={{ width: 38, height: 38, borderRadius: '50%', background: 'linear-gradient(135deg,#FF6B1A,#FFB020)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, fontWeight: 700, color: '#fff', flexShrink: 0 }}>
          {otherName.charAt(0).toUpperCase()}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{otherName}</div>
          <div style={{ fontSize: 11, color: '#FF6B1A', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>📍 {chat.listingTitle}</div>
        </div>

        {/* Menu button */}
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <button onClick={() => setShowMenu(m => !m)} style={{ background: 'none', border: 'none', color: '#A0A8BC', cursor: 'pointer', padding: 8, display: 'flex', alignItems: 'center', borderRadius: 8 }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/></svg>
          </button>
          {showMenu && (
            <>
              <div style={{ position: 'fixed', inset: 0, zIndex: 10 }} onClick={() => setShowMenu(false)} />
              <div style={{ position: 'absolute', right: 0, top: '100%', background: '#1A1F2E', border: '1px solid #2A3045', borderRadius: 12, overflow: 'hidden', minWidth: 160, zIndex: 20, boxShadow: '0 8px 24px rgba(0,0,0,.5)' }}>
                <button onClick={handleDelete} style={{ width: '100%', padding: '13px 16px', background: 'none', border: 'none', color: '#EF4444', fontSize: 14, cursor: 'pointer', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
                  Видалити чат
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Messages — scrollable flex fill */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8, overflowX: 'hidden' }}>
        {messages.length === 0 && (
          <div style={{ textAlign: 'center', color: '#6B7280', fontSize: 13, marginTop: 40, lineHeight: 1.7 }}>
            Починайте розмову 👋<br />
            <span style={{ fontSize: 12 }}>Повідомлення зберігаються локально</span>
          </div>
        )}
        {messages.map(msg => {
          const isMe = msg.senderId === user.id
          return (
            <div key={msg.id} style={{ display: 'flex', justifyContent: isMe ? 'flex-end' : 'flex-start' }}>
              <div style={{
                maxWidth: '75%',
                background: isMe ? 'linear-gradient(135deg,#FF6B1A,#FF8C3A)' : '#1A1F2E',
                borderRadius: isMe ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                padding: '10px 14px',
                border: isMe ? 'none' : '1px solid #2A3045',
              }}>
                {!isMe && <div style={{ fontSize: 11, color: '#FF6B1A', marginBottom: 4, fontWeight: 600 }}>{msg.senderName}</div>}
                <div style={{ fontSize: 14, color: '#fff', lineHeight: 1.45, wordBreak: 'break-word' }}>{msg.text}</div>
                <div style={{ fontSize: 10, color: isMe ? 'rgba(255,255,255,.55)' : '#6B7280', marginTop: 4, textAlign: 'right' }}>{timeAgo(msg.createdAt)}</div>
              </div>
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div>

      {/* Input — fixed at bottom, above keyboard */}
      <div style={{
        flexShrink: 0,
        padding: '10px 16px',
        paddingBottom: 'max(12px, env(safe-area-inset-bottom, 12px))',
        background: '#0D1018',
        borderTop: '1px solid #1E2334',
        display: 'flex', gap: 10, alignItems: 'center',
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
            padding: '11px 16px',
            color: '#fff',
            fontSize: 15,
            fontFamily: 'Inter, sans-serif',
            outline: 'none',
            minWidth: 0,
            WebkitAppearance: 'none' as any,
          }}
        />
        <button
          onClick={handleSend}
          disabled={!text.trim() || sending}
          style={{
            width: 42, height: 42, borderRadius: '50%', flexShrink: 0, border: 'none',
            background: text.trim() ? 'linear-gradient(135deg,#FF6B1A,#FF8C3A)' : '#2A3045',
            cursor: text.trim() ? 'pointer' : 'default',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'background .15s',
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="22" y1="2" x2="11" y2="13"/>
            <polygon points="22 2 15 22 11 13 2 9 22 2"/>
          </svg>
        </button>
      </div>
    </div>
  )
}

// ── CHATS LIST ────────────────────────────────────────────────
export default function ChatsScreen({
  const ptr = usePTR(onRefresh) user, isGuest, onLogin }: Props) {
  const [chats, setChats] = useState<ChatRecord[]>([])
  const [activeChat, setActiveChat] = useState<ChatRecord | null>(null)

  const loadChats = useCallback(() => {
    if (!user) return
    setChats(getUserChats(user.id))
  }, [user])

  useEffect(() => { loadChats() }, [loadChats])

  if (!user) {
    return (
      <div style={{ paddingBottom: 90 }}>
        <PTRIndicator state={ptr.state} pullY={ptr.pullY} />
        <div style={{ padding: '44px 20px 16px', paddingTop: 'max(44px,env(safe-area-inset-top,44px))', background: 'linear-gradient(180deg,#0D1018,#0F1117)', borderBottom: '1px solid #1E2334' }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#fff' }}>Повідомлення</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '80px 24px', gap: 16, textAlign: 'center' }}>
          <svg width="60" height="60" viewBox="0 0 24 24" fill="none" stroke="#2A3045" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          <div style={{ fontSize: 18, fontWeight: 600, color: '#fff' }}>Увійдіть щоб писати продавцям</div>
          <div style={{ fontSize: 14, color: '#A0A8BC', maxWidth: 260, lineHeight: 1.6 }}>Авторизовані користувачі можуть вести переписку з власниками</div>
          <button onClick={onLogin} style={{ background: 'linear-gradient(135deg,#FF6B1A,#FF8C3A)', border: 'none', borderRadius: 14, padding: '14px 32px', color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer' }}>Увійти</button>
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

  return (
    <div style={{ paddingBottom: 90 }}>
      <PTRIndicator state={ptr.state} pullY={ptr.pullY} />
      <div style={{ padding: '44px 20px 16px', paddingTop: 'max(44px,env(safe-area-inset-top,44px))', background: 'linear-gradient(180deg,#0D1018,#0F1117)', borderBottom: '1px solid #1E2334', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontSize: 22, fontWeight: 700, color: '#fff' }}>Повідомлення</div>
        {chats.length > 0 && <span style={{ background: '#FF6B1A22', color: '#FF6B1A', fontSize: 12, fontWeight: 700, borderRadius: 20, padding: '3px 10px' }}>{chats.length}</span>}
      </div>

      {chats.length === 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '60px 24px', gap: 12, textAlign: 'center' }}>
          <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="#2A3045" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          <div style={{ fontSize: 16, fontWeight: 600, color: '#fff' }}>Поки немає повідомлень</div>
          <div style={{ fontSize: 13, color: '#A0A8BC', lineHeight: 1.6, maxWidth: 260 }}>Натисніть «Написати» на картці оголошення, щоб почати переписку</div>
        </div>
      ) : (
        <div>
          {chats.map(chat => {
            const isMe = chat.buyerId === user.id
            const otherName = isMe ? chat.sellerName : chat.buyerName
            const unread = isMe ? chat.unreadBuyer : chat.unreadSeller
            return (
              <div key={chat.id} style={{ display: 'flex', alignItems: 'center', borderBottom: '1px solid #1A1F2E' }}>
                <div onClick={() => setActiveChat(chat)} style={{ flex: 1, padding: '14px 16px 14px 20px', display: 'flex', gap: 12, alignItems: 'center', cursor: 'pointer', background: unread > 0 ? 'rgba(255,107,26,.03)' : 'transparent', minWidth: 0 }}>
                  <div style={{ width: 48, height: 48, borderRadius: '50%', flexShrink: 0, background: 'linear-gradient(135deg,#FF6B1A,#FF8C3A)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, color: '#fff', fontWeight: 700, position: 'relative' }}>
                    {otherName.charAt(0).toUpperCase()}
                    {unread > 0 && <span style={{ position: 'absolute', top: -2, right: -2, background: '#FF6B1A', color: '#fff', borderRadius: 10, fontSize: 9, fontWeight: 700, padding: '1px 5px', lineHeight: 1.4 }}>{unread}</span>}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
                      <div style={{ fontSize: 14, fontWeight: unread > 0 ? 700 : 600, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '65%' }}>{otherName}</div>
                      <div style={{ fontSize: 11, color: '#6B7280', flexShrink: 0 }}>{timeAgo(chat.lastAt)}</div>
                    </div>
                    <div style={{ fontSize: 11, color: '#FF6B1A', marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>📍 {chat.listingTitle}</div>
                    <div style={{ fontSize: 13, color: unread > 0 ? '#A0A8BC' : '#6B7280', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{chat.lastMessage}</div>
                  </div>
                </div>
                {/* Swipe-delete button */}
                <button
                  onClick={() => { if (confirm('Видалити чат?')) { deleteChat(chat.id); loadChats() } }}
                  style={{ padding: '0 16px', height: '100%', minHeight: 76, background: 'none', border: 'none', color: '#EF4444', cursor: 'pointer', flexShrink: 0, display: 'flex', alignItems: 'center', borderLeft: '1px solid #1A1F2E' }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
