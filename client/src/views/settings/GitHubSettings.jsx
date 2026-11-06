// Settings → GitHub: the server writes a readable copy of your data to a GitHub
// repository with a token you give it, on the schedule you choose, and can
// bring it back from there. Everything happens on the server; this page only
// asks it.
import { useEffect, useState } from 'react'
import { ExternalLink, RefreshCw, RotateCcw } from 'lucide-react'
import { Button, Checkbox, Dialog, Field, Input, Select, Spinner } from '../../components/ui/index.js'
import { api } from '../../lib/api.js'
import { useUI } from '../../store/ui.js'
import { useSession } from '../../store/session.js'
import { useCurrentSpace, useSpaces } from '../../store/spaces.js'
import { relativeDay, isoOf, timeOf } from '../../../../shared/dates.js'
import { Row, Section } from './parts.jsx'

const NEW_TOKEN = 'https://github.com/settings/personal-access-tokens/new'

// "today at 14:43", "Mon 2 Nov at 03:00": read in the middle of a sentence
const when = (ms) => {
  const day = relativeDay(isoOf(new Date(ms)))
  return `${/^(Today|Yesterday|Tomorrow)$/.test(day) ? day.toLowerCase() : day} at ${timeOf(new Date(ms))}`
}
const zone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'

const MODES = [
  { value: 'after-changes', label: 'After changes' },
  { value: 'interval', label: 'Every few hours' },
  { value: 'daily', label: 'Once a day' },
  { value: 'weekly', label: 'Once a week' },
  { value: 'manual', label: 'Only when I ask' },
]
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((label, value) => ({ value: String(value), label }))
const QUIET = [5, 10, 30, 60].map((m) => ({ value: String(m), label: `${m} minutes after the last` }))
const HOURS = [1, 2, 3, 6, 12, 24].map((h) => ({ value: String(h), label: h === 1 ? 'Every hour' : `Every ${h} hours` }))

const KIND_LABELS = {
  board: ['board', 'boards'],
  calendar: ['calendar', 'calendars'],
  doc: ['doc', 'docs'],
  idea: ['idea board', 'idea boards'],
  prefs: ['person’s settings', 'people’s settings'],
  workspace: ['workspace file', 'workspace files'],
  channels: ['channel list', 'channel lists'],
  messages: ['month of chat', 'months of chat'],
  plugin_file: ['plugin file', 'plugin files'],
  plugin_data: ['plugin data file', 'plugin data files'],
  other: ['other file', 'other files'],
}
const kinds = (found) =>
  Object.keys(KIND_LABELS)
    .filter((k) => found[k])
    .map((k) => `${found[k]} ${KIND_LABELS[k][found[k] === 1 ? 0 : 1]}`)
    .join(', ') || 'nothing'

const defaultSchedule = (mode) => ({ 'after-changes': { quiet: 10, max: 60 }, interval: { every: 6 }, daily: { at: '03:00', tz: zone() }, weekly: { at: '03:00', tz: zone(), day: 0 } })[mode] || null

const tokenHint = (
  <>
    A{' '}
    <a href={NEW_TOKEN} target="_blank" rel="noreferrer">
      fine-grained token
    </a>{' '}
    with access to only this repository and Contents: Read and write. It’s kept encrypted on the server.
  </>
)

// the mode and its one or two details, as a value { mode, schedule }
function ScheduleFields({ value, onChange }) {
  const { mode, schedule: s } = value
  const set = (patch) => onChange({ mode, schedule: { ...s, ...patch } })
  return (
    <div className="gh-when">
      <Select aria-label="When to sync" value={mode} options={MODES} onChange={(e) => onChange({ mode: e.target.value, schedule: defaultSchedule(e.target.value) })} />
      {mode === 'after-changes' && <Select aria-label="Quiet for" value={String(s.quiet)} options={QUIET} onChange={(e) => set({ quiet: +e.target.value })} />}
      {mode === 'interval' && <Select aria-label="How often" value={String(s.every)} options={HOURS} onChange={(e) => set({ every: +e.target.value })} />}
      {mode === 'weekly' && <Select aria-label="Day" value={String(s.day)} options={DAYS} onChange={(e) => set({ day: +e.target.value })} />}
      {(mode === 'daily' || mode === 'weekly') && <Input type="time" aria-label="Time" value={s.at} onChange={(e) => e.target.value && set({ at: e.target.value, tz: zone() })} />}
    </div>
  )
}

function statusOf(c) {
  if (c.running) return { text: 'Syncing…' }
  if (c.paused) return { text: c.paused, tone: 'error' }
  if (c.lastError) return { text: `${c.lastError}${c.nextRunAt ? ` Trying again ${when(c.nextRunAt)}.` : ''}`, tone: 'error' }
  if (!c.lastRunAt) return { text: 'Waiting for the first sync' }
  const parts = [`Synced ${when(c.lastRunAt)}`]
  if (c.waiting) parts.push(c.nextRunAt ? `next sync ${when(c.nextRunAt)}` : 'changes waiting')
  return { text: parts.join(', ') }
}

// a new token for a connection, when the old one expired or was revoked
function TokenDialog({ c, onClose, onSaved }) {
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const save = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await api('PATCH', `/github/connections/${c.id}`, { token })
      onSaved()
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }
  return (
    <Dialog
      open
      onClose={onClose}
      title={`A new token for ${c.repo}`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="gh-token" loading={busy} disabled={!token.trim()}>
            Save and sync
          </Button>
        </>
      }
    >
      <form id="gh-token" className="set-form" onSubmit={save}>
        <Field label="Token" hint={tokenHint}>
          <Input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="github_pat_…" autoComplete="off" autoFocus />
        </Field>
        {error && <p className="auth-error">{error}</p>}
      </form>
    </Dialog>
  )
}

function Connection({ c, canRestore, onChange, onRestore }) {
  const toast = useUI((s) => s.toast)
  const [busy, setBusy] = useState('')
  const [dialog, setDialog] = useState(null) // 'token' | 'leave'
  const act = async (what, fn) => {
    setBusy(what)
    try {
      await fn()
      await onChange()
    } catch (e) {
      toast(e.message, { tone: 'danger' })
    } finally {
      setBusy('')
    }
  }
  const patch = (body) => act('patch', () => api('PATCH', `/github/connections/${c.id}`, body))
  const status = statusOf(c)
  const where = [`branch ${c.branch}`, c.prefix && `folder ${c.prefix}`].filter(Boolean).join(', ')
  const tokenTrouble = /token/.test(c.paused || '')
  return (
    <Section
      title={
        <a className="gh-repo" href={c.url} target="_blank" rel="noreferrer">
          {c.repo}
          <ExternalLink size={13} aria-hidden="true" />
        </a>
      }
      description={`${c.space ? (c.space.kind === 'candle' ? 'Your candle' : c.space.name) : c.scope === 'workspace' ? 'Everything in the workspace' : 'What you own'}, on ${where}.`}
    >
      <Row label="Status" hint={c.commitUrl && !c.paused ? <a href={c.commitUrl} target="_blank" rel="noreferrer">Last commit {c.lastCommit.slice(0, 7)}</a> : undefined}>
        <div className="gh-status">
          <span className={`sync-line is-${status.tone || 'ok'}`}>{status.text}</span>
          {c.paused && (
            <div className="set-inline">
              {tokenTrouble ? (
                <Button size="sm" onClick={() => setDialog('token')}>
                  Add a new token
                </Button>
              ) : /another Lumen server/.test(c.paused) ? (
                <Button size="sm" loading={busy === 'patch'} onClick={() => patch({ adopt: true })}>
                  Take it over
                </Button>
              ) : /public/.test(c.paused) ? (
                <Button size="sm" loading={busy === 'patch'} onClick={() => patch({ allowPublic: true })}>
                  Allow a public mirror
                </Button>
              ) : (
                <Button size="sm" loading={busy === 'patch'} onClick={() => patch({ resume: true })}>
                  Try again
                </Button>
              )}
            </div>
          )}
        </div>
      </Row>
      <Row label="When" hint={c.mode === 'after-changes' ? 'Waits until you’ve stopped for a while, and at most an hour.' : c.mode === 'manual' ? undefined : 'Only if something changed.'}>
        <ScheduleFields value={{ mode: c.mode, schedule: c.schedule || defaultSchedule(c.mode) }} onChange={(v) => patch(v)} />
      </Row>
      {c.drift.length > 0 && (
        <Row label="Edited on GitHub" hint="Lumen put its version back. The edits are still in the repository’s history.">
          <span className="set-value gh-drift">{c.drift.slice(0, 3).join(', ') + (c.drift.length > 3 ? ` and ${c.drift.length - 3} more` : '')}</span>
        </Row>
      )}
      <Row label="Sync" hint="Checking every file also puts back anything edited on GitHub.">
        <div className="set-inline">
          <Button variant="ghost" loading={busy === 'full'} disabled={c.running || !!c.paused} onClick={() => act('full', () => api('POST', `/github/connections/${c.id}/run`, { full: true }))}>
            Check every file
          </Button>
          <Button icon={RefreshCw} loading={busy === 'run'} disabled={c.running || !!c.paused} onClick={() => act('run', () => api('POST', `/github/connections/${c.id}/run`))}>
            Sync now
          </Button>
        </div>
      </Row>
      <Row label="Repository" hint={canRestore ? `Restoring brings its files into ${c.space?.kind === 'candle' ? 'your candle' : c.space?.name || 'this space'}. Disconnecting leaves them on GitHub.` : 'Disconnecting leaves everything on GitHub.'}>
        <div className="set-inline">
          {!tokenTrouble && (
            <Button variant="ghost" onClick={() => setDialog('token')}>
              Change token
            </Button>
          )}
          {canRestore && (
            <Button variant="ghost" icon={RotateCcw} onClick={() => onRestore({ connectionId: c.id, repo: c.repo })}>
              Restore
            </Button>
          )}
          <Button variant="ghost" onClick={() => setDialog('leave')}>
            Disconnect
          </Button>
        </div>
      </Row>
      {dialog === 'token' && (
        <TokenDialog
          c={c}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null)
            toast('Token saved')
            onChange()
          }}
        />
      )}
      <Dialog
        open={dialog === 'leave'}
        onClose={() => setDialog(null)}
        title={`Stop syncing to ${c.repo}?`}
        description="Everything already in the repository stays there, and the token is deleted from this server. You can connect it again later."
        footer={
          <>
            <Button onClick={() => setDialog(null)}>Cancel</Button>
            <Button variant="danger" loading={busy === 'delete'} onClick={() => act('delete', () => api('DELETE', `/github/connections/${c.id}`))}>
              Disconnect
            </Button>
          </>
        }
      />
    </Section>
  )
}

// the spaces whose copy you may keep: your candle, and workspaces you own or help run
function useManaged() {
  const list = useSpaces((s) => s.list)
  const user = useSession((s) => s.user)
  return list.filter((s) => s.id && (s.kind === 'candle' || s.role === 'owner' || s.role === 'admin')).map((s) => ({ value: s.id, label: s.kind === 'candle' ? s.name || `${user?.name || 'Your'}’s candle` : s.name }))
}

// a repository, a token for it, which space, and where and when
function ConnectForm({ first, restored, onDone, onRestore }) {
  const toast = useUI((s) => s.toast)
  const managed = useManaged()
  const current = useCurrentSpace()
  const start = managed.some((m) => m.value === current.id) ? current.id : managed[0]?.value
  const [form, setForm] = useState({ repo: '', token: '', branch: '', prefix: '', space: start, allowPublic: false })
  useEffect(() => {
    if (!form.space && start) setForm((f) => ({ ...f, space: start }))
  }, [start, form.space])
  const [timing, setTiming] = useState({ mode: 'daily', schedule: defaultSchedule('daily') })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })
  const ready = form.repo.trim() && form.token.trim()
  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const r = await api('POST', '/github/connections', { ...form, ...timing, adopt: restored.has(form.repo.trim().toLowerCase()) })
      toast(`Syncing to ${r.connection.repo}`, { tone: 'success' })
      setForm({ ...form, repo: '', token: '', branch: '', prefix: '', allowPublic: false })
      await onDone()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Section
      title={first ? 'Keep a copy on GitHub' : 'Add a repository'}
      description={
        first
          ? 'Your boards, calendars, docs and idea boards, written to a GitHub repository as files you can read, on a schedule you choose. If this server is ever gone, your data is still yours, and Lumen can bring it back from there. A new private repository is best; files you add to it yourself are left alone.'
          : undefined
      }
    >
      <form className="set-form" onSubmit={submit}>
        <Field label="Repository" hint="you/lumen-data, or its address on GitHub">
          <Input value={form.repo} onChange={set('repo')} placeholder="you/lumen-data" spellCheck={false} autoCapitalize="off" />
        </Field>
        <Field label="Token" hint={tokenHint}>
          <Input type="password" value={form.token} onChange={set('token')} placeholder="github_pat_…" autoComplete="off" />
        </Field>
        <div className="set-grid2">
          <Field label="Branch" hint="Empty for the repository’s default.">
            <Input value={form.branch} onChange={set('branch')} placeholder="main" spellCheck={false} autoCapitalize="off" />
          </Field>
          <Field label="Folder" hint="Empty for the whole repository.">
            <Input value={form.prefix} onChange={set('prefix')} placeholder="lumen" spellCheck={false} autoCapitalize="off" />
          </Field>
        </div>
        {managed.length > 1 && (
          <Field label="What to keep there" hint="Each repository holds one space. Restoring brings it back into the same.">
            <Select value={form.space || ''} onChange={(e) => setForm({ ...form, space: e.target.value })} options={managed} />
          </Field>
        )}
        <Field label="When">
          <ScheduleFields value={timing} onChange={setTiming} />
        </Field>
        {/public/.test(error) && <Checkbox checked={form.allowPublic} onChange={(e) => setForm({ ...form, allowPublic: e.target.checked })} label="Sync to this public repository anyway, where anyone can read it" />}
        {error && <p className="auth-error">{error}</p>}
        <div className="set-inline">
          <Button type="submit" variant="primary" loading={busy} disabled={!ready}>
            Start syncing
          </Button>
          {onRestore && (
            <Button variant="ghost" icon={RotateCcw} disabled={!form.repo.trim()} onClick={() => onRestore({ repo: form.repo.trim(), token: form.token.trim(), branch: form.branch.trim(), prefix: form.prefix.trim(), space: form.space })}>
              Restore from it
            </Button>
          )}
        </div>
      </form>
    </Section>
  )
}

function RestoreDialog({ target, onClose, onRestored }) {
  const toast = useUI((s) => s.toast)
  const [repoWins, setRepoWins] = useState(false)
  const [report, setReport] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const body = { connectionId: target.connectionId, repo: target.repo, token: target.token, branch: target.branch, prefix: target.prefix, space: target.space, repoWins }
  useEffect(() => {
    setReport(null)
    setError('')
    api('POST', '/github/restore', body)
      .then(setReport)
      .catch((e) => setError(e.message))
  }, [repoWins])
  const confirm = async () => {
    setBusy(true)
    try {
      const r = await api('POST', '/github/restore', { ...body, confirm: true })
      // the files reach this window over the live connection, like any other change
      toast(`Brought in ${r.taken} file${r.taken === 1 ? '' : 's'} from ${r.repo}`, { tone: 'success' })
      onRestored()
    } catch (e) {
      setError(e.message)
      setBusy(false)
    }
  }
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Restore from ${target.repo}`}
      description="Brings what the repository holds into this workspace. Nothing here is deleted."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={!report || !report.take} onClick={confirm}>
            {report?.take ? `Bring in ${report.take} file${report.take === 1 ? '' : 's'}` : 'Nothing to bring in'}
          </Button>
        </>
      }
    >
      {error ? (
        <p className="auth-error">{error}</p>
      ) : !report ? (
        <Spinner size={16} />
      ) : (
        <div className="gh-report">
          <p>
            Found {kinds(report.found)}
            {report.writtenAt ? `, as of ${when(Date.parse(report.writtenAt))}` : ''}.
            {report.legacy ? ' This repository is from before Lumen’s mirror, so every file that looks like Lumen’s is read.' : ''}
          </p>
          <p>
            {report.take} to bring in, {report.same} already the same here.
          </p>
          {report.kept.length > 0 && (
            <>
              <p>Changed here too, so this workspace’s version is kept: {report.kept.join(', ')}.</p>
              <Checkbox checked={repoWins} onChange={(e) => setRepoWins(e.target.checked)} label="Use the repository’s version for these as well" />
            </>
          )}
          {report.skipped.length > 0 && <p className="setting-desc">Skipped: {report.skipped.map((s) => `${s.path} (${s.why})`).join(', ')}.</p>}
        </div>
      )}
    </Dialog>
  )
}

export default function GitHubSettings() {
  const [data, setData] = useState(null)
  const [restore, setRestore] = useState(null)
  const [restored, setRestored] = useState(() => new Set())
  const load = () =>
    api('GET', '/github')
      .then(setData)
      .catch((e) => setData({ error: e.message }))

  useEffect(() => {
    load()
  }, [])
  // while a sync runs, look again every few seconds
  const running = data?.connections?.some((c) => c.running)
  useEffect(() => {
    if (!running) return
    const t = setInterval(load, 3000)
    return () => clearInterval(t)
  }, [running])

  if (!data) return <Spinner size={16} />
  if (data.error) return <Section description={data.error} />
  // restoring writes into a space you manage: every connection's is one
  return (
    <>
      {data.connections.map((c) => (
        <Connection key={c.id} c={c} canRestore onChange={load} onRestore={setRestore} />
      ))}
      <ConnectForm first={!data.connections.length} restored={restored} onDone={load} onRestore={setRestore} />
      {restore && (
        <RestoreDialog
          target={restore}
          onClose={() => setRestore(null)}
          onRestored={() => {
            // connecting to it afterwards takes over the mirror the old server wrote
            if (restore.repo && !restore.connectionId) setRestored(new Set([...restored, restore.repo.toLowerCase()]))
            setRestore(null)
            load()
          }}
        />
      )}
    </>
  )
}
