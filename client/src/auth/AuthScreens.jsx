// Signing in: server accounts (sign in, first-run setup, invites), finding your
// server from a static copy of the app, and the desktop app's first-run choice.
import { useEffect, useState } from 'react'
import { ArrowRight, Cloud, Download, Lock, Monitor } from 'lucide-react'
import { Button, Field, Input, Segmented, Spinner } from '../components/ui/index.js'
import { useSession } from '../store/session.js'
import { api } from '../lib/api.js'
import { navigate } from '../lib/router.js'
import { Logo } from '../shell/Logo.jsx'

function Card({ title, subtitle, children, footer }) {
  return (
    <div className="auth">
      <div className="auth-card">
        <a className="auth-brand" href="./" aria-label="Lumen home">
          <Logo size={28} />
        </a>
        <h1 className="auth-title">{title}</h1>
        {subtitle && <p className="auth-subtitle">{subtitle}</p>}
        {children}
      </div>
      {footer && <div className="auth-footer">{footer}</div>}
    </div>
  )
}

function useSubmit(fn) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const submit = async (e, ...args) => {
    e?.preventDefault?.()
    setBusy(true)
    setError('')
    try {
      await fn(...args)
    } catch (err) {
      setError(err.message || 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }
  return { busy, error, submit, setError }
}

const ErrorLine = ({ error }) =>
  error ? (
    <p className="auth-error" role="alert">
      {error}
    </p>
  ) : null

// signed in by the server: the app takes it from here
function signedIn(user) {
  useSession.setState({ status: 'ready', mode: 'server', user })
  navigate('/today', { replace: true })
}

/** Six-digit code entry: one-time-code autofill, submits itself once complete */
function CodeStep({ to, onVerify, onResend, onBack, extra, busy, error }) {
  const [code, setCode] = useState('')
  const [wait, setWait] = useState(30)
  useEffect(() => {
    if (wait <= 0) return
    const t = setTimeout(() => setWait(wait - 1), 1000)
    return () => clearTimeout(t)
  }, [wait])
  return (
    <form
      className="auth-form"
      onSubmit={(e) => {
        e.preventDefault()
        if (code.length === 6) onVerify(code)
      }}
    >
      <p className="auth-sent">
        We sent a 6-digit code to <b>{to}</b>. It works for 10 minutes.
      </p>
      <Field label="Code">
        <Input
          className="code-input"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          value={code}
          autoFocus
          placeholder="000000"
          onChange={(e) => {
            const v = e.target.value.replace(/\D/g, '').slice(0, 6)
            setCode(v)
            // with nothing else to fill in, a complete code goes straight away
            if (v.length === 6 && !extra) onVerify(v)
          }}
        />
      </Field>
      {extra}
      <ErrorLine error={error} />
      <Button variant="primary" type="submit" loading={busy} disabled={code.length !== 6} full>
        Continue
      </Button>
      <div className="auth-row">
        <button type="button" className="auth-link" onClick={onBack}>
          Back
        </button>
        <button
          type="button"
          className="auth-link"
          disabled={wait > 0}
          onClick={async () => {
            await onResend()
            setWait(30)
          }}
        >
          {wait > 0 ? `New code in ${wait}s` : 'Send a new code'}
        </button>
      </div>
    </form>
  )
}

export function SignIn() {
  const mail = useSession((s) => !!s.info?.mail)
  const [how, setHow] = useState('password')
  const [step, setStep] = useState(null) // { kind: 'admin', challenge, to } | { kind: 'login', to }
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  const withPassword = useSubmit(async () => {
    const r = await api('POST', '/login', { email, password })
    if (r.needsCode) return setStep({ kind: 'admin', challenge: r.challenge, to: r.email || email })
    signedIn(r.user)
  })
  const withCode = useSubmit(async () => {
    await api('POST', '/login/code', { email })
    setStep({ kind: 'login', to: email })
  })
  const verify = useSubmit(async (code) => {
    const r = step.kind === 'admin' ? await api('POST', '/login/verify', { challenge: step.challenge, code }) : await api('POST', '/login/code/verify', { email, code })
    signedIn(r.user)
  })
  const resend = async () => {
    if (step.kind === 'login') return api('POST', '/login/code', { email })
    const r = await api('POST', '/login', { email, password })
    if (r.challenge) setStep({ ...step, challenge: r.challenge })
  }

  if (step)
    return (
      <Card title="Check your email" subtitle={step.kind === 'admin' ? 'Admins confirm every sign-in with a code.' : null}>
        <CodeStep to={step.to} busy={verify.busy} error={verify.error} onVerify={(code) => verify.submit(null, code)} onResend={resend} onBack={() => setStep(null)} />
      </Card>
    )

  return (
    <Card
      title="Sign in to Lumen"
      subtitle="Your tasks, calendar and docs."
      footer={
        <>
          Have an invite? Open the link you were sent.
        </>
      }
    >
      {mail && (
        <div className="auth-switch">
          <Segmented
            label="Sign in with"
            value={how}
            onChange={setHow}
            options={[
              { value: 'password', label: 'Password' },
              { value: 'code', label: 'Email code' },
            ]}
          />
        </div>
      )}
      {how === 'password' || !mail ? (
        <form className="auth-form" onSubmit={withPassword.submit}>
          <Field label="Email">
            <Input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
          </Field>
          <Field label="Password">
            <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </Field>
          <ErrorLine error={withPassword.error} />
          <Button variant="primary" type="submit" loading={withPassword.busy} full>
            Sign in
          </Button>
          {mail && (
            <a className="auth-link auth-forgot" href="#/forgot">
              Forgot your password?
            </a>
          )}
        </form>
      ) : (
        <form className="auth-form" onSubmit={withCode.submit}>
          <Field label="Email" hint="We’ll email you a code — no password needed.">
            <Input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
          </Field>
          <ErrorLine error={withCode.error} />
          <Button variant="primary" type="submit" loading={withCode.busy} full>
            Email me a code
          </Button>
        </form>
      )}
    </Card>
  )
}

export function ForgotPassword() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [password, setPassword] = useState('')
  const [done, setDone] = useState(false)
  const request = useSubmit(async () => {
    await api('POST', '/password/forgot', { email })
    setSent(true)
  })
  const reset = useSubmit(async (code) => {
    if (password.length < 8) throw new Error('Use at least 8 characters for the password.')
    const r = await api('POST', '/password/reset', { email, code, password })
    if (r.user) return signedIn(r.user)
    setDone(true)
  })
  if (done)
    return (
      <Card title="Password changed" subtitle="Sign in with your new password.">
        <div className="auth-form">
          <Button variant="primary" full onClick={() => navigate('/signin', { replace: true })}>
            Sign in
          </Button>
        </div>
      </Card>
    )
  return (
    <Card title="Reset your password" subtitle={sent ? null : 'We’ll email you a code to set a new one.'} footer={<a href="#/signin">Back to sign in</a>}>
      {sent ? (
        <CodeStep
          to={email}
          busy={reset.busy}
          error={reset.error}
          onVerify={(code) => reset.submit(null, code)}
          onResend={() => api('POST', '/password/forgot', { email })}
          onBack={() => setSent(false)}
          extra={
            <Field label="New password" hint="At least 8 characters.">
              <Input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </Field>
          }
        />
      ) : (
        <form className="auth-form" onSubmit={request.submit}>
          <Field label="Email">
            <Input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
          </Field>
          <ErrorLine error={request.error} />
          <Button variant="primary" type="submit" loading={request.busy} full>
            Email me a code
          </Button>
        </form>
      )}
    </Card>
  )
}

export function Setup() {
  const setup = useSession((s) => s.setup)
  const [form, setForm] = useState({ name: '', email: '', password: '', confirm: '' })
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })
  const { busy, error, submit, setError } = useSubmit(async () => {
    if (form.password !== form.confirm) throw new Error('The passwords don’t match.')
    await setup({ name: form.name, email: form.email, password: form.password })
    navigate('/today', { replace: true })
  })
  useEffect(() => setError(''), [form, setError])
  return (
    <Card title="Set up Lumen" subtitle="Create the admin account. Only the admin can invite other people.">
      <form className="auth-form" onSubmit={submit}>
        <Field label="Your name">
          <Input autoComplete="name" value={form.name} onChange={set('name')} required autoFocus />
        </Field>
        <Field label="Email">
          <Input type="email" autoComplete="email" value={form.email} onChange={set('email')} required />
        </Field>
        <Field label="Password" hint="At least 8 characters.">
          <Input type="password" autoComplete="new-password" minLength={8} value={form.password} onChange={set('password')} required />
        </Field>
        <Field label="Confirm password">
          <Input type="password" autoComplete="new-password" value={form.confirm} onChange={set('confirm')} required />
        </Field>
        <ErrorLine error={error} />
        <Button variant="primary" type="submit" loading={busy} full>
          Create account
        </Button>
      </form>
    </Card>
  )
}

export function AcceptInvite({ token }) {
  const accept = useSession((s) => s.acceptInvite)
  const [invite, setInvite] = useState(null)
  const [state, setState] = useState('loading')
  const [form, setForm] = useState({ name: '', email: '', password: '' })
  useEffect(() => {
    api('GET', `/invites/${encodeURIComponent(token)}`)
      .then((inv) => {
        setInvite(inv)
        setForm((f) => ({ ...f, email: inv.email || '' }))
        setState('ready')
      })
      .catch(() => setState('gone'))
  }, [token])
  const { busy, error, submit } = useSubmit(async () => {
    await accept(token, form)
    navigate('/today', { replace: true })
  })
  if (state === 'loading')
    return (
      <div className="auth">
        <Spinner size={18} />
      </div>
    )
  if (state === 'gone')
    return (
      <Card title="This invite has expired" subtitle="Invite links work once and expire after a week. Ask for a new one." footer={<a href="#/signin">Sign in instead</a>} />
    )
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })
  return (
    <Card title="You’re invited to Lumen" subtitle={invite.role === 'admin' ? 'You’ll join as an admin.' : 'Create your account to join.'}>
      <form className="auth-form" onSubmit={submit}>
        <Field label="Your name">
          <Input autoComplete="name" value={form.name} onChange={set('name')} required autoFocus />
        </Field>
        <Field label="Email">
          <Input type="email" autoComplete="email" value={form.email} onChange={set('email')} readOnly={!!invite.email} required />
        </Field>
        <Field label="Password" hint="At least 8 characters.">
          <Input type="password" autoComplete="new-password" minLength={8} value={form.password} onChange={set('password')} required />
        </Field>
        <ErrorLine error={error} />
        <Button variant="primary" type="submit" loading={busy} full>
          Join
        </Button>
      </form>
    </Card>
  )
}

const DOWNLOADS = 'https://github.com/skillissu3s/lumen/releases/latest'
const LAST_SERVER = 'lumen.server'

// "lumen.example.com" → "https://lumen.example.com"; null if it isn't an address
function serverUrl(input) {
  const raw = String(input || '').trim().replace(/\/+$/, '').replace(/\/app\.html.*$/, '')
  if (!raw) return null
  try {
    const u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`)
    return u.protocol === 'https:' || u.protocol === 'http:' ? `${u.origin}${u.pathname.replace(/\/+$/, '')}` : null
  } catch {
    return null
  }
}

const remembered = () => {
  try {
    return localStorage.getItem(LAST_SERVER) || ''
  } catch {
    return ''
  }
}

/** Opened with no Lumen server behind it (a static copy of the app): where is yours? */
export function NoServer() {
  const [address, setAddress] = useState(remembered)
  const [error, setError] = useState('')
  const go = (e) => {
    e.preventDefault()
    const url = serverUrl(address)
    if (!url) return setError('Enter your Lumen server’s address, like lumen.example.com.')
    try {
      localStorage.setItem(LAST_SERVER, url)
    } catch {
      /* storage unavailable */
    }
    window.location.href = `${url}/app.html`
  }
  return (
    <Card
      title="Open Lumen"
      subtitle="Lumen runs on a Lumen server, or as an app on your computer."
      footer={
        <>
          Used Lumen with a GitHub repository before? Your data is still there: an admin can bring it in from Settings → Sync.
        </>
      }
    >
      <form className="auth-form" onSubmit={go}>
        <Field label="Your Lumen server">
          <Input icon={Cloud} value={address} onChange={(e) => (setAddress(e.target.value), setError(''))} placeholder="lumen.example.com" autoFocus spellCheck={false} autoCapitalize="off" />
        </Field>
        <ErrorLine error={error} />
        <Button variant="primary" type="submit" iconRight={ArrowRight} full>
          Continue
        </Button>
        <a className="auth-alt" href={DOWNLOADS} target="_blank" rel="noopener noreferrer">
          <Download size={14} /> Get the desktop app
        </a>
      </form>
    </Card>
  )
}

/** The desktop app's first question: a Lumen server, or this computer only */
export function DesktopWelcome() {
  const [step, setStep] = useState(null) // null · 'signin' · { code } · { keep }
  const [form, setForm] = useState({ server: '', email: '', password: '' })
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })
  const done = async () => {
    navigate('/today', { replace: true })
    await useSession.getState().boot()
  }
  const local = useSubmit(async () => {
    await api('POST', '/desktop/mode', { mode: 'local' })
    await done()
  })
  // signed in: if this computer has its own work, ask what to keep
  const signedIn = async (r) => {
    if (r.hasOwnData) setStep({ keep: r.user })
    else await finish.submit(null, 'server')
  }
  const signin = useSubmit(async () => {
    const r = await api('POST', '/desktop/cloud/login', form)
    setForm((f) => ({ ...f, server: r.server }))
    if (r.needsCode) setStep({ code: r })
    else await signedIn(r)
  })
  const verify = useSubmit(async (code) => signedIn(await api('POST', '/desktop/cloud/verify', { server: form.server, challenge: step.code.challenge, code })))
  const finish = useSubmit(async (keep) => {
    await api('POST', '/desktop/cloud/link', { keep })
    await done()
  })

  if (step?.code)
    return (
      <Card title="Check your email" subtitle="Admins confirm every sign-in with a code.">
        <CodeStep to={step.code.email} busy={verify.busy || finish.busy} error={verify.error || finish.error} onVerify={(code) => verify.submit(null, code)} onResend={() => signin.submit()} onBack={() => setStep('signin')} />
      </Card>
    )
  if (step?.keep)
    return (
      <Card title={`Signed in as ${step.keep.name}`} subtitle="This computer already has boards, docs or tasks of its own.">
        <div className="auth-form">
          <button type="button" className="auth-choice" onClick={() => finish.submit(null, 'both')} disabled={finish.busy}>
            <Cloud size={18} />
            <span>
              <b>Keep both</b>
              <small>Add what is on this computer to your account, next to what is already there.</small>
            </span>
          </button>
          <button type="button" className="auth-choice" onClick={() => finish.submit(null, 'server')} disabled={finish.busy}>
            <Monitor size={18} />
            <span>
              <b>Use my account’s only</b>
              <small>This computer’s work is saved to a backup folder first, then replaced by your account’s.</small>
            </span>
          </button>
          <ErrorLine error={finish.error} />
        </div>
      </Card>
    )
  if (step === 'signin')
    return (
      <Card title="Sign in to a Lumen server" subtitle="Your account’s work stays on this computer too, so Lumen works offline and catches up when it’s back online." footer={<button type="button" className="auth-link" onClick={() => setStep(null)}>Back</button>}>
        <form className="auth-form" onSubmit={signin.submit}>
          <Field label="Server">
            <Input icon={Cloud} value={form.server} onChange={set('server')} placeholder="lumen.example.com" autoFocus spellCheck={false} autoCapitalize="off" required />
          </Field>
          <Field label="Email">
            <Input type="email" value={form.email} onChange={set('email')} autoComplete="email" required />
          </Field>
          <Field label="Password">
            <Input type="password" icon={Lock} value={form.password} onChange={set('password')} autoComplete="current-password" required />
          </Field>
          <ErrorLine error={signin.error || finish.error} />
          <Button variant="primary" type="submit" loading={signin.busy || finish.busy} iconRight={ArrowRight} full>
            Sign in
          </Button>
        </form>
      </Card>
    )
  return (
    <Card title="Welcome to Lumen" subtitle="Where should your tasks, calendar and docs live?">
      <div className="auth-form">
        <button type="button" className="auth-choice" onClick={() => setStep('signin')}>
          <Cloud size={18} />
          <span>
            <b>Sign in to a Lumen server</b>
            <small>Your account, on every device. Works offline here and catches up when you’re back online.</small>
          </span>
        </button>
        <button type="button" className="auth-choice" onClick={local.submit} disabled={local.busy}>
          <Monitor size={18} />
          <span>
            <b>Use on this computer only</b>
            <small>Everything stays here, with no account. You can sign in to a server later.</small>
          </span>
        </button>
        <ErrorLine error={local.error} />
      </div>
    </Card>
  )
}

export function BootScreen() {
  return (
    <div className="auth boot" aria-busy="true">
      <Logo size={28} />
    </div>
  )
}

export function BootError({ message, onRetry }) {
  return (
    <Card title="Couldn’t open your workspace" subtitle={message}>
      <div className="auth-form">
        <Button variant="primary" onClick={onRetry} full>
          Try again
        </Button>
      </div>
    </Card>
  )
}
