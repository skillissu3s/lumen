// The server backend: files over the HTTP API, change notices over the socket.

import { api, ApiError } from '../lib/api.js'
import { connectSocket, onSocket, onSocketState } from '../lib/socket.js'
import { ConflictError, AuthError, OfflineError } from './errors.js'

function mapError(e) {
  if (e instanceof ApiError) {
    if (e.status === 409) {
      const current = e.body && typeof e.body === 'object' && 'current' in e.body ? e.body.current : null
      return new ConflictError(current)
    }
    if (e.status === 401 || e.status === 403) return new AuthError(e.message)
    if (e.status === 0) return new OfflineError()
  }
  return e
}

export function createServerBackend() {
  const listeners = new Set()
  let known = new Map() // path → sha, from the last list()
  let started = false
  let firstOpen = true
  let unsubFiles = null
  let unsubState = null

  const emit = (changes) => {
    if (!changes.length) return
    for (const fn of listeners) fn(changes)
  }

  const backend = {
    kind: 'server',

    async list() {
      const data = await api('GET', '/files')
      const files = (data && data.files) || []
      known = new Map(files.map((f) => [f.path, f.sha]))
      return files.map((f) => ({ path: f.path, sha: f.sha }))
    },

    async readMany(paths) {
      if (!paths.length) return {}
      const out = {}
      for (let i = 0; i < paths.length; i += 200) {
        const data = await api('POST', '/files/read', { paths: paths.slice(i, i + 200) })
        const files = (data && data.files) || {}
        for (const [p, f] of Object.entries(files)) out[p] = f
      }
      return out
    },

    async write(path, text, sha) {
      try {
        return await api('PUT', '/files', { path, text, sha })
      } catch (e) {
        throw mapError(e)
      }
    },

    async remove(path, sha) {
      try {
        return await api('DELETE', '/files', { path, sha })
      } catch (e) {
        throw mapError(e)
      }
    },

    subscribe(fn) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },

    start() {
      if (started) return
      started = true
      unsubFiles = onSocket('files', (msg) => {
        const changes = (msg.changes || []).map((c) => ({
          path: c.path,
          sha: c.deleted ? null : c.sha,
          deleted: !!c.deleted,
        }))
        for (const c of changes) {
          if (c.deleted) known.delete(c.path)
          else known.set(c.path, c.sha)
        }
        emit(changes)
      })
      unsubState = onSocketState(async (state) => {
        if (state !== 'open') return
        if (firstOpen) {
          firstOpen = false
          return
        }
        // reconnect: emit every path whose sha moved since our last list
        try {
          const before = known
          await backend.list()
          const changes = []
          for (const [path, sha] of known) {
            if (before.get(path) !== sha) changes.push({ path, sha, deleted: false })
          }
          for (const [path] of before) {
            if (!known.has(path)) changes.push({ path, sha: null, deleted: true })
          }
          emit(changes)
        } catch {
          /* leave it to the next reconnect */
        }
      })
      connectSocket()
    },

    stop() {
      if (!started) return
      started = false
      unsubFiles?.()
      unsubState?.()
      unsubFiles = null
      unsubState = null
    },
  }

  return backend
}
