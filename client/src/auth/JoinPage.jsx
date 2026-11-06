// #/join/<token>: an invite link to a workspace. Signed in, it's one button;
// without an account the link is also the way in (name, email, password); with
// an account but signed out, sign in first and the link carries on afterwards.
import { useEffect, useState } from 'react'
import { Button, Field, Input, Spinner } from '../components/ui/index.js'
import { api } from '../lib/api.js'
import { navigate } from '../lib/router.js'
import { useSession } from '../store/session.js'
import { useSpaces } from '../store/spaces.js'
import { Logo } from '../shell/Logo.jsx'

const PENDING = 'lumen.join'

/** A join link opened while signed out, to finish after signing in */
export function pendingJoin() {
  try {
    const t = sessionStorage.getItem(PENDING)
    sessionStorage.removeItem(PENDING)
    return t
  } catch {
    return null
  }
}

function Card({ title, subtitle, children }) {
  return (
    <div className="auth">
      <div className="auth-card">
        <span className="auth-brand">
          <Logo size={28} />
        </span>
        <h1 className="auth-title">{title}</h1>
        {subtitle && <p className="auth-subtitle">{subtitle}</p>}
        {children}
      </div>
    </div>
  )
}

export default function JoinPage({ token }) {
  const status = useSession((s) => s.status)
  const signedIn = status === 'ready'
  const [info, setInfo] = useState(null)
  const [gone, setGone] = useState(false)
  const [form, setForm] = useState({ name: '', email: '', password: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    api('GET', `/join/${encodeURIComponent(token)}`)
      .then(setInfo)
      .catch(() => setGone(true))
  }, [token, signedIn])

  const go = async (fn) => {
    setBusy(true)
    setError('')
    try {
      await fn()
    } catch (e) {
      setError(e.message || 'Something went wrong')
      setBusy(false)
    }
  }

  const join = () =>
    go(async () => {
      const r = await api('POST', `/join/${encodeURIComponent(token)}`)
      await useSpaces.getState().load()
      useSpaces.getState().open(r.space.prefix)
    })

  const signup = (e) => {
    e.preventDefault()
    go(async () => {
      const r = await api('POST', `/join/${encodeURIComponent(token)}/signup`, form)
      // open the workspace first thing after signing in
      try {
        localStorage.setItem(`lumen.space.${r.user.handle}`, r.space.prefix)
      } catch {
        /* storage unavailable */
      }
      navigate('/today', { replace: true })
      await useSession.getState().boot()
    })
  }

  if (gone) return <Card title="This invite link has expired" subtitle="Links last a week, or until whoever made it revokes it. Ask for a new one." />
  if (!info)
    return (
      <div className="auth">
        <Spinner size={18} />
      </div>
    )

  const where = info.space.name
  if (signedIn) {
    if (info.member)
      return (
        <Card title={`You’re already in ${where}`}>
          <Button variant="primary" full loading={busy} onClick={join}>
            Open {where}
          </Button>
        </Card>
      )
    return (
      <Card title={`Join ${where}`} subtitle={`You’ll join as ${info.space.role === 'admin' ? 'an admin' : 'a member'}. Everyone in it sees and edits its boards, calendars and docs. Your candle stays yours.`}>
        {error && <p className="auth-error">{error}</p>}
        <div className="auth-form">
          <Button variant="primary" full loading={busy} onClick={join}>
            Join {where}
          </Button>
          <Button variant="ghost" full onClick={() => navigate('/today', { replace: true })}>
            Not now
          </Button>
        </div>
      </Card>
    )
  }

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })
  return (
    <Card title={`Join ${where} on Lumen`} subtitle="Make your account. You get your own private candle, and this workspace beside it.">
      <form className="auth-form" onSubmit={signup}>
        <Field label="Your name">
          <Input autoComplete="name" value={form.name} onChange={set('name')} required autoFocus />
        </Field>
        <Field label="Email">
          <Input type="email" autoComplete="email" value={form.email} onChange={set('email')} required />
        </Field>
        <Field label="Password" hint="At least 8 characters.">
          <Input type="password" autoComplete="new-password" minLength={8} value={form.password} onChange={set('password')} required />
        </Field>
        {error && <p className="auth-error">{error}</p>}
        <Button variant="primary" type="submit" loading={busy} full>
          Join
        </Button>
        <button
          type="button"
          className="auth-link"
          onClick={() => {
            try {
              sessionStorage.setItem(PENDING, token)
            } catch {
              /* storage unavailable */
            }
            navigate('/signin')
          }}
        >
          I have an account
        </button>
      </form>
    </Card>
  )
}
