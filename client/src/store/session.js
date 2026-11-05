// Session: where we are (a Lumen server, or the desktop app's own), who we are,
// and the sign-in actions. Without a server there is nothing to sign in to: the
// app asks where your server is (status 'no-server'). With a server that can't
// be reached right now, someone signed in here before opens their copy of the
// workspace (`offline`).

import { create } from 'zustand'
import { api } from '../lib/api.js'
import { createServerBackend } from '../storage/server.js'
import { clearCopies, lastSession, rememberSession } from '../lib/offlineCache.js'

// /api/info: the server's answer; null when what answered isn't a Lumen server
// (a static copy of the app); { offline: true } when nothing answered at all.
async function fetchInfo() {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 4000)
  try {
    const res = await fetch('api/info', { headers: { 'X-Lumen': '1' }, signal: ctrl.signal })
    // a proxy in front of a server that's down
    if (res.status >= 502 && res.status <= 504) return { offline: true }
    const text = await res.text()
    let json = null
    try {
      json = JSON.parse(text)
    } catch {
      return null
    }
    return json && json.app === 'lumen' ? json : null
  } catch {
    return { offline: true }
  } finally {
    clearTimeout(timer)
  }
}

let backendInstance = null

export const useSession = create((set, get) => ({
  status: 'booting',
  mode: null,
  info: null,
  user: null,
  error: null,
  cloud: null, // the desktop app's account on a Lumen server, and how syncing with it goes
  offline: false, // opened from this browser's copy, without the server

  async boot() {
    set({ status: 'booting', error: null })
    const info = await fetchInfo()
    if (info?.offline) {
      const last = lastSession()
      if (last?.user) return set({ status: 'ready', mode: last.mode, info: last.info, user: last.user, offline: true })
      return set({ status: 'error', mode: null, error: 'Lumen can’t reach its server. Check your connection and try again.' })
    }
    set({ offline: false })
    if (!info) return set({ status: 'no-server', mode: null })
    // the desktop app asks once: a Lumen server, or this computer only
    if (info.desktopChoice) set({ status: 'choose', mode: info.mode, info, user: info.user })
    else if (info.user) set({ status: 'ready', mode: info.mode, info, user: info.user, cloud: info.cloud || null })
    else if (info.needsSetup) set({ status: 'needs-setup', mode: info.mode, info })
    else set({ status: 'signed-out', mode: info.mode, info })
  },

  async login(email, password) {
    const { user } = await api('POST', '/login', { email, password })
    set({ status: 'ready', mode: 'server', user })
    return user
  },

  async setup({ email, name, password }) {
    const { user } = await api('POST', '/setup', { email, name, password })
    set({ status: 'ready', mode: 'server', user })
    return user
  },

  async acceptInvite(token, body) {
    const { user } = await api('POST', `/invites/${token}/accept`, body)
    set({ status: 'ready', mode: 'server', user })
    return user
  },

  async logout() {
    // this browser's copy goes with the person
    rememberSession(null)
    await clearCopies()
    try {
      await api('POST', '/logout')
    } catch {
      /* still sign out locally */
    }
    set({ status: 'signed-out', user: null })
  },

  backend() {
    const s = get()
    if (s.mode !== 'server' && s.mode !== 'desktop') return null
    backendInstance ||= createServerBackend()
    return backendInstance
  },
}))

// whoever is signed in is remembered, so this browser can open their copy offline
useSession.subscribe((s, prev) => {
  if (s.status === 'ready' && !s.offline && s.user && (prev.status !== 'ready' || prev.user !== s.user)) {
    const { app, name, version, mode } = s.info || {}
    rememberSession({ mode: s.mode, user: s.user, info: { app, name, version, mode: mode || s.mode } })
  }
})
