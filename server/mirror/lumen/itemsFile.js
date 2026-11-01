// Boards (lists/<slug>.md) and calendars (calendars/<slug>.md) as files, both
// ways, for profile lumen/1 of the Repo Sync Protocol. `parse` turns a file into
// a root record and its cards; `render` turns them back into the file, the same
// bytes every time. Both are pure: no database, no clock, no randomness. A card
// or root without an id comes back with `id: null` (and cards keep a `ref`), so
// that the caller can mint ids (see assignIds).
//
// What a file holds beyond what the tables model (front matter keys Lumen doesn't
// know, Obsidian Kanban's own settings, loose text between cards) is kept in the
// root's `extra` and written back, so nothing is lost on the way through.

import { splitFrontMatter } from '../../../shared/frontmatter.js'
import { formatLine, parseItems } from '../../../shared/items.js'
import { readSettings } from '../../../shared/board.js'
import { frontMatter } from './frontMatter.js'

const FIELDS = ['priority', 'recurrence', 'start', 'scheduled', 'date', 'endDate', 'time', 'duration', 'location', 'color', 'skip', 'created', 'done', 'cancelled']
const ROOT_KEYS = { board: ['id', 'name', 'color', 'icon', 'view', 'owner', 'share', 'kanban-plugin'], calendar: ['id', 'name', 'color', 'icon', 'default', 'owner', 'share'] }
const SETTINGS_START = /^%%\s*kanban:settings\s*$/
const SETTINGS_END = /^%%\s*$/
const RULE = /^\*\*\*\s*$/
const HEADING = /^#{1,6}\s+/
const NOTE_INDENT = 4

const sortKeys = (obj) => Object.fromEntries(Object.keys(obj || {}).sort().map((k) => [k, obj[k]]))
const isEmpty = (v) => v == null || (Array.isArray(v) && !v.length) || (typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length)

/**
 * A board or calendar file → { root, cards, warnings }.
 * `kind`: 'board' | 'calendar'.
 */
export function parse(text, { kind = 'board' } = {}) {
  const src = String(text ?? '').replace(/\r\n?/g, '\n').normalize('NFC')
  const warnings = []
  const lines = src.split('\n')
  const { meta, bodyStart } = splitFrontMatter(src)
  const parsed = parseItems(src, { events: kind === 'calendar' })

  // the parts of the file that aren't cards: the settings block and the archive's rule
  const setStart = lines.findIndex((l) => SETTINGS_START.test(l))
  let setEnd = -1
  if (setStart >= 0) for (let i = setStart + 1; i < lines.length && setEnd < 0; i++) if (SETTINGS_END.test(lines[i])) setEnd = i
  const inSettings = (i) => setStart >= 0 && setEnd >= 0 && i >= setStart && i <= setEnd
  const rule = lines.findIndex((l, i) => i >= bodyStart && RULE.test(l) && !inSettings(i))

  // the root
  const known = ROOT_KEYS[kind]
  const root = { type: kind, id: typeof meta.id === 'string' && meta.id ? meta.id : null, extra: {} }
  for (const k of known) if (k !== 'id' && k !== 'kanban-plugin' && meta[k] !== undefined) root[k === 'default' ? 'isDefault' : k] = meta[k]
  const unknown = Object.keys(meta).filter((k) => !known.includes(k))
  if (unknown.length) root.extra.meta = sortKeys(Object.fromEntries(unknown.map((k) => [k, meta[k]])))

  // columns (boards) or sections (calendars): headings above the archive's rule
  const headings = parsed.sections.filter((s) => (rule < 0 || s.line < rule) && !inSettings(s.line))
  const names = []
  for (const s of headings) if (!names.includes(s.name)) names.push(s.name)
  const settings = kind === 'board' && setStart >= 0 ? readSettings(src) : {}
  const lumen = settings.lumen || {}
  if (kind === 'board') {
    root.columns = names.map((name) => ({ name, color: lumen.columns?.[name] || null }))
    root.done = lumen.done ?? null
    root.labels = sortKeys(lumen.labels)
    const { 'kanban-plugin': _, lumen: __, ...other } = settings
    if (Object.keys(other).length) root.extra.kanban = sortKeys(other)
    const { columns: _c, labels: _l, covers: _v, done: _d, ...lumenOther } = lumen
    if (Object.keys(lumenOther).length) root.extra.lumen = sortKeys(lumenOther)
  } else {
    root.sections = names
  }
  const covers = lumen.covers || {}

  // cards: every item, subtasks too, in file order; position counts within its siblings
  const covered = new Set()
  const cards = []
  const nextPos = new Map()
  const all = [...parsed.all.values()].filter((i) => !i.duplicate && !inSettings(i.line)).sort((a, b) => a.line - b.line)
  for (const item of all) {
    for (let l = item.line; l <= item.last; l++) covered.add(l)
    const archived = rule >= 0 && item.line > rule
    const parent = item.parent ? parsed.all.get(item.parent) : null
    const column = parent ? null : archived ? null : item.section
    const siblings = parent ? `p:${item.parent}` : `${archived ? 'a' : 'c'}:${column ?? ''}`
    const position = nextPos.get(siblings) || 0
    nextPos.set(siblings, position + 1)
    const card = {
      id: item.hasId ? item.id : null,
      ref: item.id,
      parent: item.parent,
      column,
      archived,
      position,
      kind: item.kind,
      status: item.status == null ? null : item.status === 'X' ? 'x' : item.status,
      title: item.title,
      notes: item.notes || '',
    }
    for (const f of FIELDS) if (item[f] != null && !(Array.isArray(item[f]) && !item[f].length)) card[f] = item[f]
    if (item.hasId && covers[item.id]) card.cover = covers[item.id]
    cards.push(card)
  }

  // anything else: kept as loose text, under the heading it sat under
  let section = ''
  const loose = {}
  for (let i = bodyStart; i < lines.length; i++) {
    const l = lines[i]
    if (inSettings(i) || covered.has(i) || !/\S/.test(l)) continue
    if (i === rule) {
      section = '\u0000archive'
      continue
    }
    const heading = HEADING.test(l) && parsed.sections.find((s) => s.line === i)
    if (heading) {
      section = rule >= 0 && i > rule ? '\u0000archive' : heading.name
      continue
    }
    ;(loose[section] ||= []).push(l)
  }
  if (Object.keys(loose).length) {
    root.extra.text = Object.fromEntries(Object.entries(loose).map(([k, v]) => [k === '\u0000archive' ? '*archive' : k, v.join('\n')]))
    warnings.push(`kept ${Object.values(loose).flat().length} line(s) of loose text`)
  }
  return { root, cards, warnings }
}

// one card, its notes and its subtasks, as lines
function cardLines(card, byParent, depth) {
  const out = [formatLine({ indent: depth * NOTE_INDENT, bullet: '- ', status: card.kind === 'event' ? null : card.status ?? ' ', title: card.title, ...pick(card), id: card.id })]
  if (card.notes) for (const l of card.notes.split('\n')) out.push(l.trim() ? `${' '.repeat((depth + 1) * NOTE_INDENT)}${l}`.replace(/\s+$/, '') : '')
  for (const sub of byParent.get(card.id) || []) out.push(...cardLines(sub, byParent, depth + 1))
  return out
}

const pick = (card) => Object.fromEntries(FIELDS.filter((f) => card[f] != null).map((f) => [f, card[f]]))
const byPosition = (a, b) => a.position - b.position || String(a.id).localeCompare(String(b.id))

/** A root and its cards → the file's text */
export function render(root, cards, { kind = root.type || 'board' } = {}) {
  const live = cards.filter((c) => !c.deleted)
  const byParent = new Map()
  for (const c of live) if (c.parent) (byParent.get(c.parent) || byParent.set(c.parent, []).get(c.parent)).push(c)
  for (const list of byParent.values()) list.sort(byPosition)
  const top = live.filter((c) => !c.parent)
  const text = root.extra?.text || {}

  // front matter: known keys in order, then unknown ones sorted
  const meta = {}
  for (const k of ROOT_KEYS[kind]) {
    const v = k === 'kanban-plugin' ? 'board' : k === 'default' ? root.isDefault : root[k]
    if (!isEmpty(v) && v !== false) meta[k] = v
  }
  Object.assign(meta, sortKeys(root.extra?.meta))
  const out = [frontMatter(meta), '']

  const group = (name, cardsHere) => {
    const block = []
    if (text[name ?? '']) block.push(text[name ?? ''], '')
    for (const c of cardsHere.sort(byPosition)) block.push(...cardLines(c, byParent, 0))
    if (cardsHere.length) block.push('')
    return block
  }
  const columns = kind === 'board' ? (root.columns || []).map((c) => c.name) : root.sections || []
  // cards with no column first, then each column
  out.push(...group(null, top.filter((c) => !c.archived && !c.column)))
  for (const name of columns) out.push(`## ${name}`, '', ...group(name, top.filter((c) => !c.archived && c.column === name)))
  // a card whose column no longer exists goes at the end, under its old heading
  const orphans = [...new Set(top.filter((c) => !c.archived && c.column && !columns.includes(c.column)).map((c) => c.column))]
  for (const name of orphans) out.push(`## ${name}`, '', ...group(name, top.filter((c) => !c.archived && c.column === name)))

  const archived = top.filter((c) => c.archived)
  if (archived.length || text['*archive']) {
    out.push('***', '', '## Archive', '')
    if (text['*archive']) out.push(text['*archive'], '')
    for (const c of archived.sort(byPosition)) out.push(...cardLines(c, byParent, 0))
    if (archived.length) out.push('')
  }

  if (kind === 'board') {
    const lumen = {}
    if (root.done) lumen.done = root.done
    const columnColors = Object.fromEntries((root.columns || []).filter((c) => c.color).map((c) => [c.name, c.color]))
    if (!isEmpty(columnColors)) lumen.columns = sortKeys(columnColors)
    if (!isEmpty(root.labels)) lumen.labels = sortKeys(root.labels)
    const covers = Object.fromEntries(live.filter((c) => c.cover && c.id).map((c) => [c.id, c.cover]))
    if (!isEmpty(covers)) lumen.covers = sortKeys(covers)
    Object.assign(lumen, sortKeys(root.extra?.lumen))
    const settings = { 'kanban-plugin': 'board', ...sortKeys(root.extra?.kanban) }
    if (!isEmpty(lumen)) settings.lumen = lumen
    out.push('%% kanban:settings', '```', JSON.stringify(settings), '```', '%%')
  }
  return `${out.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\n+$/, '')}\n`
}

/**
 * Gives ids to a parsed file's root and cards that had none, and points
 * subtasks at their parents' ids. `makeId(kind)` mints one.
 */
export function assignIds({ root, cards, warnings }, makeId) {
  const ids = new Map()
  const out = cards.map((c) => {
    const id = c.id || makeId('card')
    ids.set(c.ref, id)
    return { ...c, id }
  })
  for (const c of out) {
    c.parent = c.parent ? ids.get(c.parent) || null : null
    delete c.ref
  }
  return { root: { ...root, id: root.id || makeId(root.type) }, cards: out, warnings }
}
