// One-time codes for two-step admin sign-in, passwordless member login and
// password resets. Codes are 6 digits, hashed at rest, short-lived and
// rate-limited; enough wrong tries kills a code. Nothing here says which
// specific thing failed — callers rely on that for a consistent error.
import crypto from 'node:crypto'
import { db } from './db.js'
import { SECRET } from './config.js'
import { HttpError } from './auth.js'

const CODE_MS = 10 * 60000
const MAX_ATTEMPTS = 5
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex')
const codeHash = (code) => crypto.createHash('sha256').update(SECRET).update(String(code)).digest('hex')

const rateByEmail = new Map()
const rateByIp = new Map()

function allow(map, key, max, windowMs) {
  if (!key) return true
  const now = Date.now()
  const a = map.get(key)
  if (a && a.until > now && a.n >= max) return false
  if (!a || a.until <= now) map.set(key, { n: 1, until: now + windowMs })
  else a.n++
  return true
}

export function issueCode({ email, purpose, userId = null, challenge = null, ip = null }) {
  if (!allow(rateByEmail, email, 5, 15 * 60000)) throw new HttpError(429, 'Too many codes requested. Wait a few minutes.')
  if (!allow(rateByIp, ip, 20, 60 * 60000)) throw new HttpError(429, 'Too many codes requested. Wait a few minutes.')

  const code = String(crypto.randomInt(0, 1e6)).padStart(6, '0')
  const now = Date.now()
  // a new code for the same email+purpose invalidates older unused ones
  db.prepare('UPDATE codes SET used_at = ? WHERE email = ? AND purpose = ? AND used_at IS NULL').run(now, email, purpose)
  db.prepare('INSERT INTO codes (id, email, purpose, code_hash, challenge_hash, user_id, attempts, created_at, expires_at, used_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, NULL)').run(
    crypto.randomUUID(),
    email,
    purpose,
    codeHash(code),
    challenge != null ? sha256(String(challenge)) : null,
    userId,
    now,
    now + CODE_MS
  )
  return code
}

function reject() {
  throw new HttpError(400, 'That code is wrong or has expired.')
}

export function checkCode({ email = null, challenge = null, purpose, code }) {
  let row
  if (challenge != null) {
    row = db.prepare('SELECT * FROM codes WHERE challenge_hash = ? AND purpose = ? ORDER BY created_at DESC LIMIT 1').get(sha256(String(challenge)), purpose)
  } else {
    row = db.prepare('SELECT * FROM codes WHERE email = ? AND purpose = ? ORDER BY created_at DESC LIMIT 1').get(email, purpose)
  }
  if (!row || row.used_at != null || row.expires_at < Date.now() || row.attempts >= MAX_ATTEMPTS) reject()

  const want = Buffer.from(codeHash(code), 'hex')
  const have = Buffer.from(row.code_hash, 'hex')
  if (have.length !== want.length || !crypto.timingSafeEqual(have, want)) {
    db.prepare('UPDATE codes SET attempts = attempts + 1 WHERE id = ?').run(row.id)
    reject()
  }
  db.prepare('UPDATE codes SET used_at = ? WHERE id = ?').run(Date.now(), row.id)
  return row
}
