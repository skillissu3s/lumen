// The top of the sidebar: the workspace, and only the workspace. What it opens
// is about the shared place (its settings, who is in it, plugins, its copy on
// GitHub); you and your account are at the bottom of the sidebar.
import { useState } from 'react'
import { ChevronDown, Database, FolderGit2, GitBranch, Puzzle, UserPlus } from 'lucide-react'
import { Popover } from '../components/ui/index.js'
import { useSession } from '../store/session.js'
import { navigate } from '../lib/router.js'

export function workspaceWhere(session) {
  const { mode, cloud } = session
  if (mode === 'desktop') return cloud?.linked ? cloud.server.replace(/^https?:\/\//, '') : 'On this computer'
  return location.host || 'Lumen server'
}

export function WorkspaceMark({ name, size }) {
  return (
    <span className="workspace-mark" style={size ? { width: size, height: size, fontSize: Math.round(size * 0.5), borderRadius: Math.round(size * 0.28) } : undefined} aria-hidden="true">
      {(name || 'L').trim()[0]?.toUpperCase()}
    </span>
  )
}

/** `compact`: just the workspace's mark, for the rail */
export function WorkspaceMenu({ workspace, compact = false }) {
  const session = useSession()
  const [anchor, setAnchor] = useState(null)
  const { mode, user } = session
  const admin = user?.role === 'admin'
  const close = () => setAnchor(null)
  const item = (Icon, label, to) => (
    <button
      type="button"
      className="acct-item"
      role="menuitem"
      onClick={() => {
        close()
        navigate(to)
      }}
    >
      <Icon size={15} />
      <span>{label}</span>
    </button>
  )
  return (
    <>
      <button type="button" className={`workspace-button${compact ? ' is-compact' : ''}${anchor ? ' is-open' : ''}`} aria-haspopup="menu" aria-expanded={!!anchor} aria-label={compact ? workspace : undefined} onClick={(e) => setAnchor(anchor ? null : { current: e.currentTarget })}>
        <WorkspaceMark name={workspace} />
        {!compact && (
          <>
            <span className="workspace-name">{workspace}</span>
            <ChevronDown size={14} className="workspace-chevron" />
          </>
        )}
      </button>
      <Popover open={!!anchor} onOpenChange={(o) => !o && close()} anchor={anchor} placement="bottom-start" className="acct" aria-label="Workspace">
        <div className="acct-who">
          <WorkspaceMark name={workspace} size={36} />
          <div className="acct-who-text">
            <b>{workspace}</b>
            <span>{workspaceWhere(session)}</span>
          </div>
        </div>
        <div className="acct-items" role="menu">
          {item(Database, 'Workspace settings', '/settings/workspace')}
          {mode === 'server' && admin && item(UserPlus, 'Invite people', '/settings/members')}
          {item(Puzzle, 'Plugins', '/settings/plugins')}
          {mode === 'server' && item(FolderGit2, 'Copy on GitHub', '/settings/github')}
          {mode === 'desktop' && item(GitBranch, 'Sync', '/settings/sync')}
        </div>
      </Popover>
    </>
  )
}
