// Reads every text file of a GitHub repository (one branch) through the REST
// API: one recursive tree request, then the blobs. Used to bring in data from a
// repository Lumen's old GitHub mode wrote; restore from a mirror (phase 4) reads
// the same way. The token, if any, is used for these requests only.

const API = 'https://api.github.com'
const MAX_FILES = 5000

/** "owner/name", "https://github.com/owner/name(.git)" → { owner, name } */
export function parseRepo(input) {
  const s = String(input || '')
    .trim()
    .replace(/^https?:\/\/github\.com\//i, '')
    .replace(/\.git$/i, '')
    .replace(/\/+$/, '')
  const m = /^([\w.-]+)\/([\w.-]+)$/.exec(s)
  return m ? { owner: m[1], name: m[2] } : null
}

/**
 * → [[path, text]] for every file `keep(path, size)` accepts.
 * Throws an Error with `status` for answers GitHub refused.
 */
export async function readRepo({ repo, branch, token, keep = () => true, fetchImpl = fetch }) {
  const r = parseRepo(repo)
  if (!r) throw Object.assign(new Error('Enter the repository as owner/name.'), { status: 400 })
  const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'Lumen' }
  if (token) headers.Authorization = `Bearer ${token}`
  const get = async (path) => {
    const res = await fetchImpl(`${API}/repos/${r.owner}/${r.name}${path}`, { headers, signal: AbortSignal.timeout(20000) })
    if (res.status === 404) throw Object.assign(new Error(token ? 'That repository or branch wasn’t found, or the token can’t read it.' : 'That repository wasn’t found. If it’s private, add a token that can read it.'), { status: 400 })
    if (res.status === 401) throw Object.assign(new Error('GitHub didn’t accept that token.'), { status: 400 })
    if (!res.ok) throw Object.assign(new Error(`GitHub answered ${res.status}.`), { status: 502 })
    return res.json()
  }
  const ref = branch || (await get('')).default_branch
  const tree = await get(`/git/trees/${encodeURIComponent(ref)}?recursive=1`)
  const blobs = (tree.tree || []).filter((e) => e.type === 'blob' && keep(e.path, e.size)).slice(0, MAX_FILES)
  const out = []
  // a few at a time, to stay friendly to GitHub's rate limits
  for (let i = 0; i < blobs.length; i += 8) {
    const batch = await Promise.all(blobs.slice(i, i + 8).map((b) => get(`/git/blobs/${b.sha}`)))
    batch.forEach((blob, j) => out.push([blobs[i + j].path, Buffer.from(blob.content || '', blob.encoding === 'base64' ? 'base64' : 'utf8').toString('utf8')]))
  }
  return { files: out, truncated: !!tree.truncated || blobs.length === MAX_FILES, ref }
}
