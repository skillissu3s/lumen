// The signed-in app: sidebar + the current view, with the palette, toasts,
// shortcuts help and global shortcuts around them.
import { Component, lazy, Suspense, useEffect, useRef, useState } from 'react'
import { Menu as MenuIcon } from 'lucide-react'
import { Dialog, Kbd, Spinner, Toaster } from '../components/ui/index.js'
import { useUI, undoLast } from '../store/ui.js'
import { usePrefs, setPrefs } from '../store/prefs.js'
import { onProblem } from '../store/workspace.js'
import { navigate, parseHash } from '../lib/router.js'
import { useConfig, inboxPath } from '../store/hooks.js'
import { Sidebar } from './Sidebar.jsx'
import { CommandPalette } from './CommandPalette.jsx'
import PluginFrames from '../plugins/PluginFrames.jsx'
import { useShortcut, shortcutList, comboKeys } from './shortcuts.js'

const TasksView = lazy(() => import('../views/tasks/TasksView.jsx'))
const AllTasks = lazy(() => import('../views/tasks/AllTasks.jsx'))
const BoardPage = lazy(() => import('../views/boards/BoardPage.jsx'))
const IdeasView = lazy(() => import('../views/ideas/IdeasView.jsx'))
const CalendarView = lazy(() => import('../views/calendar/CalendarView.jsx'))
const DocsView = lazy(() => import('../views/docs/DocsView.jsx'))
const ChatView = lazy(() => import('../views/chat/ChatView.jsx'))
const SettingsView = lazy(() => import('../views/settings/SettingsView.jsx'))
const PluginView = lazy(() => import('../views/PluginView.jsx'))

function viewFor(route) {
  switch (route.parts[0]) {
    case 'tasks':
      return AllTasks
    case 'board':
      return BoardPage
    case 'ideas':
      return IdeasView
    case 'calendar':
      return CalendarView
    case 'docs':
      return DocsView
    case 'chat':
      return ChatView
    case 'plugin':
      return PluginView
    default:
      return TasksView
  }
}

// addresses from before boards: lists and Upcoming live elsewhere now
function redirectOld(route, inbox) {
  const [first, second] = route.parts
  if (first === 'list' && second) return `/board/${second}${route.query.task ? `?card=${route.query.task}` : ''}`
  if (first === 'inbox') return `/board/${inbox.slice(6, -3)}`
  if (first === 'upcoming') return '/tasks?group=date'
  return null
}

// one broken view shouldn't take the whole app down
class ViewBoundary extends Component {
  state = { error: null }
  static getDerivedStateFromError(error) {
    return { error }
  }
  componentDidUpdate(prev) {
    if (prev.path !== this.props.path && this.state.error) this.setState({ error: null })
  }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="view view-error" role="alert">
        <h2>Something went wrong on this page</h2>
        <p className="muted">{String(this.state.error.message || this.state.error)}</p>
        <button type="button" className="ui-button ui-button--secondary" onClick={() => location.reload()}>
          Reload
        </button>
      </div>
    )
  }
}

function ShortcutsDialog() {
  const open = useUI((s) => s.shortcutsOpen)
  const groups = open ? shortcutList() : []
  return (
    <Dialog open={open} onClose={() => useUI.setState({ shortcutsOpen: false })} title="Keyboard shortcuts" size="lg">
      <div className="shortcuts">
        {groups.map((g) => (
          <section key={g.group} className="shortcuts-group">
            <h3>{g.group}</h3>
            {g.items.map((s) => (
              <div key={s.combo} className="shortcuts-row">
                <span>{s.description}</span>
                <Kbd keys={comboKeys(s.combo)} />
              </div>
            ))}
          </section>
        ))}
      </div>
    </Dialog>
  )
}

export function AppShell({ route }) {
  const toasts = useUI((s) => s.toasts)
  const dismiss = useUI((s) => s.dismiss)
  const toast = useUI((s) => s.toast)
  const prefs = usePrefs()
  const collapsed = prefs.sidebar?.collapsed
  const [drawer, setDrawer] = useState(false)
  // Settings open over the page you were on, as a dialog
  const settings = route.parts[0] === 'settings'
  const behind = useRef(parseHash('#/today'))
  if (!settings) behind.current = route
  const page = settings ? behind.current : route
  const View = viewFor(page)

  useEffect(() => onProblem((p) => toast(p.message, { tone: 'danger' })), [toast])
  const config = useConfig()
  useEffect(() => {
    const to = redirectOld(route, inboxPath(config))
    if (to) navigate(to, { replace: true })
  }, [route, config])
  useEffect(() => setDrawer(false), [route.path])

  useShortcut('mod+k', () => useUI.getState().openPalette(), { description: 'Search and commands', allowInInput: true })
  useShortcut('mod+\\', () => setPrefs({ sidebar: { collapsed: !collapsed } }), { description: 'Show or hide the sidebar', allowInInput: true })
  useShortcut('?', () => useUI.setState({ shortcutsOpen: true }), { description: 'Keyboard shortcuts' })
  useShortcut('mod+z', () => undoLast(), { description: 'Undo the last change' })
  useShortcut('g t', () => navigate('/today'), { description: 'Go to Today', group: 'Go to' })
  useShortcut('g a', () => navigate('/tasks'), { description: 'Go to All tasks', group: 'Go to' })
  useShortcut('g i', () => navigate('/ideas'), { description: 'Go to Ideas', group: 'Go to' })
  useShortcut('g c', () => navigate('/calendar'), { description: 'Go to Calendar', group: 'Go to' })
  useShortcut('g d', () => navigate('/docs'), { description: 'Go to Docs', group: 'Go to' })
  useShortcut('g h', () => navigate('/chat'), { description: 'Go to Chat', group: 'Go to' })
  useShortcut('g s', () => navigate('/settings'), { description: 'Go to Settings', group: 'Go to' })
  useShortcut(
    'q',
    () => {
      if (!['today', undefined].includes(route.parts[0])) navigate('/today')
      setTimeout(() => window.dispatchEvent(new CustomEvent('lumen:quick-add')), 50)
    },
    { description: 'Add a task' },
  )

  return (
    <div className={`app${collapsed ? ' is-collapsed' : ''}${drawer ? ' has-drawer' : ''}`}>
      <a className="skip-link" href="#main" onClick={(e) => {
        e.preventDefault()
        document.getElementById('main')?.focus()
      }}>
        Skip to content
      </a>
      <Sidebar route={route} onNavigate={() => setDrawer(false)} />
      <div className="drawer-scrim" onClick={() => setDrawer(false)} aria-hidden="true" />
      <main id="main" className="main" tabIndex={-1}>
        <button type="button" className="drawer-toggle" aria-label="Open menu" onClick={() => setDrawer(true)}>
          <MenuIcon size={18} />
        </button>
        <Suspense
          fallback={
            <div className="view-loading">
              <Spinner size={16} />
            </div>
          }
        >
          <ViewBoundary path={page.path}>
            <View route={page} />
          </ViewBoundary>
        </Suspense>
      </main>
      {settings && (
        <Suspense fallback={null}>
          <SettingsView route={route} onClose={() => {
              const q = new URLSearchParams(behind.current.query).toString()
              navigate(`${behind.current.path}${q ? `?${q}` : ''}`)
            }} />
        </Suspense>
      )}
      <PluginFrames />
      <CommandPalette />
      <ShortcutsDialog />
      <Toaster toasts={toasts} onDismiss={dismiss} />
    </div>
  )
}
