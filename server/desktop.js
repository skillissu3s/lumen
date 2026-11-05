// Desktop mode: one local admin user and the workspace/sync routes the Electron
// shell talks to. There are no accounts to manage and no chat.
import express from 'express'
import os from 'node:os'
import path from 'node:path'
import { DESKTOP, WORKSPACE_DIR } from './config.js'
import { db, getSetting, setSetting } from './db.js'
import { HttpError, userByEmail, createUser, createSession } from './auth.js'
import { openWorkspace, importFolder, info } from './files.js'
import { seedWorkspace } from './seed.js'
import * as git from './git.js'
import { apiErrors, jsonBody, csrf, loadUser, requireUser } from './api.js'
import * as replica from './sync/replica.js'

const LOCAL_EMAIL = 'local@lumen.desktop'

export async function ensureDesktopUser() {
  if (!DESKTOP) return null
  let user = userByEmail(LOCAL_EMAIL)
  if (user) {
    if (user.role !== 'admin') db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(user.id)
    return user
  }
  return createUser({ email: LOCAL_EMAIL, name: os.userInfo().username || 'You', password: null, role: 'admin' })
}

export function desktopSessionToken() {
  const user = userByEmail(LOCAL_EMAIL)
  if (!user) throw new HttpError(500, 'Desktop user missing.')
  return createSession(user.id, 'desktop')
}

// an explicit WORKSPACE_DIR (tests, portable setups) beats the folder picked in the app
export const desktopWorkspaceDir = () => (process.env.WORKSPACE_DIR ? WORKSPACE_DIR : getSetting('desktop.workspace') || path.join(os.homedir(), 'Documents', 'Lumen'))

export const markDesktop = (req, res, next) => {
  if (req.user) req.user.desktop = true
  next()
}

export const desktopRouter = express.Router()
desktopRouter.use(jsonBody, csrf, loadUser, requireUser, markDesktop)

desktopRouter.get('/desktop/workspace', (req, res) => res.json({ dir: desktopWorkspaceDir() }))

desktopRouter.put('/desktop/workspace', async (req, res, next) => {
  try {
    const dir = String(req.body?.dir || '').trim()
    if (!dir) throw new HttpError(400, 'Choose a folder.')
    const abs = path.resolve(dir)
    await openWorkspace(abs)
    // a folder picked by hand is brought in, even when the database already has data
    await importFolder(abs)
    if (!info('lumen.json')) await seedWorkspace({ handle: req.user.handle, name: req.user.name, chat: false })
    setSetting('desktop.workspace', abs)
    res.json({ dir: abs })
  } catch (e) {
    next(e)
  }
})

// where this app's data lives: 'local' (this computer only) or 'cloud' (a copy
// of an account on a Lumen server, kept in sync: see sync/replica.js); 'ask'
// clears the choice so the app asks again
desktopRouter.get('/desktop/mode', (req, res) => res.json(getSetting('desktop.mode') || { mode: null }))

desktopRouter.post('/desktop/mode', (req, res, next) => {
  try {
    const mode = String(req.body?.mode || '')
    if (mode === 'ask') setSetting('desktop.mode', null)
    else if (mode === 'local') setSetting('desktop.mode', { mode: 'local' })
    else throw new HttpError(400, 'Choose this computer, or sign in to a server.')
    res.json({ mode: mode === 'ask' ? null : mode })
  } catch (e) {
    next(e)
  }
})

// ---------- the account on a Lumen server ----------

// "lumen.example.com" → "https://lumen.example.com", checked to be a Lumen server
async function lumenServer(input) {
  let s = String(input || '').trim().replace(/\/+$/, '')
  if (s && !/^https?:\/\//i.test(s)) s = `https://${s}`
  let url
  try {
    url = new URL(s)
  } catch {
    throw new HttpError(400, 'Enter your Lumen server’s address, like lumen.example.com.')
  }
  const server = `${url.origin}${url.pathname.replace(/\/+$/, '')}`
  let info = null
  try {
    const r = await fetch(`${server}/api/info`, { headers: { 'X-Lumen': '1' }, signal: AbortSignal.timeout(8000) })
    info = await r.json()
  } catch {
    throw new HttpError(400, `Nothing answered at ${server}. Check the address and your connection.`)
  }
  if (info?.app !== 'lumen' || info.mode !== 'server') throw new HttpError(400, `${server} isn’t a Lumen server.`)
  return server
}

// the server's own answer (a wrong password, an expired code) passes through
const remoteProblem = (e) => (e instanceof HttpError ? e : new HttpError(e.status && e.status < 500 ? 400 : 502, e.status === 0 ? 'The server didn’t answer.' : e.message))

desktopRouter.get('/desktop/cloud', (req, res) => res.json(replica.publicStatus()))

desktopRouter.post('/desktop/cloud/login', async (req, res, next) => {
  try {
    const server = await lumenServer(req.body?.server)
    res.json({ server, ...(await replica.login({ server, email: req.body?.email, password: req.body?.password })) })
  } catch (e) {
    next(remoteProblem(e))
  }
})

desktopRouter.post('/desktop/cloud/verify', async (req, res, next) => {
  try {
    const server = await lumenServer(req.body?.server)
    res.json({ server, ...(await replica.verify({ server, challenge: req.body?.challenge, code: req.body?.code })) })
  } catch (e) {
    next(remoteProblem(e))
  }
})

desktopRouter.post('/desktop/cloud/link', async (req, res, next) => {
  try {
    res.json(await replica.link({ keep: req.body?.keep === 'both' ? 'both' : 'server' }))
  } catch (e) {
    next(remoteProblem(e))
  }
})

desktopRouter.post('/desktop/cloud/sync', async (req, res) => res.json(await replica.syncNow()))

desktopRouter.post('/desktop/cloud/logout', async (req, res, next) => {
  try {
    await replica.unlink()
    res.json(replica.publicStatus())
  } catch (e) {
    next(e)
  }
})

desktopRouter.get('/desktop/sync', (req, res) => res.json({ config: git.getConfig(), status: git.status() }))

desktopRouter.put('/desktop/sync', async (req, res, next) => {
  try {
    await git.configure(req.body || {})
    res.json({ config: git.getConfig(), status: git.status() })
  } catch (e) {
    next(e)
  }
})

desktopRouter.post('/desktop/sync/now', async (req, res, next) => {
  try {
    res.json({ status: await git.syncNow() })
  } catch (e) {
    next(e)
  }
})

desktopRouter.use(apiErrors)
