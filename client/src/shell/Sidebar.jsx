// The left column: the workspace at the top, search, the main places, your
// boards, plugins, and at the bottom you (your account) and whether everything
// is saved.
import { useMemo, useRef, useState } from 'react'
import { CalendarDays, CircleAlert, CloudOff, FileText, Kanban, Lightbulb, MessagesSquare, PanelLeftClose, Plus, Search, Sun } from 'lucide-react'
import { Button, ContextMenu, Dialog, IconBadge, Spinner, Tooltip } from '../components/ui/index.js'
import { useSession, useHasAccount } from '../store/session.js'
import { useWorkspace } from '../store/workspace.js'
import { useUI } from '../store/ui.js'
import { useLists, useListsAcross, usePlugins } from '../store/hooks.js'
import { useCurrentSpace, useSpaceLabels, useSpaces } from '../store/spaces.js'
import { moveItem, useCanMove } from './MoveTo.jsx'
import { usePrefs, setPrefs } from '../store/prefs.js'
import { deleteList, updateListMeta } from '../lib/actions.js'
import { createBoard, moveCard } from '../lib/boardActions.js'
import { navigate } from '../lib/router.js'
import { flatItems, isOpen, itemDay } from '../../../shared/items.js'
import { todayIso } from '../../../shared/dates.js'
import { ListEditor } from './ListEditor.jsx'
import { iconByName } from './icons.js'
import { UpdateNotice } from './UpdateNotice.jsx'
import { AccountMenu } from './AccountMenu.jsx'
import { WorkspaceMenu } from './WorkspaceMenu.jsx'

const countOpen = (list) => list.items.filter((i) => i.kind === 'task' && isOpen(i.status)).length

// a board being dragged to a new place in the list (its key), apart from cards dropped on a board
const BOARD = 'application/x-lumen-board'

/**
 * `onDrop`: a card dropped on it. `order`: { key, onPlace(fromKey) } makes it a
 * board that can be dragged, and placed before when another is dropped on it.
 * `note`: a word after the name (the workspace a board is in).
 */
function NavItem({ href, icon: Icon, tint, label, note, count, active, children, onDrop, order, ...props }) {
  const [over, setOver] = useState(null) // 'card' | 'board'
  const kindOf = (e) => (order && e.dataTransfer.types.includes(BOARD) ? 'board' : onDrop && e.dataTransfer.types.includes('application/x-lumen-item') ? 'card' : null)
  const dropProps =
    onDrop || order
      ? {
          onDragOver: (e) => {
            const kind = kindOf(e)
            if (!kind) return
            e.preventDefault()
            setOver(kind)
          },
          onDragLeave: () => setOver(null),
          onDrop: (e) => {
            const kind = kindOf(e)
            setOver(null)
            if (kind === 'board') {
              e.preventDefault()
              const from = e.dataTransfer.getData(BOARD)
              if (from && from !== order.key) order.onPlace(from)
              return
            }
            const raw = e.dataTransfer.getData('application/x-lumen-item')
            if (raw) onDrop(JSON.parse(raw))
          },
        }
      : {}
  const dragProps = order
    ? {
        draggable: true,
        onDragStart: (e) => {
          e.dataTransfer.setData(BOARD, order.key)
          e.dataTransfer.effectAllowed = 'move'
        },
      }
    : {}
  return (
    <a href={href} className={`nav-item${active ? ' is-active' : ''}${over === 'card' ? ' is-drop' : ''}${over === 'board' ? ' is-drop-before' : ''}`} style={tint ? { '--tint': `var(--c-${tint})` } : undefined} aria-current={active ? 'page' : undefined} {...dragProps} {...dropProps} {...props}>
      <span className="nav-icon">{Icon ? <Icon size={16} strokeWidth={1.9} /> : children}</span>
      <span className="nav-label">
        {label}
        {note && <span className="nav-note"> · {note}</span>}
      </span>
      {count ? <span className="nav-count">{count}</span> : null}
    </a>
  )
}

// a desktop app signed in to a server: once saved here, how syncing with it goes
const CLOUD = {
  idle: { look: 'saved', text: 'Synced' },
  syncing: { look: 'saving', text: 'Syncing…' },
  offline: { look: 'offline', text: 'Offline · changes kept' },
  'signed-out': { look: 'error', text: 'Sign in again' },
  error: { look: 'error', text: 'Not synced' },
}

export function SyncStatus() {
  const saving = useWorkspace((s) => s.saving)
  const mode = useSession((s) => s.mode)
  const cloud = useSession((s) => s.cloud)
  const synced = mode === 'desktop' && cloud?.linked
  const where = synced ? cloud.server.replace(/^https?:\/\//, '') : mode === 'desktop' ? 'This computer' : 'Server'
  const map = {
    saved: { icon: null, text: 'Saved' },
    saving: { icon: <Spinner size={11} />, text: 'Saving…' },
    offline: { icon: <CloudOff size={13} />, text: 'Offline · changes kept' },
    error: { icon: <CircleAlert size={13} />, text: 'Couldn’t save' },
  }
  let look = saving.state
  let s = map[saving.state] || map.saved
  if (synced && saving.state === 'saved' && CLOUD[cloud.state]) {
    look = CLOUD[cloud.state].look
    s = { ...map[look], text: CLOUD[cloud.state].text }
  }
  return (
    <Tooltip label={saving.error || (synced && cloud.lastError) || `${s.text} · ${where}`}>
      <div className={`sync-status is-${look}`} role="status">
        {s.icon || <span className="sync-dot" />}
        <span className="sync-text">{s.text}</span>
      </div>
    </Tooltip>
  )
}

export function Sidebar({ route, onNavigate, closed }) {
  const account = useHasAccount()
  // chat: a workspace's channels and your messages; in your candle, your messages
  const space = useCurrentSpace()
  const canMove = useCanMove()
  const plugins = usePlugins()
  const prefs = usePrefs()
  const prefix = useWorkspace((s) => s.prefix)
  const labels = useSpaceLabels()
  // in your candle, the boards of your workspaces (and shared with you) are here
  // too, marked with where they are; in a workspace, its own
  const own = useLists()
  const across = useListsAcross()
  const shown = space.kind === 'candle' ? across : own
  // each board by its path in your tree, in the order you dragged them, the rest after
  const keyOf = (l) => `${prefix}${l.path}`
  const order = prefs.sidebar.boardOrder || []
  const lists = useMemo(() => {
    const at = new Map(order.map((k, i) => [k, i]))
    return shown.map((l, i) => ({ l, i, at: at.get(`${prefix}${l.path}`) ?? Infinity })).sort((a, b) => a.at - b.at || a.i - b.i).map((x) => x.l)
  }, [shown, order, prefix])
  const place = (from, before) => {
    const keys = lists.map(keyOf).filter((k) => k !== from)
    const at = before ? keys.indexOf(before) : keys.length
    keys.splice(at < 0 ? keys.length : at, 0, from)
    // boards not shown here (another space's) keep their place after these
    setPrefs({ sidebar: { boardOrder: [...keys, ...order.filter((k) => !keys.includes(k))] } })
  }
  const nudge = (l, by) => {
    const keys = lists.map(keyOf)
    const i = keys.indexOf(keyOf(l))
    const to = keys[i + by + (by > 0 ? 1 : 0)]
    if (i + by < 0 || i + by >= keys.length) return
    place(keyOf(l), to)
  }
  // a board in another space opens there
  const elsewhere = (l) => !!l.space && l.space !== prefix
  const openBoard = (l) => (e) => {
    if (!elsewhere(l)) return
    e.preventDefault()
    useSpaces.getState().open(l.space, { to: `/board/${l.id}` })
  }
  const openPalette = useUI((s) => s.openPalette)
  const pluginBadges = useUI((s) => s.pluginBadges)
  const pluginStatus = useUI((s) => s.pluginStatus)
  const chatUnread = useUI((s) => s.chatUnread)
  const [editor, setEditor] = useState(null) // { anchor, list? }
  const [confirm, setConfirm] = useState(null)
  const addRef = useRef(null)

  const today = todayIso()
  // the counts match Today and All tasks, which in your candle take in other spaces
  const counted = useListsAcross()
  const todayCount = useMemo(() => counted.reduce((n, l) => n + flatItems(l).filter((i) => !i.parent && i.kind === 'task' && isOpen(i.status) && itemDay(i) && itemDay(i) <= today).length, 0), [counted, today])
  const openCount = useMemo(() => counted.reduce((n, l) => n + countOpen(l), 0), [counted])
  const path = route.path
  const at = (p) => path === p || path.startsWith(`${p}/`)
  const views = plugins.filter((p) => p.manifest.view && !prefs.plugins.disabled.includes(p.id))
  const statuses = Object.entries(pluginStatus).filter(([, t]) => t)

  const boardMenu = (l) => [
    ...(elsewhere(l) ? [{ label: `Open in ${labels[l.space] || 'its space'}`, onSelect: () => useSpaces.getState().open(l.space, { to: `/board/${l.id}` }) }, 'separator'] : []),
    { label: 'Edit board…', onSelect: () => setEditor({ anchor: document.getElementById(`nav-${keyOf(l)}`), list: l }) },
    ...(canMove && !elsewhere(l) ? [moveItem(l.path, l.name)] : []),
    'separator',
    { label: 'Move up', disabled: lists[0] === l, onSelect: () => nudge(l, -1) },
    { label: 'Move down', disabled: lists.at(-1) === l, onSelect: () => nudge(l, 1) },
    'separator',
    { label: 'Delete board…', danger: true, onSelect: () => setConfirm(l) },
  ]

  return (
    <nav className={`sidebar${closed ? ' is-closed' : ''}`} aria-label="Main" inert={closed || undefined}>
      <div className="sidebar-top">
        <div className="sidebar-head">
          <WorkspaceMenu />
          <Tooltip label="Collapse the sidebar  Ctrl+\" side="right">
            <button type="button" className="sidebar-collapse" aria-label="Collapse the sidebar" onClick={() => setPrefs({ sidebar: { collapsed: true } })}>
              <PanelLeftClose size={16} />
            </button>
          </Tooltip>
        </div>
        <button type="button" className="search-button" onClick={openPalette}>
          <Search size={14} />
          <span>Search</span>
          <kbd>{/Mac/.test(navigator.platform) ? '⌘K' : 'Ctrl K'}</kbd>
        </button>
      </div>

      <div className="sidebar-scroll" onClick={(e) => e.target.closest('a') && onNavigate?.()}>
        <div className="nav-group">
          <NavItem href="#/today" icon={Sun} tint="amber" label="Today" count={todayCount} active={at('/today') || path === '/'} />
          <NavItem href="#/tasks" icon={Kanban} tint="indigo" label="All tasks" count={openCount} active={at('/tasks')} />
          <NavItem href="#/calendar" icon={CalendarDays} tint="blue" label="Calendar" active={at('/calendar')} />
          <NavItem href="#/ideas" icon={Lightbulb} tint="violet" label="Ideas" active={at('/ideas')} />
          <NavItem href="#/docs" icon={FileText} tint="teal" label="Docs" active={at('/docs')} />
          {account && space.kind !== 'shared' && <NavItem href="#/chat" icon={MessagesSquare} tint="green" label="Chat" count={chatUnread} active={at('/chat')} />}
        </div>

        <div className="nav-section">
          <div className="nav-section-head">
            <span>Boards</span>
            <button ref={addRef} type="button" className="nav-section-add" aria-label="New board" onClick={() => setEditor({ anchor: addRef.current })}>
              <Plus size={14} />
            </button>
          </div>
          {lists.map((l) => (
            <ContextMenu key={l.path} items={boardMenu(l)}>
              <NavItem
                id={`nav-${keyOf(l)}`}
                href={`#/board/${l.id}`}
                label={l.name}
                note={elsewhere(l) ? labels[l.space] : null}
                count={countOpen(l)}
                active={!elsewhere(l) && path === `/board/${l.id}`}
                onClick={openBoard(l)}
                onDrop={({ path: from, id }) => from !== l.path && moveCard(from, id, l.path, null)}
                order={{ key: keyOf(l), onPlace: (from) => place(from, keyOf(l)) }}
              >
                <IconBadge name={l.icon} color={l.color || 'gray'} size={18} fallback={Kanban} />
              </NavItem>
            </ContextMenu>
          ))}
          <button
            type="button"
            className="nav-hint"
            onClick={() => setEditor({ anchor: addRef.current })}
            // a board dropped here goes last
            onDragOver={(e) => e.dataTransfer.types.includes(BOARD) && e.preventDefault()}
            onDrop={(e) => {
              const from = e.dataTransfer.getData(BOARD)
              if (from) place(from, null)
            }}
          >
            <Plus size={14} /> New board
          </button>
        </div>

        {views.length > 0 && (
          <div className="nav-section">
            <div className="nav-section-head">
              <span>Plugins</span>
            </div>
            {views.map((p) => (
              <NavItem key={p.id} href={`#/plugin/${p.id}`} icon={iconByName(p.manifest.view.icon || p.manifest.icon)} tint="gray" label={p.manifest.view.title || p.manifest.name} count={pluginBadges[p.id]} active={path === `/plugin/${p.id}`} />
            ))}
          </div>
        )}
      </div>

      <div className="sidebar-bottom">
        <UpdateNotice />
        {statuses.length > 0 && (
          <div className="plugin-status">
            {statuses.map(([id, text]) => (
              <a key={id} href={`#/plugin/${id}`} className="plugin-status-pill">
                {text}
              </a>
            ))}
          </div>
        )}
        <div className="sidebar-footer">
          <AccountMenu />
          <SyncStatus />
        </div>
      </div>

      <ListEditor
        open={!!editor}
        onOpenChange={(o) => !o && setEditor(null)}
        anchor={editor?.anchor}
        initial={editor?.list || {}}
        kind="board"
        onSave={(v) => {
          if (editor?.list) updateListMeta(editor.list.path, v)
          else {
            const p = createBoard(v)
            navigate(`/board/${p.slice(6, -3)}`)
          }
        }}
      />
      <Dialog
        open={!!confirm}
        onClose={() => setConfirm(null)}
        size="sm"
        title={`Delete “${confirm?.name}”?`}
        description="The board and all its cards will be removed."
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                deleteList(confirm.path)
                if (path === `/board/${confirm.id}`) navigate('/tasks')
                setConfirm(null)
              }}
            >
              Delete board
            </Button>
          </>
        }
      />
    </nav>
  )
}
