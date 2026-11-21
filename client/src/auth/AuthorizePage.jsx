// #/authorize: an app asking to connect to Lumen as an AI agent (server/oauth.js).
// The person sees which app and where it sends them back, chooses what it may
// do (everywhere, or space by space), and allows or declines; either way the
// app gets its answer. Opened signed out, it waits for signing in.
import { useEffect, useState } from 'react'
import { Button, Spinner } from '../components/ui/index.js'
import { api } from '../lib/api.js'
import { useSpaces } from '../store/spaces.js'
import { Logo } from '../shell/Logo.jsx'
import { Reach } from '../views/settings/Reach.jsx'

const PENDING = 'lumen.authorize'

/** An approval opened while signed out, to carry on after signing in: the hash to go back to */
export function pendingAuthorize() {
  try {
    const h = sessionStorage.getItem(PENDING)
    sessionStorage.removeItem(PENDING)
    return h
  } catch {
    return null
  }
}

export function rememberAuthorize() {
  try {
    sessionStorage.setItem(PENDING, window.location.hash.replace(/^#/, ''))
  } catch {
    /* storage unavailable: they'll start again from the app */
  }
}

export default function AuthorizePage({ query }) {
  const [ask, setAsk] = useState(null)
  const [error, setError] = useState('')
  const [reach, setReach] = useState({ access: 'edit', scopes: null })
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    useSpaces.getState().load()
    api('GET', `/oauth/request?${new URLSearchParams(query)}`)
      .then(setAsk)
      .catch((e) => setError(e.message))
  }, [query])

  const answer = async (allow) => {
    setBusy(true)
    try {
      const r = await api('POST', '/oauth/request', { ask: query, allow, ...reach })
      window.location.assign(r.redirect)
    } catch (e) {
      setError(e.message)
      setBusy(false)
    }
  }

  return (
    <div className="auth">
      <div className="auth-card authorize-card">
        <span className="auth-brand">
          <Logo size={28} />
        </span>
        {error ? (
          <>
            <h1 className="auth-title">Can’t connect this app</h1>
            <p className="auth-subtitle">{error}</p>
          </>
        ) : !ask ? (
          <Spinner size={18} />
        ) : (
          <>
            <h1 className="auth-title">Connect {ask.client.name} to Lumen?</h1>
            <p className="auth-subtitle">
              {ask.client.name} will use Lumen as an AI agent, as you, and only where you allow it. You’ll go back to <b>{ask.client.host}</b>. You can change or remove it any time in Settings → AI agents.
            </p>
            <div className="authorize-reach">
              <Reach value={reach} onChange={setReach} />
            </div>
            <div className="auth-form">
              <Button variant="primary" full loading={busy} disabled={reach.scopes && !Object.keys(reach.scopes).length} onClick={() => answer(true)}>
                Allow
              </Button>
              <Button variant="ghost" full disabled={busy} onClick={() => answer(false)}>
                Don’t allow
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
