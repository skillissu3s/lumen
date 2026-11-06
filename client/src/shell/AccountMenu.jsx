// The bottom of the sidebar: you. Your avatar and name open who you are, the
// look in one tap, and the places you go from here: your profile, settings,
// shortcuts, and signing out. The workspace has its own menu at the top.
import { useState } from 'react'
import { ChevronsUpDown, Info, Keyboard, LogOut, Monitor, Moon, Settings, Sun, UserRound } from 'lucide-react'
import { Kbd, Popover, UserAvatar } from '../components/ui/index.js'
import { useSession } from '../store/session.js'
import { useUI } from '../store/ui.js'
import { setPrefs, usePrefs } from '../store/prefs.js'
import { navigate } from '../lib/router.js'

const mod = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform) ? '⌘' : 'Ctrl'

function whoLine(session) {
  const { user, mode, cloud } = session
  if (mode === 'desktop') return cloud?.linked && cloud.user ? `@${cloud.user.handle}` : 'On this computer'
  return [user?.handle && `@${user.handle}`, user?.email].filter(Boolean).join(' · ')
}

/** `compact`: just the avatar, for the rail */
export function AccountMenu({ compact = false }) {
  const session = useSession()
  const prefs = usePrefs()
  const [anchor, setAnchor] = useState(null)
  const { user, mode } = session
  const name = user?.name || user?.handle
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
      <button type="button" className={`account-button${compact ? ' is-compact' : ''}`} aria-haspopup="menu" aria-expanded={!!anchor} aria-label={compact ? `${name}: account` : undefined} onClick={(e) => setAnchor(anchor ? null : { current: e.currentTarget })}>
        <UserAvatar user={user} size={compact ? 26 : 24} />
        {!compact && (
          <>
            <span className="account-name">{name}</span>
            <ChevronsUpDown size={13} className="account-chevron" />
          </>
        )}
      </button>
      <Popover open={!!anchor} onOpenChange={(o) => !o && close()} anchor={anchor} placement={compact ? 'right-end' : 'top-start'} className="acct" aria-label="Account">
        <div className="acct-who">
          <UserAvatar user={user} size={36} />
          <div className="acct-who-text">
            <b>{name}</b>
            <span>{whoLine(session)}</span>
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
          {item(UserRound, 'Profile and account', () => navigate('/settings/account'))}
          {item(Settings, 'Settings', () => navigate('/settings/appearance'), [mod, ','])}
          {item(Keyboard, 'Keyboard shortcuts', () => useUI.setState({ shortcutsOpen: true }), ['?'])}
          {item(Info, 'About Lumen', () => navigate('/settings/about'))}
        </div>
        {mode === 'server' && (
          <div className="acct-items acct-out" role="menu">
            {item(LogOut, 'Sign out', () => session.logout().then(() => navigate('/signin')))}
          </div>
        )}
      </Popover>
    </>
  )
}
