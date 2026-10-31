// What the workspace button at the top of the sidebar opens: who you are and
// where Lumen keeps your work, the look in one tap, and the places you go from
// here: settings, your account, shortcuts, and signing out.
import { useState } from 'react'
import { ChevronDown, Info, Keyboard, LogOut, Monitor, Moon, Settings, Sun, UserRound } from 'lucide-react'
import { Avatar, Kbd, Popover } from '../components/ui/index.js'
import { useSession } from '../store/session.js'
import { useUI } from '../store/ui.js'
import { setPrefs, usePrefs } from '../store/prefs.js'
import { navigate } from '../lib/router.js'

const WHERE = {
  desktop: () => 'On this computer',
  github: (s) => (s.github ? `GitHub · ${s.github.owner}/${s.github.repo}` : 'GitHub'),
  server: (s) => s.user?.email || 'Lumen server',
}

export function AccountMenu({ workspace }) {
  const session = useSession()
  const prefs = usePrefs()
  const [anchor, setAnchor] = useState(null)
  const { user, mode } = session
  const close = () => setAnchor(null)
  const go = (fn) => () => {
    close()
    fn()
  }
  const item = (Icon, label, run, keys) => (
    <button type="button" className="acct-item" role="menuitem" onClick={go(run)}>
      <Icon size={15} />
      <span>{label}</span>
      {keys && <Kbd keys={keys} />}
    </button>
  )
  return (
    <>
      <button type="button" className={`workspace-button${anchor ? ' is-open' : ''}`} aria-haspopup="menu" aria-expanded={!!anchor} onClick={(e) => setAnchor(anchor ? null : { current: e.currentTarget })}>
        <span className="workspace-mark">{(workspace || 'L').trim()[0]?.toUpperCase()}</span>
        <span className="workspace-name">{workspace}</span>
        <ChevronDown size={14} className="workspace-chevron" />
      </button>
      <Popover open={!!anchor} onOpenChange={(o) => !o && close()} anchor={anchor} placement="bottom-start" className="acct" aria-label="Account">
        <div className="acct-who">
          <Avatar name={user?.name || user?.handle} size={36} />
          <div className="acct-who-text">
            <b>{user?.name || user?.handle}</b>
            <span>{(WHERE[mode] || WHERE.server)(session)}</span>
          </div>
        </div>
        <div className="acct-theme" role="radiogroup" aria-label="Theme">
          {[
            ['light', 'Light', Sun],
            ['dark', 'Dark', Moon],
            ['system', 'System', Monitor],
          ].map(([v, label, Icon]) => (
            <button key={v} type="button" role="radio" aria-checked={prefs.theme === v} className={prefs.theme === v ? 'on' : ''} onClick={() => setPrefs({ theme: v })}>
              <Icon size={14} />
              {label}
            </button>
          ))}
        </div>
        <div className="acct-items" role="menu">
          {item(Settings, 'Settings', () => navigate('/settings/appearance'), ['Ctrl', ','])}
          {mode !== 'desktop' && item(UserRound, 'Your account', () => navigate('/settings/account'))}
          {item(Keyboard, 'Keyboard shortcuts', () => useUI.setState({ shortcutsOpen: true }), ['?'])}
          {item(Info, 'About Lumen', () => navigate('/settings/about'))}
        </div>
        {(mode === 'server' || mode === 'github') && (
          <div className="acct-items acct-out" role="menu">
            {mode === 'server'
              ? item(LogOut, 'Sign out', () => session.logout().then(() => navigate('/signin')))
              : item(LogOut, 'Disconnect GitHub', () => session.disconnectGitHub())}
          </div>
        )}
      </Popover>
    </>
  )
}
