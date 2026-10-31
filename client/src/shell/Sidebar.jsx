// The left column: workspace, search, the main places, your boards, plugins,
// and at the bottom whether everything is saved.
import { useMemo, useRef, useState } from 'react'
import { CalendarDays, CircleAlert, CloudOff, FileText, Kanban, Lightbulb, MessagesSquare, PanelLeftClose, Plus, Search, Sun } from 'lucide-react'
import { Avatar, Button, ContextMenu, Dialog, IconBadge, Spinner, Tooltip } from '../components/ui/index.js'
import { useSession } from '../store/session.js'
import { useWorkspace } from '../store/workspace.js'
import { useUI } from '../store/ui.js'
import { useConfig, useLists, usePlugins } from '../store/hooks.js'
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

const countOpen = (list) => list.items.filter((i) => i.kind === 'task' && isOpen(i.status)).length

function NavItem({ href, icon: Icon, tint, label, count, active, children, onDrop, ...props }) {
  const [over, setOver] = useState(false)
  const dropProps = onDrop
    ? {
        onDragOver: (e) => {
          if (!e.dataTransfer.types.includes('application/x-lumen-item')) return
          e.preventDefault()
          setOver(true)
        },
        onDragLeave: () => setOver(false),
        onDrop: (e) => {
          setOver(false)
          const raw = e.dataTransfer.getData('application/x-lumen-item')
          if (raw) onDrop(JSON.parse(raw))
        },
      }
    : {}
  return (
    <a href={href} className={`nav-item${active ? ' is-active' : ''}${over ? ' is-drop' : ''}`} style={tint ? { '--tint': `var(--c-${tint})` } : undefined} aria-current={active ? 'page' : undefined} {...dropProps} {...props}>
      <span className="nav-icon">{Icon ? <Icon size={16} strokeWidth={1.9} /> : children}</span>
      <span className="nav-label">{label}</span>
      {count ? <span className="nav-count">{count}</span> : null}
    </a>
  )
}

export function SyncStatus() {
  const saving = useWorkspace((s) => s.saving)
  const mode = useSession((s) => s.mode)
  const github = useSession((s) => s.github)
  const where = mode === 'github' && github ? `${github.owner}/${github.repo}` : mode === 'desktop' ? 'This computer' : 'Server'
  const map = {
    saved: { icon: null, text: 'Saved' },
    saving: { icon: <Spinner size={11} />, text: 'Saving…' },
    offline: { icon: <CloudOff size={13} />, text: 'Offline · changes kept' },
    error: { icon: <CircleAlert size={13} />, text: 'Couldn’t save' },
  }
  const s = map[saving.state] || map.saved
  return (
    <Tooltip label={saving.error || `${s.text} · ${where}`}>
      <div className={`sync-status is-${saving.state}`} role="status">
        {s.icon || <span className="sync-dot" />}
        <span className="sync-text">{s.text}</span>
      </div>
    </Tooltip>
  )
}

export function Sidebar({ route, onNavigate, closed }) {
  const user = useSession((s) => s.user)
  const mode = useSession((s) => s.mode)
  const config = useConfig()
  const lists = useLists()
  const plugins = usePlugins()
  const prefs = usePrefs()
  const openPalette = useUI((s) => s.openPalette)
  const pluginBadges = useUI((s) => s.pluginBadges)
  const pluginStatus = useUI((s) => s.pluginStatus)
  const chatUnread = useUI((s) => s.chatUnread)
  const [editor, setEditor] = useState(null) // { anchor, list? }
  const [confirm, setConfirm] = useState(null)
  const addRef = useRef(null)

  const today = todayIso()
  const todayCount = useMemo(() => lists.reduce((n, l) => n + flatItems(l).filter((i) => !i.parent && i.kind === 'task' && isOpen(i.status) && itemDay(i) && itemDay(i) <= today).length, 0), [lists, today])
  const openCount = useMemo(() => lists.reduce((n, l) => n + countOpen(l), 0), [lists])
  const path = route.path
  const at = (p) => path === p || path.startsWith(`${p}/`)
  const views = plugins.filter((p) => p.manifest.view && !prefs.plugins.disabled.includes(p.id))
  const statuses = Object.entries(pluginStatus).filter(([, t]) => t)

  const boardMenu = (l) => [
    { label: 'Edit board…', onSelect: () => setEditor({ anchor: document.getElementById(`nav-${l.id}`), list: l }) },
    'separator',
    { label: 'Delete board…', danger: true, onSelect: () => setConfirm(l) },
  ]

  return (
    <nav className={`sidebar${closed ? ' is-closed' : ''}`} aria-label="Main" inert={closed || undefined}>
      <div className="sidebar-top">
        <div className="sidebar-head">
          <AccountMenu workspace={config.name} />
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
          {mode === 'server' && <NavItem href="#/chat" icon={MessagesSquare} tint="green" label="Chat" count={chatUnread} active={at('/chat')} />}
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
              <NavItem id={`nav-${l.id}`} href={`#/board/${l.id}`} label={l.name} count={countOpen(l)} active={path === `/board/${l.id}`} onDrop={({ path: from, id }) => from !== l.path && moveCard(from, id, l.path, null)}>
                <IconBadge name={l.icon} color={l.color || 'gray'} size={18} fallback={Kanban} />
              </NavItem>
            </ContextMenu>
          ))}
          <button type="button" className="nav-hint" onClick={() => setEditor({ anchor: addRef.current })}>
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
          <a href="#/settings" className="me" aria-label="Settings">
            <Avatar name={user?.name || user?.handle} size={22} />
            <span className="me-name">{user?.name || user?.handle}</span>
          </a>
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
        description="The board and all its cards will be removed. With GitHub sync, git history still has them."
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
