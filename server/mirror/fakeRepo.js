// An in-memory GitHub repository with the interface run.js uses, for tests:
// commits, trees as path → content, a branch that someone else can move.

import { gitBlob } from './run.js'

export function fakeRepo({ id = 7, isPrivate = true, branch = 'main' } = {}) {
  const commits = new Map() // sha → { files: Map path → text, parent, message }
  const refs = new Map() // branch → commit sha
  let n = 0
  const make = (files, parent, message) => {
    const sha = `c${++n}`
    commits.set(sha, { files, parent, message })
    return sha
  }
  const treeOf = (files) => new Map([...files].map(([p, t]) => [p, gitBlob(t)]))

  const repo = {
    info: { id, private: isPrivate, defaultBranch: branch },
    async repo() {
      return repo.info
    },
    async head(b) {
      const sha = refs.get(b)
      return sha ? { commit: sha, tree: sha } : null
    },
    async tree(treeSha) {
      return treeOf(commits.get(treeSha).files)
    },
    async read(path, ref) {
      return commits.get(ref)?.files.get(path) ?? null
    },
    async commit({ branch: b, head, entries, message }) {
      if ((refs.get(b) || null) !== (head?.commit || null)) throw Object.assign(new Error('moved'), { moved: true })
      const files = new Map(head ? commits.get(head.commit).files : [])
      for (const e of entries) {
        if (e.content == null) files.delete(e.path)
        else files.set(e.path, e.content)
      }
      const sha = make(files, head?.commit || null, message)
      refs.set(b, sha)
      return sha
    },

    // for tests: what's there now, and someone else pushing
    files(b = branch) {
      const sha = refs.get(b)
      return sha ? commits.get(sha).files : new Map()
    },
    commitCount: () => commits.size,
    lastMessage: (b = branch) => commits.get(refs.get(b))?.message,
    push(change, b = branch) {
      const head = refs.get(b)
      const files = new Map(head ? commits.get(head).files : [])
      for (const [p, t] of Object.entries(change)) t == null ? files.delete(p) : files.set(p, t)
      refs.set(b, make(files, head, 'someone else'))
    },
  }
  return repo
}
