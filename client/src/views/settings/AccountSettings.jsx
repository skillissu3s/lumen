// Settings → Account: how others see you (photo, colour, name, username), how
// you sign in, and where you're signed in. The desktop app on its own has one
// local person, so it keeps the profile and says where the work lives.
import { useEffect, useRef, useState } from 'react'
import { Camera, Check, LogOut, Monitor, RefreshCw, Smartphone, Trash2, Upload } from 'lucide-react'
import { AVATAR_COLORS, Button, Dialog, Field, Input, Spinner, UserAvatar } from '../../components/ui/index.js'
import { useSession } from '../../store/session.js'
import { useUI } from '../../store/ui.js'
import { api } from '../../lib/api.js'
import { navigate } from '../../lib/router.js'
import { relativeDay, isoOf, timeOf } from '../../../../shared/dates.js'
import { Row, Section } from './parts.jsx'

// "today at 09:30", "Mon 2 Nov at 09:30": to sit inside a sentence
function when(ms) {
  if (!ms) return 'never'
  const day = relativeDay(isoOf(new Date(ms)))
  return `${/^(Today|Yesterday|Tomorrow)$/.test(day) ? day.toLowerCase() : day} at ${timeOf(new Date(ms))}`
}

// a photo, cropped square and made small enough to travel with every list of people
async function shrinkPhoto(file, size = 160) {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image()
      i.onload = () => resolve(i)
      i.onerror = () => reject(new Error('That file isn’t an image Lumen can read.'))
      i.src = url
    })
    const side = Math.min(img.naturalWidth, img.naturalHeight)
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    canvas.getContext('2d').drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, size, size)
    const webp = canvas.toDataURL('image/webp', 0.86)
    return webp.startsWith('data:image/webp') ? webp : canvas.toDataURL('image/jpeg', 0.86)
  } finally {
    URL.revokeObjectURL(url)
  }
}

// "Chrome on Windows", from a browser's user agent
function deviceOf(agent = '') {
  const app = /Electron|Lumen/i.test(agent) ? 'Lumen desktop app' : /Edg\//.test(agent) ? 'Edge' : /Firefox\//.test(agent) ? 'Firefox' : /Chrome\//.test(agent) ? 'Chrome' : /Safari\//.test(agent) ? 'Safari' : agent ? 'Another app' : 'Unknown device'
  const os = /Windows/.test(agent) ? 'Windows' : /Android/.test(agent) ? 'Android' : /iPhone|iPad/.test(agent) ? 'iOS' : /Mac OS X/.test(agent) ? 'macOS' : /Linux/.test(agent) ? 'Linux' : ''
  return { label: os ? `${app} on ${os}` : app, phone: /Android|iPhone|iPad|Mobile/.test(agent) }
}

function useSaved() {
  const [saved, setSaved] = useState(null)
  const timer = useRef(null)
  useEffect(() => () => clearTimeout(timer.current), [])
  return [
    saved,
    (key) => {
      setSaved(key)
      clearTimeout(timer.current)
      timer.current = setTimeout(() => setSaved(null), 1800)
    },
  ]
}

const SavedHint = ({ on }) =>
  on ? (
    <span className="set-saved" role="status">
      <Check size={13} /> Saved
    </span>
  ) : null

/** Photo, colour and name: the parts of you everyone sees. `handle`: also the username. */
function Profile({ handle = true }) {
  const user = useSession((s) => s.user)
  const toast = useUI((s) => s.toast)
  const [name, setName] = useState(user?.name || '')
  const [username, setUsername] = useState(user?.handle || '')
  const [busy, setBusy] = useState(false)
  const [saved, markSaved] = useSaved()
  const fileRef = useRef(null)

  const patch = async (body, key) => {
    try {
      const r = await api('PATCH', '/me', body)
      useSession.setState({ user: { ...useSession.getState().user, ...r.user } })
      markSaved(key)
      return true
    } catch (err) {
      toast(err.message, { tone: 'danger' })
      return false
    }
  }
  const saveName = () => {
    const v = name.trim()
    if (!v) return setName(user?.name || '')
    if (v !== user?.name) patch({ name: v }, 'name')
  }
  const saveUsername = async () => {
    const v = username.trim().replace(/^@/, '').toLowerCase()
    if (!v || v === user?.handle) return setUsername(user?.handle || '')
    if (await patch({ handle: v }, 'handle')) {
      // files named after you moved: start again from the server's view
      setTimeout(() => location.reload(), 600)
    } else setUsername(user?.handle || '')
  }
  const onPhoto = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setBusy(true)
    try {
      await patch({ avatar: await shrinkPhoto(file) }, 'photo')
    } catch (err) {
      toast(err.message, { tone: 'danger' })
    } finally {
      setBusy(false)
    }
  }
  const enter = (e) => e.key === 'Enter' && e.currentTarget.blur()

  return (
    <Section title="Profile">
      <div className="profile-card">
        <button type="button" className="profile-photo" aria-label={user?.avatar ? 'Change your photo' : 'Add a photo'} onClick={() => fileRef.current?.click()}>
          <UserAvatar user={user} size={64} />
          <span className="profile-photo-edit" aria-hidden="true">
            {busy ? <Spinner size={14} /> : <Camera size={15} />}
          </span>
        </button>
        <div className="profile-card-text">
          <div className="settings-summary-title">{user?.name}</div>
          <div className="settings-summary-meta">
            {handle && <span className="faint">@{user?.handle}</span>}
            {user?.role === 'admin' && handle && <span className="set-badge">Admin</span>}
            <SavedHint on={saved === 'photo'} />
          </div>
          <div className="set-inline profile-card-actions">
            <Button size="sm" icon={Upload} onClick={() => fileRef.current?.click()} loading={busy}>
              {user?.avatar ? 'Change photo' : 'Upload a photo'}
            </Button>
            {user?.avatar && (
              <Button size="sm" variant="ghost" icon={Trash2} onClick={() => patch({ avatar: null }, 'photo')}>
                Remove
              </Button>
            )}
          </div>
        </div>
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={onPhoto} />
      </div>
      <Row label="Colour" hint="Behind your initials when there’s no photo.">
        <div className="avatar-swatches" role="radiogroup" aria-label="Avatar colour">
          {AVATAR_COLORS.map((c) => (
            <button key={c} type="button" role="radio" aria-checked={user?.color === c} aria-label={c} className="avatar-swatch" style={{ '--sw': `var(--c-${c})` }} onClick={() => patch({ color: c }, 'color')} />
          ))}
          <SavedHint on={saved === 'color'} />
        </div>
      </Row>
      <Row label="Name" hint="How you’re shown to people in this workspace.">
        <div className="set-inline">
          <Input value={name} onChange={(e) => setName(e.target.value)} onBlur={saveName} onKeyDown={enter} aria-label="Name" maxLength={80} />
          <SavedHint on={saved === 'name'} />
        </div>
      </Row>
      {handle && (
        <Row label="Username" hint="Shown as @username in chat, and as the owner in your files and their copy on GitHub.">
          <div className="set-inline">
            <Input value={username} onChange={(e) => setUsername(e.target.value)} onBlur={saveUsername} onKeyDown={enter} aria-label="Username" spellCheck={false} autoCapitalize="off" />
            <SavedHint on={saved === 'handle'} />
          </div>
        </Row>
      )}
      {handle && (
        <Row label="Email" hint="Where sign-in codes and invites go.">
          <span className="set-value">{user?.email}</span>
        </Row>
      )}
    </Section>
  )
}

function Password() {
  const toast = useUI((s) => s.toast)
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <Section title="Password">
      <form
        className="set-form"
        onSubmit={async (e) => {
          e.preventDefault()
          setError('')
          if (pw.next !== pw.confirm) return setError('The new passwords don’t match.')
          setBusy(true)
          try {
            await api('POST', '/me/password', { current: pw.current, next: pw.next })
            setPw({ current: '', next: '', confirm: '' })
            toast('Password changed')
          } catch (err) {
            setError(err.message)
          } finally {
            setBusy(false)
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
          <Button type="submit" disabled={!pw.current || pw.next.length < 8} loading={busy}>
            Change password
          </Button>
        </div>
      </form>
    </Section>
  )
}

function Sessions() {
  const toast = useUI((s) => s.toast)
  const logout = useSession((s) => s.logout)
  const [sessions, setSessions] = useState(null)
  const [confirm, setConfirm] = useState(false)
  useEffect(() => {
    api('GET', '/me/sessions')
      .then((r) => setSessions(r.sessions))
      .catch(() => setSessions([]))
  }, [])
  const others = sessions?.filter((s) => !s.current).length || 0
  return (
    <Section title="Where you’re signed in">
      {!sessions ? (
        <div className="set-loading">
          <Spinner size={14} /> Loading…
        </div>
      ) : (
        <div className="set-table">
          {sessions.map((s) => {
            const d = deviceOf(s.agent)
            const Icon = d.phone ? Smartphone : Monitor
            return (
              <div key={s.id} className="set-table-row session-row">
                <span className="session-who">
                  <span className="session-icon">
                    <Icon size={16} />
                  </span>
                  <span>
                    <span className="member-name">{d.label}</span>
                    {s.current && <span className="set-badge">This device</span>}
                    <span className="faint session-when">Signed in {when(s.createdAt)}</span>
                  </span>
                </span>
              </div>
            )
          })}
        </div>
      )}
      <div className="set-inline set-actions">
        <Button
          disabled={!others}
          onClick={async () => {
            const r = await api('DELETE', '/me/sessions')
            setSessions((list) => list.filter((s) => s.current))
            toast(r.ended === 1 ? 'Signed out of 1 other device' : `Signed out of ${r.ended} other devices`)
          }}
        >
          Sign out other devices
        </Button>
        <Button variant="danger" icon={LogOut} onClick={() => setConfirm(true)}>
          Sign out
        </Button>
      </div>
      <Dialog
        open={confirm}
        onClose={() => setConfirm(false)}
        size="sm"
        title="Sign out of Lumen?"
        description="This browser forgets the copy of your workspace it keeps for working offline."
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(false)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={() => logout().then(() => navigate('/signin'))}>
              Sign out
            </Button>
          </>
        }
      />
    </Section>
  )
}

// back to the welcome screen, to sign in to a server (or again)
async function askWhere() {
  await api('POST', '/desktop/mode', { mode: 'ask' })
  await useSession.getState().boot()
}

function cloudLine(cloud) {
  if (cloud.state === 'syncing') return 'Syncing…'
  if (cloud.state === 'offline') return 'Offline. Your changes are kept here and sent when you’re back online.'
  if (cloud.state === 'signed-out' || cloud.state === 'error') return cloud.lastError || 'Not synced'
  return cloud.lastSync ? `Up to date, last synced ${when(Date.parse(cloud.lastSync))}` : 'Not synced yet'
}

// the desktop app: this computer only, or a copy of an account on a Lumen server
function DesktopLink() {
  const cloud = useSession((s) => s.cloud)
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState(false)
  if (!cloud?.linked)
    return (
      <Section title="Where your work lives" description="Lumen keeps everything on this computer, with no account.">
        <Row label="Lumen server" hint="Use your account on a Lumen server here too. What is on this computer can come with you.">
          <Button onClick={askWhere}>Sign in to a server</Button>
        </Row>
      </Section>
    )
  const host = cloud.server.replace(/^https?:\/\//, '')
  return (
    <Section title="Where your work lives" description={`Signed in to ${host}. Your account’s work is kept on this computer too, so Lumen works offline.`}>
      <Row label="Account">
        <span className="set-value">
          <UserAvatar user={cloud.user} size={22} /> {cloud.user?.name} <span className="faint">@{cloud.user?.handle}</span>
        </span>
      </Row>
      <Row label="Syncing" hint={cloudLine(cloud)}>
        {cloud.state === 'signed-out' ? (
          <Button onClick={askWhere}>Sign in again</Button>
        ) : (
          <Button
            icon={RefreshCw}
            loading={busy || cloud.state === 'syncing'}
            onClick={async () => {
              setBusy(true)
              try {
                useSession.setState({ cloud: await api('POST', '/desktop/cloud/sync') })
              } finally {
                setBusy(false)
              }
            }}
          >
            Sync now
          </Button>
        )}
      </Row>
      {cloud.conflicts?.length > 0 && (
        <Row label="Changed in both places" hint="These were changed here and on the server at once; where the same thing changed, the server’s version was kept.">
          <span className="set-value faint">{cloud.conflicts.join(', ')}</span>
        </Row>
      )}
      {cloud.refused?.length > 0 && (
        <Row label="Kept on this computer" hint="The server didn’t take these changes, so they are only here.">
          <span className="set-value faint">{cloud.refused.map((r) => `${r.path}: ${r.reason}`).join('; ')}</span>
        </Row>
      )}
      <Row label="Sign out" hint="This computer keeps a copy of your work, on its own.">
        <Button variant="danger" onClick={() => setConfirm(true)}>
          Sign out of the server
        </Button>
      </Row>
      <Dialog
        open={confirm}
        onClose={() => setConfirm(false)}
        size="sm"
        title={`Sign out of ${host}?`}
        description="Changes not sent yet stay on this computer only. Your account and everything on the server stay as they are."
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={async () => {
                await api('POST', '/desktop/cloud/logout')
                setConfirm(false)
                await useSession.getState().boot()
              }}
            >
              Sign out
            </Button>
          </>
        }
      />
    </Section>
  )
}

export default function AccountSettings() {
  const mode = useSession((s) => s.mode)
  if (mode === 'desktop')
    return (
      <>
        <Profile handle={false} />
        <DesktopLink />
      </>
    )
  return (
    <>
      <Profile />
      <Password />
      <Sessions />
    </>
  )
}
