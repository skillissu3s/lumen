// Access for AI agents (docs/MCP.md): a token per agent someone connects, shown
// once and kept as a hash. Each token reaches what its person can reach, no
// further, and says how far: 'read' (look only), 'edit' (also add and change),
// or 'full' (also delete). `scopes` narrows it per space: { <space id> | 'shared'
// | 'dm': level }, where a space left out is out of reach; null is every space
// at `access`. Tokens only open /mcp, never the app's own API.
import crypto from 'node:crypto'
import { db } from './db.js'
import { HttpError } from './auth.js'

db.exec(`
CREATE TABLE IF NOT EXISTS agent_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  access TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER
);
`)

// tokens made before per-space access reach every space
const columns = new Set(db.prepare('PRAGMA table_info(agent_tokens)').all().map((c) => c.name))
if (!columns.has('scopes')) db.exec('ALTER TABLE agent_tokens ADD COLUMN scopes TEXT')
// an agent an app connected by signing in (oauth.js): which app, and the
// short-lived tokens it was given (an access token and the refresh token that renews it)
if (!columns.has('client_id')) db.exec('ALTER TABLE agent_tokens ADD COLUMN client_id TEXT')
db.exec(`
CREATE TABLE IF NOT EXISTS agent_grants (
  token_hash TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agent_tokens(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  client_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
`)

export const ACCESS = ['read', 'edit', 'full']
const RANK = { read: 0, edit: 1, full: 2 }
const SCOPE_KEY = /^(c_|w_)[\w-]+$|^shared$|^dm$/
const PREFIX = 'lumen_'
const sha = (t) => crypto.createHash('sha256').update(t).digest('hex')
const parseScopes = (s) => {
  try {
    return s ? JSON.parse(s) : null
  } catch {
    return {}
  }
}
const shape = (r) => ({ id: r.id, name: r.name, access: r.access, scopes: parseScopes(r.scopes), createdAt: r.created_at, lastUsedAt: r.last_used_at ?? null, ...(r.client_id ? { connected: true } : {}) })

/** null (every space), or { key: level } with only real keys and levels; 'none' leaves a space out */
function checkScopes(scopes) {
  if (scopes == null) return null
  if (typeof scopes !== 'object' || Array.isArray(scopes)) throw new HttpError(400, 'Spaces are { space: level }.')
  const out = {}
  for (const [key, level] of Object.entries(scopes)) {
    if (!SCOPE_KEY.test(key)) throw new HttpError(400, `Unknown space: ${key}`)
    if (level === 'none' || level == null) continue
    out[key] = checkAccess(level)
  }
  return out
}

/** An agent's reach checked as making one would → the scopes to keep */
export function checkReach(access, scopes) {
  checkAccess(access)
  return checkScopes(scopes)
}

/** The level a token has in a space ('read' | 'edit' | 'full'), or null when it's out of reach */
export const levelIn = (agent, key) => (agent.scopes ? agent.scopes[key] ?? null : agent.access)

/** The most a token may do anywhere */
export const mostOf = (agent) => (agent.scopes ? Object.values(agent.scopes).reduce((a, l) => (a == null || RANK[l] > RANK[a] ? l : a), null) : agent.access)

export const reaches = (level, need) => level != null && RANK[level] >= RANK[need]

function checkAccess(access) {
  if (!ACCESS.includes(access)) throw new HttpError(400, 'Access is read, edit or full.')
  return access
}

function checkName(name) {
  const n = String(name ?? '').trim().slice(0, 60)
  if (!n) throw new HttpError(400, 'Give the agent a name.')
  return n
}

/** A new token for `user` → { token, agent }: the token is only ever seen here */
export function createToken(user, { name, access = 'edit', scopes = null } = {}) {
  const token = PREFIX + crypto.randomBytes(32).toString('base64url')
  const s = checkScopes(scopes)
  const row = { id: crypto.randomBytes(8).toString('hex'), user_id: user.id, name: checkName(name), token_hash: sha(token), access: checkAccess(access), scopes: s ? JSON.stringify(s) : null, created_at: Date.now() }
  db.prepare('INSERT INTO agent_tokens (id, user_id, name, token_hash, access, scopes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(row.id, row.user_id, row.name, row.token_hash, row.access, row.scopes, row.created_at)
  return { token, agent: shape(row) }
}

export const listTokens = (userId) => db.prepare('SELECT * FROM agent_tokens WHERE user_id = ? ORDER BY created_at DESC').all(userId).map(shape)

export function updateToken(userId, id, { name, access, scopes } = {}) {
  const row = db.prepare('SELECT * FROM agent_tokens WHERE id = ? AND user_id = ?').get(String(id), userId)
  if (!row) throw new HttpError(404, 'No such agent.')
  if (name !== undefined) row.name = checkName(name)
  if (access !== undefined) row.access = checkAccess(access)
  if (scopes !== undefined) {
    const s = checkScopes(scopes)
    row.scopes = s ? JSON.stringify(s) : null
  }
  db.prepare('UPDATE agent_tokens SET name = ?, access = ?, scopes = ? WHERE id = ?').run(row.name, row.access, row.scopes, row.id)
  return shape(row)
}

export function revokeToken(userId, id) {
  const r = db.prepare('DELETE FROM agent_tokens WHERE id = ? AND user_id = ?').run(String(id), userId)
  if (!r.changes) throw new HttpError(404, 'No such agent.')
}

// the token as an agent sends it: in X-Token, or one of the other headers apps
// allow (some won't take a custom name, some keep Authorization for their own
// sign-in), or as `Authorization: Bearer lumen_…`
const TOKEN_HEADERS = ['x-token', 'x-api-key', 'x-lumen-token']
function tokenOf(req) {
  const bearer = /^Bearer\s+(\S+)$/i.exec(String(req.headers.authorization || ''))?.[1]
  const t = String(TOKEN_HEADERS.map((h) => req.headers[h]).find(Boolean) || bearer || '').trim()
  return t.startsWith(PREFIX) ? t : null
}

// ---------- agents an app connected by signing in (oauth.js) ----------

const MINUTE = 60000
const ACCESS_FOR = 60 * MINUTE
const REFRESH_FOR = 60 * 24 * 60 * MINUTE

/**
 * The agent for an app a person approved: the one it had (its reach set anew),
 * or a new one named after the app. Its own token is never shown or used;
 * the app holds grants instead. → the agent's id
 */
export function agentForApp(user, client, { access, scopes }) {
  const a = checkAccess(access)
  const s = checkScopes(scopes)
  const have = db.prepare('SELECT id FROM agent_tokens WHERE user_id = ? AND client_id = ?').get(user.id, client.id)
  if (have) {
    db.prepare('UPDATE agent_tokens SET access = ?, scopes = ? WHERE id = ?').run(a, s ? JSON.stringify(s) : null, have.id)
    return have.id
  }
  const id = crypto.randomBytes(8).toString('hex')
  db.prepare('INSERT INTO agent_tokens (id, user_id, name, token_hash, access, scopes, client_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(id, user.id, checkName(client.name), sha(crypto.randomBytes(32).toString('hex')), a, s ? JSON.stringify(s) : null, client.id, Date.now())
  return id
}

/** A fresh access token (an hour) and refresh token (two months) for an agent → the token response */
export function issueGrant(agentId, clientId) {
  const now = Date.now()
  db.prepare('DELETE FROM agent_grants WHERE expires_at < ?').run(now)
  const access = `${PREFIX}at_${crypto.randomBytes(32).toString('base64url')}`
  const refresh = `${PREFIX}rt_${crypto.randomBytes(32).toString('base64url')}`
  const add = db.prepare('INSERT INTO agent_grants (token_hash, agent_id, kind, client_id, expires_at) VALUES (?, ?, ?, ?, ?)')
  add.run(sha(access), agentId, 'access', clientId, now + ACCESS_FOR)
  add.run(sha(refresh), agentId, 'refresh', clientId, now + REFRESH_FOR)
  return { access_token: access, token_type: 'Bearer', expires_in: ACCESS_FOR / 1000, refresh_token: refresh, scope: 'lumen' }
}

/** A refresh token → a new pair (the old refresh token is spent), or null */
export function refreshGrant(token, clientId) {
  const row = db.prepare("SELECT * FROM agent_grants WHERE token_hash = ? AND kind = 'refresh' AND client_id = ? AND expires_at > ?").get(sha(String(token || '')), String(clientId || ''), Date.now())
  if (!row) return null
  db.prepare('DELETE FROM agent_grants WHERE token_hash = ?').run(row.token_hash)
  return issueGrant(row.agent_id, clientId)
}

export const revokeGrant = (token) => db.prepare('DELETE FROM agent_grants WHERE token_hash = ?').run(sha(String(token || '')))

/** The agent a request comes from → { user, agent }, or null */
export function agentFromRequest(req) {
  const token = tokenOf(req)
  if (!token) return null
  const hash = sha(token)
  const pick = 'SELECT a.id AS a_id, a.name AS a_name, a.access AS a_access, a.scopes AS a_scopes, a.last_used_at AS a_used, u.* FROM agent_tokens a JOIN users u ON u.id = a.user_id'
  const row =
    db.prepare(`${pick} WHERE a.token_hash = ?`).get(hash) ||
    // an app's access token, while it lasts
    db.prepare(`${pick} JOIN agent_grants g ON g.agent_id = a.id WHERE g.token_hash = ? AND g.kind = 'access' AND g.expires_at > ?`).get(hash, Date.now())
  if (!row || row.disabled) return null
  const now = Date.now()
  // when it was last used, to the minute: enough to tell which agents still run
  if (!row.a_used || now - row.a_used > 60000) db.prepare('UPDATE agent_tokens SET last_used_at = ? WHERE id = ?').run(now, row.a_id)
  const agent = { id: row.a_id, name: row.a_name, access: row.a_access, scopes: parseScopes(row.a_scopes) }
  for (const k of ['a_id', 'a_name', 'a_access', 'a_scopes', 'a_used']) delete row[k]
  return { user: row, agent }
}
