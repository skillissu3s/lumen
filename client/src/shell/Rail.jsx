// The sidebar, closed: a slim rail of icons, so the places stay one click away.
// It is its own column beside the sidebar (as obi does it): closing the sidebar
// slides it shut while the rail slides open, so neither has to rearrange itself.
import { useRef, useState } from 'react'
import { CalendarDays, FileText, Kanban, Lightbulb, MessagesSquare, PanelLeftOpen, Plus, Search, Sun } from 'lucide-react'
import { Avatar, IconBadge, Tooltip } from '../components/ui/index.js'
import { useSession } from '../store/session.js'
import { useUI } from '../store/ui.js'
import { useConfig, useLists, usePlugins } from '../store/hooks.js'
import { usePrefs, setPrefs } from '../store/prefs.js'
import { createBoard } from '../lib/boardActions.js'
import { navigate } from '../lib/router.js'
import { ListEditor } from './ListEditor.jsx'
import { iconByName } from './icons.js'
import { AccountMenu } from './AccountMenu.jsx'
import { SyncStatus } from './Sidebar.jsx'

function RailItem({ href, icon: Icon, tint, label, active, children }) {
  return (
    <Tooltip label={label} side="right">
      <a href={href} className={`app-rail-item${active ? ' is-active' : ''}`} style={tint ? { '--tint': `var(--c-${tint})` } : undefined} aria-label={label} aria-current={active ? 'page' : undefined}>
        {Icon ? <Icon size={16} strokeWidth={1.9} /> : children}
      </a>
    </Tooltip>
  )
}

export function Rail({ route, closed }) {
  const user = useSession((s) => s.user)
  const mode = useSession((s) => s.mode)
  const config = useConfig()
  const lists = useLists()
  const plugins = usePlugins()
  const prefs = usePrefs()
  const openPalette = useUI((s) => s.openPalette)
  const [adding, setAdding] = useState(false)
  const addRef = useRef(null)
  const path = route.path
  const at = (p) => path === p || path.startsWith(`${p}/`)
  const views = plugins.filter((p) => p.manifest.view && !prefs.plugins.disabled.includes(p.id))

  return (
    <nav className={`app-rail${closed ? ' is-closed' : ''}`} aria-label="Main" inert={closed || undefined}>
      <div className="app-rail-top">
        <AccountMenu workspace={config.name} compact />
        <Tooltip label="Expand the sidebar  Ctrl+\" side="right">
          <button type="button" className="app-rail-item" aria-label="Expand the sidebar" onClick={() => setPrefs({ sidebar: { collapsed: false } })}>
            <PanelLeftOpen size={16} />
          </button>
        </Tooltip>
        <Tooltip label="Search  Ctrl K" side="right">
          <button type="button" className="app-rail-item" aria-label="Search" onClick={openPalette}>
            <Search size={16} />
          </button>
        </Tooltip>
      </div>

      <div className="app-rail-scroll">
        <RailItem href="#/today" icon={Sun} tint="amber" label="Today" active={at('/today') || path === '/'} />
        <RailItem href="#/tasks" icon={Kanban} tint="indigo" label="All tasks" active={at('/tasks')} />
        <RailItem href="#/calendar" icon={CalendarDays} tint="blue" label="Calendar" active={at('/calendar')} />
        <RailItem href="#/ideas" icon={Lightbulb} tint="violet" label="Ideas" active={at('/ideas')} />
        <RailItem href="#/docs" icon={FileText} tint="teal" label="Docs" active={at('/docs')} />
        {mode === 'server' && <RailItem href="#/chat" icon={MessagesSquare} tint="green" label="Chat" active={at('/chat')} />}
        <span className="app-rail-sep" />
        {lists.map((l) => (
          <RailItem key={l.path} href={`#/board/${l.id}`} label={l.name} active={path === `/board/${l.id}`}>
            <IconBadge name={l.icon} color={l.color || 'gray'} size={18} fallback={Kanban} />
          </RailItem>
        ))}
        <Tooltip label="New board" side="right">
          <button ref={addRef} type="button" className="app-rail-item is-faint" aria-label="New board" onClick={() => setAdding(true)}>
            <Plus size={16} />
          </button>
        </Tooltip>
        {views.length > 0 && <span className="app-rail-sep" />}
        {views.map((p) => (
          <RailItem key={p.id} href={`#/plugin/${p.id}`} icon={iconByName(p.manifest.view.icon || p.manifest.icon)} label={p.manifest.view.title || p.manifest.name} active={path === `/plugin/${p.id}`} />
        ))}
      </div>

      <div className="app-rail-bottom">
        <Tooltip label="Settings" side="right">
          <a href="#/settings" className="me" aria-label="Settings">
            <Avatar name={user?.name || user?.handle} size={22} />
          </a>
        </Tooltip>
        <SyncStatus />
      </div>

      <ListEditor
        open={adding}
        onOpenChange={setAdding}
        anchor={addRef}
        initial={{}}
        kind="board"
        onSave={(v) => {
          const p = createBoard(v)
          navigate(`/board/${p.slice(6, -3)}`)
        }}
      />
    </nav>
  )
}
