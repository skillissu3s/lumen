// The GitHub backend: the workspace lives in one repository, reached through the
// REST v3 API with a fine-grained token. Reads are cached by blob sha; writes are
// serialized through one queue because a branch can't take parallel commits.

import { idbGet, idbSet } from '../lib/idb.js'
import { blobSha } from '../../../shared/merge.js'
import { ConflictError, AuthError, OfflineError } from './errors.js'

const API = 'https://api.github.com'
const TEXT_EXT = /\.(md|markdown|txt|json|jsonl|canvas|js|mjs|css|html|svg|ics|csv|yml|yaml)$/i
const IGNORED = /(^|\/)(\.git|\.obsidian|node_modules)(\/|$)/
const POLL_MS = 30000

function base64Encode(text) {
  const bytes = new TextEncoder().encode(String(text))
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin)
}

function base64Decode(b64) {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new TextDecoder().decode(bytes)
}

function encodePath(path) {
  return String(path).split('/').map(encodeURIComponent).join('/')
}

function ghHeaders(token, opts = {}) {
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  }
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json'
  return { ...headers, ...(opts.headers || {}) }
}

async function ghFetch(token, path, opts = {}) {
  let res
  try {
    res = await fetch(API + path, {
      method: opts.method || 'GET',
      headers: ghHeaders(token, opts),
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    })
  } catch {
    throw new OfflineError()
  }
  const text = await res.text()
  let json = null
  if (text) {
    try {
      json = JSON.parse(text)
    } catch {
      /* not JSON */
    }
  }
  return { status: res.status, ok: res.ok, headers: res.headers, json, text }
}

function ghError(status, json, headers) {
  if (status === 401) return new AuthError('Your GitHub token is no longer valid')
  if (status === 403 && headers.get('x-ratelimit-remaining') === '0') {
    const reset = +headers.get('x-ratelimit-reset') * 1000
    const when = reset ? new Date(reset).toLocaleTimeString() : 'soon'
    return new Error(`GitHub rate limit reached; it resets at ${when}`)
  }
  const message = (json && json.message) || `GitHub request failed (${status})`
  const err = new Error(message)
  err.status = status
  err.body = json
  return err
}

async function ghJson(token, path, opts = {}) {
  const r = await ghFetch(token, path, opts)
  if (!r.ok) throw ghError(r.status, r.json, r.headers)
  return r.json
}

export async function githubUser(token) {
  return ghJson(token, '/user')
}

export async function listRepos(token) {
  return ghJson(token, '/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator')
}

/** { defaultBranch, push, empty } for a repository. */
export async function repoInfo(token, owner, repo) {
  const r = await ghJson(token, `/repos/${owner}/${repo}`)
  return {
    defaultBranch: r.default_branch,
    push: !!(r.permissions && r.permissions.push),
    empty: r.size === 0,
  }
}

export function createGitHubBackend({ token, owner, repo, branch }) {
  const listeners = new Set()
  let known = new Map() // path → blob sha
  let lastHead = null
  let etag = null
  let firstPoll = true
  let started = false
  let pollTimer = null
  let queue = Promise.resolve()

  const onFocus = () => poll()
  const onOnline = () => poll()

  // one commit at a time, so a branch ref can't take parallel writes
  const enqueue = (fn) => {
    const run = queue.then(fn, fn)
    queue = run.catch(() => {})
    return run
  }

  const emit = (changes) => {
    if (!changes.length) return
    for (const fn of listeners) fn(changes)
  }

  function diff(before, after) {
    const changes = []
    for (const [path, sha] of after) {
      if (before.get(path) !== sha) changes.push({ path, sha, deleted: false })
    }
    for (const [path] of before) {
      if (!after.has(path)) changes.push({ path, sha: null, deleted: true })
    }
    return changes
  }

  const isTextPath = (p) =>
    p === '.gitattributes' || (!IGNORED.test(p) && TEXT_EXT.test(p))

  async function getCurrent(path) {
    try {
      const r = await ghJson(token, `/repos/${owner}/${repo}/contents/${encodePath(path)}?ref=${encodeURIComponent(branch)}`)
      return { text: base64Decode(r.content), sha: r.sha }
    } catch (e) {
      if (e.status === 404) return null
      throw e
    }
  }

  async function readBlob(sha) {
    const key = `blob:${sha}`
    const cached = await idbGet(key)
    if (cached != null) return { text: cached, sha }
    const r = await ghJson(token, `/repos/${owner}/${repo}/git/blobs/${sha}`)
    const text = r.encoding === 'utf-8' ? r.content : base64Decode(r.content)
    await idbSet(key, text)
    return { text, sha }
  }

  async function poll() {
    try {
      const r = await ghFetch(token, `/repos/${owner}/${repo}/branches/${encodeURIComponent(branch)}`, {
        headers: etag ? { 'If-None-Match': etag } : {},
      })
      if (r.status === 304) return
      const head = r.json && r.json.commit ? r.json.commit.sha : null
      etag = r.headers.get('etag') || etag
      if (firstPoll) {
        firstPoll = false
        lastHead = head
        return
      }
      if (head && head !== lastHead) {
        lastHead = head
        const before = known
        await list()
        emit(diff(before, known))
      }
    } catch {
      /* transient; the next poll or a focus event retries */
    }
  }

  const backend = {
    kind: 'github',

    async list() {
      let json
      try {
        json = await ghJson(token, `/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`)
      } catch (e) {
        // an empty repo has no tree yet
        if (e.status === 404 || (e.status === 409 && /empty/i.test(e.message))) return []
        throw e
      }
      const files = (json.tree || []).filter((e) => e.type === 'blob' && isTextPath(e.path))
      known = new Map(files.map((f) => [f.path, f.sha]))
      return files.map((f) => ({ path: f.path, sha: f.sha }))
    },

    async readMany(paths) {
      if (!paths.length) return {}
      const missing = paths.filter((p) => !known.has(p))
      if (missing.length) await backend.list()
      const out = {}
      const pending = [...paths]
      const worker = async () => {
        while (pending.length) {
          const p = pending.shift()
          const sha = known.get(p)
          if (!sha) {
            out[p] = null
            continue
          }
          out[p] = await readBlob(sha)
        }
      }
      await Promise.all(Array.from({ length: Math.min(6, paths.length) }, worker))
      return out
    },

    write(path, text, sha) {
      return enqueue(() => writeLocked(path, text, sha))
    },

    remove(path, sha) {
      return enqueue(() => removeLocked(path, sha))
    },

    subscribe(fn) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },

    start() {
      if (started) return
      started = true
      poll()
      pollTimer = setInterval(() => {
        if (typeof document === 'undefined' || document.visibilityState === 'visible') poll()
      }, POLL_MS)
      if (typeof window !== 'undefined') {
        window.addEventListener('focus', onFocus)
        window.addEventListener('online', onOnline)
      }
    },

    stop() {
      if (!started) return
      started = false
      clearInterval(pollTimer)
      if (typeof window !== 'undefined') {
        window.removeEventListener('focus', onFocus)
        window.removeEventListener('online', onOnline)
      }
    },
  }

  async function writeLocked(path, text, sha) {
    const message = `Lumen: ${sha == null ? 'add' : 'update'} ${path}`
    const body = { message, content: base64Encode(text), branch }
    if (sha != null) body.sha = sha
    for (let attempt = 0; attempt < 4; attempt++) {
      let r
      try {
        r = await ghJson(token, `/repos/${owner}/${repo}/contents/${encodePath(path)}`, {
          method: 'PUT',
          body,
        })
      } catch (e) {
        if (e.status === 409 || e.status === 422) {
          const cur = await getCurrent(path)
          // the branch moved, but our file is still where we based the edit (or still absent) → retry
          if ((cur?.sha ?? null) === (sha ?? null)) continue
          throw new ConflictError(cur)
        }
        throw e
      }
      const newSha = await blobSha(text)
      known.set(path, newSha)
      await idbSet(`blob:${newSha}`, text)
      lastHead = r.commit && r.commit.sha ? r.commit.sha : lastHead
      return { sha: newSha }
    }
    throw new Error(`Could not save ${path} after several tries`)
  }

  async function removeLocked(path, sha) {
    for (let attempt = 0; attempt < 4; attempt++) {
      let r
      try {
        r = await ghJson(token, `/repos/${owner}/${repo}/contents/${encodePath(path)}`, {
          method: 'DELETE',
          body: { message: `Lumen: remove ${path}`, sha, branch },
        })
      } catch (e) {
        if (e.status === 404) return { deleted: true }
        if (e.status === 409 || e.status === 422) {
          const cur = await getCurrent(path)
          if (!cur) return { deleted: true }
          if (cur.sha === sha) continue
          throw new ConflictError(cur)
        }
        throw e
      }
      known.delete(path)
      lastHead = r.commit && r.commit.sha ? r.commit.sha : lastHead
      return { deleted: true }
    }
    throw new Error(`Could not remove ${path} after several tries`)
  }

  return backend
}
