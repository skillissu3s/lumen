// One GitHub repository behind the small interface the mirror run uses
// (mirror/run.js), on GitHub's Git Data API: read the branch head and its tree,
// then write a whole change as one tree, one commit and one ref update. The ref
// update is never forced, so if someone pushed in the meantime GitHub refuses it
// and the run starts again from the new head.

import { GitHubError, ghFetch } from './app.js'

const enc = (p) => p.split('/').map(encodeURIComponent).join('/')

/**
 * `repoId`: the repository's numeric id (it survives renames and transfers);
 * `token()`: a fresh installation token for it.
 */
export function githubRepo({ repoId, token, api, fetchImpl = fetch }) {
  let base = null // /repos/owner/name, found from the id
  const call = async (path, opts) => ghFetch(fetchImpl, path, { ...opts, api, token: await token() })

  async function where() {
    if (!base) await info()
    return base
  }

  async function info() {
    const r = await call(`/repositories/${repoId}`)
    base = `/repos/${r.full_name}`
    return { id: r.id, fullName: r.full_name, private: !!r.private, defaultBranch: r.default_branch || 'main' }
  }

  async function head(branch) {
    let ref
    try {
      ref = await call(`${await where()}/git/ref/heads/${enc(branch)}`)
    } catch (e) {
      // 409: an empty repository; 404: no such branch yet
      if (e.status === 404 || e.status === 409) return null
      throw e
    }
    const commit = await call(`${await where()}/git/commits/${ref.object.sha}`)
    return { commit: ref.object.sha, tree: commit.tree.sha }
  }

  async function tree(treeSha) {
    const t = await call(`${await where()}/git/trees/${treeSha}?recursive=1`)
    if (t.truncated) throw new GitHubError(413, 'The repository is too large for GitHub to list in one go. Use a folder of it, or another repository.')
    return new Map(t.tree.filter((e) => e.type === 'blob').map((e) => [e.path, e.sha]))
  }

  async function read(path, ref) {
    try {
      return await call(`${await where()}/contents/${enc(path)}?ref=${encodeURIComponent(ref)}`, { accept: 'application/vnd.github.raw+json' })
    } catch (e) {
      if (e.status === 404) return null
      throw e
    }
  }

  async function isEmpty() {
    try {
      await call(`${await where()}/git/refs?per_page=1`)
      return false
    } catch (e) {
      if (e.status === 409 || e.status === 404) return true
      throw e
    }
  }

  async function commit({ branch, head: from, entries, message }) {
    const at = await where()
    let parent = from
    let exists = !!from
    if (!parent && (await isEmpty())) {
      // the Git Data API can't write to a repository with no commits; the first
      // file goes in through the contents API (on the default branch), the rest
      // on top of it
      const first = entries.find((e) => e.content != null)
      try {
        await call(`${at}/contents/${enc(first.path)}`, { method: 'PUT', body: { message, content: Buffer.from(first.content, 'utf8').toString('base64') } })
      } catch (e) {
        if (e.status === 409 || e.status === 422) throw Object.assign(new Error('moved'), { moved: true })
        throw e
      }
      const own = await head(branch)
      exists = !!own
      parent = own || (await head((await info()).defaultBranch))
      entries = entries.filter((e) => e !== first)
      if (!entries.length && exists) return parent.commit
    }
    let sha = parent?.commit
    if (entries.length) {
      const t = await call(`${at}/git/trees`, {
        method: 'POST',
        body: {
          ...(parent ? { base_tree: parent.tree } : {}),
          tree: entries.map((e) => ({ path: e.path, mode: '100644', type: 'blob', ...(e.content == null ? { sha: null } : { content: e.content }) })),
        },
      })
      sha = (await call(`${at}/git/commits`, { method: 'POST', body: { message, tree: t.sha, parents: parent ? [parent.commit] : [] } })).sha
    }
    try {
      if (exists) await call(`${at}/git/refs/heads/${enc(branch)}`, { method: 'PATCH', body: { sha, force: false } })
      else await call(`${at}/git/refs`, { method: 'POST', body: { ref: `refs/heads/${branch}`, sha } })
    } catch (e) {
      // not a fast-forward (someone pushed), or the branch appeared meanwhile
      if (e.status === 422 || e.status === 409) throw Object.assign(new Error('moved'), { moved: true })
      throw e
    }
    return sha
  }

  return { repo: info, head, tree, read, commit }
}
