// Git sync: the workspace folder is a git working copy, committed a few seconds
// after changes stop and pushed/pulled to a configured remote. Config (including
// the encrypted token) lives in the `sync` setting (db.js).
import { EventEmitter } from 'node:events'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { decrypt, encrypt } from './config.js'
import { HttpError } from './auth.js'
import { getSetting, setSetting } from './db.js'
import { events as fileEvents, workspaceRoot, rescan } from './files.js'

export const syncEvents = new EventEmitter()
syncEvents.setMaxListeners(100)

let cfg = null
let timer = null
let debounce = null
let chain = Promise.resolve()
let gitAvailable = null
let state = { state: 'off', lastSync: null, lastError: null, ahead: 0, pending: 0 }
const dirty = new Set()

const emitStatus = () => syncEvents.emit('status', status())
export const status = () => ({ ...state })
export const getConfig = () => ({
  remote: cfg?.remote ?? null,
  branch: cfg?.branch ?? 'main',
  authorName: cfg?.authorName ?? '',
  authorEmail: cfg?.authorEmail ?? '',
  interval: cfg?.interval ?? 2,
  hasToken: !!cfg?.token,
  enabled: !!cfg?.enabled,
})

function setState(patch) {
  state = { ...state, ...patch }
  emitStatus()
}

const token = () => (cfg?.token ? decrypt(cfg.token) : null)

// ---------- git plumbing ----------

function runGit(args, opts = {}) {
  return new Promise((resolve, reject) => {
    const root = workspaceRoot() || process.cwd()
    const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', GIT_ASKPASS: '', SSH_ASKPASS: '' }
    const tk = token()
    // no stored credentials or prompts; the token (if any) goes as a Basic auth header
    const cfgs = [
      ['credential.helper', ''],
      ['core.quotepath', 'false'],
      ['core.autocrlf', 'false'],
    ]
    if (tk) cfgs.push(['http.extraHeader', `Authorization: Basic ${Buffer.from(`x-access-token:${tk}`).toString('base64')}`])
    env.GIT_CONFIG_COUNT = String(cfgs.length)
    cfgs.forEach(([k, v], i) => {
      env[`GIT_CONFIG_KEY_${i}`] = k
      env[`GIT_CONFIG_VALUE_${i}`] = v
    })
    let child
    try {
      child = spawn('git', args, { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    } catch (e) {
      return reject(e)
    }
    let out = ''
    let err = ''
    let done = false
    const scrub = (s) => (tk ? String(s).split(tk).join('[token]') : String(s)).replace(/Authorization: Basic [A-Za-z0-9+/=]+/g, 'Authorization: [token]')
    child.stdout.on('data', (d) => {
      out += d
    })
    child.stderr.on('data', (d) => {
      err += d
    })
    child.on('error', (e) => {
      if (!done) {
        done = true
        reject(e)
      }
    })
    child.on('close', (code) => {
      if (done) return
      done = true
      if (code === 0 || opts.allowFail) return resolve({ code, stdout: out, stderr: scrub(err) })
      const e = new Error((scrub(err) || scrub(out) || `git exited ${code}`).trim())
      e.code = code
      reject(e)
    })
  })
}

async function hasGit() {
  if (gitAvailable !== null) return gitAvailable
  try {
    await runGit(['--version'])
    gitAvailable = true
  } catch {
    gitAvailable = false
  }
  return gitAvailable
}

async function hasHead() {
  const r = await runGit(['rev-parse', '--verify', 'HEAD'], { allowFail: true })
  return r.code === 0
}

function authorConfig() {
  const name = cfg?.authorName || 'Lumen'
  const email = cfg?.authorEmail || 'lumen@localhost'
  return ['-c', `user.name=${name}`, '-c', `user.email=${email}`]
}

const pad = (n) => String(n).padStart(2, '0')
function stampNow() {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}${pad(d.getMinutes())}`
}

function conflictName(file) {
  const ext = path.extname(file)
  return `${file.slice(0, file.length - ext.length)} (conflict ${stampNow()})${ext}`
}

/** https only, except local paths/file:// when LUMEN_ALLOW_FILE_REMOTES is set. */
export function normalizeRepoUrl(input) {
  let url = String(input || '').trim()
  if (!url) return null
  const allowFile = process.env.LUMEN_ALLOW_FILE_REMOTES === '1'
  const ssh = /^git@([^:]+):(.+)$/.exec(url)
  if (ssh) url = `https://${ssh[1]}/${ssh[2]}`
  if (/^[\w.-]+\/[\w.-]+$/.test(url)) url = `https://github.com/${url}.git`
  if (url.startsWith('file://') || /^[a-zA-Z]:[\\/]/.test(url) || url.startsWith('/') || url.startsWith('.') || url.startsWith('\\\\')) {
    return allowFile ? url : null
  }
  if (!/^https:\/\//i.test(url)) return null
  return url
}

// ---------- setup and sync ----------

async function ensureRemote() {
  const r = await runGit(['remote', 'get-url', 'origin'], { allowFail: true })
  if (r.code === 0 && r.stdout.trim() === cfg.remote) return
  if (r.code === 0) await runGit(['remote', 'set-url', 'origin', cfg.remote], { allowFail: true })
  else await runGit(['remote', 'add', 'origin', cfg.remote])
}

async function setup() {
  const root = workspaceRoot()
  if (!root || !cfg?.remote) return
  if (!fs.existsSync(path.join(root, '.git'))) await runGit(['init', '-b', cfg.branch])
  await ensureRemote()
}

async function resolveConflicts() {
  const res = await runGit(['diff', '--name-only', '--diff-filter=U'], { allowFail: true })
  const conflicted = res.stdout.trim().split('\n').filter(Boolean)
  for (const f of conflicted) {
    await runGit(['checkout', '--ours', '--', f])
    const theirs = await runGit(['show', `:3:${f}`], { allowFail: true })
    if (theirs.code === 0) await fs.promises.writeFile(path.join(workspaceRoot(), conflictName(f)), theirs.stdout)
  }
  await runGit(['add', '-A'])
  await runGit([...authorConfig(), 'commit', '-m', 'Lumen: merged conflicts'])
}

async function doSync() {
  if (!cfg?.enabled || !cfg?.remote) {
    setState({ state: 'off' })
    return status()
  }
  if (!(await hasGit())) {
    setState({ state: 'error', lastError: 'git is not installed' })
    return status()
  }
  setState({ state: 'syncing' })
  try {
    await setup()
    await runGit(['add', '-A'])
    const st = await runGit(['status', '--porcelain'])
    const n = st.stdout.trim() ? st.stdout.trim().split('\n').length : 0
    if (n > 0) await runGit([...authorConfig(), 'commit', '-m', `Lumen: update ${n} file(s)`])

    let remoteExists = false
    try {
      await runGit(['fetch', 'origin', cfg.branch])
      remoteExists = true
    } catch {
      remoteExists = false
    }

    if (remoteExists) {
      if (!(await hasHead())) {
        await runGit(['add', '-A'])
        const st2 = await runGit(['status', '--porcelain'])
        if (st2.stdout.trim()) await runGit([...authorConfig(), 'commit', '-m', 'Lumen: initial import'])
        if (await hasHead()) {
          try {
            await runGit(['merge', '--no-edit', '--allow-unrelated-histories', `origin/${cfg.branch}`])
          } catch {
            await resolveConflicts()
          }
        } else {
          await runGit(['checkout', '-B', cfg.branch, `origin/${cfg.branch}`], { allowFail: true })
        }
      } else {
        try {
          await runGit(['merge', '--no-edit', `origin/${cfg.branch}`])
        } catch {
          await resolveConflicts()
        }
      }
    }

    await runGit(['push', 'origin', `HEAD:${cfg.branch}`])
    dirty.clear()
    await rescan()
    setState({ state: 'idle', lastSync: new Date().toISOString(), lastError: null, ahead: 0, pending: 0 })
    return status()
  } catch (e) {
    setState({ state: 'error', lastError: e.message || 'sync failed' })
    return status()
  }
}

export function syncNow() {
  const run = chain.then(() => doSync())
  chain = run.catch(() => {})
  return run
}

// ---------- configure and loop ----------

export async function configure(input = {}) {
  const remote = normalizeRepoUrl(input.remote)
  if (!remote) throw new HttpError(400, 'Enter a valid git remote (https URL, owner/repo, or a local path).')
  if (!(await hasGit())) throw new HttpError(400, 'git is not installed.')

  const branch = String(input.branch || 'main').trim() || 'main'
  const interval = Math.max(1, Math.round(Number(input.interval) || 2))
  const prev = cfg || {}
  const next = {
    remote,
    branch,
    authorName: String(input.authorName ?? prev.authorName ?? '').trim().slice(0, 200),
    authorEmail: String(input.authorEmail ?? prev.authorEmail ?? '').trim().slice(0, 200),
    interval,
    enabled: input.enabled !== false,
  }
  if (typeof input.token === 'string' && input.token.trim()) next.token = encrypt(input.token.trim())
  else if (input.token === '' || input.token === null) next.token = null
  else if (prev.token) next.token = prev.token

  cfg = next
  try {
    await runGit(['ls-remote', remote])
  } catch (e) {
    cfg = prev
    throw new HttpError(400, `Can’t reach that remote: ${e.message}`)
  }
  setSetting('sync', next)

  if (next.enabled) {
    await setup()
    restartLoop()
    syncNow().catch(() => {})
  } else {
    restartLoop()
  }
  return status()
}

function restartLoop() {
  clearInterval(timer)
  timer = null
  clearTimeout(debounce)
  debounce = null
  if (!cfg?.enabled || !cfg?.remote) {
    setState({ state: 'off' })
    return
  }
  const mins = Math.max(1, Number(cfg.interval) || 2)
  timer = setInterval(() => syncNow().catch(() => {}), mins * 60000)
  setState({ state: state.lastError ? 'error' : 'idle' })
}

export async function start() {
  cfg = getSetting('sync')
  if (!cfg?.enabled || !cfg?.remote) {
    setState({ state: 'off' })
    return
  }
  if (!(await hasGit())) {
    setState({ state: 'error', lastError: 'git is not installed' })
    return
  }
  try {
    await setup()
  } catch {
    // a broken config shouldn't stop the server; syncNow will report it
  }
  restartLoop()
  syncNow().catch(() => {})
}

export async function stop() {
  clearInterval(timer)
  timer = null
  clearTimeout(debounce)
  debounce = null
  if (cfg?.enabled && cfg?.remote && (await hasGit())) {
    await Promise.race([syncNow(), new Promise((r) => setTimeout(r, 10000))])
  }
  setState({ state: 'off' })
}

// changes made through the API (not by git itself) queue a sync in 8 s
fileEvents.on('change', (changes, opts) => {
  if (opts?.external) return
  if (!cfg?.enabled || !cfg?.remote) return
  for (const c of changes) dirty.add(c.path)
  setState({ pending: dirty.size })
  clearTimeout(debounce)
  debounce = setTimeout(() => syncNow().catch(() => {}), 8000)
})
