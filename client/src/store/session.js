// Session: where we are (a Lumen server, or the desktop app's own), who we are,
// and the sign-in actions. Without a server there is nothing to sign in to: the
// app asks where your server is (status 'no-server').

import { create } from 'zustand'
import { api } from '../lib/api.js'
import { createServerBackend } from '../storage/server.js'

// /api/info that only succeeds when a Lumen server actually answered.
async function fetchInfo() {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 4000)
  try {
    const res = await fetch('api/info', { headers: { 'X-Lumen': '1' }, signal: ctrl.signal })
    const text = await res.text()
    let json = null
    try {
      json = JSON.parse(text)
    } catch {
      return null
    }
    return json && json.app === 'lumen' ? json : null
  } catch {
    return null
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

  async boot() {
    set({ status: 'booting', error: null })
    const info = await fetchInfo()
    if (!info) return set({ status: 'no-server', mode: null })
    // the desktop app asks once: a Lumen server, or this computer only
    if (info.desktopChoice) set({ status: 'choose', mode: info.mode, info, user: info.user })
    else if (info.user) set({ status: 'ready', mode: info.mode, info, user: info.user })
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
