// Session: which mode we're in, who we are, and the auth actions for each mode.

import { create } from 'zustand'
import { api } from '../lib/api.js'
import { createServerBackend } from '../storage/server.js'
import { createGitHubBackend, githubUser, repoInfo } from '../storage/github.js'

const GITHUB_KEY = 'lumen.github'

function readGithub() {
  try {
    return JSON.parse(localStorage.getItem(GITHUB_KEY) || 'null')
  } catch {
    return null
  }
}

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
let backendKey = null

export const useSession = create((set, get) => ({
  status: 'booting',
  mode: null,
  info: null,
  user: null,
  github: null,
  error: null,

  async boot() {
    set({ status: 'booting', error: null })
    const info = await fetchInfo()
    if (info) {
      if (info.user) set({ status: 'ready', mode: info.mode, info, user: info.user })
      else if (info.needsSetup) set({ status: 'needs-setup', mode: info.mode, info })
      else set({ status: 'signed-out', mode: info.mode, info })
      return
    }
    const github = readGithub()
    if (github && github.token) {
      try {
        const u = await githubUser(github.token)
        set({ status: 'ready', mode: 'github', github, user: { handle: u.login, name: u.name || u.login, role: 'admin' } })
      } catch (e) {
        set({ status: 'error', mode: 'github', github, error: e.message })
      }
      return
    }
    set({ status: 'signed-out', mode: 'github', github: null })
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
    set({ status: 'signed-out', user: null, github: null })
  },

  async connectGitHub({ token, owner, repo, branch }) {
    const info = await repoInfo(token, owner, repo)
    if (!info.push) throw new Error('That token cannot write to this repository')
    const github = { token, owner, repo, branch: branch || info.defaultBranch }
    try {
      localStorage.setItem(GITHUB_KEY, JSON.stringify(github))
    } catch {
      /* storage unavailable */
    }
    const u = await githubUser(token)
    set({ status: 'ready', mode: 'github', github, user: { handle: u.login, name: u.name || u.login, role: 'admin' } })
    return github
  },

  disconnectGitHub() {
    try {
      localStorage.removeItem(GITHUB_KEY)
    } catch {
      /* storage unavailable */
    }
    backendInstance?.stop()
    backendInstance = null
    backendKey = null
    set({ status: 'signed-out', mode: 'github', github: null, user: null })
  },

  backend() {
    const s = get()
    if (s.mode === 'server' || s.mode === 'desktop') {
      if (backendKey !== 'server') {
        backendInstance = createServerBackend()
        backendKey = 'server'
      }
      return backendInstance
    }
    if (s.mode === 'github' && s.github) {
      const key = `github:${s.github.owner}/${s.github.repo}/${s.github.branch}`
      if (backendKey !== key) {
        backendInstance = createGitHubBackend(s.github)
        backendKey = key
      }
      return backendInstance
    }
    return null
  },
}))
