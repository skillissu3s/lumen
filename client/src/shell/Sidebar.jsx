// The left column: workspace, search, the main places, your lists, plugins, and
// at the bottom whether everything is saved.
import { useMemo, useRef, useState } from 'react'
import { CalendarDays, CalendarRange, ChevronDown, CircleAlert, CloudOff, FileText, Inbox, Keyboard, LogOut, MessagesSquare, Plus, Search, Settings, Sun } from 'lucide-react'
import { Avatar, ColorDot, ContextMenu, Dialog, Button, Menu, Spinner, Tooltip } from '../components/ui/index.js'
import { useSession } from '../store/session.js'
import { useWorkspace } from '../store/workspace.js'
import { useUI } from '../store/ui.js'
import { useConfig, useLists, usePlugins, inboxPath } from '../store/hooks.js'
import { usePrefs } from '../store/prefs.js'
import { createList, deleteList, updateListMeta, moveItemToFile } from '../lib/actions.js'
import { navigate } from '../lib/router.js'
import { flatItems, isOpen, itemDay } from '../../../shared/items.js'
import { todayIso } from '../../../shared/dates.js'
import { ListEditor } from './ListEditor.jsx'
import { iconByName } from './icons.js'

const countOpen = (list) => flatItems(list).filter((i) => !i.parent && isOpen(i.status)).length

function NavItem({ href, icon: Icon, label, count, active, children, onDrop, ...props }) {
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
    <a href={href} className={`nav-item${active ? ' is-active' : ''}${over ? ' is-drop' : ''}`} aria-current={active ? 'page' : undefined} {...dropProps} {...props}>
      <span className="nav-icon">{Icon ? <Icon size={16} strokeWidth={1.75} /> : children}</span>
      <span className="nav-label">{label}</span>
      {count ? <span className="nav-count">{count}</span> : null}
    </a>
  )
}

function SyncStatus() {
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
        <span className="sync-where">{where}</span>
      </div>
    </Tooltip>
  )
}

export function Sidebar({ route, onNavigate }) {
  const user = useSession((s) => s.user)
  const mode = useSession((s) => s.mode)
  const logout = useSession((s) => s.logout)
  const disconnect = useSession((s) => s.disconnectGitHub)
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

  const inbox = inboxPath(config)
  const today = todayIso()
  const inboxList = lists.find((l) => l.path === inbox)
  const others = lists.filter((l) => l.path !== inbox)
  const todayCount = useMemo(
    () => lists.reduce((n, l) => n + flatItems(l).filter((i) => !i.parent && isOpen(i.status) && itemDay(i) && itemDay(i) <= today).length, 0),
    [lists, today],
  )
  const path = route.path
  const at = (p) => path === p || path.startsWith(`${p}/`)
  const views = plugins.filter((p) => p.manifest.view && !prefs.plugins.disabled.includes(p.id))
  const statuses = Object.entries(pluginStatus).filter(([, t]) => t)

  const moveTo = (toPath) => ({ path: from, id }) => from !== toPath && moveItemToFile(from, id, toPath, {})

  const listMenu = (l) => [
    { label: 'Edit list…', onSelect: () => setEditor({ anchor: document.getElementById(`nav-${l.id}`), list: l }) },
    'separator',
    { label: 'Delete list…', danger: true, onSelect: () => setConfirm(l) },
  ]

  return (
    <nav className="sidebar" aria-label="Main">
      <div className="sidebar-top">
        <Menu
          trigger={
            <button type="button" className="workspace-button">
              <span className="workspace-mark">{(config.name || 'L').trim()[0]?.toUpperCase()}</span>
              <span className="workspace-name">{config.name}</span>
              <ChevronDown size={14} className="workspace-chevron" />
            </button>
          }
          items={[
            { section: user?.email || `@${user?.handle}` },
            { label: 'Settings', icon: Settings, onSelect: () => navigate('/settings') },
            { label: 'Keyboard shortcuts', icon: Keyboard, shortcut: '?', onSelect: () => useUI.setState({ shortcutsOpen: true }) },
            'separator',
            mode === 'github'
              ? { label: 'Disconnect GitHub', icon: LogOut, onSelect: () => disconnect() }
              : mode === 'server'
                ? { label: 'Sign out', icon: LogOut, onSelect: () => logout().then(() => navigate('/signin')) }
                : null,
          ].filter(Boolean)}
        />
        <button type="button" className="search-button" onClick={openPalette}>
          <Search size={14} />
          <span>Search</span>
          <kbd>{/Mac/.test(navigator.platform) ? '⌘K' : 'Ctrl K'}</kbd>
        </button>
      </div>

      <div className="sidebar-scroll" onClick={(e) => e.target.closest('a') && onNavigate?.()}>
        <div className="nav-group">
          <NavItem href="#/today" icon={Sun} label="Today" count={todayCount} active={at('/today') || path === '/'} />
          <NavItem href="#/inbox" icon={Inbox} label="Inbox" count={inboxList ? countOpen(inboxList) : 0} active={at('/inbox')} onDrop={moveTo(inbox)} />
          <NavItem href="#/upcoming" icon={CalendarRange} label="Upcoming" active={at('/upcoming')} />
          <NavItem href="#/calendar" icon={CalendarDays} label="Calendar" active={at('/calendar')} />
          <NavItem href="#/docs" icon={FileText} label="Docs" active={at('/docs')} />
          {mode === 'server' && <NavItem href="#/chat" icon={MessagesSquare} label="Chat" count={chatUnread} active={at('/chat')} />}
        </div>

        <div className="nav-section">
          <div className="nav-section-head">
            <span>Lists</span>
            <button ref={addRef} type="button" className="nav-section-add" aria-label="New list" onClick={() => setEditor({ anchor: addRef.current })}>
              <Plus size={14} />
            </button>
          </div>
          {others.map((l) => (
            <ContextMenu key={l.path} items={listMenu(l)}>
              <NavItem id={`nav-${l.id}`} href={`#/list/${l.id}`} label={l.name} count={countOpen(l)} active={path === `/list/${l.id}`} onDrop={moveTo(l.path)}>
                {l.icon ? <span className="nav-emoji">{l.icon}</span> : <ColorDot color={l.color || 'gray'} size={8} />}
              </NavItem>
            </ContextMenu>
          ))}
          {!others.length && (
            <button type="button" className="nav-hint" onClick={() => setEditor({ anchor: addRef.current })}>
              New list
            </button>
          )}
        </div>

        {views.length > 0 && (
          <div className="nav-section">
            <div className="nav-section-head">
              <span>Plugins</span>
            </div>
            {views.map((p) => {
              const Icon = iconByName(p.manifest.view.icon || p.manifest.icon)
              return <NavItem key={p.id} href={`#/plugin/${p.id}`} icon={Icon} label={p.manifest.view.title || p.manifest.name} count={pluginBadges[p.id]} active={path === `/plugin/${p.id}`} />
            })}
          </div>
        )}
      </div>

      <div className="sidebar-bottom">
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
        onSave={(v) => {
          if (editor?.list) updateListMeta(editor.list.path, v)
          else {
            const p = createList(v)
            navigate(`/list/${p.slice(6, -3)}`)
          }
        }}
      />
      <Dialog
        open={!!confirm}
        onClose={() => setConfirm(null)}
        size="sm"
        title={`Delete “${confirm?.name}”?`}
        description="The list and all its tasks will be removed. In GitHub mode, git history still has them."
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                deleteList(confirm.path)
                if (path === `/list/${confirm.id}`) navigate('/inbox')
                setConfirm(null)
              }}
            >
              Delete list
            </Button>
          </>
        }
      />
    </nav>
  )
}
