// The top of the sidebar: the space you're in, and only that (you and your
// account are at the bottom). It opens the list of spaces to move between,
// each saying what it is: your candle, your workspaces, and what each person
// shared with you. Below the list, making a workspace or joining one (with an
// account), or how to get one (without); last, what the space you're in offers.
import { useState } from 'react'
import { Check, ChevronDown, Cloud, Database, FolderGit2, GitBranch, Link2, Plus, Puzzle, UserPlus } from 'lucide-react'
import { Button, Dialog, Field, Input, Popover } from '../components/ui/index.js'
import { useSession, useHasAccount } from '../store/session.js'
import { useSpaces, useCurrentSpace } from '../store/spaces.js'
import { api } from '../lib/api.js'
import { navigate } from '../lib/router.js'

// what a space is, in a few words, under its name
function spaceKind(space, account) {
  if (space.kind === 'candle') return account ? 'Private to you' : 'On this computer'
  if (space.kind === 'shared') return 'Shared with you'
  return space.role === 'owner' ? 'Workspace you own' : space.role === 'admin' ? 'Workspace you run' : 'Workspace'
}

export function WorkspaceMark({ name, size, kind }) {
  return (
    <span className={`workspace-mark${kind ? ` is-${kind}` : ''}`} style={size ? { width: size, height: size, fontSize: Math.round(size * 0.5), borderRadius: Math.round(size * 0.28) } : undefined} aria-hidden="true">
      {(name || 'L').trim()[0]?.toUpperCase()}
    </span>
  )
}

const spaceName = (s, user) => (s.kind === 'candle' ? s.name || `${user?.name || 'My'}’s candle` : s.name)

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
  const mode = useSession((s) => s.mode)
  const user = useSession((s) => s.user)
  const account = useHasAccount()
  const spaces = useSpaces((s) => s.list)
  const current = useCurrentSpace()
  const [anchor, setAnchor] = useState(null)
  const [dialog, setDialog] = useState(null) // 'new' | 'join'
  const manager = current.kind === 'candle' || current.role === 'owner' || current.role === 'admin'
  const name = spaceName(current, user)
  const close = () => setAnchor(null)
  const item = (Icon, label, onClick) => (
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
    </button>
  )
  const go = (to) => () => navigate(to)
  const groups = [
    ['Your candle', spaces.filter((s) => s.kind === 'candle')],
    ['Workspaces', spaces.filter((s) => s.kind === 'workspace')],
    ['Shared with you', spaces.filter((s) => s.kind === 'shared')],
  ].filter(([, list]) => list.length)
  const here = [
    current.kind !== 'shared' && item(Database, 'Settings', go('/settings/workspace')),
    account && current.kind === 'workspace' && item(UserPlus, manager ? 'Members and invites' : 'Members', go('/settings/members')),
    current.kind === 'candle' && item(Puzzle, 'Plugins', go('/settings/plugins')),
    account && manager && current.kind !== 'shared' && item(FolderGit2, 'Copy on GitHub', go('/settings/github')),
    mode === 'desktop' && current.kind === 'candle' && item(GitBranch, 'Sync', go('/settings/sync')),
  ].filter(Boolean)
  return (
    <>
      <button type="button" className={`workspace-button${compact ? ' is-compact' : ''}${anchor ? ' is-open' : ''}`} aria-haspopup="menu" aria-expanded={!!anchor} aria-label={compact ? `${name}, switch space` : undefined} onClick={(e) => setAnchor(anchor ? null : { current: e.currentTarget })}>
        <WorkspaceMark name={name} kind={current.kind} />
        {!compact && (
          <>
            <span className="workspace-text">
              <span className="workspace-name">{name}</span>
              <span className="workspace-kind">{spaceKind(current, account)}</span>
            </span>
            <ChevronDown size={14} className="workspace-chevron" />
          </>
        )}
      </button>
      <Popover open={!!anchor} onOpenChange={(o) => !o && close()} anchor={anchor} placement="bottom-start" className="acct space-menu" aria-label="Spaces">
        <div className="space-list" role="menu" aria-label="Switch to">
          {groups.map(([label, list]) => (
            <div key={label} className="space-group" role="group" aria-label={label}>
              <div className="space-group-label">{label}</div>
              {list.map((s) => {
                const on = s.prefix === current.prefix
                return (
                  <button
                    key={s.prefix}
                    type="button"
                    className={`space-item${on ? ' is-current' : ''}`}
                    role="menuitemradio"
                    aria-checked={on}
                    onClick={() => {
                      close()
                      if (!on) useSpaces.getState().open(s.prefix)
                    }}
                  >
                    <WorkspaceMark name={spaceName(s, user)} kind={s.kind} size={28} />
                    <span className="space-text">
                      <span className="space-name">{spaceName(s, user)}</span>
                      <span className="space-kind">{s.kind === 'shared' ? `From ${s.name}` : spaceKind(s, account)}</span>
                    </span>
                    {on && <Check size={15} className="space-check" aria-hidden="true" />}
                  </button>
                )
              })}
            </div>
          ))}
        </div>
        {account ? (
          <div className="space-make">
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                close()
                setDialog('new')
              }}
            >
              <Plus size={14} /> New workspace
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                close()
                setDialog('join')
              }}
            >
              <Link2 size={14} /> Join with a link
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="space-account"
            role="menuitem"
            onClick={() => {
              close()
              navigate('/settings/account')
            }}
          >
            <Cloud size={15} />
            <span>
              <b>Work with others</b>
              <span>Sign in to a Lumen server for workspaces, sharing and chat.</span>
            </span>
          </button>
        )}
        {here.length > 0 && (
          <div className="acct-items space-here" role="menu" aria-label={name}>
            <div className="space-group-label">{name}</div>
            {here}
          </div>
        )}
      </Popover>
      <NewWorkspace open={dialog === 'new'} onClose={() => setDialog(null)} />
      <JoinWorkspace open={dialog === 'join'} onClose={() => setDialog(null)} />
    </>
  )
}
