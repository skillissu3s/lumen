// Boot: find out where we are (server, desktop or GitHub mode), sign in, load
// the workspace, then show the app.
import { useEffect } from 'react'
import { useSession } from './store/session.js'
import { useWorkspace } from './store/workspace.js'
import { usePrefs, applyTheme } from './store/prefs.js'
import { useRoute, navigate } from './lib/router.js'
import { connectSocket } from './lib/socket.js'
import { AcceptInvite, BootError, BootScreen, ConnectGitHub, ForgotPassword, SignIn, Setup } from './auth/AuthScreens.jsx'
import { AppShell } from './shell/AppShell.jsx'

const AUTH_ROUTES = ['signin', 'setup', 'invite', 'github', 'forgot']

export default function App() {
  const status = useSession((s) => s.status)
  const mode = useSession((s) => s.mode)
  const user = useSession((s) => s.user)
  const error = useSession((s) => s.error)
  const wsStatus = useWorkspace((s) => s.status)
  const wsError = useWorkspace((s) => s.error)
  const prefs = usePrefs()
  const route = useRoute()

  useEffect(() => {
    useSession.getState().boot()
    if (window.lumenDesktop?.titleBar) document.documentElement.classList.add('is-desktop-titlebar')
  }, [])

  // signed in: open the workspace once per session
  useEffect(() => {
    if (status !== 'ready') return
    const ws = useWorkspace.getState()
    ws.initWorkspace({ backend: useSession.getState().backend(), user, mode })
    ws.load()
    if (mode === 'server' || mode === 'desktop') connectSocket()
    if (AUTH_ROUTES.includes(route.parts[0])) navigate('/today', { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, mode, user?.handle])

  useEffect(() => applyTheme(prefs), [prefs.theme, prefs.palette, prefs.accent, prefs.density]) // eslint-disable-line react-hooks/exhaustive-deps

  // the desktop window's title bar follows the theme
  useEffect(() => {
    const d = window.lumenDesktop
    if (!d?.setTitleBarColors) return
    const css = getComputedStyle(document.documentElement)
    d.setTitleBarColors({ color: css.getPropertyValue('--bg-subtle').trim(), symbolColor: css.getPropertyValue('--text-muted').trim() })
  }, [prefs.theme, prefs.palette, status])

  if (status === 'booting') return <BootScreen />
  if (status === 'error') return <BootError message={error} onRetry={() => useSession.getState().boot()} />

  if (status !== 'ready') {
    const [first, second] = route.parts
    if (first === 'invite' && second) return <AcceptInvite token={second} />
    if (status === 'needs-setup') return <Setup />
    if (first === 'forgot' && mode === 'server') return <ForgotPassword />
    if (first === 'github' || mode === 'github') return <ConnectGitHub />
    return <SignIn />
  }

  if (wsStatus === 'error') return <BootError message={wsError} onRetry={() => useWorkspace.getState().load()} />
  if (wsStatus !== 'ready') return <BootScreen />
  return <AppShell route={route} />
}
