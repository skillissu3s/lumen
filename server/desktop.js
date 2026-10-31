// Desktop mode: one local admin user and the workspace/sync routes the Electron
// shell talks to. There are no accounts to manage and no chat.
import express from 'express'
import os from 'node:os'
import path from 'node:path'
import { DESKTOP, WORKSPACE_DIR } from './config.js'
import { db, getSetting, setSetting } from './db.js'
import { HttpError, userByEmail, createUser, createSession } from './auth.js'
import { openWorkspace, info } from './files.js'
import { seedWorkspace } from './seed.js'
import * as git from './git.js'
import { jsonBody, csrf, loadUser, requireUser } from './api.js'

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
    if (!info('lumen.json')) await seedWorkspace({ handle: req.user.handle, name: req.user.name, chat: false })
    setSetting('desktop.workspace', abs)
    res.json({ dir: abs })
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
