// Who may read and write which file of the workspace (server mode). See
// docs/ARCHITECTURE.md → Access control. On the desktop there is one person and
// everything is theirs.
import { splitFrontMatter } from '../shared/frontmatter.js'

export const SHARED_KINDS = /^(lists\/[^/]+\.md|calendars\/[^/]+\.md|docs\/.+\.md)$/

export function metaOf(path, text) {
  if (!SHARED_KINDS.test(path)) return null
  const { meta } = splitFrontMatter(text)
  return { owner: meta.owner ? String(meta.owner) : null, share: meta.share ?? null }
}

export function sharedWith(meta, handle) {
  if (!meta) return false
  const s = meta.share
  if (s === 'everyone' || s === true) return true
  return Array.isArray(s) && s.map(String).includes(handle)
}

const isAdmin = (u) => u?.role === 'admin'

/** May `user` see this file? `meta` from metaOf (null for files without one) */
export function canRead(user, path, meta) {
  if (!user) return false
  if (user.desktop) return true
  if (path === 'lumen.json' || path === '.gitattributes' || path.startsWith('plugins/')) return true
  if (path.startsWith('chat/')) return false // through the chat API only
  let m = /^users\/([^/]+)\//.exec(path)
  if (m) return m[1] === user.handle
  m = /^data\/plugins\/[^/]+\/([^/]+)\//.exec(path)
  if (m) return m[1] === user.handle
  if (SHARED_KINDS.test(path)) {
    if (!meta?.owner) return isAdmin(user)
    return meta.owner === user.handle || sharedWith(meta, user.handle)
  }
  return isAdmin(user)
}

/**
 * May `user` change the file from `before` (meta of the current version, null
 * if it doesn't exist) to `after` (meta of the new text; null for a delete)?
 * Returns null if so, or the reason not.
 */
export function writeProblem(user, path, before, after, exists) {
  if (!user) return 'Sign in first.'
  if (user.desktop) return null
  if (path === 'lumen.json' || path === '.gitattributes' || path.startsWith('plugins/')) return isAdmin(user) ? null : 'Only an admin can change this.'
  if (path.startsWith('chat/')) return 'Chat is written through the chat API.'
  let m = /^users\/([^/]+)\//.exec(path)
  if (m) return m[1] === user.handle ? null : 'That belongs to someone else.'
  m = /^data\/plugins\/[^/]+\/([^/]+)\//.exec(path)
  if (m) return m[1] === user.handle ? null : 'That belongs to someone else.'
  if (SHARED_KINDS.test(path)) {
    if (exists && !canRead(user, path, before)) return 'You don’t have access to this.'
    const owner = before?.owner || null
    const isOwner = isAdmin(user) || (owner ? owner === user.handle : false)
    if (!exists) {
      if (!after?.owner) return 'New files need an owner.'
      if (after.owner !== user.handle && !isAdmin(user)) return 'New files must be owned by you.'
      return null
    }
    if (!after) return isOwner ? null : 'Only the owner can delete this.'
    const changedAccess = (after.owner || null) !== owner || JSON.stringify(after.share ?? null) !== JSON.stringify(before?.share ?? null)
    if (changedAccess && !isOwner) return 'Only the owner can change who has access.'
    return null
  }
  return isAdmin(user) ? null : 'Only an admin can change this.'
}
