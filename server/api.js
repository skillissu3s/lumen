// The HTTP API (docs/API.md). Desktop-only routes live in desktop.js.
import crypto from 'node:crypto'
import express from 'express'
import { APP_NAME, VERSION, DESKTOP, PUBLIC_URL, INVITE_DAYS } from './config.js'
import { db } from './db.js'
import { HttpError, userFromRequest, countUsers, createUser, login, getUser, allUsers, changePassword, createInvite, listInvites, revokeInvite, findInvite, acceptInvite, createSession, setSessionCookie, endSession, endUserSessions, cleanEmail, hashPassword, validPassword, userByEmail } from './auth.js'
import * as files from './files.js'
import { canRead, writeProblem, metaOf } from './access.js'
import * as chat from './chat.js'
import * as git from './git.js'
import { seedWorkspace } from './seed.js'
import { mailEnabled, sendMail, codeMail, inviteMail } from './mail.js'
import { issueCode, checkCode } from './codes.js'

const DAY = 86400000
const router = express.Router()

export const jsonBody = express.json({ limit: '3mb' })

export const csrf = (req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD' && req.headers['x-lumen'] !== '1') {
    return res.status(403).json({ error: 'Missing X-Lumen header.' })
  }
  next()
}

export const loadUser = (req, res, next) => {
  req.user = userFromRequest(req)
  if (DESKTOP && req.user) req.user.desktop = true
  next()
}

export function requireUser(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Sign in first.' })
  next()
}

export function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Sign in first.' })
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Only an admin can do that.' })
  next()
}

const toUser = (u) => u && { id: u.id, email: u.email, handle: u.handle, name: u.name, role: u.role }
const adminUser = (u) => ({ ...toUser(u), disabled: !!u.disabled, createdAt: u.created_at })
const maskEmail = (email) => {
  const [user, domain] = String(email).split('@')
  return `${user.slice(0, 2)}…@${domain}`
}

const signIn = (req, res, user) => {
  const token = createSession(user.id, req.get('user-agent'))
  setSessionCookie(res, token)
  return toUser(user)
}

router.use(jsonBody, csrf, loadUser)

// ---------- info and auth ----------

router.get('/info', (req, res) => {
  res.json({
    app: 'lumen',
    name: APP_NAME,
    version: VERSION,
    mode: DESKTOP ? 'desktop' : 'server',
    needsSetup: countUsers() === 0,
    user: req.user ? toUser(req.user) : null,
    mail: mailEnabled(),
  })
})

router.post('/setup', async (req, res, next) => {
  try {
    if (countUsers() !== 0) throw new HttpError(403, 'Setup is done — ask an admin to invite you.')
    const user = await createUser({ email: req.body?.email, name: req.body?.name, password: req.body?.password, role: 'admin' })
    await seedWorkspace({ handle: user.handle, name: user.name, chat: true })
    res.json({ user: signIn(req, res, user) })
  } catch (e) {
    next(e)
  }
})

router.post('/login', async (req, res, next) => {
  try {
    const user = await login(req.body?.email, req.body?.password, req.ip)
    if (user.role === 'admin' && mailEnabled()) {
      const challenge = crypto.randomUUID()
      const code = issueCode({ email: user.email, purpose: 'admin', userId: user.id, challenge, ip: req.ip })
      await sendMail({ to: user.email, ...codeMail(code, 'admin') })
      res.json({ needsCode: true, challenge, email: maskEmail(user.email) })
      return
    }
    res.json({ user: signIn(req, res, user) })
  } catch (e) {
    next(e)
  }
})

router.post('/login/verify', async (req, res, next) => {
  try {
    const row = checkCode({ challenge: req.body?.challenge, purpose: 'admin', code: req.body?.code })
    const user = row.user_id ? getUser(row.user_id) : null
    if (!user || user.disabled || user.role !== 'admin') throw new HttpError(400, 'That code is wrong or has expired.')
    res.json({ user: signIn(req, res, user) })
  } catch (e) {
    next(e)
  }
})

router.post('/login/code', async (req, res, next) => {
  try {
    if (!mailEnabled()) throw new HttpError(404, 'Not here.')
    const email = String(req.body?.email || '').trim().toLowerCase()
    const user = email ? userByEmail(email) : null
    if (user && !user.disabled && user.role === 'member') {
      const code = issueCode({ email: user.email, purpose: 'login', ip: req.ip })
      await sendMail({ to: user.email, ...codeMail(code, 'login') }).catch(() => {})
    }
    res.json({ sent: true })
  } catch (e) {
    next(e)
  }
})

router.post('/login/code/verify', async (req, res, next) => {
  try {
    const email = cleanEmail(req.body?.email)
    checkCode({ email, purpose: 'login', code: req.body?.code })
    const user = userByEmail(email)
    if (!user || user.disabled || user.role !== 'member') throw new HttpError(400, 'That code is wrong or has expired.')
    res.json({ user: signIn(req, res, user) })
  } catch (e) {
    next(e)
  }
})

router.post('/password/forgot', async (req, res, next) => {
  try {
    if (!mailEnabled()) throw new HttpError(404, 'Not here.')
    const email = String(req.body?.email || '').trim().toLowerCase()
    const user = email ? userByEmail(email) : null
    if (user && !user.disabled) {
      const code = issueCode({ email: user.email, purpose: 'reset', ip: req.ip })
      await sendMail({ to: user.email, ...codeMail(code, 'reset') }).catch(() => {})
    }
    res.json({ sent: true })
  } catch (e) {
    next(e)
  }
})

router.post('/password/reset', async (req, res, next) => {
  try {
    const email = cleanEmail(req.body?.email)
    checkCode({ email, purpose: 'reset', code: req.body?.code })
    validPassword(req.body?.password)
    const user = userByEmail(email)
    if (!user || user.disabled) throw new HttpError(400, 'That code is wrong or has expired.')
    db.prepare('UPDATE users SET pass_hash = ? WHERE id = ?').run(await hashPassword(req.body?.password), user.id)
    endUserSessions(user.id)
    if (user.role === 'admin') return res.json({ ok: true })
    res.json({ user: signIn(req, res, user) })
  } catch (e) {
    next(e)
  }
})

router.post('/logout', (req, res) => {
  endSession(req, res)
  res.json({ ok: true })
})

router.get('/me', requireUser, (req, res) => res.json({ user: toUser(req.user) }))

router.patch('/me', requireUser, (req, res) => {
  const name = String(req.body?.name ?? '').trim().slice(0, 80)
  if (name) db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name, req.user.id)
  res.json({ user: toUser(getUser(req.user.id)) })
})

router.post('/me/password', requireUser, async (req, res, next) => {
  try {
    await changePassword(req.user, req.body?.current, req.body?.next)
    res.json({ ok: true })
  } catch (e) {
    next(e)
  }
})

router.get('/invites/:token', (req, res) => {
  const inv = findInvite(req.params.token)
  if (!inv) return res.status(410).json({ error: 'This invite link has expired or was already used.' })
  res.json({ email: inv.email, role: inv.role })
})

router.post('/invites/:token/accept', async (req, res, next) => {
  try {
    const user = await acceptInvite(req.params.token, { name: req.body?.name, password: req.body?.password, email: req.body?.email })
    res.json({ user: signIn(req, res, user) })
  } catch (e) {
    next(e)
  }
})

router.get('/users', requireUser, (req, res) => {
  res.json({ users: allUsers().filter((u) => !u.disabled).map((u) => ({ handle: u.handle, name: u.name, role: u.role })) })
})

// ---------- admin ----------

router.get('/admin/users', requireAdmin, (req, res) => {
  res.json({ users: allUsers().map(adminUser) })
})

router.patch('/admin/users/:id', requireAdmin, (req, res, next) => {
  try {
    const target = getUser(req.params.id)
    if (!target) throw new HttpError(404, 'No such user.')
    const admins = allUsers().filter((u) => u.role === 'admin' && !u.disabled)
    const isSelf = target.id === req.user.id
    const patch = {}
    const body = req.body || {}

    if ('name' in body) {
      const name = String(body.name ?? '').trim().slice(0, 80)
      if (name) patch.name = name
    }
    if ('role' in body) {
      const role = body.role
      if (!['admin', 'member'].includes(role)) throw new HttpError(400, 'Unknown role.')
      if (role !== target.role) {
        if (isSelf) throw new HttpError(403, 'You can’t demote yourself.')
        if (role === 'member' && target.role === 'admin' && admins.length <= 1) throw new HttpError(403, 'You can’t demote the last admin.')
        patch.role = role
      }
    }
    if ('disabled' in body) {
      const disabled = !!body.disabled
      if (disabled !== !!target.disabled) {
        if (isSelf) throw new HttpError(403, 'You can’t disable yourself.')
        if (disabled && target.role === 'admin' && admins.length <= 1) throw new HttpError(403, 'You can’t disable the last admin.')
        patch.disabled = disabled ? 1 : 0
      }
    }

    if (Object.keys(patch).length) {
      const sets = Object.keys(patch).map((k) => `${k} = ?`)
      db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...Object.values(patch), target.id)
      if (patch.disabled === 1) endUserSessions(target.id)
    }
    res.json({ user: adminUser(getUser(target.id)) })
  } catch (e) {
    next(e)
  }
})

router.delete('/admin/users/:id', requireAdmin, (req, res, next) => {
  try {
    const target = getUser(req.params.id)
    if (!target) throw new HttpError(404, 'No such user.')
    if (target.id === req.user.id) throw new HttpError(403, 'You can’t delete yourself.')
    const admins = allUsers().filter((u) => u.role === 'admin' && !u.disabled)
    if (target.role === 'admin' && admins.length <= 1) throw new HttpError(403, 'You can’t delete the last admin.')
    db.prepare('DELETE FROM users WHERE id = ?').run(target.id)
    res.json({ ok: true })
  } catch (e) {
    next(e)
  }
})

router.get('/admin/invites', requireAdmin, (req, res) => res.json({ invites: listInvites() }))

router.post('/admin/invites', requireAdmin, async (req, res, next) => {
  try {
    const email = req.body?.email ? cleanEmail(req.body.email) : null
    const role = ['admin', 'member'].includes(req.body?.role) ? req.body.role : 'member'
    const note = String(req.body?.note || '').slice(0, 200)
    const { token, hash } = createInvite({ email, role, note, by: req.user.id })
    const now = Date.now()
    const invite = { id: hash.slice(0, 16), email, role, note, createdAt: now, expiresAt: now + INVITE_DAYS * DAY, usedAt: null, expired: false }
    const origin = PUBLIC_URL || `${req.protocol}://${req.get('host')}`
    const url = `${origin}/app.html#/invite/${token}`
    let emailed = false
    let emailError
    if (email && mailEnabled()) {
      try {
        await sendMail({ to: email, ...inviteMail(url, req.user.name) })
        emailed = true
      } catch (e) {
        emailError = e.message
      }
    }
    res.json({ invite, url, emailed, ...(emailError ? { emailError } : {}) })
  } catch (e) {
    next(e)
  }
})

router.delete('/admin/invites/:id', requireAdmin, (req, res) => {
  revokeInvite(req.params.id)
  res.json({ ok: true })
})

router.get('/admin/sync', requireAdmin, (req, res) => res.json({ config: git.getConfig(), status: git.status() }))

router.put('/admin/sync', requireAdmin, async (req, res, next) => {
  try {
    await git.configure(req.body || {})
    res.json({ config: git.getConfig(), status: git.status() })
  } catch (e) {
    next(e)
  }
})

router.post('/admin/sync/now', requireAdmin, async (req, res, next) => {
  try {
    res.json({ status: await git.syncNow() })
  } catch (e) {
    next(e)
  }
})

// ---------- files ----------

// A conflict answers with the current text — only for someone who may read it
function guardConflict(e, user, p) {
  if (e instanceof files.ConflictError && e.current && !canRead(user, p, metaOf(p, e.current.text))) return new HttpError(404, 'Not found.')
  return e
}

router.get('/files', requireUser, (req, res) => {
  const list = files.list().filter((f) => canRead(req.user, f.path, f.meta)).map((f) => ({ path: f.path, sha: f.sha, size: f.size }))
  res.json({ files: list })
})

router.post('/files/read', requireUser, async (req, res, next) => {
  try {
    const paths = Array.isArray(req.body?.paths) ? req.body.paths : []
    if (paths.length > 500) throw new HttpError(400, 'Too many paths.')
    const out = {}
    for (const raw of paths) {
      const p = files.cleanPath(raw)
      if (!p) {
        out[String(raw)] = null
        continue
      }
      const meta = files.info(p)?.meta ?? null
      if (!canRead(req.user, p, meta)) {
        out[p] = null
        continue
      }
      const r = await files.read(p)
      out[p] = r ? { text: r.text, sha: r.sha } : null
    }
    res.json({ files: out })
  } catch (e) {
    next(e)
  }
})

router.put('/files', requireUser, async (req, res, next) => {
  try {
    const p = files.cleanPath(req.body?.path)
    if (!p) throw new HttpError(400, 'Invalid path.')
    const text = String(req.body?.text ?? '')
    const result = await files.write(p, text, {
      baseSha: req.body?.sha ?? null,
      check(cur) {
        const reason = writeProblem(req.user, p, metaOf(p, cur?.text ?? ''), metaOf(p, text), !!cur)
        if (reason) throw new HttpError(403, reason)
      },
      by: req.user.handle,
    })
    // the file as stored, when it differs from what was sent (ids added, formatting settled)
    res.json(result.text != null && result.text !== text ? { sha: result.sha, text: result.text } : { sha: result.sha })
  } catch (e) {
    next(guardConflict(e, req.user, files.cleanPath(req.body?.path)))
  }
})

router.delete('/files', requireUser, async (req, res, next) => {
  try {
    const p = files.cleanPath(req.body?.path)
    if (!p) throw new HttpError(400, 'Invalid path.')
    await files.remove(p, {
      baseSha: req.body?.sha ?? null,
      check(cur) {
        const reason = writeProblem(req.user, p, metaOf(p, cur?.text ?? ''), null, !!cur)
        if (reason) throw new HttpError(403, reason)
      },
      by: req.user.handle,
    })
    res.json({ ok: true })
  } catch (e) {
    next(guardConflict(e, req.user, files.cleanPath(req.body?.path)))
  }
})

// ---------- chat (server mode only) ----------

const chatOnly = (req, res, next) => (DESKTOP ? res.status(404).json({ error: 'Not here.' }) : next())

router.get('/chat/channels', chatOnly, requireUser, async (req, res, next) => {
  try {
    res.json({ channels: await chat.listChannels(req.user) })
  } catch (e) {
    next(e)
  }
})

router.post('/chat/channels', chatOnly, requireUser, async (req, res, next) => {
  try {
    const body = req.body || {}
    const channel = body.dm ? await chat.createDm(req.user, body.dm) : await chat.createChannel(req.user, { name: body.name, members: body.members })
    res.json({ channel })
  } catch (e) {
    next(e)
  }
})

router.get('/chat/messages', chatOnly, requireUser, async (req, res, next) => {
  try {
    const channel = String(req.query.channel || '')
    const before = req.query.before ? String(req.query.before) : undefined
    res.json(await chat.listMessages(req.user, channel, before))
  } catch (e) {
    next(e)
  }
})

router.post('/chat/messages', chatOnly, requireUser, async (req, res, next) => {
  try {
    res.json({ message: await chat.postMessage(req.user, req.body?.channel, req.body?.text, req.body?.reply) })
  } catch (e) {
    next(e)
  }
})

router.patch('/chat/messages', chatOnly, requireUser, async (req, res, next) => {
  try {
    res.json({ message: await chat.editMessage(req.user, req.body?.channel, req.body?.id, req.body?.text) })
  } catch (e) {
    next(e)
  }
})

router.delete('/chat/messages', chatOnly, requireUser, async (req, res, next) => {
  try {
    res.json(await chat.deleteMessage(req.user, req.body?.channel, req.body?.id))
  } catch (e) {
    next(e)
  }
})

router.post('/chat/read', chatOnly, requireUser, async (req, res, next) => {
  try {
    res.json(await chat.markRead(req.user, req.body?.channel, req.body?.at))
  } catch (e) {
    next(e)
  }
})

// ---------- errors ----------

router.use((err, req, res, next) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message })
  if (err instanceof files.ConflictError) return res.status(409).json({ error: err.message, current: err.current })
  if (err instanceof RangeError) return res.status(400).json({ error: err.message })
  if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'That request body is too large.' })
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON.' })
  if (err?.status && err.status >= 400 && err.status < 500) return res.status(err.status).json({ error: err.message })
  console.error('[api]', err)
  res.status(500).json({ error: 'Something went wrong.' })
})

export { router as apiRouter }
