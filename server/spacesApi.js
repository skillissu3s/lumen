// /api/spaces and /api/join: your candle and the workspaces you're in, making
// and managing workspaces, and invite links (docs/CANDLES.md). Mounted at /api.

import express from 'express'
import { DESKTOP, PUBLIC_URL } from './config.js'
import { createSession, createUser, setSessionCookie, userByEmail, userByHandle } from './auth.js'
import * as files from './files.js'
import { getSetting } from './db.js'
import * as spaces from './spaces.js'
import * as view from './view.js'
import { setUpAccount } from './accounts.js'
import { seedSpace } from './seed.js'
import { apiErrors, csrf, jsonBody, loadUser, requireUser } from './api.js'

export const spacesRouter = express.Router()
spacesRouter.use(jsonBody, csrf, loadUser)

const fail = (status, message) => Object.assign(new Error(message), { status })
const serverOnly = (req, res, next) => (DESKTOP ? res.status(404).json({ error: 'Workspaces are on a Lumen server.' }) : next())

// `home`: the workspace that holds chat for now (phase 4 gives every workspace its own)
const shape = (s) => ({ id: s.id, kind: s.kind, name: s.name, slug: s.slug, role: s.role, prefix: s.kind === 'candle' ? '' : `workspaces/${s.slug}/`, home: s.id === files.homeSpaceId() })
const mustBeIn = (user, id) => {
  const role = spaces.roleIn(user.id, id)
  if (!role) throw fail(404, 'Not found.')
  return role
}

spacesRouter.get('/spaces', requireUser, (req, res) => {
  if (req.user.desktop) {
    // signed in to a server: the account's spaces, as of the last sync (their files are here too)
    const cloud = getSetting('cloud') && getSetting('cloud.spaces')
    return res.json(cloud || { spaces: [{ id: files.homeSpaceId(), kind: 'candle', name: '', slug: null, role: 'owner', prefix: '', home: true }], shared: [] })
  }
  spaces.ensureCandle(req.user)
  res.json({
    spaces: spaces.spacesOf(req.user.id).map(shape),
    shared: view.shared(req.user).map((s) => ({ prefix: s.prefix, path: s.path, owner: s.owner, ownerName: userByHandle(s.owner)?.name || s.owner, can: s.can })),
  })
})

spacesRouter.post('/spaces', serverOnly, requireUser, async (req, res) => {
  const ws = spaces.createWorkspace(req.user, req.body?.name)
  await seedSpace(files.space(ws.id), { handle: req.user.handle, name: req.user.name, title: ws.name, chat: true })
  res.json({ space: shape({ ...ws, role: 'owner' }) })
})

spacesRouter.patch('/spaces/:id', serverOnly, requireUser, async (req, res) => {
  const s = spaces.rename(req.params.id, req.user, { name: req.body?.name, slug: req.body?.slug })
  // the space's own lumen.json carries its name too
  if (req.body?.name !== undefined) {
    const sp = files.space(s.id)
    const cur = await sp.read('lumen.json')
    const cfg = cur ? JSON.parse(cur.text) : { version: 1, inbox: 'inbox', plugins: {} }
    if (cfg.name !== s.name) await sp.write('lumen.json', `${JSON.stringify({ ...cfg, name: s.name }, null, 2)}\n`, { by: req.user.handle })
  }
  res.json({ space: shape({ ...s, role: spaces.roleIn(req.user.id, s.id) }) })
})

spacesRouter.delete('/spaces/:id', serverOnly, requireUser, (req, res) => {
  spaces.deleteWorkspace(req.params.id, req.user)
  res.json({ ok: true })
})

spacesRouter.get('/spaces/:id/members', serverOnly, requireUser, (req, res) => {
  mustBeIn(req.user, req.params.id)
  res.json({ members: spaces.members(req.params.id) })
})

spacesRouter.patch('/spaces/:id/members/:userId', serverOnly, requireUser, (req, res) => {
  spaces.setRole(req.params.id, req.user, req.params.userId, String(req.body?.role || ''))
  res.json({ members: spaces.members(req.params.id) })
})

// remove someone, or (your own id) leave
spacesRouter.delete('/spaces/:id/members/:userId', serverOnly, requireUser, (req, res) => {
  spaces.removeMember(req.params.id, req.user, req.params.userId)
  res.json({ ok: true })
})

spacesRouter.get('/spaces/:id/invites', serverOnly, requireUser, (req, res) => {
  res.json({ invites: spaces.listInvites(req.params.id, req.user) })
})

spacesRouter.post('/spaces/:id/invites', serverOnly, requireUser, (req, res) => {
  const inv = spaces.createInvite(req.params.id, req.user, { role: req.body?.role, days: req.body?.days })
  const origin = PUBLIC_URL || `${req.protocol}://${req.get('host')}`
  res.json({ ...inv, url: `${origin}/app.html#/join/${inv.token}` })
})

spacesRouter.delete('/spaces/:id/invites/:inviteId', serverOnly, requireUser, (req, res) => {
  if (!spaces.revokeInvite(req.params.id, req.user, req.params.inviteId)) throw fail(404, 'No such invite.')
  res.json({ ok: true })
})

// ---------- joining through a link ----------

spacesRouter.get('/join/:token', serverOnly, (req, res) => {
  const found = spaces.findInvite(req.params.token)
  if (!found) throw fail(410, 'This invite link has expired or was revoked.')
  res.json({ space: { name: found.space.name, role: found.invite.role }, signedIn: !!req.user, member: !!req.user && !!spaces.roleIn(req.user.id, found.space.id) })
})

spacesRouter.post('/join/:token', serverOnly, requireUser, (req, res) => {
  const s = spaces.acceptInvite(req.params.token, req.user)
  res.json({ space: shape({ ...s, role: spaces.roleIn(req.user.id, s.id) }) })
})

// no account yet: the link is also the way in
spacesRouter.post('/join/:token/signup', serverOnly, async (req, res) => {
  if (!spaces.findInvite(req.params.token)) throw fail(410, 'This invite link has expired or was revoked.')
  if (userByEmail(String(req.body?.email || '').trim().toLowerCase())) throw fail(409, 'There is already an account with that email. Sign in, then open the link again.')
  const user = await createUser({ email: req.body?.email, name: req.body?.name, password: req.body?.password, role: 'member' })
  await setUpAccount(user)
  const s = spaces.acceptInvite(req.params.token, user)
  setSessionCookie(res, createSession(user.id, req.get('user-agent')))
  res.json({ user: { id: user.id, email: user.email, handle: user.handle, name: user.name, role: user.role }, space: shape({ ...s, role: spaces.roleIn(user.id, s.id) }) })
})

spacesRouter.use(apiErrors)
