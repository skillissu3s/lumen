// /api/github: connecting a repository through the server's GitHub App, the
// mirror's schedule, Sync now, and restoring from a repository. Only on a
// server (the desktop app has no public address for GitHub to come back to).

import crypto from 'node:crypto'
import os from 'node:os'
import express from 'express'
import { APP_NAME, DESKTOP, PUBLIC_URL, VERSION } from '../config.js'
import { db, getSetting, setSetting } from '../db.js'
import { getUser } from '../auth.js'
import * as files from '../files.js'
import { GitHubError, appConfig, createGitHubApp } from './app.js'
import { githubRepo } from './repo.js'
import { createWorker } from '../mirror/worker.js'
import { cleanSchedule } from '../mirror/schedule.js'
import { countKinds, planRestore, readMirror } from '../mirror/restore.js'
import { apiErrors, csrf, jsonBody, loadUser, requireAdmin, requireUser } from '../api.js'

const TEN_MIN = 10 * 60000
const config = DESKTOP ? null : appConfig()
const app = config ? createGitHubApp(config, { callbackUrl: PUBLIC_URL ? `${PUBLIC_URL}/api/github/callback` : undefined }) : null

// this server, as the mirrors it writes name it; kept so a moved database is still "this server"
function source() {
  let s = getSetting('mirror.source')
  if (!s) setSetting('mirror.source', (s = { id: `srv_${crypto.randomBytes(8).toString('hex')}`, label: PUBLIC_URL || os.hostname() }))
  return s
}

const repoFor = (installationId, repoId) => githubRepo({ repoId, api: app.api, token: () => app.installationToken(installationId, repoId) })

export const worker = app
  ? createWorker(
      { db, store: files.store, units: files.units, events: files.events, users: { get: getUser }, source: source(), app: { name: APP_NAME, version: VERSION } },
      (c) => repoFor(c.installation_id, c.repo_id),
    )
  : null

// a connect in progress: state → who started it; then the repositories they may choose from
const states = new Map()
const picks = new Map()
const sweep = (m) => {
  for (const [k, v] of m) if (v.expires < Date.now()) m.delete(k)
}
const picksOf = (user) => {
  sweep(picks)
  return picks.get(user.id)?.repos || null
}

function view(c) {
  return {
    id: c.id,
    repo: c.repo_name,
    repoId: c.repo_id,
    url: `${app.web}/${c.repo_name}${c.branch ? `/tree/${encodeURIComponent(c.branch)}${c.prefix ? `/${c.prefix}` : ''}` : ''}`,
    branch: c.branch,
    prefix: c.prefix,
    scope: c.scope,
    mode: c.mode,
    schedule: c.schedule,
    allowPublic: !!c.allow_public,
    lastRunAt: c.last_run_at,
    lastCommit: c.last_commit,
    commitUrl: c.last_commit ? `${app.web}/${c.repo_name}/commit/${c.last_commit}` : null,
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
githubRouter.use(jsonBody, csrf, loadUser)

// GitHub sends people back here, signed in to Lumen as before
githubRouter.get('/callback', async (req, res) => {
  const back = (q) => res.redirect(`/app.html#/settings/github?${new URLSearchParams(q)}`)
  const s = states.get(String(req.query.state || ''))
  states.delete(String(req.query.state || ''))
  if (!app || !req.user || !s || s.expires < Date.now() || s.user !== req.user.id) return back({ error: 'That GitHub link expired or wasn’t started here. Try connecting again.' })
  if (!req.query.code) return back({ error: req.query.setup_action === 'request' ? 'GitHub sent an install request to the account’s owner. Connect again once they approve it.' : 'GitHub didn’t finish connecting. Try again.' })
  try {
    const repos = await app.reposFor(String(req.query.code), req.query.installation_id ? String(req.query.installation_id) : null)
    picks.set(req.user.id, { repos, expires: Date.now() + 30 * 60000 })
    back({ connected: '1' })
  } catch (e) {
    back({ error: e.message })
  }
})

githubRouter.use(requireUser, (req, res, next) => {
  if (!app) return req.method === 'GET' && req.path === '/' ? res.json({ available: false }) : res.status(404).json({ error: 'This server has no GitHub App set up.' })
  next()
})

githubRouter.get('/', (req, res) => {
  res.json({
    available: true,
    appUrl: `${app.web}/apps/${app.slug}`,
    canWorkspace: req.user.role === 'admin',
    connections: worker.list(req.user.id).map(view),
    picks: picksOf(req.user),
  })
})

// "Connect GitHub": to GitHub to install the App (or, if it's installed, just to say who you are)
githubRouter.post('/connect', (req, res) => {
  sweep(states)
  const state = crypto.randomBytes(16).toString('base64url')
  states.set(state, { user: req.user.id, expires: Date.now() + TEN_MIN })
  res.json({ url: req.body?.installed ? app.authorizeUrl(state) : app.installUrl(state) })
})

githubRouter.post('/connections', (req, res) => {
  const b = req.body || {}
  const repo = (picksOf(req.user) || []).find((r) => r.id === Number(b.repoId))
  if (!repo) throw Object.assign(new Error('Choose one of the repositories GitHub listed. If it isn’t there, connect GitHub again and give the App access to it.'), { status: 400 })
  const scope = b.scope === 'workspace' && req.user.role === 'admin' ? 'workspace' : 'owner'
  const mode = String(b.mode || 'daily')
  const c = worker.create(req.user.id, {
    installationId: repo.installationId,
    repo,
    branch: cleanBranch(b.branch || repo.defaultBranch),
    prefix: cleanPrefix(b.prefix),
    scope,
    mode,
    schedule: cleanSchedule(mode, b.schedule),
    allowPublic: !!b.allowPublic,
    adopt: !!b.adopt,
  })
  picks.delete(req.user.id)
  worker.run(c.id).catch(() => {})
  res.json({ connection: view(worker.get(c.id)) })
})

githubRouter.patch('/connections/:id', (req, res) => {
  const c = mine(req)
  const b = req.body || {}
  const patch = {}
  if (b.mode !== undefined) Object.assign(patch, { mode: String(b.mode), schedule: b.schedule })
  if (b.branch !== undefined) patch.branch = cleanBranch(b.branch)
  if (b.prefix !== undefined) patch.prefix = cleanPrefix(b.prefix)
  if (b.allowPublic !== undefined) patch.allowPublic = !!b.allowPublic
  if (b.resume) patch.resume = true
  if (b.adopt) patch.adopt = true
  if (patch.mode !== undefined) cleanSchedule(patch.mode, patch.schedule)
  worker.update(c.id, patch)
  if (patch.resume || patch.adopt || patch.allowPublic) worker.run(c.id).catch(() => {})
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
// says what it would do. Admins only: it writes into the whole workspace.
githubRouter.post('/restore', requireAdmin, async (req, res) => {
  const b = req.body || {}
  let target = null
  if (b.connectionId) {
    const c = worker.get(String(b.connectionId))
    if (c && c.owner === req.user.id) target = { installationId: c.installation_id, id: c.repo_id, fullName: c.repo_name, branch: c.branch, prefix: c.prefix }
  } else {
    const r = (picksOf(req.user) || []).find((x) => x.id === Number(b.repoId))
    if (r) target = { installationId: r.installationId, id: r.id, fullName: r.fullName, branch: cleanBranch(b.branch || r.defaultBranch), prefix: cleanPrefix(b.prefix) }
  }
  if (!target) throw Object.assign(new Error('Choose a repository first.'), { status: 400 })
  let m
  try {
    m = await readMirror(repoFor(target.installationId, target.id), {
      branch: target.branch,
      prefix: target.prefix,
      keep: (p) => files.cleanPath(p) === p,
    })
  } catch (e) {
    if (!(e instanceof GitHubError)) throw e
    throw Object.assign(new Error([401, 403, 404].includes(e.status) ? 'Lumen can’t reach that repository. Check that the GitHub App still has access to it.' : e.message), { status: e.status === 413 ? 400 : 502 })
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
