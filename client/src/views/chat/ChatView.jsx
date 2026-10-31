// Chat with the people you invited: channels and direct messages, live.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import MarkdownIt from 'markdown-it'
import DOMPurify from 'dompurify'
import { ArrowDown, CornerUpLeft, Hash, MessagesSquare, Pencil, Plus, Trash2, X } from 'lucide-react'
import { Avatar, Button, Dialog, EmptyState, Input, Segmented, Spinner } from '../../components/ui/index.js'
import { api } from '../../lib/api.js'
import { onSocket, sendSocket } from '../../lib/socket.js'
import { navigate } from '../../lib/router.js'
import { useSession } from '../../store/session.js'
import { useUI } from '../../store/ui.js'
import { relativeDay, todayIso, isoOf, timeOf, formatTime } from '../../../../shared/dates.js'
import { usePrefs } from '../../store/prefs.js'
import './chat.css'

const md = new MarkdownIt({ html: false, linkify: true, breaks: true })
const render = (text, me) => {
  let html = md.render(text || '')
  html = html.replace(/(^|[\s>(])@([a-z0-9-]+)/gi, (m, pre, h) => `${pre}<span class="mention${h === me ? ' is-me' : ''}">@${h}</span>`)
  return DOMPurify.sanitize(html, { ADD_ATTR: ['target'] })
}

function NewChannel({ open, onClose, people, onCreated }) {
  const [name, setName] = useState('')
  const [who, setWho] = useState('everyone')
  const [picked, setPicked] = useState([])
  const [error, setError] = useState('')
  useEffect(() => {
    if (open) {
      setName('')
      setWho('everyone')
      setPicked([])
      setError('')
    }
  }, [open])
  const create = async () => {
    try {
      const { channel } = await api('POST', '/chat/channels', { name, members: who === 'everyone' ? 'everyone' : picked })
      onCreated(channel)
    } catch (e) {
      setError(e.message)
    }
  }
  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="sm"
      title="New channel"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={create} disabled={!name.trim()}>
            Create
          </Button>
        </>
      }
    >
      <div className="chat-form">
        <Input icon={Hash} value={name} onChange={(e) => setName(e.target.value)} placeholder="planning" aria-label="Channel name" autoFocus />
        <Segmented label="Members" value={who} onChange={setWho} options={[{ value: 'everyone', label: 'Everyone' }, { value: 'some', label: 'Some people' }]} />
        {who === 'some' &&
          people.map((p) => (
            <label key={p.handle} className="share-person">
              <input type="checkbox" checked={picked.includes(p.handle)} onChange={(e) => setPicked(e.target.checked ? [...picked, p.handle] : picked.filter((h) => h !== p.handle))} />
              <span>{p.name}</span>
              <span className="share-handle">@{p.handle}</span>
            </label>
          ))}
        {error && <p className="auth-error">{error}</p>}
      </div>
    </Dialog>
  )
}

function Message({ m, first, me, people, h12, onReply, onEdit, onDelete, editing, setEditing, replyTo }) {
  const person = people.get(m.from)
  const at = new Date(m.at)
  const [draft, setDraft] = useState(m.text)
  useEffect(() => setDraft(m.text), [m.text, editing])
  return (
    <div className={`msg${first ? ' is-first' : ''}${m.pending ? ' is-pending' : ''}${m.failed ? ' is-failed' : ''}`} data-id={m.id}>
      <div className="msg-gutter">{first ? <Avatar name={person?.name || m.from} size={30} /> : <span className="msg-time-hover tabular">{formatTime(timeOf(at), h12)}</span>}</div>
      <div className="msg-main">
        {first && (
          <div className="msg-head">
            <span className="msg-name">{person?.name || m.from}</span>
            <span className="msg-time tabular">{formatTime(timeOf(at), h12)}</span>
          </div>
        )}
        {replyTo && (
          <div className="msg-reply-ref">
            <CornerUpLeft size={12} />
            <b>{people.get(replyTo.from)?.name || replyTo.from}</b> {replyTo.deleted ? 'deleted message' : replyTo.text.slice(0, 80)}
          </div>
        )}
        {m.deleted ? (
          <p className="msg-deleted">Message deleted</p>
        ) : editing ? (
          <div className="msg-edit">
            <textarea
              value={draft}
              autoFocus
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  onEdit(m, draft)
                } else if (e.key === 'Escape') setEditing(null)
              }}
              aria-label="Edit message"
            />
            <span className="faint">Enter to save · Esc to cancel</span>
          </div>
        ) : (
          <div className="msg-text md" dangerouslySetInnerHTML={{ __html: render(m.text, me) }} />
        )}
        {m.edited && !m.deleted && <span className="msg-edited">(edited)</span>}
        {m.failed && (
          <span className="msg-failed">
            Couldn’t send — <button type="button" onClick={() => onEdit(m, m.text, true)}>Retry</button>
          </span>
        )}
      </div>
      {!m.deleted && !m.pending && !editing && (
        <div className="msg-actions">
          <button type="button" aria-label="Reply" onClick={() => onReply(m)}>
            <CornerUpLeft size={14} />
          </button>
          {m.from === me && (
            <>
              <button type="button" aria-label="Edit" onClick={() => setEditing(m.id)}>
                <Pencil size={14} />
              </button>
              <button type="button" aria-label="Delete" onClick={() => onDelete(m)}>
                <Trash2 size={14} />
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}

export default function ChatView({ route }) {
  const mode = useSession((s) => s.mode)
  const me = useSession((s) => s.user?.handle)
  const prefs = usePrefs()
  const h12 = prefs.timeFormat === '12h'
  const [channels, setChannels] = useState(null)
  const [people, setPeople] = useState([])
  const [online, setOnline] = useState([])
  const [messages, setMessages] = useState([])
  const [more, setMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [text, setText] = useState('')
  const [reply, setReply] = useState(null)
  const [editing, setEditing] = useState(null)
  const [typing, setTyping] = useState({})
  const [newOpen, setNewOpen] = useState(false)
  const [dmOpen, setDmOpen] = useState(false)
  const [mention, setMention] = useState(null) // { q, index }
  const [atBottom, setAtBottom] = useState(true)
  const [unseen, setUnseen] = useState(false)
  const listRef = useRef(null)
  const inputRef = useRef(null)
  const lastTyping = useRef(0)
  const channelId = route.parts[1] || null

  const refreshChannels = useCallback(async () => {
    const r = await api('GET', '/chat/channels')
    setChannels(r.channels)
    useUI.setState({ chatUnread: r.channels.reduce((n, c) => n + (c.unread || 0), 0) })
    return r.channels
  }, [])

  useEffect(() => {
    if (mode !== 'server') return
    refreshChannels().then((list) => {
      if (!channelId && list.length) navigate(`/chat/${list.find((c) => c.id === 'general')?.id || list[0].id}`, { replace: true })
    })
    api('GET', '/users').then((r) => setPeople(r.users)).catch(() => {})
  }, [mode]) // eslint-disable-line react-hooks/exhaustive-deps

  const peopleMap = useMemo(() => new Map(people.map((p) => [p.handle, p])), [people])
  const channel = channels?.find((c) => c.id === channelId)

  // load the channel's history
  useEffect(() => {
    if (!channelId || mode !== 'server') return
    let alive = true
    setLoading(true)
    setMessages([])
    setReply(null)
    setEditing(null)
    api('GET', `/chat/messages?channel=${encodeURIComponent(channelId)}`)
      .then((r) => {
        if (!alive) return
        setMessages(r.messages)
        setMore(r.more)
        requestAnimationFrame(() => listRef.current && (listRef.current.scrollTop = listRef.current.scrollHeight))
      })
      .catch(() => alive && setMessages([]))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [channelId, mode])

  // mark read when looking at it
  useEffect(() => {
    const last = messages[messages.length - 1]
    if (!last || !channelId || document.visibilityState !== 'visible') return
    api('POST', '/chat/read', { channel: channelId, at: last.at })
      .then(refreshChannels)
      .catch(() => {})
  }, [messages.length, channelId]) // eslint-disable-line react-hooks/exhaustive-deps

  // live updates
  useEffect(() => {
    const offs = [
      onSocket('chat', (e) => {
        if (e.channel !== channelId) return refreshChannels()
        setMessages((list) => {
          const i = list.findIndex((m) => m.id === e.message.id)
          if (i >= 0) return list.map((m, j) => (j === i ? { ...e.message } : m))
          return [...list, e.message]
        })
        if (!atBottom && e.message.from !== me) setUnseen(true)
      }),
      onSocket('channels', refreshChannels),
      onSocket('presence', (e) => setOnline(e.online || [])),
      onSocket('typing', (e) => {
        if (e.channel !== channelId) return
        setTyping((t) => ({ ...t, [e.handle]: Date.now() }))
      }),
    ]
    const tick = setInterval(() => setTyping((t) => Object.fromEntries(Object.entries(t).filter(([, at]) => Date.now() - at < 5000))), 1500)
    return () => {
      offs.forEach((off) => off())
      clearInterval(tick)
    }
  }, [channelId, atBottom, me, refreshChannels])

  useLayoutEffect(() => {
    const el = listRef.current
    if (el && atBottom) el.scrollTop = el.scrollHeight
  }, [messages, atBottom])

  const loadEarlier = async () => {
    if (!messages.length) return
    const el = listRef.current
    const before = el.scrollHeight
    const r = await api('GET', `/chat/messages?channel=${encodeURIComponent(channelId)}&before=${encodeURIComponent(messages[0].at)}`)
    setMessages((list) => [...r.messages, ...list])
    setMore(r.more)
    requestAnimationFrame(() => (el.scrollTop = el.scrollHeight - before))
  }

  const send = async (body = text, retryOf) => {
    const t = body.trim()
    if (!t) return
    const temp = retryOf || { id: `tmp-${Date.now()}`, at: new Date().toISOString(), from: me, text: t, reply: reply?.id, pending: true }
    if (!retryOf) setMessages((list) => [...list, temp])
    else setMessages((list) => list.map((m) => (m.id === retryOf.id ? { ...m, failed: false, pending: true } : m)))
    setText('')
    setReply(null)
    setAtBottom(true)
    try {
      const { message } = await api('POST', '/chat/messages', { channel: channelId, text: t, reply: temp.reply })
      setMessages((list) => {
        const without = list.filter((m) => m.id !== temp.id)
        return without.some((m) => m.id === message.id) ? without : [...without, message]
      })
    } catch {
      setMessages((list) => list.map((m) => (m.id === temp.id ? { ...m, pending: false, failed: true } : m)))
    }
  }
  const edit = async (m, t, retry) => {
    if (retry) return send(t, m)
    setEditing(null)
    if (t.trim() === m.text) return
    const { message } = await api('PATCH', '/chat/messages', { channel: channelId, id: m.id, text: t.trim() })
    setMessages((list) => list.map((x) => (x.id === m.id ? message : x)))
  }
  const remove = async (m) => {
    await api('DELETE', '/chat/messages', { channel: channelId, id: m.id })
    setMessages((list) => list.map((x) => (x.id === m.id ? { ...x, deleted: true, text: '' } : x)))
  }

  const onInput = (e) => {
    const v = e.target.value
    setText(v)
    if (Date.now() - lastTyping.current > 3000) {
      lastTyping.current = Date.now()
      sendSocket({ type: 'typing', channel: channelId })
    }
    const before = v.slice(0, e.target.selectionStart)
    const m = /(^|\s)@([a-z0-9-]*)$/i.exec(before)
    setMention(m ? { q: m[2].toLowerCase(), index: 0 } : null)
  }
  const candidates = mention ? people.filter((p) => p.handle !== me && (p.handle.includes(mention.q) || p.name.toLowerCase().includes(mention.q))).slice(0, 6) : []
  const pickMention = (p) => {
    const el = inputRef.current
    const pos = el.selectionStart
    const before = text.slice(0, pos).replace(/@([a-z0-9-]*)$/i, `@${p.handle} `)
    setText(before + text.slice(pos))
    setMention(null)
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(before.length, before.length)
    })
  }
  const onKey = (e) => {
    if (mention && candidates.length) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        setMention({ ...mention, index: (mention.index + (e.key === 'ArrowDown' ? 1 : candidates.length - 1)) % candidates.length })
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        return pickMention(candidates[mention.index])
      }
      if (e.key === 'Escape') return setMention(null)
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    } else if (e.key === 'ArrowUp' && !text) {
      const mine = [...messages].reverse().find((m) => m.from === me && !m.deleted && !m.pending)
      if (mine) {
        e.preventDefault()
        setEditing(mine.id)
      }
    } else if (e.key === 'Escape' && reply) setReply(null)
  }

  if (mode !== 'server')
    return (
      <div className="view">
        <EmptyState icon={MessagesSquare} title="Chat needs a Lumen server">
          Chat is for talking with people you invite, so it runs on a self-hosted Lumen server. Your tasks, calendar and docs work everywhere.
        </EmptyState>
      </div>
    )

  const titleOf = (c) => (c.dm ? peopleMap.get((c.members || []).find((h) => h !== me))?.name || 'Direct message' : `${c.name}`)
  const byId = new Map(messages.map((m) => [m.id, m]))
  const typers = Object.keys(typing).filter((h) => h !== me)
  let lastDay = null
  let prev = null

  return (
    <div className="view chat">
      <aside className="chat-side">
        <div className="chat-side-head">
          <span className="view-title">Chat</span>
        </div>
        <div className="chat-side-section">
          <div className="cal-side-head">
            <span>Channels</span>
            <button type="button" className="nav-section-add" aria-label="New channel" onClick={() => setNewOpen(true)}>
              <Plus size={14} />
            </button>
          </div>
          {(channels || []).filter((c) => !c.dm).map((c) => (
            <a key={c.id} href={`#/chat/${c.id}`} className={`nav-item${c.id === channelId ? ' is-active' : ''}${c.unread ? ' has-unread' : ''}`}>
              <span className="nav-icon">
                <Hash size={15} />
              </span>
              <span className="nav-label">{c.name}</span>
              {c.unread ? <span className="chat-badge">{c.unread}</span> : null}
            </a>
          ))}
        </div>
        <div className="chat-side-section">
          <div className="cal-side-head">
            <span>Direct messages</span>
            <button type="button" className="nav-section-add" aria-label="New direct message" onClick={() => setDmOpen(true)}>
              <Plus size={14} />
            </button>
          </div>
          {(channels || []).filter((c) => c.dm).map((c) => {
            const other = (c.members || []).find((h) => h !== me)
            return (
              <a key={c.id} href={`#/chat/${c.id}`} className={`nav-item${c.id === channelId ? ' is-active' : ''}${c.unread ? ' has-unread' : ''}`}>
                <span className="nav-icon chat-dm-avatar">
                  <Avatar name={titleOf(c)} size={18} />
                  {online.includes(other) && <span className="presence" aria-label="online" />}
                </span>
                <span className="nav-label">{titleOf(c)}</span>
                {c.unread ? <span className="chat-badge">{c.unread}</span> : null}
              </a>
            )
          })}
        </div>
      </aside>

      <section className="chat-main" aria-label={channel ? titleOf(channel) : 'Chat'}>
        <header className="view-header has-border">
          <h1 className="view-title">
            {channel && !channel.dm && <Hash size={16} className="faint" />}
            {channel ? titleOf(channel) : ''}
          </h1>
          <select className="chat-switch" aria-label="Channel" value={channelId || ''} onChange={(e) => navigate(`/chat/${e.target.value}`)}>
            {(channels || []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.dm ? titleOf(c) : `#${c.name}`}
                {c.unread ? ` (${c.unread})` : ''}
              </option>
            ))}
          </select>
          {channel && (
            <span className="view-subtitle">
              {channel.members === 'everyone' ? 'Everyone' : `${(channel.members || []).length} people`}
            </span>
          )}
        </header>
        <div
          className="chat-list"
          ref={listRef}
          role="log"
          aria-live="polite"
          onScroll={(e) => {
            const el = e.currentTarget
            const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40
            setAtBottom(bottom)
            if (bottom) setUnseen(false)
          }}
        >
          {more && (
            <button type="button" className="chat-earlier" onClick={loadEarlier}>
              Load earlier messages
            </button>
          )}
          {loading && (
            <div className="view-loading">
              <Spinner size={16} />
            </div>
          )}
          {!loading && !messages.length && channel && <div className="chat-empty">This is the beginning of {channel.dm ? 'your conversation' : `#${channel.name}`}.</div>}
          {messages.map((m) => {
            const day = isoOf(new Date(m.at))
            const sep = day !== lastDay
            lastDay = day
            const first = sep || !prev || prev.from !== m.from || new Date(m.at) - new Date(prev.at) > 5 * 60000 || m.reply
            prev = m
            return (
              <div key={m.id}>
                {sep && (
                  <div className="chat-day">
                    <span>{day === todayIso() ? 'Today' : relativeDay(day)}</span>
                  </div>
                )}
                <Message m={m} first={first} me={me} people={peopleMap} h12={h12} onReply={setReply} onEdit={edit} onDelete={remove} editing={editing === m.id} setEditing={setEditing} replyTo={m.reply ? byId.get(m.reply) : null} />
              </div>
            )
          })}
        </div>
        {unseen && (
          <button type="button" className="chat-new-pill" onClick={() => setAtBottom(true)}>
            <ArrowDown size={13} /> New messages
          </button>
        )}
        {channel && (
          <div className="composer-wrap">
            {reply && (
              <div className="composer-reply">
                <CornerUpLeft size={13} /> Replying to <b>{peopleMap.get(reply.from)?.name || reply.from}</b>
                <span className="composer-reply-text">{reply.text}</span>
                <button type="button" aria-label="Cancel reply" onClick={() => setReply(null)}>
                  <X size={13} />
                </button>
              </div>
            )}
            {mention && candidates.length > 0 && (
              <div className="mention-list" role="listbox" aria-label="Mention someone">
                {candidates.map((p, i) => (
                  <button key={p.handle} type="button" role="option" aria-selected={i === mention.index} className="mention-option" onMouseDown={(e) => e.preventDefault()} onClick={() => pickMention(p)}>
                    <Avatar name={p.name} size={18} /> {p.name} <span className="faint">@{p.handle}</span>
                  </button>
                ))}
              </div>
            )}
            <div className="composer">
              <textarea ref={inputRef} rows={1} value={text} onChange={onInput} onKeyDown={onKey} placeholder={`Message ${channel.dm ? titleOf(channel) : `#${channel.name}`}`} aria-label="Message" />
            </div>
            <div className="composer-foot">{typers.length ? `${typers.map((h) => peopleMap.get(h)?.name || h).join(', ')} ${typers.length > 1 ? 'are' : 'is'} typing…` : <span className="faint">Enter to send · Shift Enter for a new line · @ to mention</span>}</div>
          </div>
        )}
      </section>

      <NewChannel
        open={newOpen}
        onClose={() => setNewOpen(false)}
        people={people.filter((p) => p.handle !== me)}
        onCreated={(c) => {
          setNewOpen(false)
          refreshChannels()
          navigate(`/chat/${c.id}`)
        }}
      />
      <Dialog open={dmOpen} onClose={() => setDmOpen(false)} size="sm" title="Message someone">
        <div className="chat-form">
          {people.filter((p) => p.handle !== me).map((p) => (
            <button
              key={p.handle}
              type="button"
              className="mention-option"
              onClick={async () => {
                const { channel: c } = await api('POST', '/chat/channels', { dm: p.handle })
                setDmOpen(false)
                await refreshChannels()
                navigate(`/chat/${c.id}`)
              }}
            >
              <Avatar name={p.name} size={20} /> {p.name} <span className="faint">@{p.handle}</span>
            </button>
          ))}
          {people.length < 2 && <p className="muted">No one else is here yet. Invite people from Settings → Members.</p>}
        </div>
      </Dialog>
    </div>
  )
}
