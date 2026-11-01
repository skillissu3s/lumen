// Profile lumen/1: which file holds what. `fileKind(path)` names the kind of
// file at a path in a mirror (or a workspace folder, which has the same
// layout), or null for a path the profile doesn't manage. The codecs for each
// kind are re-exported here so callers need only this module.

export * as items from './itemsFile.js'
export * as doc from './docFile.js'
export * as idea from './ideaFile.js'
export { prefs, workspace, channels, messages } from './jsonFiles.js'

export const PROFILE = 'lumen/1'

const KINDS = [
  ['workspace', /^lumen\.json$/],
  ['prefs', /^users\/([^/]+)\/settings\.json$/],
  ['board', /^lists\/[^/]+\.md$/],
  ['calendar', /^calendars\/[^/]+\.md$/],
  ['doc', /^docs\/(?:[^/]+\/)*[^/]+\.md$/],
  ['idea', /^ideas\/[^/]+\.canvas$/],
  ['channels', /^chat\/channels\.json$/],
  ['messages', /^chat\/([^/]+)\/(\d{4}-\d{2})\.jsonl$/],
  ['plugin_file', /^plugins\/([^/]+)\/(.+)$/],
  ['plugin_data', /^data\/plugins\/([^/]+)\/([^/]+)\/(.+)$/],
]

/** `lists/inbox.md` → { kind: 'board' }; `users/ana/settings.json` → { kind: 'prefs', handle: 'ana' } */
export function fileKind(path) {
  if (path.startsWith('.sync/')) return null
  for (const [kind, re] of KINDS) {
    const m = re.exec(path)
    if (!m) continue
    if (kind === 'prefs') return { kind, handle: m[1] }
    if (kind === 'messages') return { kind, channel: m[1], month: m[2] }
    if (kind === 'plugin_file') return { kind, plugin: m[1], file: m[2] }
    if (kind === 'plugin_data') return { kind, plugin: m[1], handle: m[2], file: m[3] }
    return { kind }
  }
  return null
}
