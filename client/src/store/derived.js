// Selectors over the workspace state, with per-file memoization so a file is
// only parsed when its text changed.

import { parseItems, flatItems } from '../../../shared/items.js'
import { splitFrontMatter } from '../../../shared/frontmatter.js'

const parseCache = new Map() // path → { text, result }

function parseMemo(path, text, fn) {
  const c = parseCache.get(path)
  if (c && c.text === text) return c.result
  const result = fn(text)
  parseCache.set(path, { text, result })
  return result
}

const DEFAULT_CONFIG = { version: 1, name: 'My workspace', inbox: 'inbox', plugins: {} }

export function selectConfig(state) {
  const f = state.files['lumen.json']
  if (!f) return DEFAULT_CONFIG
  try {
    return { ...DEFAULT_CONFIG, ...JSON.parse(f.text) }
  } catch {
    return DEFAULT_CONFIG
  }
}

const idOf = (path, dir) => path.slice(dir.length + 1, -3)

function listShape(path, parsed, id) {
  const meta = parsed.meta || {}
  return {
    path,
    id,
    name: meta.name || id,
    color: meta.color,
    icon: meta.icon,
    owner: meta.owner,
    share: meta.share,
    sections: parsed.sections,
    items: parsed.items,
    all: parsed.all,
  }
}

export function selectLists(state) {
  const config = selectConfig(state)
  const inboxRaw = config.inbox || 'inbox'
  const inbox = inboxRaw.includes('/') ? inboxRaw : `lists/${inboxRaw}.md`
  const out = []
  for (const path of state.paths) {
    if (!/^lists\/[^/]+\.md$/.test(path)) continue
    const f = state.files[path]
    if (!f) continue
    const parsed = parseMemo(path, f.text, (t) => parseItems(t))
    out.push(listShape(path, parsed, idOf(path, 'lists')))
  }
  out.sort((a, b) => (a.path === inbox ? -1 : b.path === inbox ? 1 : a.name.localeCompare(b.name)))
  return out
}

export function selectCalendars(state) {
  const out = []
  for (const path of state.paths) {
    if (!/^calendars\/[^/]+\.md$/.test(path)) continue
    const f = state.files[path]
    if (!f) continue
    const parsed = parseMemo(path, f.text, (t) => parseItems(t, { events: true }))
    const meta = parsed.meta || {}
    out.push({ ...listShape(path, parsed, idOf(path, 'calendars')), default: !!meta.default })
  }
  out.sort((a, b) => a.name.localeCompare(b.name))
  return out
}

export function selectAllItems(state) {
  const out = []
  for (const l of selectLists(state)) {
    for (const item of flatItems(l)) out.push({ ...item, path: l.path, source: { kind: 'list', name: l.name, color: l.color, icon: l.icon } })
  }
  for (const c of selectCalendars(state)) {
    for (const item of flatItems(c)) out.push({ ...item, path: c.path, source: { kind: 'calendar', name: c.name, color: c.color, icon: c.icon } })
  }
  return out
}

export function selectPlugins(state) {
  const config = selectConfig(state)
  const plugins = config.plugins || {}
  const out = []
  for (const [id, entry] of Object.entries(plugins)) {
    const f = state.files[`plugins/${id}/manifest.json`]
    if (!f) continue
    let manifest
    try {
      manifest = JSON.parse(f.text)
    } catch {
      manifest = {}
    }
    out.push({ id, manifest, granted: entry.permissions || [] })
  }
  return out
}

export function selectDocs(state) {
  const out = []
  for (const path of state.paths) {
    const m = /^docs\/(.+)\.md$/.exec(path)
    if (!m) continue
    const parts = m[1].split('/')
    const fileName = parts.pop()
    const folder = parts.join('/') || ''
    let title = fileName
    const f = state.files[path]
    if (f) title = splitFrontMatter(f.text).meta.title || fileName
    out.push({ path, title, folder })
  }
  return out.sort((a, b) => a.path.localeCompare(b.path))
}
