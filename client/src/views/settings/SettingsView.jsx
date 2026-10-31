// Settings: one page per topic, saved as you change them.
import { lazy, Suspense, useEffect, useState } from 'react'
import { Copy, ExternalLink, FolderOpen, RefreshCw, Trash2 } from 'lucide-react'
import { Avatar, Button, Dialog, Field, Input, Kbd, Segmented, Select, Spinner, Switch } from '../../components/ui/index.js'
import { useSession } from '../../store/session.js'
import { useWorkspace } from '../../store/workspace.js'
import { useUI } from '../../store/ui.js'
import { usePrefs, setPrefs } from '../../store/prefs.js'
import { useCalendars, useConfig, useLists } from '../../store/hooks.js'
import { api } from '../../lib/api.js'
import { navigate } from '../../lib/router.js'
import { relativeDay, isoOf, timeOf } from '../../../../shared/dates.js'
import { shortcutList, comboKeys } from '../../shell/shortcuts.js'
import { Customize } from '../calendar/CalendarView.jsx'
import { useUpdateState } from '../../shell/UpdateNotice.jsx'
import './settings.css'

const PluginSettings = lazy(() => import('./PluginSettings.jsx'))

const ACCENTS = ['indigo', 'blue', 'teal', 'green', 'orange', 'rose', 'violet', 'graphite']
const ACCENT_HEX = { indigo: '#5b5bd6', blue: '#0b6bcb', teal: '#0d7f72', green: '#18794e', orange: '#c2410c', rose: '#c62a5a', violet: '#7c3aed', graphite: '#3a3a37' }

function Section({ title, description, children }) {
  return (
    <section className="set-section">
      <div className="set-section-head">
        <h2>{title}</h2>
        {description && <p className="muted">{description}</p>}
      </div>
      <div className="set-section-body">{children}</div>
    </section>
  )
}

function Row({ label, hint, children }) {
  return (
    <div className="set-row">
      <div className="set-row-label">
        <span>{label}</span>
        {hint && <span className="set-hint">{hint}</span>}
      </div>
      <div className="set-row-control">{children}</div>
    </div>
  )
}

const when = (ms) => (ms ? `${relativeDay(isoOf(new Date(ms)))} at ${timeOf(new Date(ms))}` : 'never')

function Account() {
  const mode = useSession((s) => s.mode)
  const user = useSession((s) => s.user)
  const github = useSession((s) => s.github)
  const disconnect = useSession((s) => s.disconnectGitHub)
  const toast = useUI((s) => s.toast)
  const [name, setName] = useState(user?.name || '')
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' })
  const [error, setError] = useState('')
  const [confirm, setConfirm] = useState(false)

  if (mode === 'github')
    return (
      <Section title="Account" description="You’re using Lumen with a GitHub repository. Nothing about you is stored anywhere else.">
        <Row label="Signed in as">
          <span className="set-value">
            <Avatar name={user?.name} size={22} /> {user?.name} <span className="faint">@{user?.handle}</span>
          </span>
        </Row>
        <Row label="Repository">
          <a href={`https://github.com/${github?.owner}/${github?.repo}`} target="_blank" rel="noopener noreferrer" className="set-value">
            {github?.owner}/{github?.repo} <span className="faint">· {github?.branch}</span> <ExternalLink size={12} />
          </a>
        </Row>
        <Row label="This browser" hint="Removes the token from this browser. Your data stays in the repository.">
          <Button variant="danger" onClick={() => setConfirm(true)}>
            Disconnect
          </Button>
        </Row>
        <Dialog
          open={confirm}
          onClose={() => setConfirm(false)}
          size="sm"
          title="Disconnect GitHub?"
          description="Unsaved changes are kept until they reach GitHub; once everything says Saved, it’s safe."
          footer={
            <>
              <Button variant="ghost" onClick={() => setConfirm(false)}>
                Cancel
              </Button>
              <Button variant="danger" onClick={() => disconnect()}>
                Disconnect
              </Button>
            </>
          }
        />
      </Section>
    )
  if (mode === 'desktop')
    return (
      <Section title="Account" description="The desktop app runs for you alone on this computer — there is no account to manage.">
        <Row label="Name">
          <span className="set-value">{user?.name}</span>
        </Row>
      </Section>
    )
  return (
    <>
      <Section title="Profile">
        <Row label="Name">
          <div className="set-inline">
            <Input value={name} onChange={(e) => setName(e.target.value)} aria-label="Name" />
            <Button
              disabled={!name.trim() || name === user?.name}
              onClick={async () => {
                const r = await api('PATCH', '/me', { name })
                useSession.setState({ user: { ...user, ...r.user } })
                toast('Name saved')
              }}
            >
              Save
            </Button>
          </div>
        </Row>
        <Row label="Email">
          <span className="set-value">{user?.email}</span>
        </Row>
        <Row label="Handle" hint="How people mention you in chat.">
          <span className="set-value">@{user?.handle}</span>
        </Row>
      </Section>
      <Section title="Password">
        <form
          className="set-form"
          onSubmit={async (e) => {
            e.preventDefault()
            setError('')
            if (pw.next !== pw.confirm) return setError('The new passwords don’t match.')
            try {
              await api('POST', '/me/password', { current: pw.current, next: pw.next })
              setPw({ current: '', next: '', confirm: '' })
              toast('Password changed')
            } catch (err) {
              setError(err.message)
            }
          }}
        >
          <Field label="Current password">
            <Input type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} />
          </Field>
          <Field label="New password" hint="At least 8 characters.">
            <Input type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />
          </Field>
          <Field label="Confirm new password" error={error}>
            <Input type="password" autoComplete="new-password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} />
          </Field>
          <div>
            <Button type="submit" disabled={!pw.current || !pw.next}>
              Change password
            </Button>
          </div>
        </form>
      </Section>
    </>
  )
}

function Appearance() {
  const prefs = usePrefs()
  return (
    <Section title="Appearance" description="How Lumen looks on this account, on every device.">
      <Row label="Theme">
        <Segmented label="Theme" value={prefs.theme} onChange={(v) => setPrefs({ theme: v })} options={[{ value: 'system', label: 'System' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]} />
      </Row>
      <Row label="Accent" hint="Used for focus, selection and today.">
        <div className="accents" role="radiogroup" aria-label="Accent">
          {ACCENTS.map((a) => (
            <button key={a} type="button" role="radio" aria-checked={prefs.accent === a} aria-label={a} className="accent-swatch" style={{ '--sw': ACCENT_HEX[a] }} onClick={() => setPrefs({ accent: a })} />
          ))}
        </div>
      </Row>
      <Row label="Density">
        <Segmented label="Density" value={prefs.density} onChange={(v) => setPrefs({ density: v })} options={[{ value: 'compact', label: 'Compact' }, { value: 'default', label: 'Default' }, { value: 'comfortable', label: 'Comfortable' }]} />
      </Row>
      <Row label="Time format">
        <Segmented label="Time format" value={prefs.timeFormat} onChange={(v) => setPrefs({ timeFormat: v })} options={[{ value: '24h', label: '13:00' }, { value: '12h', label: '1:00 PM' }]} />
      </Row>
      <Row label="Week starts on">
        <Segmented label="Week starts on" value={String(prefs.weekStart)} onChange={(v) => setPrefs({ weekStart: +v })} options={[{ value: '1', label: 'Monday' }, { value: '0', label: 'Sunday' }]} />
      </Row>
    </Section>
  )
}

function CalendarTab() {
  const prefs = usePrefs()
  const calendars = useCalendars()
  return (
    <Section title="Calendar" description="The same options as the calendar’s Customize panel.">
      <Customize c={prefs.calendar} prefs={prefs} calendars={calendars} title={false} />
    </Section>
  )
}

function TasksTab() {
  const prefs = usePrefs()
  const lists = useLists()
  return (
    <Section title="Tasks">
      <Row label="New tasks go to" hint="From Today, Upcoming and the Q shortcut.">
        <Select value={prefs.tasks.defaultList || ''} onChange={(e) => setPrefs({ tasks: { defaultList: e.target.value || null } })} options={[{ value: '', label: 'Inbox' }, ...lists.map((l) => ({ value: l.path, label: l.name }))]} />
      </Row>
      <Row label="Show completed tasks">
        <Switch checked={prefs.tasks.showCompleted} onChange={(v) => setPrefs({ tasks: { showCompleted: v } })} label="" />
      </Row>
      <Row label="New lists open as">
        <Segmented label="Default view" value={prefs.tasks.view} onChange={(v) => setPrefs({ tasks: { view: v } })} options={[{ value: 'list', label: 'List' }, { value: 'board', label: 'Board' }]} />
      </Row>
    </Section>
  )
}

function Members() {
  const me = useSession((s) => s.user)
  const toast = useUI((s) => s.toast)
  const [users, setUsers] = useState([])
  const [invites, setInvites] = useState([])
  const [form, setForm] = useState({ email: '', role: 'member', note: '' })
  const [link, setLink] = useState(null)
  const [remove, setRemove] = useState(null)
  const [error, setError] = useState('')
  const load = async () => {
    const [u, i] = await Promise.all([api('GET', '/admin/users'), api('GET', '/admin/invites')])
    setUsers(u.users)
    setInvites(i.invites.filter((x) => !x.usedAt && !x.expired))
  }
  useEffect(() => {
    load().catch(() => {})
  }, [])
  const patch = async (u, body) => {
    try {
      await api('PATCH', `/admin/users/${u.id}`, body)
      load()
    } catch (e) {
      toast(e.message, { tone: 'danger' })
    }
  }
  return (
    <>
      <Section title="Invite someone" description="Only admins can add people. The link works once and expires in 7 days.">
        <form
          className="invite-form"
          onSubmit={async (e) => {
            e.preventDefault()
            setError('')
            try {
              const r = await api('POST', '/admin/invites', { email: form.email || null, role: form.role, note: form.note })
              setLink({ url: r.url, emailed: r.emailed ? form.email : null })
              setForm({ email: '', role: 'member', note: '' })
              load()
            } catch (err) {
              setError(err.message)
            }
          }}
        >
          <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="Email (optional)" aria-label="Email" />
          <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} options={[{ value: 'member', label: 'Member' }, { value: 'admin', label: 'Admin' }]} aria-label="Role" />
          <Button type="submit" variant="primary">
            Create invite link
          </Button>
        </form>
        {error && <p className="auth-error">{error}</p>}
        {link?.emailed && <p className="invite-sent">Invite emailed to {link.emailed}. You can also share the link yourself:</p>}
        {link && (
          <div className="invite-link">
            <code>{link.url}</code>
            <Button
              icon={Copy}
              size="sm"
              onClick={() => {
                navigator.clipboard?.writeText(link.url)
                toast('Invite link copied')
              }}
            >
              Copy
            </Button>
          </div>
        )}
        {invites.length > 0 && (
          <div className="set-table">
            {invites.map((i) => (
              <div key={i.id} className="set-table-row">
                <span>{i.email || 'Anyone with the link'}</span>
                <span className="faint">{i.role}</span>
                <span className="faint">expires {relativeDay(isoOf(new Date(i.expiresAt))).toLowerCase()}</span>
                <Button size="sm" variant="ghost" onClick={() => api('DELETE', `/admin/invites/${i.id}`).then(load)}>
                  Revoke
                </Button>
              </div>
            ))}
          </div>
        )}
      </Section>
      <Section title="Members">
        <div className="set-table">
          {users.map((u) => (
            <div key={u.id} className={`set-table-row member${u.disabled ? ' is-disabled' : ''}`}>
              <span className="member-who">
                <Avatar name={u.name} size={26} />
                <span>
                  <span className="member-name">{u.name}</span>
                  <span className="faint">
                    {' '}
                    @{u.handle} · {u.email}
                  </span>
                </span>
              </span>
              {u.id === me?.id ? (
                <span className="faint">You · {u.role}</span>
              ) : (
                <>
                  <Select value={u.role} onChange={(e) => patch(u, { role: e.target.value })} options={[{ value: 'member', label: 'Member' }, { value: 'admin', label: 'Admin' }]} aria-label={`${u.name}'s role`} />
                  <Button size="sm" variant="ghost" onClick={() => patch(u, { disabled: !u.disabled })}>
                    {u.disabled ? 'Enable' : 'Disable'}
                  </Button>
                  <Button size="sm" variant="ghost" icon={Trash2} aria-label={`Remove ${u.name}`} onClick={() => setRemove(u)} />
                </>
              )}
            </div>
          ))}
        </div>
      </Section>
      <Dialog
        open={!!remove}
        onClose={() => setRemove(null)}
        size="sm"
        title={`Remove ${remove?.name}?`}
        description="They lose access right away. Lists and docs they own stay in the workspace."
        footer={
          <>
            <Button variant="ghost" onClick={() => setRemove(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={async () => {
                await api('DELETE', `/admin/users/${remove.id}`)
                setRemove(null)
                load()
              }}
            >
              Remove
            </Button>
          </>
        }
      />
    </>
  )
}

function Sync() {
  const mode = useSession((s) => s.mode)
  const github = useSession((s) => s.github)
  const saving = useWorkspace((s) => s.saving)
  const toast = useUI((s) => s.toast)
  const base = mode === 'desktop' ? '/desktop/sync' : '/admin/sync'
  const [cfg, setCfg] = useState(null)
  const [status, setStatus] = useState(null)
  const [form, setForm] = useState({ remote: '', branch: 'main', token: '', authorName: '', authorEmail: '', interval: 2, enabled: true })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [dir, setDir] = useState('')

  useEffect(() => {
    if (mode === 'github') return
    api('GET', base)
      .then((r) => {
        setCfg(r.config)
        setStatus(r.status)
        setForm((f) => ({ ...f, ...r.config, token: '' }))
      })
      .catch(() => {})
    if (mode === 'desktop') api('GET', '/desktop/workspace').then((r) => setDir(r.dir)).catch(() => {})
  }, [mode, base])

  if (mode === 'github')
    return (
      <Section title="Sync" description="In GitHub mode the repository is the storage: every change is a commit, made a moment after you stop typing.">
        <Row label="Repository">
          <span className="set-value">
            {github?.owner}/{github?.repo} · {github?.branch}
          </span>
        </Row>
        <Row label="Status">
          <span className="set-value">{saving.state === 'saved' ? 'Everything saved' : saving.state === 'offline' ? 'Offline — changes kept in this browser' : saving.state === 'error' ? saving.error : 'Saving…'}</span>
        </Row>
        <Row label="Changes made elsewhere" hint="Lumen checks for them every 30 seconds while open.">
          <Button icon={RefreshCw} onClick={() => useWorkspace.getState().load()}>
            Check now
          </Button>
        </Row>
      </Section>
    )

  const save = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const r = await api('PUT', base, { ...form, interval: +form.interval })
      setCfg(r.config)
      setStatus(r.status)
      setForm((f) => ({ ...f, token: '' }))
      toast('Sync settings saved')
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })
  return (
    <>
      {mode === 'desktop' && (
        <Section title="Workspace folder" description="Lumen keeps everything as plain files in this folder.">
          <Row label="Folder">
            <div className="set-inline">
              <code className="set-path">{dir}</code>
              <Button
                icon={FolderOpen}
                onClick={async () => {
                  const picked = await window.lumenDesktop?.pickFolder({ title: 'Choose a workspace folder', buttonLabel: 'Use this folder' })
                  if (!picked) return
                  await api('PUT', '/desktop/workspace', { dir: picked })
                  location.reload()
                }}
              >
                Change…
              </Button>
              <Button variant="ghost" onClick={() => window.lumenDesktop?.reveal(dir)}>
                Show
              </Button>
            </div>
          </Row>
        </Section>
      )}
      <Section title="GitHub sync" description="Commit changes to a GitHub repository and pull changes made elsewhere. Needs git installed.">
        <form className="set-form" onSubmit={save}>
          <Field label="Repository" hint="https://github.com/you/notes, or you/notes">
            <Input value={form.remote || ''} onChange={set('remote')} placeholder="owner/repository" spellCheck={false} />
          </Field>
          <div className="set-grid2">
            <Field label="Branch">
              <Input value={form.branch || ''} onChange={set('branch')} spellCheck={false} />
            </Field>
            <Field label="Pull every (minutes)">
              <Input type="number" min="1" max="120" value={form.interval} onChange={set('interval')} />
            </Field>
          </div>
          <Field label="Token" hint={cfg?.hasToken ? 'A token is saved. Leave empty to keep it.' : 'A fine-grained token with Contents: read and write.'}>
            <Input type="password" value={form.token} onChange={set('token')} placeholder={cfg?.hasToken ? '••••••••' : 'github_pat_…'} autoComplete="off" />
          </Field>
          <div className="set-grid2">
            <Field label="Commit author">
              <Input value={form.authorName || ''} onChange={set('authorName')} placeholder="Lumen" />
            </Field>
            <Field label="Author email">
              <Input value={form.authorEmail || ''} onChange={set('authorEmail')} placeholder="lumen@localhost" />
            </Field>
          </div>
          <Switch checked={!!form.enabled} onChange={(v) => setForm({ ...form, enabled: v })} label="Sync automatically" />
          {error && <p className="auth-error">{error}</p>}
          <div className="set-inline">
            <Button type="submit" variant="primary" loading={busy}>
              Save
            </Button>
            {cfg?.remote && (
              <Button
                icon={RefreshCw}
                onClick={async () => {
                  const r = await api('POST', `${base}/now`)
                  setStatus(r.status)
                }}
              >
                Sync now
              </Button>
            )}
          </div>
        </form>
        {status && status.state !== 'off' && (
          <p className={`sync-line is-${status.state}`}>
            {status.state === 'error' ? status.lastError : status.state === 'syncing' ? 'Syncing…' : `Last synced ${when(status.lastSync)}`}
          </p>
        )}
      </Section>
    </>
  )
}

function Workspace() {
  const config = useConfig()
  const mode = useSession((s) => s.mode)
  const user = useSession((s) => s.user)
  const github = useSession((s) => s.github)
  const [name, setName] = useState(config.name)
  const [busy, setBusy] = useState(false)
  const canEdit = mode !== 'server' || user?.role === 'admin'
  const exportAll = async () => {
    setBusy(true)
    try {
      const ws = useWorkspace.getState()
      const backend = useSession.getState().backend()
      const files = await backend.readMany(ws.paths)
      const out = Object.fromEntries(Object.entries(files).filter(([, f]) => f).map(([p, f]) => [p, f.text]))
      const a = document.createElement('a')
      a.href = URL.createObjectURL(new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' }))
      a.download = `lumen-export-${isoOf(new Date())}.json`
      a.click()
    } finally {
      setBusy(false)
    }
  }
  return (
    <Section title="Workspace">
      <Row label="Name">
        <div className="set-inline">
          <Input value={name} onChange={(e) => setName(e.target.value)} disabled={!canEdit} aria-label="Workspace name" />
          <Button disabled={!canEdit || !name.trim() || name === config.name} onClick={() => useWorkspace.getState().edit('lumen.json', (t) => `${JSON.stringify({ ...JSON.parse(t || '{}'), name: name.trim() }, null, 2)}\n`)}>
            Save
          </Button>
        </div>
      </Row>
      <Row label="Where your data lives">
        <span className="set-value">
          {mode === 'github' ? `GitHub · ${github?.owner}/${github?.repo}` : mode === 'desktop' ? 'A folder on this computer (Settings → Sync)' : 'This server’s data folder (and GitHub, if sync is on)'}
        </span>
      </Row>
      <Row label="Export" hint="Every file you can see, in one JSON file.">
        <Button onClick={exportAll} loading={busy}>
          Export everything
        </Button>
      </Row>
    </Section>
  )
}

function Shortcuts() {
  const groups = shortcutList()
  return (
    <Section title="Keyboard shortcuts" description="Press ? anywhere to see these.">
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
    </Section>
  )
}

const DOWNLOADS = 'https://github.com/skillissu3s/lumen-releases/releases/latest'

function updateText(u) {
  if (!u || u.status === 'off') return 'Updates are checked in the installed app'
  return {
    idle: 'Up to date',
    checking: 'Checking…',
    downloading: `Downloading ${u.version}… ${u.progress || 0}%`,
    ready: `Version ${u.version} is ready — restart to update`,
    available: `Version ${u.version} is available`,
    error: `Couldn’t check for updates (${u.error})`,
  }[u.status]
}

function About() {
  const info = useSession((s) => s.info)
  const mode = useSession((s) => s.mode)
  const [update, updates] = useUpdateState()
  return (
    <Section title="About Lumen">
      <Row label="Version">
        <span className="set-value">{info?.version || '0.1.0'}</span>
      </Row>
      <Row label="Running as">
        <span className="set-value">{{ github: 'Web app with GitHub', server: 'Web app on a Lumen server', desktop: 'Desktop app' }[mode]}</span>
      </Row>
      {mode === 'desktop' ? (
        <Row label="Updates" hint={update?.selfUpdating ? 'New versions download by themselves and install when Lumen restarts.' : 'Lumen tells you when a new version is out.'}>
          <div className="set-inline">
            <span className="set-value">{updateText(update)}</span>
            {update?.status === 'ready' || update?.status === 'available' ? (
              <Button variant="primary" onClick={() => updates.install()}>
                {update.status === 'ready' ? 'Restart now' : 'Download'}
              </Button>
            ) : (
              <Button onClick={() => updates?.check()} disabled={update?.status === 'checking' || update?.status === 'downloading'}>
                Check now
              </Button>
            )}
          </div>
        </Row>
      ) : (
        <Row label="Desktop app" hint="Works offline with a folder on your computer.">
          <a className="ui-button ui-button--secondary" href={DOWNLOADS} target="_blank" rel="noopener noreferrer">
            Download
          </a>
        </Row>
      )}
      <Row label="Source">
        <a className="set-value" href="https://github.com/skillissu3s/lumen" target="_blank" rel="noopener noreferrer">
          github.com/skillissu3s/lumen <ExternalLink size={12} />
        </a>
      </Row>
    </Section>
  )
}

export default function SettingsView({ route }) {
  const mode = useSession((s) => s.mode)
  const role = useSession((s) => s.user?.role)
  const tabs = [
    { id: 'account', label: 'Account', el: Account },
    { id: 'appearance', label: 'Appearance', el: Appearance },
    { id: 'calendar', label: 'Calendar', el: CalendarTab },
    { id: 'tasks', label: 'Tasks', el: TasksTab },
    { id: 'plugins', label: 'Plugins', el: () => <Suspense fallback={<Spinner size={16} />}><PluginSettings /></Suspense> },
    ...(mode === 'server' && role === 'admin' ? [{ id: 'members', label: 'Members', el: Members }] : []),
    ...(mode !== 'server' || role === 'admin' ? [{ id: 'sync', label: 'Sync', el: Sync }] : []),
    { id: 'workspace', label: 'Workspace', el: Workspace },
    { id: 'shortcuts', label: 'Shortcuts', el: Shortcuts },
    { id: 'about', label: 'About', el: About },
  ]
  const current = tabs.find((t) => t.id === route.parts[1]) || tabs[0]
  const Panel = current.el
  const go = (id) => navigate(`/settings/${id}`, { replace: true })
  return (
    <div className="view settings">
      <nav className="set-nav" aria-label="Settings">
        <div className="set-nav-head view-title">Settings</div>
        <div role="tablist" aria-orientation="vertical">
          {tabs.map((t, i) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={t.id === current.id}
              tabIndex={t.id === current.id ? 0 : -1}
              className={`nav-item${t.id === current.id ? ' is-active' : ''}`}
              onClick={() => go(t.id)}
              onKeyDown={(e) => {
                const d = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0
                if (!d) return
                e.preventDefault()
                const next = tabs[(i + d + tabs.length) % tabs.length]
                go(next.id)
                setTimeout(() => e.currentTarget.parentElement?.querySelector('[aria-selected="true"]')?.focus(), 0)
              }}
            >
              <span className="nav-label">{t.label}</span>
            </button>
          ))}
        </div>
        <select className="set-nav-select" value={current.id} onChange={(e) => go(e.target.value)} aria-label="Settings page">
          {tabs.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
      </nav>
      <div className="set-main" role="tabpanel" aria-label={current.label}>
        <div className="set-column">
          <Panel />
        </div>
      </div>
    </div>
  )
}
