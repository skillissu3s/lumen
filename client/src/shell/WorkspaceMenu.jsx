// The top of the sidebar: the space you're in, and only that (you and your
// account are at the bottom). It opens the list of spaces to move between:
// your candle, your workspaces, and what each person shared with you, with
// making a new workspace and joining one with a link; then what this space
// offers (its settings, its people, plugins, its copy on GitHub).
import { useState } from 'react'
import { Check, ChevronDown, Database, FolderGit2, GitBranch, Link2, Plus, Puzzle, UserPlus } from 'lucide-react'
import { Button, Dialog, Field, Input, Popover } from '../components/ui/index.js'
import { useSession } from '../store/session.js'
import { useSpaces, useCurrentSpace } from '../store/spaces.js'
import { api } from '../lib/api.js'
import { navigate } from '../lib/router.js'

export function workspaceWhere(session, space) {
  const { mode, cloud } = session
  if (mode === 'desktop') return cloud?.linked ? cloud.server.replace(/^https?:\/\//, '') : 'On this computer'
  if (space?.kind === 'candle') return 'Your candle, private to you'
  if (space?.kind === 'shared') return 'Shared with you'
  return space?.role === 'owner' ? 'Workspace you own' : 'Workspace'
}

export function WorkspaceMark({ name, size, kind }) {
  return (
    <span className={`workspace-mark${kind ? ` is-${kind}` : ''}`} style={size ? { width: size, height: size, fontSize: Math.round(size * 0.5), borderRadius: Math.round(size * 0.28) } : undefined} aria-hidden="true">
      {(name || 'L').trim()[0]?.toUpperCase()}
    </span>
  )
}

const spaceName = (s, user) => (s.kind === 'candle' ? s.name || `${user?.name || 'My'}’s candle` : s.kind === 'shared' ? `Shared by ${s.name}` : s.name)

// a link (or just its token) → the token
const tokenOf = (text) => {
  const t = String(text || '').trim()
  return /#\/join\/([\w-]+)/.exec(t)?.[1] || (/^[\w-]{16,}$/.test(t) ? t : null)
}

function NewWorkspace({ open, onClose }) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const r = await api('POST', '/spaces', { name })
      await useSpaces.getState().load()
      setName('')
      onClose()
      useSpaces.getState().open(r.space.prefix)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="sm"
      title="New workspace"
      description="A place to share boards, calendars, docs and chat with people you invite. Your candle stays yours."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="new-workspace" loading={busy} disabled={!name.trim()}>
            Create
          </Button>
        </>
      }
    >
      <form id="new-workspace" className="set-form" onSubmit={submit}>
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Launch team" autoFocus />
        </Field>
        {error && <p className="auth-error">{error}</p>}
      </form>
    </Dialog>
  )
}

function JoinWorkspace({ open, onClose }) {
  const [link, setLink] = useState('')
  const token = tokenOf(link)
  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="sm"
      title="Join a workspace"
      description="Paste the invite link someone sent you."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!token}
            onClick={() => {
              setLink('')
              onClose()
              navigate(`/join/${token}`)
            }}
          >
            Continue
          </Button>
        </>
      }
    >
      <Field label="Invite link">
        <Input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://…/app.html#/join/…" autoFocus spellCheck={false} />
      </Field>
    </Dialog>
  )
}

/** `compact`: just the space's mark, for the rail */
export function WorkspaceMenu({ compact = false }) {
  const session = useSession()
  const spaces = useSpaces((s) => s.list)
  const current = useCurrentSpace()
  const [anchor, setAnchor] = useState(null)
  const [dialog, setDialog] = useState(null) // 'new' | 'join'
  const { mode, user } = session
  const server = mode === 'server'
  const manager = current.kind === 'candle' || current.role === 'owner' || current.role === 'admin'
  const name = spaceName(current, user)
  const close = () => setAnchor(null)
  const item = (Icon, label, onClick, extra) => (
    <button
      type="button"
      className="acct-item"
      role="menuitem"
      onClick={() => {
        close()
        onClick()
      }}
    >
      <Icon size={15} />
      <span>{label}</span>
      {extra}
    </button>
  )
  const go = (to) => () => navigate(to)
  const groups = [
    ['', spaces.filter((s) => s.kind === 'candle')],
    ['Workspaces', spaces.filter((s) => s.kind === 'workspace')],
    ['Shared with you', spaces.filter((s) => s.kind === 'shared')],
  ].filter(([, list]) => list.length)
  return (
    <>
      <button type="button" className={`workspace-button${compact ? ' is-compact' : ''}${anchor ? ' is-open' : ''}`} aria-haspopup="menu" aria-expanded={!!anchor} aria-label={compact ? name : undefined} onClick={(e) => setAnchor(anchor ? null : { current: e.currentTarget })}>
        <WorkspaceMark name={name} kind={current.kind} />
        {!compact && (
          <>
            <span className="workspace-name">{name}</span>
            <ChevronDown size={14} className="workspace-chevron" />
          </>
        )}
      </button>
      <Popover open={!!anchor} onOpenChange={(o) => !o && close()} anchor={anchor} placement="bottom-start" className="acct space-menu" aria-label="Spaces">
        <div className="acct-who">
          <WorkspaceMark name={name} kind={current.kind} size={36} />
          <div className="acct-who-text">
            <b>{name}</b>
            <span>{workspaceWhere(session, current)}</span>
          </div>
        </div>
        <div className="acct-items" role="menu">
          {current.kind !== 'shared' && item(Database, current.kind === 'candle' ? 'Candle settings' : 'Workspace settings', go('/settings/workspace'))}
          {server && current.kind === 'workspace' && item(UserPlus, manager ? 'Members and invites' : 'Members', go('/settings/members'))}
          {current.kind === 'candle' && item(Puzzle, 'Plugins', go('/settings/plugins'))}
          {server && manager && current.kind !== 'shared' && item(FolderGit2, 'Copy on GitHub', go('/settings/github'))}
          {mode === 'desktop' && item(GitBranch, 'Sync', go('/settings/sync'))}
        </div>
        {(server || spaces.length > 1) && (
          <div className="acct-items space-list" role="menu" aria-label="Move to">
            {groups.map(([label, list]) => (
              <div key={label || 'candle'} className="space-group">
                {label && <div className="space-group-label">{label}</div>}
                {list.map((s) => (
                  <button
                    key={s.prefix}
                    type="button"
                    className={`acct-item space-item${s.prefix === current.prefix ? ' is-current' : ''}`}
                    role="menuitemradio"
                    aria-checked={s.prefix === current.prefix}
                    onClick={() => {
                      close()
                      if (s.prefix !== current.prefix) useSpaces.getState().open(s.prefix)
                    }}
                  >
                    <WorkspaceMark name={spaceName(s, user)} kind={s.kind} size={20} />
                    <span>{spaceName(s, user)}</span>
                    {s.prefix === current.prefix && <Check size={14} className="space-check" />}
                  </button>
                ))}
              </div>
            ))}
            {server && item(Plus, 'New workspace…', () => setDialog('new'))}
            {server && item(Link2, 'Join with a link…', () => setDialog('join'))}
          </div>
        )}
      </Popover>
      <NewWorkspace open={dialog === 'new'} onClose={() => setDialog(null)} />
      <JoinWorkspace open={dialog === 'join'} onClose={() => setDialog(null)} />
    </>
  )
}
