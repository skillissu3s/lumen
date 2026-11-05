// Talking to GitHub's REST API with a person's token: one request helper, and
// the check made before a token is kept (it must reach the repository and be
// allowed to write to it).

import { parseRepo } from './readRepo.js'

// GitHub Enterprise Server (and local testing) lives elsewhere
export const API = String(process.env.GITHUB_API_URL || 'https://api.github.com').replace(/\/+$/, '')
export const WEB = String(process.env.GITHUB_URL || 'https://github.com').replace(/\/+$/, '')

/** An error from GitHub, with its HTTP status kept for the caller to judge */
export class GitHubError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

/** One request to GitHub's REST API; JSON in and out, or a file's raw text */
export async function ghFetch(fetchImpl, url, { api = API, token, method = 'GET', body, accept = 'application/vnd.github+json' } = {}) {
  const headers = { Accept: accept, 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'Lumen' }
  if (token) headers.Authorization = `Bearer ${token}`
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

const refuse = (message) => Object.assign(new Error(message), { status: 400 })

/**
 * Before keeping a token: does it open "owner/name", with write access (or,
 * `write: false`, at least to read)?
 * → { id, fullName, private, defaultBranch }
 */
export async function checkToken(repo, token, { write = true, api = API, fetchImpl = fetch } = {}) {
  const r = parseRepo(repo)
  if (!r) throw refuse('Enter the repository as owner/name.')
  const t = String(token || '').trim()
  // a public repository can be read without one
  if (!t && write) throw refuse('Add a token that can write to the repository.')
  let info
  try {
    info = await ghFetch(fetchImpl, `/repos/${r.owner}/${r.name}`, { api, token: t || undefined })
  } catch (e) {
    if (e.status === 401) throw refuse('GitHub didn’t accept that token. Check it was copied whole and hasn’t expired.')
    if (e.status === 404 || e.status === 403) throw refuse(t ? 'That token can’t see the repository. Check the name, and that the token was given access to it.' : 'That repository wasn’t found. If it’s private, add a token that can read it.')
    throw Object.assign(new Error(e.message), { status: 502 })
  }
  if (write && info.permissions && !info.permissions.push) throw refuse('That token can read the repository but not write to it. Give it Contents: Read and write.')
  return { id: info.id, fullName: info.full_name, private: !!info.private, defaultBranch: info.default_branch || 'main' }
}
