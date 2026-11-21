// Signing an app in to Lumen as an AI agent (docs/MCP.md → Connecting by
// signing in): OAuth 2.1 as MCP asks for it, so an app like Claude needs only
// Lumen's address. The app finds where to go (two /.well-known files),
// registers itself, sends the person to Lumen to approve (#/authorize, which
// chooses spaces as Settings → AI agents does), and swaps the one-time code it
// gets back, with its PKCE secret, for tokens. What it's given is an agent like
// any other: listed in Settings → AI agents, and gone the moment it's removed.
import crypto from 'node:crypto'
import express from 'express'
import { PUBLIC_URL } from './config.js'
import { db } from './db.js'
import { HttpError } from './auth.js'
import { apiErrors, csrf, jsonBody, loadUser, requireUser } from './api.js'
import { agentForApp, checkReach, issueGrant, refreshGrant, revokeGrant } from './agents.js'

db.exec(`
CREATE TABLE IF NOT EXISTS oauth_clients (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  redirect_uris TEXT NOT NULL,
  secret_hash TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS oauth_codes (
  code_hash TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  redirect_uri TEXT NOT NULL,
  challenge TEXT NOT NULL,
  access TEXT NOT NULL,
  scopes TEXT,
  expires_at INTEGER NOT NULL
);
`)

const CODE_FOR = 5 * 60000
const sha = (t) => crypto.createHash('sha256').update(String(t)).digest('hex')
const b64url = (buf) => Buffer.from(buf).toString('base64url')
const parse = (s, fallback) => {
  try {
    return JSON.parse(s)
  } catch {
    return fallback
  }
}

/** This server as apps reach it: PUBLIC_URL, or the address the request came to */
export const publicBase = (req) => (PUBLIC_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '')

// ---------- where an app finds everything ----------

const resourceMeta = (req) => ({
  resource: `${publicBase(req)}/mcp`,
  authorization_servers: [publicBase(req)],
  bearer_methods_supported: ['header'],
  scopes_supported: ['lumen'],
  resource_name: 'Lumen',
})

const serverMeta = (req) => {
  const base = publicBase(req)
  return {
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/oauth/token`,
    registration_endpoint: `${base}/oauth/register`,
    revocation_endpoint: `${base}/oauth/revoke`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
    scopes_supported: ['lumen'],
  }
}

/** What /mcp says when no token came: where to sign in */
export const signInHint = (req) => `Bearer resource_metadata="${publicBase(req)}/.well-known/oauth-protected-resource/mcp"`

// ---------- apps ----------

// where an app may ask to be sent back to: https, an app's own scheme, or this
// computer (apps that run here listen on a local port, which may change)
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]'])
function checkRedirect(uri) {
  let u
  try {
    u = new URL(String(uri))
  } catch {
    return false
  }
  if (u.hash) return false
  if (u.protocol === 'https:') return true
  if (u.protocol === 'http:') return LOOPBACK.has(u.hostname)
  return !['javascript:', 'data:', 'file:', 'vbscript:', 'blob:'].includes(u.protocol)
}

function sameRedirect(registered, asked) {
  if (registered === asked) return true
  try {
    const a = new URL(registered)
    const b = new URL(asked)
    return a.protocol === 'http:' && LOOPBACK.has(a.hostname) && a.hostname === b.hostname && a.pathname === b.pathname && a.search === b.search
  } catch {
    return false
  }
}

const clientOf = (id) => {
  const c = db.prepare('SELECT * FROM oauth_clients WHERE id = ?').get(String(id || ''))
  return c ? { ...c, redirect_uris: parse(c.redirect_uris, []) } : null
}

const oauthError = (res, status, error, description) => res.status(status).set('Cache-Control', 'no-store').json({ error, ...(description ? { error_description: description } : {}) })

/**
 * The approval an app asks for (its query) checked: → { client, redirect } or
 * an error. `redirect`: where to send the person back, once it's trusted.
 */
function checkAsk(q) {
  const client = clientOf(q.client_id)
  if (!client) return { error: 'This app isn’t registered with Lumen. Remove it and add it again.' }
  const redirect = q.redirect_uri || (client.redirect_uris.length === 1 ? client.redirect_uris[0] : null)
  if (!redirect || !client.redirect_uris.some((r) => sameRedirect(r, redirect))) return { error: 'This app asked to return somewhere it didn’t register.' }
  // from here on, problems go back to the app
  if (q.response_type !== 'code') return { client, redirect, back: 'unsupported_response_type' }
  if (!q.code_challenge || (q.code_challenge_method || 'plain') !== 'S256') return { client, redirect, back: 'invalid_request' }
  return { client, redirect }
}

function backTo(redirect, params) {
  const u = new URL(redirect)
  for (const [k, v] of Object.entries(params)) if (v != null) u.searchParams.set(k, v)
  return u.toString()
}

// ---------- routes ----------

export const oauthRouter = express.Router()

// apps call these from anywhere (no cookies involved), some from a browser
oauthRouter.use(['/.well-known/oauth-protected-resource', '/.well-known/oauth-authorization-server', '/oauth/register', '/oauth/token', '/oauth/revoke'], (req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*')
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, MCP-Protocol-Version')
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  if (req.method === 'OPTIONS') return res.status(204).end()
  next()
})

for (const p of ['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp']) oauthRouter.get(p, (req, res) => res.json(resourceMeta(req)))
for (const p of ['/.well-known/oauth-authorization-server', '/.well-known/oauth-authorization-server/mcp']) oauthRouter.get(p, (req, res) => res.json(serverMeta(req)))

// an app registers itself (RFC 7591): its name and where to send people back
oauthRouter.post('/oauth/register', express.json({ limit: '64kb' }), (req, res) => {
  const b = req.body || {}
  const uris = Array.isArray(b.redirect_uris) ? b.redirect_uris.map(String) : []
  if (!uris.length || uris.length > 10 || !uris.every(checkRedirect)) return oauthError(res, 400, 'invalid_redirect_uri', 'Give one to ten redirect_uris: https, an app scheme, or a local address.')
  const method = b.token_endpoint_auth_method || 'none'
  if (!['none', 'client_secret_post', 'client_secret_basic'].includes(method)) return oauthError(res, 400, 'invalid_client_metadata', 'Unsupported token_endpoint_auth_method.')
  const id = `lumen_app_${crypto.randomBytes(12).toString('base64url')}`
  const secret = method === 'none' ? null : crypto.randomBytes(32).toString('base64url')
  const name = String(b.client_name || 'An app').trim().slice(0, 60) || 'An app'
  const at = Date.now()
  db.prepare('INSERT INTO oauth_clients (id, name, redirect_uris, secret_hash, created_at) VALUES (?, ?, ?, ?, ?)').run(id, name, JSON.stringify(uris), secret ? sha(secret) : null, at)
  res.status(201).json({
    client_id: id,
    client_id_issued_at: Math.floor(at / 1000),
    ...(secret ? { client_secret: secret, client_secret_expires_at: 0 } : {}),
    client_name: name,
    redirect_uris: uris,
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: method,
  })
})

// the person comes here from the app: checked, then on to the approval page
const ASK = ['response_type', 'client_id', 'redirect_uri', 'code_challenge', 'code_challenge_method', 'state', 'scope', 'resource']
oauthRouter.get('/oauth/authorize', (req, res) => {
  const q = Object.fromEntries(ASK.filter((k) => req.query[k] != null).map((k) => [k, String(req.query[k])]))
  const r = checkAsk(q)
  if (r.error) return res.status(400).type('text/plain').send(r.error)
  if (r.back) return res.redirect(backTo(r.redirect, { error: r.back, state: q.state }))
  res.redirect(`/app.html#/authorize?${new URLSearchParams(q)}`)
})

// the app swaps a code (or a refresh token) for tokens
function clientAuth(req) {
  const basic = /^Basic\s+(\S+)$/i.exec(String(req.headers.authorization || ''))?.[1]
  if (basic) {
    const [id, secret] = Buffer.from(basic, 'base64').toString().split(':').map(decodeURIComponent)
    return { id, secret }
  }
  return { id: req.body?.client_id, secret: req.body?.client_secret }
}

oauthRouter.post('/oauth/token', express.urlencoded({ extended: false }), express.json(), (req, res) => {
  res.set('Cache-Control', 'no-store')
  const b = req.body || {}
  const auth = clientAuth(req)
  const client = clientOf(auth.id)
  if (!client) return oauthError(res, 401, 'invalid_client')
  if (client.secret_hash && sha(auth.secret || '') !== client.secret_hash) return oauthError(res, 401, 'invalid_client')
  if (b.grant_type === 'authorization_code') {
    const code = db.prepare('SELECT * FROM oauth_codes WHERE code_hash = ?').get(sha(b.code || ''))
    // a code works once, for the app it was given to, within five minutes
    if (code) db.prepare('DELETE FROM oauth_codes WHERE code_hash = ?').run(code.code_hash)
    if (!code || code.client_id !== client.id || code.expires_at < Date.now()) return oauthError(res, 400, 'invalid_grant', 'That code is wrong, used or expired.')
    if (b.redirect_uri && !sameRedirect(code.redirect_uri, String(b.redirect_uri))) return oauthError(res, 400, 'invalid_grant', 'redirect_uri doesn’t match.')
    if (!b.code_verifier || b64url(crypto.createHash('sha256').update(String(b.code_verifier)).digest()) !== code.challenge) return oauthError(res, 400, 'invalid_grant', 'code_verifier doesn’t match.')
    const user = db.prepare('SELECT * FROM users WHERE id = ? AND disabled = 0').get(code.user_id)
    if (!user) return oauthError(res, 400, 'invalid_grant')
    const agentId = agentForApp(user, client, { access: code.access, scopes: parse(code.scopes, null) })
    return res.json(issueGrant(agentId, client.id))
  }
  if (b.grant_type === 'refresh_token') {
    const out = refreshGrant(b.refresh_token, client.id)
    return out ? res.json(out) : oauthError(res, 400, 'invalid_grant', 'That refresh token is wrong, used or expired.')
  }
  oauthError(res, 400, 'unsupported_grant_type')
})

// an app signing out (RFC 7009): always fine
oauthRouter.post('/oauth/revoke', express.urlencoded({ extended: false }), express.json(), (req, res) => {
  revokeGrant(req.body?.token)
  res.status(200).end()
})

// ---------- the approval page's own calls (signed in to Lumen) ----------

const pageApi = express.Router()
pageApi.use(jsonBody, csrf, loadUser, requireUser)

// what is asking: its name and where it goes back to, to show the person
pageApi.get('/', (req, res) => {
  const r = checkAsk(req.query)
  if (r.error) throw new HttpError(400, r.error)
  res.json({ client: { name: r.client.name, host: new URL(r.redirect).host || new URL(r.redirect).protocol.replace(':', '') }, ...(r.back ? { problem: r.back } : {}) })
})

// allowed (with the reach chosen) or not: → { redirect } back to the app
pageApi.post('/', (req, res) => {
  const q = req.body?.ask || {}
  const r = checkAsk(q)
  if (r.error) throw new HttpError(400, r.error)
  if (r.back || !req.body?.allow) return res.json({ redirect: backTo(r.redirect, { error: r.back || 'access_denied', state: q.state }) })
  const access = String(req.body.access || 'edit')
  const scopes = req.body.scopes ?? null
  // checked now, as making the agent will, rather than failing when the app swaps the code
  checkReach(access, scopes)
  const code = crypto.randomBytes(32).toString('base64url')
  db.prepare('INSERT INTO oauth_codes (code_hash, client_id, user_id, redirect_uri, challenge, access, scopes, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(sha(code), r.client.id, req.user.id, r.redirect, String(q.code_challenge), access, scopes ? JSON.stringify(scopes) : null, Date.now() + CODE_FOR)
  res.json({ redirect: backTo(r.redirect, { code, state: q.state, iss: publicBase(req) }) })
})
pageApi.use(apiErrors)
oauthRouter.use('/api/oauth/request', pageApi)
