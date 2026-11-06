// Who may read and write which file (docs/CANDLES.md → Access rules). A path a
// person sends is first resolved in their own tree (view.js) to a target: their
// candle, a workspace they're in (with their role), or one thing someone shared
// with them (view or edit). These rules then say what they may do there. On the
// desktop there is one person and everything is theirs.
import { splitFrontMatter } from '../shared/frontmatter.js'

export const SHARED_KINDS = /^(lists\/[^/]+\.md|calendars\/[^/]+\.md|docs\/.+\.md|ideas\/[^/]+\.canvas)$/

export function metaOf(path, text) {
  if (!SHARED_KINDS.test(path)) return null
  // an idea board (JSON Canvas) keeps its owner and sharing under "lumen"
  if (path.endsWith('.canvas')) {
    let lumen = {}
    try {
      lumen = JSON.parse(text || '{}').lumen || {}
    } catch {
      /* unreadable: no owner, no sharing */
    }
    return { owner: lumen.owner ? String(lumen.owner) : null, share: lumen.share ?? null }
  }
  const { meta } = splitFrontMatter(text)
  return { owner: meta.owner ? String(meta.owner) : null, share: meta.share ?? null }
}

/**
 * What a share gives `handle`: 'edit', 'view' or null. A share is a list like
 * [sam, ana:view]: a bare handle may edit, `:view` may only look.
 */
export function shareFor(share, handle) {
  if (!Array.isArray(share) || !handle) return null
  for (const entry of share.map(String)) {
    const [h, can = 'edit'] = entry.split(':')
    if (h === handle) return can === 'view' ? 'view' : 'edit'
  }
  return null
}

const isManager = (role) => role === 'owner' || role === 'admin'
const personal = /^(users|data)\//

/** May the person see `path` at `target`? (targets come from view.resolve) */
export function canReadAt(target, path) {
  if (!target) return false
  if (target.shared) return true
  // chat goes through the chat API only
  if (path.startsWith('chat/')) return false
  if (target.kind === 'workspace' && personal.test(path)) return false
  return true
}

/**
 * May `user` change `path` at `target` from `before` (meta of the current
 * version, null if it doesn't exist) to `after` (meta of the new text; null for
 * a delete)? Returns null if so, or the reason not.
 */
export function writeProblemAt(user, target, path, before, after, exists) {
  if (!user) return 'Sign in first.'
  if (!target) return 'You don’t have access to this.'
  if (path.startsWith('chat/')) return 'Chat is written through the chat API.'
  if (user.desktop) return null
  if (target.shared) {
    if (target.can !== 'edit') return 'You can view this, not change it.'
    if (!exists) return 'You can’t add files there.'
    if (!after) return 'Only its owner can delete this.'
    if (JSON.stringify(after.share ?? null) !== JSON.stringify(before?.share ?? null)) return 'Only its owner can change who has access.'
    return null
  }
  if (target.kind === 'candle') {
    if (/^(workspaces|shared)\//.test(path)) return 'Those folder names are kept for workspaces and shared things.'
    const m = /^users\/([^/]+)\//.exec(path) || /^data\/plugins\/[^/]+\/([^/]+)\//.exec(path)
    if (m && m[1] !== user.handle) return 'That belongs to someone else.'
    return null
  }
  // a workspace: its members share everything in it
  if (path === 'lumen.json' || path === '.gitattributes') return isManager(target.role) ? null : 'Only the workspace’s owner and admins can change its settings.'
  if (path.startsWith('plugins/')) return 'Plugins are installed in your candle.'
  if (personal.test(path)) return 'Personal files belong in your candle.'
  return null
}
