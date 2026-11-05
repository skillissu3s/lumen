// The server's GitHub App (docs: repo-sync-protocol/docs/github-app.md). People
// install it on the repository their mirror goes to; the server then signs in
// as the App with its private key and asks for a token that opens that one
// repository for an hour. Who installed it is checked once, when connecting:
// GitHub's OAuth step proves which installations the person can reach, and that
// short-lived user token is thrown away straight after.

import crypto from 'node:crypto'
import fs from 'node:fs'

const API = 'https://api.github.com'
const WEB = 'https://github.com'

/** The App's settings from the environment, or null when the server has none */
export function appConfig(env = process.env) {
  const id = String(env.GITHUB_APP_ID || '').trim()
  let privateKey = env.GITHUB_APP_PRIVATE_KEY || ''
  if (!privateKey && env.GITHUB_APP_PRIVATE_KEY_FILE) {
    try {
      privateKey = fs.readFileSync(env.GITHUB_APP_PRIVATE_KEY_FILE, 'utf8')
    } catch {
      privateKey = ''
    }
  }
  // a key pasted into one line of an env file keeps its line breaks as \n
  privateKey = privateKey.replace(/\\n/g, '\n').trim()
  const config = {
    id,
    slug: String(env.GITHUB_APP_SLUG || '').trim(),
    clientId: String(env.GITHUB_APP_CLIENT_ID || '').trim(),
    clientSecret: String(env.GITHUB_APP_CLIENT_SECRET || '').trim(),
    privateKey,
  }
  if (!Object.values(config).every(Boolean)) return null
  // GitHub Enterprise Server lives elsewhere: https://HOST and https://HOST/api/v3
  config.web = String(env.GITHUB_URL || WEB).replace(/\/+$/, '')
  config.api = String(env.GITHUB_API_URL || (env.GITHUB_URL ? `${config.web}/api/v3` : API)).replace(/\/+$/, '')
  return config
}

const b64url = (v) => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64url')

export function appJwt(appId, privateKeyPem, now = Date.now()) {
  const s = Math.floor(now / 1000)
  const head = b64url({ alg: 'RS256', typ: 'JWT' })
  const body = b64url({ iat: s - 60, exp: s + 540, iss: String(appId) })
  const sig = crypto.createSign('RSA-SHA256').update(`${head}.${body}`).sign(privateKeyPem).toString('base64url')
  return `${head}.${body}.${sig}`
}

/** An error from GitHub, with its HTTP status kept for the caller to judge */
export class GitHubError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

/** One request to GitHub's REST API; JSON in and out */
export async function ghFetch(fetchImpl, url, { api = API, token, basic, method = 'GET', body, accept = 'application/vnd.github+json' } = {}) {
  const headers = { Accept: accept, 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'Lumen' }
  if (token) headers.Authorization = `Bearer ${token}`
  else if (basic) headers.Authorization = `Basic ${Buffer.from(basic).toString('base64')}`
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  let res
  try {
    res = await fetchImpl(url.startsWith('http') ? url : `${api}${url}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30000) })
  } catch {
    throw new GitHubError(0, 'GitHub didn’t answer.')
  }
  const text = await res.text()
  // a file's own bytes, even when they happen to be JSON
  if (res.ok && accept.includes('raw')) return text
  let data = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = null
  }
  if (!res.ok) throw new GitHubError(res.status, data?.message || `GitHub answered ${res.status}.`)
  return data
}

const toRepo = (r, installationId) => ({ id: r.id, fullName: r.full_name, private: !!r.private, defaultBranch: r.default_branch || 'main', installationId })

/**
 * `config` from appConfig(); `callbackUrl` is where GitHub sends people back.
 * Tokens for installations are kept in memory until shortly before they expire.
 */
export function createGitHubApp(config, { callbackUrl, fetchImpl = fetch, clock = () => Date.now() } = {}) {
  const tokens = new Map() // `${installation}:${repo}` → { token, expires }
  const web = config.web || WEB
  const api = config.api || API
  const call = (url, opts) => ghFetch(fetchImpl, url, { ...opts, api })

  const jwt = () => appJwt(config.id, config.privateKey, clock())

  return {
    slug: config.slug,
    web,
    api,

    /** Where "Connect GitHub" sends people: installing the App (or changing which repositories it has) */
    installUrl: (state) => `${web}/apps/${encodeURIComponent(config.slug)}/installations/new?state=${encodeURIComponent(state)}`,

    /** For people who installed it before: just the authorization step */
    authorizeUrl: (state) => {
      const q = new URLSearchParams({ client_id: config.clientId, state })
      if (callbackUrl) q.set('redirect_uri', callbackUrl)
      return `${web}/login/oauth/authorize?${q}`
    },

    /**
     * The `code` GitHub gave the callback → the repositories this person can
     * reach through the App's installations, as { id, fullName, private,
     * defaultBranch, installationId }. `installationId`, when GitHub sent one,
     * must be among them.
     */
    async reposFor(code, installationId) {
      const out = await call(`${web}/login/oauth/access_token`, {
        method: 'POST',
        accept: 'application/json',
        body: { client_id: config.clientId, client_secret: config.clientSecret, code, ...(callbackUrl ? { redirect_uri: callbackUrl } : {}) },
      })
      if (!out?.access_token) throw new GitHubError(400, 'GitHub didn’t confirm who you are. Try connecting again.')
      const token = out.access_token
      const installs = (await call('/user/installations?per_page=100', { token })).installations || []
      if (installationId && !installs.some((i) => String(i.id) === String(installationId))) {
        throw new GitHubError(403, 'That installation isn’t one your GitHub account can reach.')
      }
      const repos = []
      for (const inst of installs) {
        for (let page = 1; page <= 10; page++) {
          const r = await call(`/user/installations/${inst.id}/repositories?per_page=100&page=${page}`, { token })
          repos.push(...(r.repositories || []).map((x) => toRepo(x, inst.id)))
          if ((r.repositories || []).length < 100) break
        }
      }
      // the user token was only for these checks; GitHub is asked to forget it too
      call(`/applications/${config.clientId}/token`, {
        method: 'DELETE',
        body: { access_token: token },
        basic: `${config.clientId}:${config.clientSecret}`,
      }).catch(() => {})
      return repos
    },

    /** A token that opens one repository of one installation, with contents write */
    async installationToken(installationId, repoId) {
      const key = `${installationId}:${repoId}`
      const kept = tokens.get(key)
      if (kept && kept.expires - clock() > 5 * 60000) return kept.token
      const out = await call(`/app/installations/${installationId}/access_tokens`, {
        method: 'POST',
        token: jwt(),
        body: { repository_ids: [Number(repoId)], permissions: { contents: 'write', metadata: 'read' } },
      })
      tokens.set(key, { token: out.token, expires: Date.parse(out.expires_at) || clock() + 3600000 })
      return out.token
    },

    forget(installationId) {
      for (const k of tokens.keys()) if (k.startsWith(`${installationId}:`)) tokens.delete(k)
    },
  }
}
