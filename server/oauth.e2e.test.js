// An app connecting to Lumen by signing in (server/oauth.js), the way Claude's
// connectors do: discovery, registration, the person's approval, swapping the
// code with PKCE, using and renewing the tokens, and every way it should fail.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const CALLBACK = 'https://claude.ai/api/mcp/auth_callback'
let base = ''
let server = null
let ada = ''
let crew = null

function freePort() {
  return new Promise((resolve) => {
    const s = net.createServer()
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port
      s.close(() => resolve(p))
    })
  })
}

async function call(cookie, method, url, body) {
  const res = await fetch(base + url, { method, headers: { cookie: cookie || '', 'content-type': 'application/json', 'x-lumen': '1' }, body: body === undefined ? undefined : JSON.stringify(body) })
  const json = await res.json().catch(() => null)
  if (!res.ok) throw Object.assign(new Error(json?.error || String(res.status)), { status: res.status })
  return { json, cookie: res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ') }
}

// the app's side: a form post to the token address
const token = (body) => fetch(`${base}/oauth/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body) }).then(async (r) => ({ status: r.status, json: await r.json() }))
const mcp = (bearer, method, params) => fetch(`${base}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${bearer}` }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }))
const pkce = () => {
  const verifier = crypto.randomBytes(32).toString('base64url')
  return { verifier, challenge: crypto.createHash('sha256').update(verifier).digest('base64url') }
}

before(async () => {
  const port = await freePort()
  base = `http://127.0.0.1:${port}`
  server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(here, 'index.js')], {
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-oauth-')), ADMIN_EMAIL: '', ADMIN_PASSWORD: '', MAIL_LOG_CODES: '', SMTP_URL: '', SMTP_HOST: '', PUBLIC_URL: '' },
    stdio: ['ignore', 'ignore', 'inherit'],
  })
  for (let i = 0; i < 150; i++) {
    try {
      if ((await fetch(`${base}/healthz`)).ok) break
    } catch {
      /* not up yet */
    }
    await sleep(100)
  }
  ada = (await call('', 'POST', '/api/setup', { email: 'ada@example.com', name: 'Ada', handle: 'ada', password: 'password123' })).cookie
  crew = (await call(ada, 'POST', '/api/spaces', { name: 'Crew' })).json.space
})

after(() => server?.kill())

/** Register, ask, approve as Ada: → { client, code, verifier, state } */
async function approve(reach = { access: 'edit', scopes: null }) {
  const reg = await fetch(`${base}/oauth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'Claude', redirect_uris: [CALLBACK], token_endpoint_auth_method: 'none' }) })
  assert.equal(reg.status, 201)
  const client = await reg.json()
  const { verifier, challenge } = pkce()
  const ask = { response_type: 'code', client_id: client.client_id, redirect_uri: CALLBACK, code_challenge: challenge, code_challenge_method: 'S256', state: 'xyz', resource: `${base}/mcp` }
  // the person lands on Lumen's approval page
  const go = await fetch(`${base}/oauth/authorize?${new URLSearchParams(ask)}`, { redirect: 'manual' })
  assert.equal(go.status, 302)
  assert.match(go.headers.get('location'), /^\/app\.html#\/authorize\?/)
  const shown = (await call(ada, 'GET', `/api/oauth/request?${new URLSearchParams(ask)}`)).json
  assert.deepEqual(shown.client, { name: 'Claude', host: 'claude.ai' })
  const back = new URL((await call(ada, 'POST', '/api/oauth/request', { ask, allow: true, ...reach })).json.redirect)
  assert.equal(back.origin + back.pathname, CALLBACK)
  assert.equal(back.searchParams.get('state'), 'xyz')
  return { client, code: back.searchParams.get('code'), verifier }
}

test('an app finds where to sign in from /mcp alone', async () => {
  const r = await fetch(`${base}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }) })
  assert.equal(r.status, 401)
  const meta = /resource_metadata="([^"]+)"/.exec(r.headers.get('www-authenticate'))[1]
  const resource = await (await fetch(meta)).json()
  assert.equal(resource.resource, `${base}/mcp`)
  const as = await (await fetch(`${resource.authorization_servers[0]}/.well-known/oauth-authorization-server`)).json()
  assert.equal(as.issuer, base)
  assert.deepEqual(as.code_challenge_methods_supported, ['S256'])
  for (const k of ['authorization_endpoint', 'token_endpoint', 'registration_endpoint']) assert.ok(as[k].startsWith(base), k)
})

test('approved, the app gets tokens that work, renew, and show as an agent', async () => {
  const { client, code, verifier } = await approve()
  const t = await token({ grant_type: 'authorization_code', code, redirect_uri: CALLBACK, client_id: client.client_id, code_verifier: verifier })
  assert.equal(t.status, 200)
  assert.equal(t.json.token_type, 'Bearer')
  const list = await mcp(t.json.access_token, 'tools/call', { name: 'list_spaces', arguments: {} })
  assert.match(list.json.result.content[0].text, /workspaces\/crew\//)
  // a code works once
  assert.equal((await token({ grant_type: 'authorization_code', code, redirect_uri: CALLBACK, client_id: client.client_id, code_verifier: verifier })).json.error, 'invalid_grant')
  // renewing spends the refresh token and gives a new pair
  const r = await token({ grant_type: 'refresh_token', refresh_token: t.json.refresh_token, client_id: client.client_id })
  assert.equal(r.status, 200)
  assert.notEqual(r.json.access_token, t.json.access_token)
  assert.equal((await token({ grant_type: 'refresh_token', refresh_token: t.json.refresh_token, client_id: client.client_id })).json.error, 'invalid_grant')
  assert.equal((await mcp(r.json.access_token, 'ping')).status, 200)
  // a refresh token isn't an access token
  assert.equal((await mcp(r.json.refresh_token, 'ping')).status, 401)
  // it's an agent in Settings; removing it cuts the app off
  const agent = (await call(ada, 'GET', '/api/me/agents')).json.agents.find((a) => a.connected)
  assert.equal(agent.name, 'Claude')
  await call(ada, 'DELETE', `/api/me/agents/${agent.id}`)
  assert.equal((await mcp(r.json.access_token, 'ping')).status, 401)
  assert.equal((await token({ grant_type: 'refresh_token', refresh_token: r.json.refresh_token, client_id: client.client_id })).json.error, 'invalid_grant')
})

test('the spaces chosen on the approval page are what the app reaches', async () => {
  const { client, code, verifier } = await approve({ access: 'read', scopes: { [crew.id]: 'read' } })
  const t = (await token({ grant_type: 'authorization_code', code, client_id: client.client_id, code_verifier: verifier })).json
  const spaces = JSON.parse((await mcp(t.access_token, 'tools/call', { name: 'list_spaces', arguments: {} })).json.result.content[0].text).spaces
  assert.deepEqual(spaces.map((s) => s.prefix), ['workspaces/crew/'])
  const tools = (await mcp(t.access_token, 'tools/list')).json.result.tools.map((x) => x.name)
  assert.ok(!tools.includes('add_task'))
})

test('what should fail does', async () => {
  // the wrong PKCE secret
  const a = await approve()
  assert.equal((await token({ grant_type: 'authorization_code', code: a.code, client_id: a.client.client_id, code_verifier: 'not-it' })).json.error, 'invalid_grant')
  // another app's code
  const b = await approve()
  const other = await (await fetch(`${base}/oauth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'Other', redirect_uris: [CALLBACK] }) })).json()
  assert.equal((await token({ grant_type: 'authorization_code', code: b.code, client_id: other.client_id, code_verifier: b.verifier })).json.error, 'invalid_grant')
  // somewhere it didn't register, or no PKCE at all
  const bad = await fetch(`${base}/oauth/authorize?${new URLSearchParams({ response_type: 'code', client_id: other.client_id, redirect_uri: 'https://evil.example/cb', code_challenge: 'x', code_challenge_method: 'S256' })}`, { redirect: 'manual' })
  assert.equal(bad.status, 400)
  const noPkce = await fetch(`${base}/oauth/authorize?${new URLSearchParams({ response_type: 'code', client_id: other.client_id, redirect_uri: CALLBACK, state: 's' })}`, { redirect: 'manual' })
  assert.match(noPkce.headers.get('location'), /error=invalid_request&state=s/)
  // a redirect to a plain http site isn't registered at all
  assert.equal((await fetch(`${base}/oauth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ redirect_uris: ['http://evil.example/cb'] }) })).status, 400)
  // declining sends the app away with nothing
  const { verifier, challenge } = pkce()
  const ask = { response_type: 'code', client_id: other.client_id, redirect_uri: CALLBACK, code_challenge: challenge, code_challenge_method: 'S256', state: 'no' }
  const declined = new URL((await call(ada, 'POST', '/api/oauth/request', { ask, allow: false })).json.redirect)
  assert.equal(declined.searchParams.get('error'), 'access_denied')
  assert.equal(declined.searchParams.get('code'), null)
  assert.ok(verifier)
  // only someone signed in to Lumen can approve
  await assert.rejects(call('', 'POST', '/api/oauth/request', { ask, allow: true }), /Sign in/)
})
