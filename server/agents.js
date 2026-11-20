// Access for AI agents (docs/MCP.md): a token per agent someone connects, shown
// once and kept as a hash. Each token reaches what its person can reach, no
// further, and says how far: 'read' (look only), 'edit' (also add and change),
// or 'full' (also delete). Tokens only open /mcp, never the app's own API.
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

export const ACCESS = ['read', 'edit', 'full']
const PREFIX = 'lumen_'
const sha = (t) => crypto.createHash('sha256').update(t).digest('hex')
const shape = (r) => ({ id: r.id, name: r.name, access: r.access, createdAt: r.created_at, lastUsedAt: r.last_used_at ?? null })

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
export function createToken(user, { name, access = 'edit' } = {}) {
  const token = PREFIX + crypto.randomBytes(32).toString('base64url')
  const row = { id: crypto.randomBytes(8).toString('hex'), user_id: user.id, name: checkName(name), token_hash: sha(token), access: checkAccess(access), created_at: Date.now() }
  db.prepare('INSERT INTO agent_tokens (id, user_id, name, token_hash, access, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(row.id, row.user_id, row.name, row.token_hash, row.access, row.created_at)
  return { token, agent: shape(row) }
}

export const listTokens = (userId) => db.prepare('SELECT * FROM agent_tokens WHERE user_id = ? ORDER BY created_at DESC').all(userId).map(shape)

export function updateToken(userId, id, { name, access } = {}) {
  const row = db.prepare('SELECT * FROM agent_tokens WHERE id = ? AND user_id = ?').get(String(id), userId)
  if (!row) throw new HttpError(404, 'No such agent.')
  if (name !== undefined) row.name = checkName(name)
  if (access !== undefined) row.access = checkAccess(access)
  db.prepare('UPDATE agent_tokens SET name = ?, access = ? WHERE id = ?').run(row.name, row.access, row.id)
  return shape(row)
}

export function revokeToken(userId, id) {
  const r = db.prepare('DELETE FROM agent_tokens WHERE id = ? AND user_id = ?').run(String(id), userId)
  if (!r.changes) throw new HttpError(404, 'No such agent.')
}

/** `Authorization: Bearer lumen_…` → { user, agent }, or null */
export function agentFromRequest(req) {
  const m = /^Bearer\s+(\S+)$/i.exec(String(req.headers.authorization || ''))
  if (!m || !m[1].startsWith(PREFIX)) return null
  const row = db.prepare('SELECT a.id AS a_id, a.name AS a_name, a.access AS a_access, a.last_used_at AS a_used, u.* FROM agent_tokens a JOIN users u ON u.id = a.user_id WHERE a.token_hash = ?').get(sha(m[1]))
  if (!row || row.disabled) return null
  const now = Date.now()
  // when it was last used, to the minute: enough to tell which agents still run
  if (!row.a_used || now - row.a_used > 60000) db.prepare('UPDATE agent_tokens SET last_used_at = ? WHERE id = ?').run(now, row.a_id)
  const agent = { id: row.a_id, name: row.a_name, access: row.a_access }
  for (const k of ['a_id', 'a_name', 'a_access', 'a_used']) delete row[k]
  return { user: row, agent }
}
