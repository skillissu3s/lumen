// /api/github: the GitHub mirror's connections, each a repository and a
// fine-grained token that can write to it (kept encrypted), its schedule, Sync
// now, and restoring from a repository. Only on a server: the mirror runs there.

import crypto from 'node:crypto'
import os from 'node:os'
import express from 'express'
import { APP_NAME, DESKTOP, PUBLIC_URL, VERSION, decrypt, encrypt } from '../config.js'
import { db, getSetting, setSetting } from '../db.js'
import { getUser } from '../auth.js'
import * as files from '../files.js'
import { GitHubError, WEB, checkToken } from './api.js'
import { githubRepo } from './repo.js'
import { createWorker } from '../mirror/worker.js'
import { cleanSchedule } from '../mirror/schedule.js'
import { countKinds, planRestore, readMirror } from '../mirror/restore.js'
import { apiErrors, csrf, jsonBody, loadUser, requireAdmin, requireUser } from '../api.js'

// this server, as the mirrors it writes name it; kept so a moved database is still "this server"
function source() {
  let s = getSetting('mirror.source')
  if (!s) setSetting('mirror.source', (s = { id: `srv_${crypto.randomBytes(8).toString('hex')}`, label: PUBLIC_URL || os.hostname() }))
  return s
}

const repoFor = (repoId, token) => githubRepo({ repoId, token: async () => token })

export const worker = DESKTOP
  ? null
  : createWorker(
      { db, store: files.store, units: files.units, events: files.events, users: { get: getUser }, source: source(), app: { name: APP_NAME, version: VERSION } },
      (c) => repoFor(c.repo_id, decrypt(c.token)),
    )

function view(c) {
  return {
    id: c.id,
    repo: c.repo_name,
    url: `${WEB}/${c.repo_name}/tree/${encodeURIComponent(c.branch)}${c.prefix ? `/${c.prefix}` : ''}`,
    branch: c.branch,
    prefix: c.prefix,
    scope: c.scope,
    mode: c.mode,
    schedule: c.schedule,
    allowPublic: !!c.allow_public,
    lastRunAt: c.last_run_at,
    lastCommit: c.last_commit,
    commitUrl: c.last_commit ? `${WEB}/${c.repo_name}/commit/${c.last_commit}` : null,
    nextRunAt: c.next_run_at,
    lastError: c.last_error,
    paused: c.paused,
    running: worker.isRunning(c.id),
    waiting: !!c.index_json && worker.pending(c),
    drift: worker.drift(c.id),
    runs: worker.runs(c.id).map((r) => ({ at: r.finished_at, written: r.written, removed: r.removed, commit: r.commit_sha, error: r.error, full: !!r.full })),
  }
}

const cleanBranch = (b) => {
  const s = String(b || '').trim() || 'main'
  if (s.length > 100 || !/^[\w.\-/]+$/.test(s) || s.includes('..') || s.startsWith('/') || s.endsWith('/') || s.endsWith('.lock')) throw Object.assign(new Error('That isn’t a branch name GitHub accepts.'), { status: 400 })
  return s
}
const cleanPrefix = (p) => {
  const s = String(p || '').trim().replace(/^\/+|\/+$/g, '')
  if (!s) return ''
  if (s.length > 100 || s.split('/').some((x) => !x || x === '.' || x === '..' || x.startsWith('.') || /[\0<>:"|?*\\]/.test(x))) throw Object.assign(new Error('That folder name won’t work. Use letters, digits and dashes, like lumen or backups/lumen.'), { status: 400 })
  return s
}

const mine = (req) => {
  const c = worker.get(req.params.id)
  if (!c || c.owner !== req.user.id) throw Object.assign(new Error('Not found.'), { status: 404 })
  return c
}

// mounted at /api/github
export const githubRouter = express.Router()
githubRouter.use(jsonBody, csrf, loadUser, requireUser, (req, res, next) => {
  if (!worker) return res.status(404).json({ error: 'The GitHub mirror runs on a Lumen server.' })
  next()
})

githubRouter.get('/', (req, res) => {
  res.json({ canWorkspace: req.user.role === 'admin', connections: worker.list(req.user.id).map(view) })
})

githubRouter.post('/connections', async (req, res) => {
  const b = req.body || {}
  const token = String(b.token || '').trim()
  const repo = await checkToken(b.repo, token)
  if (!repo.private && !b.allowPublic) throw Object.assign(new Error('That repository is public: anyone could read your data there. Make it private, or tick the box to sync to it anyway.'), { status: 400 })
  const mode = String(b.mode || 'daily')
  const c = worker.create(req.user.id, {
    token: encrypt(token),
    repo,
    branch: cleanBranch(b.branch || repo.defaultBranch),
    prefix: cleanPrefix(b.prefix),
    scope: b.scope === 'workspace' && req.user.role === 'admin' ? 'workspace' : 'owner',
    mode,
    schedule: cleanSchedule(mode, b.schedule),
    allowPublic: !!b.allowPublic,
    adopt: !!b.adopt,
  })
  worker.run(c.id).catch(() => {})
  res.json({ connection: view(worker.get(c.id)) })
})

githubRouter.patch('/connections/:id', async (req, res) => {
  const c = mine(req)
  const b = req.body || {}
  const patch = {}
  if (b.mode !== undefined) {
    cleanSchedule(String(b.mode), b.schedule)
    Object.assign(patch, { mode: String(b.mode), schedule: b.schedule })
  }
  if (b.branch !== undefined) patch.branch = cleanBranch(b.branch)
  if (b.prefix !== undefined) patch.prefix = cleanPrefix(b.prefix)
  if (b.allowPublic !== undefined) patch.allowPublic = !!b.allowPublic
  if (b.resume) patch.resume = true
  if (b.adopt) patch.adopt = true
  if (b.token) {
    // a new token must open the same repository (by id, so a renamed one is fine)
    const repo = await checkToken(c.repo_name, String(b.token))
    if (repo.id !== c.repo_id) throw Object.assign(new Error('That repository isn’t the one this sync was set up with. Disconnect and connect the new one.'), { status: 400 })
    patch.token = encrypt(String(b.token).trim())
  }
  worker.update(c.id, patch)
  if (patch.resume || patch.adopt || patch.allowPublic || patch.token) worker.run(c.id).catch(() => {})
  res.json({ connection: view(worker.get(c.id)) })
})

githubRouter.delete('/connections/:id', (req, res) => {
  worker.remove(mine(req).id)
  res.json({ ok: true })
})

githubRouter.post('/connections/:id/run', async (req, res) => {
  const c = mine(req)
  await worker.run(c.id, { full: !!req.body?.full })
  res.json({ connection: view(worker.get(c.id)) })
})

// Restore: read a repository's mirror and take it in. Without `confirm`, only
// says what it would do. Admins only: it writes into the whole workspace. The
// repository is a connection's, or any one with a token that can read it (used
// for this request only, never kept).
githubRouter.post('/restore', requireAdmin, async (req, res) => {
  const b = req.body || {}
  let target = null
  if (b.connectionId) {
    const c = worker.get(String(b.connectionId))
    if (c && c.owner === req.user.id) target = { id: c.repo_id, fullName: c.repo_name, token: decrypt(c.token), branch: c.branch, prefix: c.prefix }
  } else if (b.repo) {
    const token = String(b.token || '').trim() || null
    const info = await checkToken(b.repo, token, { write: false })
    target = { id: info.id, fullName: info.fullName, token, branch: cleanBranch(b.branch || info.defaultBranch), prefix: cleanPrefix(b.prefix) }
  }
  if (!target) throw Object.assign(new Error('Choose a repository first.'), { status: 400 })
  let m
  try {
    m = await readMirror(repoFor(target.id, target.token), { branch: target.branch, prefix: target.prefix, keep: (p) => files.cleanPath(p) === p })
  } catch (e) {
    if (!(e instanceof GitHubError)) throw e
    throw Object.assign(new Error([401, 403, 404].includes(e.status) ? 'GitHub refused the token for that repository.' : e.message), { status: e.status === 413 ? 400 : 502 })
  }
  const ours = m.manifest?.source?.id === source().id
  const plan = planRestore(m.files, { units: files.units, store: files.store, since: ours ? m.manifest.cursor : null, repoWins: !!b.repoWins })
  const report = {
    repo: target.fullName,
    branch: target.branch,
    legacy: m.legacy,
    writtenAt: m.manifest?.written || null,
    found: countKinds(m.files.map(([p]) => p), files.units),
    take: plan.take.length,
    same: plan.same.length,
    kept: plan.kept,
    skipped: m.skipped,
  }
  if (b.confirm) report.taken = files.importTexts(plan.take)
  res.json(report)
})

githubRouter.use(apiErrors)
