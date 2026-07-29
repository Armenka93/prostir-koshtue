'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import type { User } from '@/types'
import {
  getUserChats, getChatMessages, sendMessage, markChatRead,
  deleteChat, subscribeToMessages, subscribeToUserChats, uploadChatImage,
  type ChatRecord, type MessageRecord,
} from '@/lib/chats-db'
import ConfirmModal from '@/components/ConfirmModal'

interface Props {
  user: User | null
  isGuest: boolean
  onLogin: () => void
  onRefresh?: () => Promise<void>
  initialChatId?: string
  onInitialChatConsumed?: () => void
  onBackToListing?: () => void
  onChatOpenChange?: (open: boolean) => void
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
function ChatWindow({ chat, user, onBack, onDeleted }: {
  chat: ChatRecord; user: User; onBack: () => void; onDeleted: () => void
}) {
  const [messages, setMessages] = useState<MessageRecord[]>([])
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [loading, setLoading] = useState(true)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const photoRef = useRef<HTMLInputElement>(null)
  const chatRef = useRef(chat)
  chatRef.current = chat
  const otherName = chat.buyer_id === user.id ? chat.seller_name : chat.buyer_name

  const scrollDown = useCallback((instant = false) => {
    const el = listRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: instant ? ('instant' as any) : 'smooth' })
  }, [])

  // ── iOS PWA keyboard fix ─────────────────────────────────────
  // In a PWA (WKWebView) interactiveWidget:'resizes-content' is ignored by
  // Apple. When the keyboard opens iOS shifts the visual viewport UP by
  // ~keyboardHeight pixels, so position:fixed elements anchored to top:0
  // of the LAYOUT viewport disappear above the screen.
  //
  // The only reliable solution for WKWebView is to:
  //  1. Lock body.position = fixed so iOS has nothing to scroll
  //  2. Read visualViewport.offsetTop + .height each frame and apply them
  //     as top / height on our container so it tracks the visible area
  //
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const body = document.body
    const savedScroll = window.scrollY
    const savedPos   = body.style.position
    const savedTop   = body.style.top
    const savedWidth = body.style.width
    const savedOvf   = body.style.overflow

    body.style.position = 'fixed'
    body.style.top      = '0'
    body.style.width    = '100%'
    body.style.overflow = 'hidden'

    const vv = window.visualViewport

    let raf = 0
    const sync = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const el = containerRef.current
        if (!el || !vv) return
        el.style.top    = `${vv.offsetTop}px`
        el.style.height = `${vv.height}px`
      })
    }

    sync()

    vv?.addEventListener('resize', sync)
    vv?.addEventListener('scroll', sync)

    return () => {
      cancelAnimationFrame(raf)
      vv?.removeEventListener('resize', sync)
      vv?.removeEventListener('scroll', sync)
      body.style.position = savedPos
      body.style.top      = savedTop
      body.style.width    = savedWidth
      body.style.overflow = savedOvf
      window.scrollTo(0, savedScroll)
    }
  }, [])

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
          const tempIdx = prev.findIndex(m => m.id < 0 && m.text === msg.text && m.sender_id === msg.sender_id)
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

  const handleSend = async () => {
    const t = text.trim()
    if (!t || sending) return
    setSending(true)
    setText('')
    playSentSound()

    const tmp: MessageRecord = {
      id: -Date.now(), chat_id: chat.id,
      sender_id: user.id, sender_name: user.name,
      text: t, created_at: new Date().toISOString(),
    }
    setMessages(p => [...p, tmp])
    setTimeout(() => scrollDown(), 60)

    const saved = await sendMessage(chat.id, user.id, user.name, t, chatRef.current)
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
        last_message: t,
        unread_seller: user.id === chat.buyer_id
          ? (chatRef.current.unread_seller || 0) + 1
          : chatRef.current.unread_seller,
        unread_buyer: user.id === chat.seller_id
          ? (chatRef.current.unread_buyer || 0) + 1
          : chatRef.current.unread_buyer,
      }
    }
    setSending(false)
    // Deliberately NOT calling inputRef.current?.focus() here.
    // On iOS, re-focusing the input immediately after send causes the
    // keyboard to reopen, which interrupts the visualViewport restoring
    // vv.offsetTop → 0, leaving a stale gap at the bottom of the screen.
  }

  const handlePhotoSend = async (file: File) => {
    if (!file || sending) return
    if (file.size > 10 * 1024 * 1024) { alert('Фото більше за 10 MB'); return }
    setSending(true)
    const previewUrl = URL.createObjectURL(file)
    const tempId = -Date.now()
    setMessages(prev => [...prev, { id: tempId, chat_id: chat.id, sender_id: user.id, sender_name: user.name, text: '', image_url: previewUrl, created_at: new Date().toISOString() }])
    setTimeout(() => scrollDown(true), 30)
    const url = await uploadChatImage(file, chat.id)
    if (!url) {
      setMessages(prev => prev.filter(m => m.id !== tempId))
      alert('Не вдалося завантажити фото')
      setSending(false)
      return
    }
    const saved = await sendMessage(chat.id, user.id, user.name, '', chatRef.current, url)
    setMessages(prev => prev.map(m => m.id === tempId ? (saved || { ...m, image_url: url }) : m))
    setSending(false)
  }

  return (
    <>
    <div ref={containerRef} style={{
      position: 'fixed', top: 0, left: '50%', height: '100dvh',
      transform: 'translateX(-50%)',
      width: '100%', maxWidth: 430,
      zIndex: 200,
      display: 'flex', flexDirection: 'column',
      background: '#0F1117',
      overflow: 'hidden',
      transition: 'top 0.25s ease, height 0.25s ease',
      willChange: 'top, height',
    }}>
      {/* Header */}
      <div style={{
        flexShrink: 0, background: '#0D1018', borderBottom: '1px solid #1E2334',
        paddingTop: 'max(44px,env(safe-area-inset-top,44px))',
        paddingBottom: 10, paddingLeft: 6, paddingRight: 12,
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <button onClick={() => { inputRef.current?.blur(); onBack() }} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', padding: '8px 10px', display: 'flex', alignItems: 'center' }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'linear-gradient(135deg,#FF6B1A,#FFB020)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17, fontWeight: 700, color: '#fff', flexShrink: 0 }}>
          {otherName.charAt(0).toUpperCase()}
        </div>
        <div style={{ flex: 1, minWidth: 0, marginLeft: 4 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{otherName}</div>
          <div style={{ fontSize: 11, color: '#FF6B1A', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>📍 {chat.listing_title}</div>
        </div>
        <button onClick={() => setShowDeleteConfirm(true)}
          style={{ background: 'none', border: 'none', color: '#6B7280', cursor: 'pointer', padding: '8px', display: 'flex', alignItems: 'center', flexShrink: 0 }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
        </button>
      </div>

      {/* Messages — flex:1 scrollable */}
      <div ref={listRef} style={{
        flex: '1 1 0', minHeight: 0, overflowY: 'auto', overflowX: 'hidden',
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
                  padding: msg.image_url ? '4px' : '10px 14px',
                  border: mine ? 'none' : '1px solid #2A3045',
                  opacity: msg.id < 0 ? 0.55 : 1,
                  overflow: 'hidden',
                }}>
                  {msg.image_url
                    ? <img src={msg.image_url} alt="фото" style={{ maxWidth: 220, maxHeight: 280, borderRadius: 12, display: 'block', objectFit: 'cover' }} />
                    : <div style={{ fontSize: 15, color: '#fff', lineHeight: 1.5, wordBreak: 'break-word' }}>{msg.text}</div>
                  }
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

      {/* Input */}
      <div style={{
        flexShrink: 0,
        background: '#0D1018',
        borderTop: '1px solid #1E2334',
        padding: '10px 16px',
        paddingBottom: 'calc(10px + env(safe-area-inset-bottom, 0px))',
        display: 'flex', gap: 8, alignItems: 'center',
      }}>
        <button onClick={() => photoRef.current?.click()} style={{ width: 36, height: 36, borderRadius: 10, border: 'none', background: '#1A1F2E', color: '#A0A8BC', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, touchAction: 'manipulation' }}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
        </button>
        <input ref={photoRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) handlePhotoSend(f); e.target.value = '' }} />
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
          disabled={!text.trim() || sending}
          style={{
            width: 46, height: 46, borderRadius: '50%', border: 'none', flexShrink: 0,
            background: text.trim() ? 'linear-gradient(135deg,#FF6B1A,#FF8C3A)' : '#1E2334',
            cursor: text.trim() ? 'pointer' : 'default',
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

    {showDeleteConfirm && (
      <ConfirmModal
        title="Видалити чат?"
        message="Переписку буде видалено для вас. Це не можна скасувати."
        confirmLabel="Видалити"
        cancelLabel="Скасувати"
        danger
        onConfirm={() => { setShowDeleteConfirm(false); deleteChat(chat.id); onDeleted() }}
        onCancel={() => setShowDeleteConfirm(false)}
      />
    )}
  </>
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
export default function ChatsScreen({ user, isGuest, onLogin, initialChatId, onInitialChatConsumed, onBackToListing, onChatOpenChange }: Props) {
  const [chats, setChats] = useState<ChatRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [activeChat, setActiveChat] = useState<ChatRecord | null>(null)
  const [pendingDeleteChat, setPendingDeleteChat] = useState<ChatRecord | null>(null)
  const openedRef = useRef(false)
  const openedViaListingRef = useRef(false)

  // Tell the parent whether a single conversation is open, so it can hide
  // the bottom nav only inside ChatWindow (not on the chat list).
  useEffect(() => {
    onChatOpenChange?.(!!activeChat)
  }, [activeChat, onChatOpenChange])

  // Make sure the parent restores the nav when this screen unmounts.
  useEffect(() => {
    return () => { onChatOpenChange?.(false) }
  }, [onChatOpenChange])

  const loadChats = useCallback(async () => {
    if (!user) return
    const data = await getUserChats(user.id)
    setChats(data)
    setLoading(false)
    if (initialChatId && !openedRef.current) {
      const target = data.find(c => c.id === initialChatId)
      if (target) {
        setActiveChat(target)
        openedRef.current = true
        openedViaListingRef.current = true
        onInitialChatConsumed?.()
      }
    }
  }, [user, initialChatId, onInitialChatConsumed])

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
      <div style={{ paddingBottom: 16 }}>
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
        onBack={() => {
          setActiveChat(null)
          openedRef.current = false
          if (openedViaListingRef.current && onBackToListing) {
            openedViaListingRef.current = false
            onBackToListing()
          } else {
            openedViaListingRef.current = false
            loadChats()
          }
        }}
        onDeleted={() => {
          // Remove from local list immediately — no waiting for server round-trip
          setChats(prev => prev.filter(c => c.id !== activeChat!.id))
          setActiveChat(null)
          openedRef.current = false
          openedViaListingRef.current = false
        }}
      />
    )
  }

  return (
    <div style={{ paddingBottom: 90 }}>
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
            setPendingDeleteChat(chat)
          }}
        />
      ))}

      {pendingDeleteChat && (
        <ConfirmModal
          title="Видалити чат?"
          message="Переписку буде видалено для вас. Це не можна скасувати."
          confirmLabel="Видалити"
          cancelLabel="Скасувати"
          danger
          onConfirm={async () => {
            const id = pendingDeleteChat.id
            // Remove instantly from local state — UI updates before server responds
            setChats(prev => prev.filter(c => c.id !== id))
            setPendingDeleteChat(null)
            await deleteChat(id)
          }}
          onCancel={() => setPendingDeleteChat(null)}
        />
      )}
    </div>
  )
}
