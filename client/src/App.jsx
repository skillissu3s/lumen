// Boot: find out where we are (a Lumen server, or the desktop app's own), sign
// in, load the workspace, then show the app. Nothing shows before signing in.
import { useEffect } from 'react'
import { useUI } from './store/ui.js'
import { useSession } from './store/session.js'
import { useWorkspace } from './store/workspace.js'
import { rememberedSpace } from './store/spaces.js'
import { usePrefs, applyTheme } from './store/prefs.js'
import { useRoute, navigate } from './lib/router.js'
import { connectSocket, onSocket } from './lib/socket.js'
import { AcceptInvite, BootError, BootScreen, DesktopWelcome, FinishProfile, ForgotPassword, NoServer, SignIn, Setup } from './auth/AuthScreens.jsx'
import { AppShell } from './shell/AppShell.jsx'
import JoinPage, { pendingJoin } from './auth/JoinPage.jsx'
import AuthorizePage, { pendingAuthorize, rememberAuthorize } from './auth/AuthorizePage.jsx'

const AUTH_ROUTES = ['signin', 'setup', 'invite', 'forgot']

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
    ws.initWorkspace({ backend: useSession.getState().backend(), user, mode, space: mode === 'server' ? rememberedSpace() : '' })
    ws.load({ offline: useSession.getState().offline })
    if (mode === 'server' || mode === 'desktop') connectSocket()
    // the desktop app's syncing with a Lumen server, as it goes
    const off = mode === 'desktop' ? onSocket('cloud', (msg) => useSession.setState({ cloud: msg.status })) : null
    if (AUTH_ROUTES.includes(route.parts[0])) navigate('/today', { replace: true })
    // a workspace link opened before signing in carries on now
    const join = pendingJoin()
    if (join) navigate(`/join/${join}`, { replace: true })
    // an app asked to connect while you were signed out: back to its approval
    const authorize = pendingAuthorize()
    if (authorize) navigate(authorize, { replace: true })
    return () => off?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, mode, user?.handle])

  // an admin hears once that the server started with an empty database
  useEffect(() => {
    const at = useSession.getState().info?.freshAt
    if (status !== 'ready' || !at) return
    const key = `lumen.fresh.${at}`
    try {
      if (localStorage.getItem(key)) return
      localStorage.setItem(key, '1')
    } catch {
      /* storage unavailable: say it anyway */
    }
    const day = new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'long' })
    useUI.getState().toast(`This server started with an empty database on ${day}. If it had data before, its data folder isn’t kept between updates: see “Self-hosted” in the README.`, { tone: 'danger', timeout: 600000 })
  }, [status])

  useEffect(() => applyTheme(prefs), [prefs.theme, prefs.palette, prefs.accent, prefs.density]) // eslint-disable-line react-hooks/exhaustive-deps

  // the desktop window's title bar follows the theme
  useEffect(() => {
    const d = window.lumenDesktop
    if (!d?.setTitleBarColors) return
    const css = getComputedStyle(document.documentElement)
    d.setTitleBarColors({ color: css.getPropertyValue('--bg-subtle').trim(), symbolColor: css.getPropertyValue('--text-muted').trim(), theme: prefs.theme })
  }, [prefs.theme, prefs.palette, status])

  if (status === 'booting') return <BootScreen />
  if (status === 'error') return <BootError message={error} onRetry={() => useSession.getState().boot()} />
  if (status === 'no-server') return <NoServer />
  if (status === 'choose') return <DesktopWelcome />

  if (status !== 'ready') {
    const [first, second] = route.parts
    if (first === 'invite' && second) return <AcceptInvite token={second} />
    if (first === 'join' && second && mode === 'server') return <JoinPage token={second} />
    if (status === 'needs-setup') return <Setup />
    if (first === 'forgot' && mode === 'server') return <ForgotPassword />
    if (first === 'authorize') rememberAuthorize()
    return <SignIn />
  }

  if (user?.needsProfile) return <FinishProfile />
  if (wsStatus === 'error') return <BootError message={wsError} onRetry={() => useWorkspace.getState().load()} />
  if (wsStatus !== 'ready') return <BootScreen />
  if (route.parts[0] === 'join' && route.parts[1]) return <JoinPage token={route.parts[1]} />
  if (route.parts[0] === 'authorize') return <AuthorizePage query={route.query} />
  return <AppShell route={route} />
}
