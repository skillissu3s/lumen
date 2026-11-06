// The HTTP API (docs/API.md). Desktop-only routes live in desktop.js.
import crypto from 'node:crypto'
import express from 'express'
import { APP_NAME, VERSION, DESKTOP, PUBLIC_URL, INVITE_DAYS } from './config.js'
import { db, getSetting } from './db.js'
import { HttpError, checkHandle, userFromRequest, countUsers, createUser, login, getUser, allUsers, changePassword, createInvite, listInvites, revokeInvite, findInvite, acceptInvite, createSession, setSessionCookie, endSession, endUserSessions, sessionHashOf, cleanEmail, hashPassword, validPassword, userByEmail } from './auth.js'
import * as files from './files.js'
import { canReadAt, writeProblemAt, metaOf, SHARED_KINDS } from './access.js'
import * as view from './view.js'
import * as chat from './chat.js'
import * as git from './git.js'
import { seedWorkspace } from './seed.js'
import { setUpAccount } from './accounts.js'
import * as spaces from './spaces.js'
import { mailEnabled, sendMail, codeMail, inviteMail } from './mail.js'
import { issueCode, checkCode } from './codes.js'
import { readRepo } from './github/readRepo.js'
import { publicStatus as cloudStatus } from './sync/replica.js'

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

const toUser = (u) => u && { id: u.id, email: u.email, handle: u.handle, name: u.name, role: u.role, color: u.color || null, avatar: u.avatar || null }

// the colours an avatar can take (the item colours), and a photo small enough
// to send with every list of people
const AVATAR_COLORS = ['gray', 'red', 'orange', 'amber', 'green', 'teal', 'blue', 'indigo', 'violet', 'pink']
const AVATAR_MAX = 200_000
function checkAvatar(v) {
  if (v === null || v === '') return null
  const s = String(v)
  if (!/^data:image\/(png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(s)) throw new HttpError(400, 'A photo must be a PNG, JPEG or WebP image.')
  if (s.length > AVATAR_MAX) throw new HttpError(413, 'That photo is too large.')
  return s
}
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
    // the desktop app hasn't been told yet: a Lumen server, or this computer only
    ...(DESKTOP && !getSetting('desktop.mode') ? { desktopChoice: true } : {}),
    // and when it's signed in to one, how keeping in step with it is going
    ...(DESKTOP && req.user ? { cloud: cloudStatus() } : {}),
  })
})

router.post('/setup', async (req, res, next) => {
  try {
    if (countUsers() !== 0) throw new HttpError(403, 'Setup is done — ask an admin to invite you.')
    const user = await createUser({ email: req.body?.email, name: req.body?.name, password: req.body?.password, role: 'admin' })
    await setUpAccount(user, { joinHome: true })
    const home = spaces.rename(files.homeSpaceId(), user, { name: `${user.name}'s workspace` })
    await seedWorkspace({ handle: user.handle, name: user.name, title: home.name, chat: true })
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

router.patch('/me', requireUser, async (req, res) => {
  const body = req.body || {}
  const name = String(body.name ?? '').trim().slice(0, 80)
  // check everything before changing anything
  const color = body.color === undefined ? undefined : body.color === null ? null : String(body.color)
  if (color && !AVATAR_COLORS.includes(color)) throw new HttpError(400, 'Unknown colour.')
  const avatar = body.avatar === undefined ? undefined : checkAvatar(body.avatar)
  const handle = body.handle === undefined ? undefined : checkHandle(body.handle, req.user.id)
  if (name) {
    db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name, req.user.id)
    spaces.renameCandleFor({ ...req.user, name }, req.user.name)
  }
  if (color !== undefined) db.prepare('UPDATE users SET color = ? WHERE id = ?').run(color, req.user.id)
  if (avatar !== undefined) db.prepare('UPDATE users SET avatar = ? WHERE id = ?').run(avatar, req.user.id)
  if (handle !== undefined && handle !== req.user.handle) await files.renameHandle(req.user.handle, handle, () => db.prepare('UPDATE users SET handle = ? WHERE id = ?').run(handle, req.user.id))
  res.json({ user: toUser(getUser(req.user.id)) })
})

// the places this account is signed in, and signing out of all but this one
router.get('/me/sessions', requireUser, (req, res) => {
  const current = sessionHashOf(req)
  const rows = db.prepare('SELECT token_hash, created_at, agent FROM sessions WHERE user_id = ? AND expires_at > ? ORDER BY created_at DESC').all(req.user.id, Date.now())
  res.json({ sessions: rows.map((r) => ({ id: r.token_hash.slice(0, 12), createdAt: r.created_at, agent: r.agent || '', current: r.token_hash === current })) })
})

router.delete('/me/sessions', requireUser, (req, res) => {
  const r = db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').run(req.user.id, sessionHashOf(req) || '')
  res.json({ ended: Number(r.changes) })
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
    await setUpAccount(user, { joinHome: true })
    res.json({ user: signIn(req, res, user) })
  } catch (e) {
    next(e)
  }
})

router.get('/users', requireUser, (req, res) => {
  res.json({ users: allUsers().filter((u) => !u.disabled).map((u) => ({ handle: u.handle, name: u.name, role: u.role, color: u.color || null, avatar: u.avatar || null })) })
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

// Bring in the files of a GitHub repository (what Lumen's old GitHub mode wrote).
// The token reads the repository for this request only and is never stored.
router.post('/admin/import/github', requireAdmin, async (req, res, next) => {
  try {
    const token = String(req.body?.token || '').trim() || null
    const { files: entries, truncated, ref } = await readRepo({
      repo: req.body?.repo,
      branch: String(req.body?.branch || '').trim() || null,
      token,
      keep: (p, size) => files.cleanPath(p) === p && !p.startsWith('.sync/') && size <= 2 * 1024 * 1024,
    })
    const count = files.importTexts(entries)
    res.json({ files: count, branch: ref, truncated })
  } catch (e) {
    next(e.status ? new HttpError(e.status, e.message) : e)
  }
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

// Paths here are the person's own tree (view.js): their candle at the top,
// workspaces under workspaces/<slug>/, things shared with them under shared/<owner>/.
const target = (user, raw, cache) => {
  const p = files.cleanPath(raw)
  if (!p) throw new HttpError(400, 'Invalid path.')
  const t = view.resolve(user, p, cache)
  if (!t || !canReadAt(t, t.path)) throw new HttpError(404, 'Not found.')
  return t
}

router.get('/files', requireUser, (req, res) => {
  res.json({ files: view.list(req.user).map((f) => ({ path: f.path, sha: f.sha, size: f.size })) })
})

router.post('/files/read', requireUser, async (req, res, next) => {
  try {
    const paths = Array.isArray(req.body?.paths) ? req.body.paths : []
    if (paths.length > 500) throw new HttpError(400, 'Too many paths.')
    const cache = view.lookups(req.user)
    const out = {}
    for (const raw of paths) {
      const p = files.cleanPath(raw)
      const t = p && view.resolve(req.user, p, cache)
      if (!t || !canReadAt(t, t.path)) {
        out[p || String(raw)] = null
        continue
      }
      const r = await files.space(t.space).read(t.path)
      out[p] = r ? { text: r.text, sha: r.sha } : null
    }
    res.json({ files: out })
  } catch (e) {
    next(e)
  }
})

router.put('/files', requireUser, async (req, res, next) => {
  try {
    const t = target(req.user, req.body?.path)
    const text = String(req.body?.text ?? '')
    const result = await files.space(t.space).write(t.path, text, {
      baseSha: req.body?.sha ?? null,
      check(cur) {
        const reason = writeProblemAt(req.user, t, t.path, metaOf(t.path, cur?.text ?? ''), metaOf(t.path, text), !!cur)
        if (reason) throw new HttpError(403, reason)
      },
      by: req.user.handle,
    })
    // the file as stored, when it differs from what was sent (ids added, formatting settled)
    res.json(result.text != null && result.text !== text ? { sha: result.sha, text: result.text } : { sha: result.sha })
  } catch (e) {
    next(e)
  }
})

// a board, calendar, doc or idea board to another space you can edit: { from, to }
// are paths in your tree (`to` may be taken: the server picks a free one)
router.post('/files/move', requireUser, async (req, res, next) => {
  try {
    const cache = view.lookups(req.user)
    const from = target(req.user, req.body?.from, cache)
    const to = target(req.user, req.body?.to, cache)
    if (!SHARED_KINDS.test(from.path) || !SHARED_KINDS.test(to.path) || from.path.split('/')[0] !== to.path.split('/')[0]) throw new HttpError(400, 'Only boards, calendars, docs and idea boards move, and they stay what they are.')
    if (from.space === to.space) throw new HttpError(400, 'It’s there already.')
    const cur = await files.space(from.space).read(from.path)
    const leave = writeProblemAt(req.user, from, from.path, metaOf(from.path, cur?.text ?? ''), null, !!cur)
    if (leave) throw new HttpError(403, leave)
    const arrive = writeProblemAt(req.user, to, to.path, null, metaOf(to.path, cur?.text ?? ''), false)
    if (arrive) throw new HttpError(403, arrive)
    const dest = await files.move(from, to, { by: req.user.handle })
    res.json({ path: view.toView(req.user, to.space, dest) })
  } catch (e) {
    next(e)
  }
})

router.delete('/files', requireUser, async (req, res, next) => {
  try {
    const t = target(req.user, req.body?.path)
    await files.space(t.space).remove(t.path, {
      baseSha: req.body?.sha ?? null,
      check(cur) {
        const reason = writeProblemAt(req.user, t, t.path, metaOf(t.path, cur?.text ?? ''), null, !!cur)
        if (reason) throw new HttpError(403, reason)
      },
      by: req.user.handle,
    })
    res.json({ ok: true })
  } catch (e) {
    next(e)
  }
})

// ---------- chat (server mode only) ----------

// chat belongs to the home workspace for now: only its members see it
const chatOnly = (req, res, next) => {
  if (DESKTOP) return res.status(404).json({ error: 'Not here.' })
  if (req.user && !spaces.roleIn(req.user.id, files.homeSpaceId())) return res.status(404).json({ error: 'Not here.' })
  next()
}

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

router.delete('/chat/channels/:id', chatOnly, requireUser, async (req, res, next) => {
  try {
    res.json(await chat.deleteChannel(req.user, req.params.id))
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

/** Errors as JSON ({ error }), for this router and the desktop's */
export function apiErrors(err, req, res, next) {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message })
  if (err instanceof files.ConflictError) return res.status(409).json({ error: err.message, current: err.current })
  if (err instanceof RangeError) return res.status(400).json({ error: err.message })
  if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'That request body is too large.' })
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON.' })
  if (err?.status && err.status >= 400 && err.status < 500) return res.status(err.status).json({ error: err.message })
  console.error('[api]', err)
  res.status(500).json({ error: 'Something went wrong.' })
}
router.use(apiErrors)

export { router as apiRouter }
