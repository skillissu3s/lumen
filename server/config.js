import path from 'node:path'
import fs from 'node:fs'
import crypto from 'node:crypto'

const env = process.env
const bool = (v, d = false) => (v == null || v === '' ? d : /^(1|true|yes|on)$/i.test(v))

export const DESKTOP = bool(env.LUMEN_DESKTOP)
export const PORT = Number(env.PORT || 3000)
export const HOST = env.HOST || (DESKTOP ? '127.0.0.1' : '0.0.0.0')
export const DATA_DIR = path.resolve(env.DATA_DIR || './data')
export const APP_NAME = env.APP_NAME || 'Lumen'
export const PUBLIC_URL = (env.PUBLIC_URL || '').replace(/\/+$/, '')
export const SESSION_DAYS = Number(env.SESSION_DAYS || 30)
export const INVITE_DAYS = Number(env.INVITE_DAYS || 7)
export const MAX_FILE_BYTES = Number(env.MAX_FILE_MB || 2) * 1024 * 1024
export const ADMIN_EMAIL = (env.ADMIN_EMAIL || '').trim().toLowerCase()
export const ADMIN_PASSWORD = env.ADMIN_PASSWORD || ''
export const ADMIN_NAME = env.ADMIN_NAME || ''
export const SECURE_COOKIES = bool(env.SECURE_COOKIES, PUBLIC_URL.startsWith('https://'))
export const TRUST_PROXY = bool(env.TRUST_PROXY, true)
/** The workspace folder: its own setting on the desktop (users pick it), DATA_DIR/workspace on a server */
export const WORKSPACE_DIR = env.WORKSPACE_DIR ? path.resolve(env.WORKSPACE_DIR) : path.join(DATA_DIR, 'workspace')

fs.mkdirSync(DATA_DIR, { recursive: true })

// The key that encrypts stored GitHub tokens: APP_SECRET, or one made on first start
function loadSecret() {
  if (env.APP_SECRET) return crypto.createHash('sha256').update(env.APP_SECRET).digest()
  const file = path.join(DATA_DIR, 'secret.key')
  try {
    return Buffer.from(fs.readFileSync(file, 'utf8').trim(), 'base64')
  } catch {
    const key = crypto.randomBytes(32)
    fs.writeFileSync(file, key.toString('base64'), { mode: 0o600 })
    return key
  }
}
export const SECRET = loadSecret()

export function encrypt(text) {
  const iv = crypto.randomBytes(12)
  const c = crypto.createCipheriv('aes-256-gcm', SECRET, iv)
  const enc = Buffer.concat([c.update(String(text), 'utf8'), c.final()])
  return `v1:${iv.toString('base64')}:${c.getAuthTag().toString('base64')}:${enc.toString('base64')}`
}

export function decrypt(blob) {
  try {
    const [v, iv, tag, enc] = String(blob).split(':')
    if (v !== 'v1') return null
    const d = crypto.createDecipheriv('aes-256-gcm', SECRET, Buffer.from(iv, 'base64'))
    d.setAuthTag(Buffer.from(tag, 'base64'))
    return Buffer.concat([d.update(Buffer.from(enc, 'base64')), d.final()]).toString('utf8')
  } catch {
    return null
  }
}

export const VERSION = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version
