// Spaces (docs/CANDLES.md): every account's own candle, and the workspaces
// people create and join. This module keeps who is in which space, with which
// role, and the invite links that let people in. What a space holds is in the
// record tables, each row tagged with its space (store/units.js).

import crypto from 'node:crypto'
import { EventEmitter } from 'node:events'
import { db } from './db.js'

db.exec(`
CREATE TABLE IF NOT EXISTS spaces (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  slug TEXT UNIQUE,
  name TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE TABLE IF NOT EXISTS space_members (
  space_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL,
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (space_id, user_id)
);
CREATE INDEX IF NOT EXISTS space_members_user ON space_members (user_id);
CREATE TABLE IF NOT EXISTS space_invites (
  token_hash TEXT PRIMARY KEY,
  space_id TEXT NOT NULL,
  role TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  uses INTEGER NOT NULL DEFAULT 0,
  revoked_at INTEGER
);
`)

/** 'access' (userIds): what these people may see changed (joined, left, removed, renamed…) */
export const spaceEvents = new EventEmitter()
spaceEvents.setMaxListeners(50)

const DAY = 86400000
const ROLES = ['owner', 'admin', 'member']
const sha = (t) => crypto.createHash('sha256').update(t).digest('hex')
const fail = (status, message) => Object.assign(new Error(message), { status })

export const candleId = (userId) => `c_${userId}`
export const isCandle = (id) => String(id).startsWith('c_')

const row = (id) => db.prepare('SELECT * FROM spaces WHERE id = ? AND deleted_at IS NULL').get(id) || null
export const get = row
export const bySlug = (slug) => db.prepare('SELECT * FROM spaces WHERE slug = ? AND deleted_at IS NULL').get(String(slug)) || null

/** A slug made from a name: lowercase letters, digits and dashes, unused */
export function slugFrom(name, taken = (s) => !!db.prepare('SELECT 1 FROM spaces WHERE slug = ?').get(s)) {
  const base =
    String(name || '')
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/[\s_]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'workspace'
  let s = base
  for (let i = 2; taken(s); i++) s = `${base}-${i}`
  return s
}

const candleName = (name) => `${String(name || 'My').trim()}’s candle`

/** The person's candle, made the first time it's asked for. Returns { space, created }. */
export function ensureCandle(user) {
  const id = candleId(user.id)
  const have = row(id)
  if (have) return { space: have, created: false }
  db.prepare('INSERT INTO spaces (id, kind, slug, name, owner_id, created_at) VALUES (?, ?, NULL, ?, ?, ?)').run(id, 'candle', candleName(user.name), user.id, Date.now())
  db.prepare('INSERT OR IGNORE INTO space_members (space_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)').run(id, user.id, 'owner', Date.now())
  return { space: row(id), created: true }
}

/** A candle follows its person's name, unless they renamed it themselves */
export function renameCandleFor(user, oldName) {
  const c = row(candleId(user.id))
  if (c && c.name === candleName(oldName)) db.prepare('UPDATE spaces SET name = ? WHERE id = ?').run(candleName(user.name), c.id)
}

export function createWorkspace(user, name, { id } = {}) {
  const n = String(name || '').trim().slice(0, 80)
  if (!n) throw fail(400, 'Give the workspace a name.')
  const sid = id || `w_${crypto.randomBytes(6).toString('hex')}`
  db.prepare('INSERT INTO spaces (id, kind, slug, name, owner_id, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(sid, 'workspace', slugFrom(n), n, user?.id || '', Date.now())
  if (user) addMember(sid, user.id, 'owner')
  return row(sid)
}

export function roleIn(userId, spaceId) {
  const s = row(spaceId)
  if (!s) return null
  return db.prepare('SELECT role FROM space_members WHERE space_id = ? AND user_id = ?').get(spaceId, userId)?.role || null
}

/** The spaces a person is in: their candle first, then workspaces by name */
export function spacesOf(userId) {
  return db
    .prepare(
      `SELECT s.*, m.role FROM spaces s JOIN space_members m ON m.space_id = s.id
       WHERE m.user_id = ? AND s.deleted_at IS NULL ORDER BY (s.kind = 'candle') DESC, lower(s.name)`,
    )
    .all(userId)
}

export function members(spaceId) {
  return db
    .prepare(
      `SELECT u.id, u.handle, u.name, m.role, m.joined_at AS joinedAt FROM space_members m JOIN users u ON u.id = m.user_id
       WHERE m.space_id = ? ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, lower(u.name)`,
    )
    .all(spaceId)
}
export const memberIds = (spaceId) => db.prepare('SELECT user_id FROM space_members WHERE space_id = ?').all(spaceId).map((r) => r.user_id)

export function addMember(spaceId, userId, role = 'member') {
  if (!ROLES.includes(role)) throw fail(400, 'Unknown role.')
  const changed = db.prepare('INSERT OR IGNORE INTO space_members (space_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)').run(spaceId, userId, role, Date.now()).changes
  if (changed) spaceEvents.emit('access', [userId])
  return !!changed
}

const isManager = (role) => role === 'owner' || role === 'admin'

/** `by` changes `userId`'s role. Owners and admins manage members; only the owner hands over ownership. */
export function setRole(spaceId, by, userId, role) {
  const s = row(spaceId)
  if (!s || s.kind !== 'workspace') throw fail(404, 'Not found.')
  if (!['admin', 'member', 'owner'].includes(role)) throw fail(400, 'Unknown role.')
  const mine = roleIn(by.id, spaceId)
  const theirs = roleIn(userId, spaceId)
  if (!theirs) throw fail(404, 'They aren’t in this workspace.')
  if (role === 'owner' || theirs === 'owner') {
    if (mine !== 'owner') throw fail(403, 'Only the owner can hand over the workspace.')
    if (role !== 'owner') throw fail(400, 'Make someone else the owner first.')
    // handing over: the old owner stays, as an admin
    db.prepare("UPDATE space_members SET role = 'admin' WHERE space_id = ? AND user_id = ?").run(spaceId, by.id)
    db.prepare("UPDATE space_members SET role = 'owner' WHERE space_id = ? AND user_id = ?").run(spaceId, userId)
    db.prepare('UPDATE spaces SET owner_id = ? WHERE id = ?').run(userId, spaceId)
    return
  }
  if (!isManager(mine)) throw fail(403, 'Only the workspace’s owner and admins can change roles.')
  db.prepare('UPDATE space_members SET role = ? WHERE space_id = ? AND user_id = ?').run(role, spaceId, userId)
}

/** Someone leaves, or is removed by an owner or admin */
export function removeMember(spaceId, by, userId) {
  const s = row(spaceId)
  if (!s || s.kind !== 'workspace') throw fail(404, 'Not found.')
  const theirs = roleIn(userId, spaceId)
  if (!theirs) return false
  if (theirs === 'owner') throw fail(400, userId === by.id ? 'Hand the workspace to someone else before leaving it.' : 'The owner can’t be removed.')
  if (userId !== by.id) {
    const mine = roleIn(by.id, spaceId)
    if (!isManager(mine) || (theirs === 'admin' && mine !== 'owner')) throw fail(403, 'You can’t remove them.')
  }
  db.prepare('DELETE FROM space_members WHERE space_id = ? AND user_id = ?').run(spaceId, userId)
  spaceEvents.emit('access', [userId])
  return true
}

export function rename(spaceId, by, { name, slug } = {}) {
  const s = row(spaceId)
  if (!s) throw fail(404, 'Not found.')
  const mine = roleIn(by.id, spaceId)
  if (s.kind === 'candle' ? mine !== 'owner' : !isManager(mine)) throw fail(403, 'Only the owner and admins can rename it.')
  if (name !== undefined) {
    const n = String(name).trim().slice(0, 80)
    if (!n) throw fail(400, 'Give it a name.')
    db.prepare('UPDATE spaces SET name = ? WHERE id = ?').run(n, spaceId)
  }
  if (slug !== undefined && s.kind === 'workspace') {
    const next = String(slug).trim().toLowerCase()
    if (!/^[a-z0-9][a-z0-9-]{1,39}$/.test(next) || next.endsWith('-')) throw fail(400, 'Use 2 to 40 lowercase letters, digits or dashes.')
    const other = bySlug(next)
    if (other && other.id !== spaceId) throw fail(409, 'That address is taken.')
    if (next !== s.slug) {
      db.prepare('UPDATE spaces SET slug = ? WHERE id = ?').run(next, spaceId)
      // everyone's paths for it moved
      spaceEvents.emit('access', memberIds(spaceId))
    }
  }
  return row(spaceId)
}

/** The owner deletes a workspace: it disappears for everyone (its rows stay, for a restore) */
export function deleteWorkspace(spaceId, by) {
  const s = row(spaceId)
  if (!s || s.kind !== 'workspace') throw fail(404, 'Not found.')
  if (roleIn(by.id, spaceId) !== 'owner') throw fail(403, 'Only the owner can delete the workspace.')
  const people = memberIds(spaceId)
  db.prepare('UPDATE spaces SET deleted_at = ? WHERE id = ?').run(Date.now(), spaceId)
  db.prepare('DELETE FROM space_invites WHERE space_id = ?').run(spaceId)
  spaceEvents.emit('access', people)
}

// ---------- invite links ----------

export function createInvite(spaceId, by, { role = 'member', days = 7 } = {}) {
  const s = row(spaceId)
  if (!s || s.kind !== 'workspace') throw fail(404, 'Not found.')
  if (!isManager(roleIn(by.id, spaceId))) throw fail(403, 'Only the workspace’s owner and admins can invite people.')
  if (!['admin', 'member'].includes(role)) throw fail(400, 'Unknown role.')
  const token = crypto.randomBytes(18).toString('base64url')
  const now = Date.now()
  const d = Math.min(30, Math.max(1, Number(days) || 7))
  db.prepare('INSERT INTO space_invites (token_hash, space_id, role, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)').run(sha(token), spaceId, role, by.id, now, now + d * DAY)
  return { token, id: sha(token).slice(0, 16), role, expiresAt: now + d * DAY }
}

export function listInvites(spaceId, by) {
  if (!isManager(roleIn(by.id, spaceId))) throw fail(403, 'Only the workspace’s owner and admins can see invites.')
  return db
    .prepare('SELECT substr(token_hash, 1, 16) AS id, role, created_by AS createdBy, created_at AS createdAt, expires_at AS expiresAt, uses FROM space_invites WHERE space_id = ? AND revoked_at IS NULL AND expires_at > ? ORDER BY created_at DESC')
    .all(spaceId, Date.now())
}

export function revokeInvite(spaceId, by, id) {
  if (!isManager(roleIn(by.id, spaceId))) throw fail(403, 'Only the workspace’s owner and admins can revoke invites.')
  return db.prepare('UPDATE space_invites SET revoked_at = ? WHERE space_id = ? AND substr(token_hash, 1, 16) = ? AND revoked_at IS NULL').run(Date.now(), spaceId, String(id)).changes > 0
}

/** The workspace a link leads to, while the link is good: { invite, space } or null */
export function findInvite(token) {
  const inv = db.prepare('SELECT * FROM space_invites WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > ?').get(sha(String(token || '')), Date.now())
  const s = inv && row(inv.space_id)
  return s ? { invite: inv, space: s } : null
}

/** `user` follows a link: joins the workspace (once) with the link's role */
export function acceptInvite(token, user) {
  const found = findInvite(token)
  if (!found) throw fail(410, 'This invite link has expired or was revoked.')
  if (addMember(found.space.id, user.id, found.invite.role)) db.prepare('UPDATE space_invites SET uses = uses + 1 WHERE token_hash = ?').run(found.invite.token_hash)
  return found.space
}
