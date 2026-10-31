// Accounts: email + password, sessions in an httpOnly cookie, and invite links.
// There is no public sign-up — the only ways in are the first-run setup (when
// there are no accounts at all), ADMIN_EMAIL/ADMIN_PASSWORD, or an invite an
// admin made.
import crypto from 'node:crypto'
import { promisify } from 'node:util'
import { db } from './db.js'
import { ADMIN_EMAIL, ADMIN_NAME, ADMIN_PASSWORD, INVITE_DAYS, SECURE_COOKIES, SESSION_DAYS, DESKTOP } from './config.js'

const scrypt = promisify(crypto.scrypt)
const COOKIE = 'lumen_session'
const DAY = 86400000

export class HttpError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

// ---------- passwords ----------

export async function hashPassword(pw) {
  const salt = crypto.randomBytes(16)
  const key = await scrypt(String(pw), salt, 64, { N: 16384, r: 8, p: 1 })
  return `scrypt$16384$${salt.toString('base64')}$${key.toString('base64')}`
}

async function checkPassword(pw, stored) {
  if (!stored) return false
  const [kind, n, salt, hash] = stored.split('$')
  if (kind !== 'scrypt') return false
  const key = await scrypt(String(pw), Buffer.from(salt, 'base64'), 64, { N: +n, r: 8, p: 1 })
  const want = Buffer.from(hash, 'base64')
  return key.length === want.length && crypto.timingSafeEqual(key, want)
}

export function validPassword(pw) {
  if (typeof pw !== 'string' || pw.length < 8) throw new HttpError(400, 'Use at least 8 characters for the password.')
  if (pw.length > 200) throw new HttpError(400, 'That password is too long.')
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
export function cleanEmail(e) {
  const email = String(e || '').trim().toLowerCase()
  if (!EMAIL.test(email) || email.length > 200) throw new HttpError(400, 'Enter a valid email address.')
  return email
}

// ---------- users ----------

export const publicUser = (u) => u && { id: u.id, email: u.email, handle: u.handle, name: u.name, role: u.role, disabled: !!u.disabled, createdAt: u.created_at }
export const getUser = (id) => db.prepare('SELECT * FROM users WHERE id = ?').get(id)
export const userByEmail = (email) => db.prepare('SELECT * FROM users WHERE email = ?').get(email)
export const userByHandle = (h) => db.prepare('SELECT * FROM users WHERE handle = ?').get(h)
export const allUsers = () => db.prepare('SELECT * FROM users ORDER BY created_at').all()
export const countUsers = () => db.prepare('SELECT COUNT(*) AS n FROM users').get().n

/** A handle (shown as @handle, used in files) made from a name or email, unique */
export function makeHandle(name, email) {
  const base =
    String(name || email.split('@')[0])
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/[\s_]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 24) || 'user'
  let h = base
  for (let i = 2; userByHandle(h) || h === 'everyone'; i++) h = `${base}${i}`
  return h
}

export async function createUser({ email, name, password, role = 'member' }) {
  const e = cleanEmail(email)
  if (userByEmail(e)) throw new HttpError(409, 'There is already an account with that email.')
  if (password != null) validPassword(password)
  const n = String(name || '').trim().slice(0, 80) || e.split('@')[0]
  const user = {
    id: crypto.randomUUID(),
    email: e,
    handle: makeHandle(n, e),
    name: n,
    pass_hash: password != null ? await hashPassword(password) : null,
    role,
    created_at: Date.now(),
  }
  db.prepare('INSERT INTO users (id, email, handle, name, pass_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(user.id, user.email, user.handle, user.name, user.pass_hash, user.role, user.created_at)
  return getUser(user.id)
}

/** ADMIN_EMAIL + ADMIN_PASSWORD: make (or promote) that admin on start */
export async function ensureEnvAdmin() {
  if (DESKTOP || !ADMIN_EMAIL || !ADMIN_PASSWORD) return
  const existing = userByEmail(ADMIN_EMAIL)
  if (existing) {
    if (existing.role !== 'admin') db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(existing.id)
    if (!existing.pass_hash) db.prepare('UPDATE users SET pass_hash = ? WHERE id = ?').run(await hashPassword(ADMIN_PASSWORD), existing.id)
    return
  }
  await createUser({ email: ADMIN_EMAIL, name: ADMIN_NAME || 'Admin', password: ADMIN_PASSWORD, role: 'admin' })
  console.log(`[auth] created admin ${ADMIN_EMAIL}`)
}

// ---------- sessions ----------

const sha = (t) => crypto.createHash('sha256').update(t).digest('hex')

export function createSession(userId, agent = '') {
  const token = crypto.randomBytes(32).toString('base64url')
  const now = Date.now()
  db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at, agent) VALUES (?, ?, ?, ?, ?)').run(sha(token), userId, now, now + SESSION_DAYS * DAY, String(agent).slice(0, 200))
  return token
}

function parseCookies(header) {
  const out = {}
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=')
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim())
  }
  return out
}

/** The signed-in user for a request (or a WebSocket upgrade), or null */
export function userFromRequest(req) {
  const token = parseCookies(req.headers.cookie)[COOKIE]
  if (!token) return null
  const row = db.prepare('SELECT u.*, s.expires_at AS s_exp FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?').get(sha(token))
  if (!row || row.s_exp < Date.now() || row.disabled) return null
  return row
}

export function setSessionCookie(res, token) {
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: SECURE_COOKIES, maxAge: SESSION_DAYS * DAY, path: '/' })
}

export function endSession(req, res) {
  const token = parseCookies(req.headers.cookie)[COOKIE]
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha(token))
  res.clearCookie(COOKIE, { path: '/' })
}

export const endUserSessions = (userId) => db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId)

// ---------- invites ----------

export function createInvite({ email, role = 'member', note = '', by }) {
  const token = crypto.randomBytes(24).toString('base64url')
  const now = Date.now()
  const e = email ? cleanEmail(email) : null
  if (e && userByEmail(e)) throw new HttpError(409, 'That person already has an account.')
  if (!['member', 'admin'].includes(role)) throw new HttpError(400, 'Unknown role.')
  db.prepare('INSERT INTO invites (token_hash, email, role, note, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(sha(token), e, role, String(note).slice(0, 200), by, now, now + INVITE_DAYS * DAY)
  return { token, hash: sha(token) }
}

export function findInvite(token) {
  const row = db.prepare('SELECT * FROM invites WHERE token_hash = ?').get(sha(String(token || '')))
  if (!row || row.used_at || row.expires_at < Date.now()) return null
  return row
}

export const listInvites = () =>
  db
    .prepare('SELECT token_hash, email, role, note, created_at, expires_at, used_at, used_by FROM invites ORDER BY created_at DESC')
    .all()
    .map((r) => ({ id: r.token_hash.slice(0, 16), email: r.email, role: r.role, note: r.note, createdAt: r.created_at, expiresAt: r.expires_at, usedAt: r.used_at, usedBy: r.used_by, expired: !r.used_at && r.expires_at < Date.now() }))

export const revokeInvite = (id) => db.prepare('DELETE FROM invites WHERE substr(token_hash, 1, 16) = ? AND used_at IS NULL').run(String(id)).changes

export async function acceptInvite(token, { name, password, email }) {
  const inv = findInvite(token)
  if (!inv) throw new HttpError(410, 'This invite link has expired or was already used. Ask for a new one.')
  const user = await createUser({ email: inv.email || email, name, password, role: inv.role })
  db.prepare('UPDATE invites SET used_at = ?, used_by = ? WHERE token_hash = ?').run(Date.now(), user.id, inv.token_hash)
  return user
}

// ---------- sign-in ----------

const attempts = new Map() // key → { n, until }
function limited(key) {
  const a = attempts.get(key)
  return a && a.n >= 8 && a.until > Date.now()
}
function failed(key) {
  const a = attempts.get(key)
  if (!a || a.until < Date.now()) attempts.set(key, { n: 1, until: Date.now() + 15 * 60000 })
  else a.n++
}

export async function login(email, password, ip) {
  const e = String(email || '').trim().toLowerCase()
  const key = `${ip}|${e}`
  if (limited(key)) throw new HttpError(429, 'Too many attempts. Try again in a few minutes.')
  const user = userByEmail(e)
  const ok = user && !user.disabled && (await checkPassword(password, user.pass_hash))
  if (!ok) {
    failed(key)
    throw new HttpError(401, 'That email and password don’t match an account.')
  }
  attempts.delete(key)
  return user
}

export async function changePassword(user, current, next) {
  if (!(await checkPassword(current, user.pass_hash))) throw new HttpError(403, 'The current password is not right.')
  validPassword(next)
  db.prepare('UPDATE users SET pass_hash = ? WHERE id = ?').run(await hashPassword(next), user.id)
}
