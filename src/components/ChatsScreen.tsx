'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import type { User } from '@/types'
import { getUserChats, getMessages, sendMessage as dbSendMsg, markChatRead, type ChatRecord, type MessageRecord } from '@/lib/storage'

interface Props {
  user: User | null
  isGuest: boolean
  onLogin: () => void
}

function timeAgo(iso: string): string {
  const d = new Date(iso)
  const now = Date.now()
  const diff = (now - d.getTime()) / 1000
  if (diff < 60) return 'щойно'
  if (diff < 3600) return Math.floor(diff / 60) + ' хв'
  if (diff < 86400) return d.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' })
  return d.toLocaleDateString('uk-UA', { day: 'numeric', month: 'short' })
}

export default function ChatsScreen({ user, isGuest, onLogin }: Props) {
  const [chats, setChats] = useState<ChatRecord[]>([])
  const [activeChat, setActiveChat] = useState<ChatRecord | null>(null)
  const [messages, setMessages] = useState<MessageRecord[]>([])
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const pollRef = useRef<ReturnType<typeof setInterval>>()

  const loadChats = useCallback(() => {
    if (!user) return
    setChats(getUserChats(user.id))
  }, [user])

  useEffect(() => { loadChats() }, [loadChats])

  const openChat = useCallback((chat: ChatRecord) => {
    setActiveChat(chat)
    setMessages(getMessages(chat.id))
    if (user) markChatRead(chat.id, user.id)
    loadChats()
    // Poll for new messages
    clearInterval(pollRef.current)
    pollRef.current = setInterval(() => {
      setMessages(getMessages(chat.id))
    }, 2000)
  }, [user, loadChats])

  const closeChat = useCallback(() => {
    clearInterval(pollRef.current)
    setActiveChat(null)
    setMessages([])
    loadChats()
  }, [loadChats])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => () => clearInterval(pollRef.current), [])

  const handleSend = async () => {
    if (!text.trim() || !activeChat || !user || sending) return
    setSending(true)
    const other = activeChat.buyerId === user.id
      ? { id: activeChat.sellerId, name: activeChat.sellerName }
      : { id: activeChat.buyerId, name: activeChat.buyerName }
    dbSendMsg(activeChat.listingId, activeChat.listingTitle, user, other, text.trim())
    setMessages(getMessages(activeChat.id))
    setText('')
    setSending(false)
  }

  if (!user) {
    return (
      <div style={{ paddingBottom: 80, minHeight: '100dvh' }}>
        <div style={{ padding: '44px 20px 16px', paddingTop: 'max(44px, env(safe-area-inset-top,44px))', background: 'linear-gradient(180deg,#0D1018,#0F1117)', borderBottom: '1px solid #1E2334' }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#fff' }}>Повідомлення</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '80px 24px', gap: 16, textAlign: 'center' }}>
          <svg width="60" height="60" viewBox="0 0 24 24" fill="none" stroke="#2A3045" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          <div style={{ fontSize: 18, fontWeight: 600, color: '#fff' }}>Увійдіть, щоб писати продавцям</div>
          <div style={{ fontSize: 14, color: '#A0A8BC', maxWidth: 260, lineHeight: 1.6 }}>Авторизовані користувачі можуть вести переписку з власниками приміщень</div>
          <button onClick={onLogin} style={{ background: 'linear-gradient(135deg,#FF6B1A,#FF8C3A)', border: 'none', borderRadius: 14, padding: '14px 32px', color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer' }}>Увійти / Зареєструватись</button>
        </div>
      </div>
    )
  }

  // ── CHAT WINDOW ──────────────────────────────────────────────
  if (activeChat) {
    const otherName = activeChat.buyerId === user.id ? activeChat.sellerName : activeChat.buyerName
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100dvh', background: '#0F1117' }}>
        {/* Header */}
        <div style={{ padding: '44px 16px 12px', paddingTop: 'max(44px, env(safe-area-inset-top,44px))', background: '#0D1018', borderBottom: '1px solid #1E2334', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={closeChat} style={{ background: 'none', border: 'none', color: '#A0A8BC', cursor: 'pointer', padding: 4, display: 'flex', alignItems: 'center' }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <div style={{ width: 38, height: 38, borderRadius: '50%', background: 'linear-gradient(135deg,#FF6B1A,#FFB020)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, color: '#fff', fontWeight: 700, flexShrink: 0 }}>
            {otherName.charAt(0).toUpperCase()}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{otherName}</div>
            <div style={{ fontSize: 11, color: '#FF6B1A', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>📍 {activeChat.listingTitle}</div>
          </div>
        </div>

        {/* Messages */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {messages.length === 0 && (
            <div style={{ textAlign: 'center', color: '#A0A8BC', fontSize: 13, marginTop: 40, lineHeight: 1.6 }}>
              Почніть розмову 👋<br/>
              <span style={{ fontSize: 12, color: '#6B7280' }}>Повідомлення зберігаються в цьому чаті</span>
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
                  <div style={{ fontSize: 10, color: isMe ? 'rgba(255,255,255,.6)' : '#6B7280', marginTop: 4, textAlign: 'right' }}>{timeAgo(msg.createdAt)}</div>
                </div>
              </div>
            )
          })}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div style={{ padding: '10px 16px', paddingBottom: 'max(10px, env(safe-area-inset-bottom,10px))', background: '#0D1018', borderTop: '1px solid #1E2334', display: 'flex', gap: 8, alignItems: 'flex-end', flexShrink: 0 }}>
          <input
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSend()}
            placeholder="Написати повідомлення..."
            style={{ flex: 1, background: '#1A1F2E', border: '1px solid #2A3045', borderRadius: 20, padding: '10px 14px', color: '#fff', fontSize: 14, fontFamily: 'Inter,sans-serif', outline: 'none', minHeight: 40 }}
          />
          <button onClick={handleSend} disabled={!text.trim() || sending} style={{
            width: 40, height: 40, borderRadius: '50%', flexShrink: 0,
            background: text.trim() ? 'linear-gradient(135deg,#FF6B1A,#FF8C3A)' : '#2A3045',
            border: 'none', cursor: text.trim() ? 'pointer' : 'default',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'background .15s',
          }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
          </button>
        </div>
      </div>
    )
  }

  // ── CHATS LIST ────────────────────────────────────────────────
  return (
    <div style={{ paddingBottom: 80, minHeight: '100dvh' }}>
      <div style={{ padding: '44px 20px 16px', paddingTop: 'max(44px, env(safe-area-inset-top,44px))', background: 'linear-gradient(180deg,#0D1018,#0F1117)', borderBottom: '1px solid #1E2334' }}>
        <div style={{ fontSize: 22, fontWeight: 700, color: '#fff' }}>Повідомлення</div>
      </div>

      {chats.length === 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '60px 24px', gap: 12, textAlign: 'center' }}>
          <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="#2A3045" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          <div style={{ fontSize: 16, fontWeight: 600, color: '#fff' }}>Поки немає повідомлень</div>
          <div style={{ fontSize: 13, color: '#A0A8BC', lineHeight: 1.6 }}>Натисніть «Написати» на картці оголошення, щоб почати переписку</div>
        </div>
      ) : (
        chats.map(chat => {
          const isMe = chat.buyerId === user.id
          const otherName = isMe ? chat.sellerName : chat.buyerName
          const unread = isMe ? chat.unreadBuyer : chat.unreadSeller
          return (
            <div key={chat.id} onClick={() => openChat(chat)} style={{
              padding: '14px 20px',
              borderBottom: '1px solid #1A1F2E',
              display: 'flex', gap: 12, alignItems: 'center', cursor: 'pointer',
              background: unread > 0 ? 'rgba(255,107,26,.04)' : 'transparent',
              transition: 'background .15s',
            }}>
              <div style={{ width: 48, height: 48, borderRadius: '50%', flexShrink: 0, background: 'linear-gradient(135deg,#FF6B1A,#FF8C3A)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, color: '#fff', fontWeight: 700, position: 'relative' }}>
                {otherName.charAt(0).toUpperCase()}
                {unread > 0 && <span style={{ position: 'absolute', top: -2, right: -2, background: '#FF6B1A', color: '#fff', borderRadius: 10, fontSize: 9, fontWeight: 700, padding: '1px 4px', lineHeight: 1.4 }}>{unread}</span>}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
                  <div style={{ fontSize: 14, fontWeight: unread > 0 ? 700 : 600, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '65%' }}>{otherName}</div>
                  <div style={{ fontSize: 11, color: '#6B7280', flexShrink: 0 }}>{timeAgo(chat.lastAt)}</div>
                </div>
                <div style={{ fontSize: 11, color: '#FF6B1A', marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>📍 {chat.listingTitle}</div>
                <div style={{ fontSize: 13, color: unread > 0 ? '#A0A8BC' : '#6B7280', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{chat.lastMessage}</div>
              </div>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#2A3045" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
            </div>
          )
        })
      )}
    </div>
  )
}
