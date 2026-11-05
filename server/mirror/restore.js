// Getting data back from a mirror (Repo Sync Protocol §12): read the files a
// mirror lists in .sync/index.jsonl (or, for a repository from before the
// protocol, every file that looks like Lumen's), then work out which of them to
// take in. A restore never deletes: what the database has and the mirror lacks
// stays, and a record changed in both places keeps the database's version
// unless the person chose otherwise.

import { PROTOCOL, parseIndex } from './run.js'
import { PROFILE } from './lumen/index.js'

const nameOf = (s) => String(s || '').split('/')[0]
const majorOf = (s) => Number(String(s || '').split('/')[1]?.split('.')[0])

/**
 * → { manifest, legacy, files: [[path, text]], skipped: [{ path, why }] }
 * `keep(path, size)` says which paths the app can take in at all.
 */
export async function readMirror(gh, { branch, prefix = '', keep = () => true }) {
  const base = prefix ? `${prefix.replace(/\/+$/, '')}/` : ''
  const head = await gh.head(branch)
  if (!head) throw Object.assign(new Error('That branch has nothing in it yet.'), { status: 400 })
  const tree = await gh.tree(head.tree)
  const read = (p) => gh.read(`${base}${p}`, head.commit)

  let manifest = null
  if (tree.has(`${base}.sync/manifest.json`)) {
    try {
      manifest = JSON.parse(await read('.sync/manifest.json'))
    } catch {
      throw Object.assign(new Error('The mirror’s .sync/manifest.json can’t be read.'), { status: 400 })
    }
    if (nameOf(manifest.protocol) !== nameOf(PROTOCOL) || nameOf(manifest.profile) !== nameOf(PROFILE)) throw Object.assign(new Error('That repository holds a mirror of another app.'), { status: 400 })
    if (majorOf(manifest.profile) > majorOf(PROFILE)) throw Object.assign(new Error('That mirror was written by a newer version of Lumen. Update this server first.'), { status: 400 })
  }

  // the files to read: the mirror's list, or for a legacy repository, all of them
  const inTree = [...tree.keys()].filter((p) => p.startsWith(base)).map((p) => p.slice(base.length))
  let paths = inTree.filter((p) => !p.startsWith('.sync/'))
  const skipped = []
  if (manifest && tree.has(`${base}.sync/index.jsonl`)) {
    const listed = [...parseIndex(await read('.sync/index.jsonl')).keys()]
    for (const p of listed) if (!tree.has(`${base}${p}`)) skipped.push({ path: p, why: 'listed in the index but not in the repository' })
    paths = listed.filter((p) => tree.has(`${base}${p}`))
  }
  paths = paths.filter((p) => {
    if (keep(p)) return true
    // files people added beside a legacy layout are simply not Lumen's
    if (manifest) skipped.push({ path: p, why: 'not a file Lumen keeps' })
    return false
  })

  const files = []
  for (let i = 0; i < paths.length; i += 8) {
    const batch = await Promise.all(paths.slice(i, i + 8).map((p) => read(p)))
    batch.forEach((text, j) => (text == null ? skipped.push({ path: paths[i + j], why: 'couldn’t be read' }) : files.push([paths[i + j], text])))
  }
  return { manifest, legacy: !manifest, files, skipped, commit: head.commit }
}

/**
 * Which files to take in, against what the database holds now.
 * `since`: when the mirror was written by this database, its cursor: a record
 * with no journal rows after it is unchanged here, so the repository's version
 * (perhaps edited on GitHub) is taken. Otherwise a record in both places that
 * differs counts as changed in both, and the database's version is kept.
 * → { take: [[path, text]], same: [path], kept: [path] }
 */
export function planRestore(files, { units, store, since = null, repoWins = false }) {
  const changed = new Set()
  if (since != null) for (const j of store.changesSince(since, { limit: 1e7 })) changed.add(j.root_type === 'channel' ? 'channels:channels' : `${j.root_type}:${j.root_id}`)
  const take = []
  const same = []
  const kept = []
  for (const [p, text] of files) {
    const rec = units.recordOf(p)
    if (!rec) {
      take.push([p, text])
      continue
    }
    if (units.render(p) === text) {
      same.push(p)
      continue
    }
    if (repoWins || (since != null && !changed.has(`${rec.type}:${rec.id}`))) take.push([p, text])
    else kept.push(p)
  }
  return { take, same, kept }
}

/** How many of each kind of thing a set of files holds, for the report */
export function countKinds(paths, units) {
  const out = {}
  for (const p of paths) {
    const k = units.kindOf(p).kind
    out[k] = (out[k] || 0) + 1
  }
  return out
}
