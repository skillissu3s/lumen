// Signing in: server accounts (sign in, first-run setup, invites) and GitHub mode.
import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, Check, ExternalLink, Lock, Search } from 'lucide-react'
import { Button, Field, Input, Segmented, Spinner } from '../components/ui/index.js'
import { useSession } from '../store/session.js'
import { api } from '../lib/api.js'
import { navigate } from '../lib/router.js'
import { githubUser, listRepos } from '../storage/github.js'
import { Logo } from '../shell/Logo.jsx'

function GithubMark({ size = 15 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  )
}

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
          Have an invite? Open the link you were sent. · <a href="#/github">Use with GitHub instead</a>
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

const TOKEN_URL = 'https://github.com/settings/personal-access-tokens/new'

export function ConnectGitHub() {
  const connect = useSession((s) => s.connectGitHub)
  const mode = useSession((s) => s.mode)
  const [token, setToken] = useState('')
  const [who, setWho] = useState(null)
  const [repos, setRepos] = useState([])
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState(null)
  const [typed, setTyped] = useState('')
  const [branch, setBranch] = useState('')

  const check = useSubmit(async () => {
    const u = await githubUser(token.trim())
    setWho(u)
    setRepos(await listRepos(token.trim()))
  })
  const finish = useSubmit(async () => {
    const full = picked?.full_name || typed.trim()
    const m = /^([\w.-]+)\/([\w.-]+)$/.exec(full)
    if (!m) throw new Error('Pick a repository, or type it as owner/name.')
    await connect({ token: token.trim(), owner: m[1], repo: m[2], branch: branch.trim() || picked?.default_branch })
    navigate('/today', { replace: true })
  })

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return repos.filter((r) => !q || r.full_name.toLowerCase().includes(q)).slice(0, 50)
  }, [repos, query])

  return (
    <Card
      title="Use Lumen with GitHub"
      subtitle="Your tasks, calendar and docs live as text files in a repository you choose. The token stays in this browser."
      footer={mode === 'server' ? <a href="#/signin">Sign in with an account instead</a> : null}
    >
      {!who ? (
        <form className="auth-form" onSubmit={check.submit}>
          <Field
            label="GitHub token"
            hint={
              <>
                <a href={TOKEN_URL} target="_blank" rel="noopener noreferrer">
                  Create a fine-grained token <ExternalLink size={11} style={{ display: 'inline' }} />
                </a>{' '}
                with access to one repository and <b>Contents: Read and write</b>.
              </>
            }
          >
            <Input type="password" icon={Lock} value={token} onChange={(e) => setToken(e.target.value)} placeholder="github_pat_…" required autoFocus spellCheck={false} />
          </Field>
          <ErrorLine error={check.error} />
          <Button variant="primary" type="submit" loading={check.busy} iconRight={ArrowRight} full>
            Continue
          </Button>
        </form>
      ) : (
        <form className="auth-form" onSubmit={finish.submit}>
          <div className="auth-who">
            <GithubMark /> Signed in as <b>@{who.login}</b>
            <button type="button" className="auth-link" onClick={() => setWho(null)}>
              Change
            </button>
          </div>
          <Field label="Repository" hint="Create an empty private repository on GitHub first if you don’t have one.">
            <Input icon={Search} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search your repositories" />
          </Field>
          <div className="repo-list" role="listbox" aria-label="Repositories">
            {shown.map((r) => {
              const canWrite = r.permissions?.push !== false
              return (
                <button
                  key={r.id}
                  type="button"
                  role="option"
                  aria-selected={picked?.id === r.id}
                  disabled={!canWrite}
                  className="repo-option"
                  onClick={() => {
                    setPicked(r)
                    setBranch(r.default_branch || 'main')
                  }}
                >
                  <span className="repo-name">{r.full_name}</span>
                  <span className="repo-meta">{!canWrite ? 'read only' : r.private ? 'private' : 'public'}</span>
                  {picked?.id === r.id && <Check size={14} />}
                </button>
              )
            })}
            {!shown.length && <div className="repo-empty">No repositories found. Type owner/name below.</div>}
          </div>
          {!picked && (
            <Field label="Or type it">
              <Input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="owner/name" spellCheck={false} />
            </Field>
          )}
          <Field label="Branch">
            <Input value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="main" spellCheck={false} />
          </Field>
          <ErrorLine error={finish.error} />
          <Button variant="primary" type="submit" loading={finish.busy} full>
            Open workspace
          </Button>
        </form>
      )}
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
  const disconnect = useSession((s) => s.disconnectGitHub)
  return (
    <Card title="Couldn’t open your workspace" subtitle={message}>
      <div className="auth-form">
        <Button variant="primary" onClick={onRetry} full>
          Try again
        </Button>
        <Button variant="ghost" onClick={disconnect} full>
          Use a different token
        </Button>
      </div>
    </Card>
  )
}
