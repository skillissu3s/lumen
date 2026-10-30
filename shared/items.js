// Items — tasks and events — are markdown list lines in the Obsidian Tasks emoji
// format, with a few additions for time-blocking (see docs/STORAGE.md):
//
//   - [ ] 📞 Call the bank #admin ⏫ 📅 2026-11-02 ⏰ 10:30 ⏱ 15m 🆔 k3j9x2
//   - 🧍 Standup 📅 2026-11-02 ⏰ 09:30 ⏱ 15m 🔁 every weekday 🆔 ev01st   (an event)
//
// This module is the only place that reads and rewrites those lines. Every edit
// is a pure function from a file's text to its new text, naming items by id, so
// the same edit can be re-applied to a newer version of the file after a
// conflict (see client/src/store/workspace.js).

import { addDays, daysBetween, isIsoDate, normTime, parseDuration, formatDuration, todayIso } from './dates.js'
import { parseRecurrence, nextOccurrence } from './recurrence.js'
import { splitFrontMatter } from './frontmatter.js'

// ---------- ids ----------

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz'
export function newId(len = 6) {
  const bytes = new Uint8Array(len)
  globalThis.crypto.getRandomValues(bytes)
  let s = ''
  for (const b of bytes) s += ALPHABET[b % 36]
  return s
}

function hash(s) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return (h >>> 0).toString(36)
}

// ---------- the line ----------

/** indent, bullet, checkbox status (undefined if none), the rest */
const LIST_LINE = /^(\s*)((?:[-*+]|\d+[.)])\s+)(?:\[([ xX/\-])\](?= |$) ?)?(.*)$/
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/

export const isDone = (s) => s === 'x' || s === 'X'
export const isCancelled = (s) => s === '-'
/** open or in progress (events count as open) */
export const isOpen = (s) => !isDone(s) && !isCancelled(s)

export const PRIORITIES = ['highest', 'high', 'medium', 'low', 'lowest']
export const PRIORITY_EMOJI = { highest: '🔺', high: '⏫', medium: '🔼', low: '🔽', lowest: '⏬' }
const PRIORITY_OF = Object.fromEntries(Object.entries(PRIORITY_EMOJI).map(([k, v]) => [v, k]))
const RANK = { highest: 4, high: 3, medium: 2, low: 0, lowest: -1 }
export const priorityRank = (p) => RANK[p] ?? 1

// Each field: its emoji (first one is what Lumen writes), the kind of value, in the order Lumen writes them
const FIELDS = [
  { key: 'recurrence', emoji: ['🔁'], type: 'text' },
  { key: 'start', emoji: ['🛫'], type: 'date' },
  { key: 'scheduled', emoji: ['⏳', '⌛'], type: 'date' },
  { key: 'date', emoji: ['📅', '📆', '🗓'], type: 'date' },
  { key: 'endDate', emoji: ['🔚'], type: 'date' },
  { key: 'time', emoji: ['⏰'], type: 'time' },
  { key: 'duration', emoji: ['⏱'], type: 'duration' },
  { key: 'location', emoji: ['📍'], type: 'text' },
  { key: 'color', emoji: ['🎨'], type: 'word' },
  { key: 'skip', emoji: ['🚫'], type: 'dates' },
  { key: 'created', emoji: ['➕'], type: 'date' },
  { key: 'done', emoji: ['✅'], type: 'date' },
  { key: 'cancelled', emoji: ['❌'], type: 'date' },
  { key: 'id', emoji: ['🆔'], type: 'word' },
]
const FIELD_OF = new Map(FIELDS.flatMap((f) => f.emoji.map((e) => [e, f])))
export const FIELD_KEYS = ['priority', ...FIELDS.map((f) => f.key)]
const ALL_EMOJI = [...Object.values(PRIORITY_EMOJI), ...FIELDS.flatMap((f) => f.emoji), '⛔', '🏁']
const EMOJI_RE = new RegExp(`(${ALL_EMOJI.join('|')})\\uFE0F?`, 'gu')

const VALUE = {
  date: /^\s*(\d{4}-\d{2}-\d{2})/,
  time: /^\s*(\d{1,2}:\d{2})/,
  duration: /^\s*(\d+h\d+m|\d+(?:\.\d+)?h|\d+m)/,
  word: /^\s*([\w#-]+)/,
  dates: /^\s*(\d{4}-\d{2}-\d{2}(?:\s*,\s*\d{4}-\d{2}-\d{2})*)/,
}

const TAG = /(^|[\s(,;])#([\p{L}\p{N}_\-/]*[\p{L}_\-/][\p{L}\p{N}_\-/]*)/gu
const ICON = /^(\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic}|[\u{1F3FB}-\u{1F3FF}])*)\s+/u

// The fields in the text after the checkbox: where each sits and what it says
function scan(rest) {
  const marks = [...rest.matchAll(EMOJI_RE)].map((m) => ({ emoji: m[1], at: m.index, len: m[0].length }))
  const found = []
  const seen = new Set()
  marks.forEach((mk, i) => {
    const after = rest.slice(mk.at + mk.len)
    const nextAt = i + 1 < marks.length ? marks[i + 1].at : rest.length
    if (PRIORITY_OF[mk.emoji]) {
      if (seen.has('priority')) return
      seen.add('priority')
      found.push({ key: 'priority', value: PRIORITY_OF[mk.emoji], start: mk.at, end: mk.at + mk.len })
      return
    }
    const f = FIELD_OF.get(mk.emoji)
    if (!f || seen.has(f.key)) return
    let value
    let end
    if (f.type === 'text') {
      value = rest.slice(mk.at + mk.len, nextAt).trim()
      end = nextAt
      if (!value) return
    } else {
      const m = VALUE[f.type].exec(after)
      if (!m) return
      value = m[1]
      end = mk.at + mk.len + m[0].length
    }
    seen.add(f.key)
    found.push({ key: f.key, value, start: mk.at, end })
  })
  return found
}

function cut(rest, found) {
  let out = ''
  let at = 0
  for (const f of [...found].sort((a, b) => a.start - b.start)) {
    out += rest.slice(at, f.start) + ' '
    at = f.end
  }
  return (out + rest.slice(at)).replace(/\s+/g, ' ').trim()
}

export const tagsOf = (title) => [...String(title).matchAll(TAG)].map((m) => m[2].replace(/\/+$/, '')).filter(Boolean)

/** Title → { icon, label }: "🏃 Run" → { icon: "🏃", label: "Run" } */
export function splitIcon(title) {
  const m = ICON.exec(title || '')
  return m ? { icon: m[1], label: title.slice(m[0].length) } : { icon: null, label: title || '' }
}
export const joinIcon = (icon, label) => (icon ? `${icon} ${label}`.trim() : String(label || '').trim())

function convert(key, raw) {
  switch (key) {
    case 'time':
      return normTime(raw)
    case 'duration':
      return parseDuration(raw)
    case 'skip':
      return raw.split(',').map((s) => s.trim()).filter(isIsoDate)
    default:
      return raw
  }
}

/**
 * Reads one line. `events`: a plain list line counts (as an event).
 * Returns null if the line isn't an item.
 */
export function parseLine(line, { events = false } = {}) {
  const m = LIST_LINE.exec(String(line).replace(/\r$/, ''))
  if (!m) return null
  const [, indent, bullet, status, rest] = m
  if (status === undefined && !events) return null
  const found = scan(rest)
  const title = cut(rest, found)
  const item = { kind: status === undefined ? 'event' : 'task', status: status ?? null, indent: indentWidth(indent), bullet, title }
  for (const f of found) {
    const v = convert(f.key, f.value)
    if (v != null && !(Array.isArray(v) && !v.length)) item[f.key] = v
  }
  const { icon, label } = splitIcon(title)
  item.icon = icon
  item.label = label
  item.tags = tagsOf(title)
  return item
}

const indentWidth = (s) => s.replace(/\t/g, '    ').length

function token(key, value) {
  if (key === 'priority') return PRIORITY_EMOJI[value]
  const f = FIELDS.find((x) => x.key === key)
  const v = key === 'duration' ? formatDuration(value) : key === 'skip' ? value.join(',') : value
  return `${f.emoji[0]} ${v}`
}

function validate(key, value) {
  if (value == null) return
  const bad = (what) => {
    throw new RangeError(`"${value}" is not ${what}`)
  }
  const f = FIELDS.find((x) => x.key === key)
  if (key === 'priority' && !PRIORITIES.includes(value)) bad('a priority')
  if (f?.type === 'date' && !isIsoDate(value)) bad('a date (yyyy-mm-dd)')
  if (key === 'time' && !normTime(value)) bad('a time (HH:MM)')
  if (key === 'duration' && !(Number.isFinite(value) && value > 0)) bad('a duration')
  if (key === 'recurrence' && !parseRecurrence(value)) bad('a repeat rule')
  if (key === 'skip' && !(Array.isArray(value) && value.every(isIsoDate))) bad('a list of dates')
  if ((key === 'id' || key === 'color') && !/^[\w#-]+$/.test(value)) bad(`a valid ${key}`)
}

/**
 * Writes an item's line from its parts: { indent, bullet, status (null = event),
 * title, …fields }. Fields go in a fixed order after the title.
 */
export function formatLine(item) {
  const pad = ' '.repeat(item.indent || 0)
  const box = item.status == null ? '' : `[${item.status}] `
  const tokens = FIELD_KEYS.filter((k) => item[k] != null && !(Array.isArray(item[k]) && !item[k].length)).map((k) => token(k, item[k]))
  const text = [String(item.title || '').replace(/\s+/g, ' ').trim(), ...tokens].filter(Boolean).join(' ')
  return `${pad}${item.bullet || '- '}${box}${text}`.replace(/\s+$/, '')
}

// ---------- a whole file ----------

/**
 * Reads a list or calendar file:
 *   { meta, items (top level, in order), all (Map id → item, subtasks too), sections }
 * Each item also has: id, line, last (its block's last line), parent (id|null),
 * section, notes (text), subtasks (items), noteLines.
 */
export function parseItems(text, { events = false } = {}) {
  const { meta, bodyStart } = splitFrontMatter(text)
  const lines = String(text ?? '').split('\n')
  const items = []
  const all = new Map()
  const sections = []
  const stack = [] // { indent, item }
  const titleCount = new Map()
  let section = null

  for (let i = bodyStart; i < lines.length; i++) {
    const raw = lines[i].replace(/\r$/, '')
    if (!/\S/.test(raw)) continue
    const ind = indentWidth(/^\s*/.exec(raw)[0])
    while (stack.length && stack[stack.length - 1].indent >= ind) stack.pop()
    const parent = stack.length ? stack[stack.length - 1].item : null
    const h = !parent && HEADING.exec(raw)
    if (h) {
      section = h[2]
      sections.push({ name: section, line: i, level: h[1].length })
      continue
    }
    // a plain bullet nested under an item is part of its notes, not an event
    const item = parseLine(raw, { events: events && !parent })
    if (item) {
      item.line = i
      item.last = i
      item.parent = parent ? parent.id : null
      item.section = section
      item.subtasks = []
      item.noteLines = []
      if (item.id) item.hasId = true
      else {
        const key = hash(item.title)
        const n = titleCount.get(key) || 0
        titleCount.set(key, n + 1)
        item.id = `~${key}.${n}`
        item.hasId = false
      }
      if (parent) parent.subtasks.push(item)
      else items.push(item)
      // the later of two lines with the same id wins (a union merge can leave both)
      const dup = all.get(item.id)
      if (dup) {
        dup.duplicate = true
        const list = dup.parent ? all.get(dup.parent)?.subtasks : items
        if (list) list.splice(list.indexOf(dup), 1)
      }
      all.set(item.id, item)
      for (const s of stack) s.item.last = i
      stack.push({ indent: ind, item })
      continue
    }
    if (parent) {
      // blank lines between paragraphs of a note belong to it
      for (let b = parent.last + 1; b < i; b++) parent.noteLines.push(b)
      parent.noteLines.push(i)
      for (const s of stack) s.item.last = i
    } else {
      stack.length = 0
    }
  }

  for (const item of all.values()) {
    if (!item.noteLines.length) {
      item.notes = ''
      continue
    }
    const noteText = item.noteLines.map((n) => lines[n].replace(/\r$/, ''))
    const min = Math.min(...noteText.filter((l) => /\S/.test(l)).map((l) => indentWidth(/^\s*/.exec(l)[0])))
    item.notes = noteText.map((l) => l.replace(/\t/g, '    ').slice(min)).join('\n')
  }
  return { meta, items, all, sections, bodyStart }
}

/** Every item of a parsed file, subtasks included, in line order */
export const flatItems = (parsed) => [...parsed.all.values()].filter((i) => !i.duplicate).sort((a, b) => a.line - b.line)

// ---------- editing a file ----------

export class ItemMissingError extends Error {
  constructor(id) {
    super(`That item is gone (it may have been deleted elsewhere): ${id}`)
    this.status = 404
  }
}

function locate(text, id, opts) {
  const parsed = parseItems(text, opts)
  const item = parsed.all.get(id)
  if (!item || item.duplicate) throw new ItemMissingError(id)
  return { parsed, item, lines: String(text).split('\n') }
}

const crOf = (lines) => (lines.some((l) => l.endsWith('\r')) ? '\r' : '')

// lines of a block without its trailing blank lines
function blockRange(lines, item) {
  let end = item.last
  while (end > item.line && !/\S/.test(lines[end])) end--
  return [item.line, end]
}

function stampStatus(prev, patch, today) {
  const next = { ...patch }
  if (patch.status === undefined || patch.status === prev.status) return next
  if (isDone(patch.status) && !isDone(prev.status)) Object.assign(next, { done: patch.done ?? today, cancelled: null })
  else if (isCancelled(patch.status)) Object.assign(next, { cancelled: patch.cancelled ?? today, done: null })
  else if (!isDone(patch.status)) Object.assign(next, { done: null, cancelled: null })
  return next
}

function applyFields(item, patch) {
  const out = { ...item }
  if (patch.title != null || patch.icon !== undefined || patch.label != null) {
    const cur = splitIcon(item.title)
    const label = patch.label ?? (patch.title != null ? splitIcon(patch.title).label : cur.label)
    const icon = patch.icon !== undefined ? patch.icon : patch.title != null ? splitIcon(patch.title).icon : cur.icon
    out.title = joinIcon(icon, label)
  }
  for (const k of FIELD_KEYS) {
    if (!(k in patch)) continue
    validate(k, patch[k])
    if (patch[k] == null) delete out[k]
    else out[k] = k === 'time' ? normTime(patch[k]) : patch[k]
  }
  if ('status' in patch && item.status != null) out.status = patch.status
  return out
}

const reindent = (block, from, to) => block.map((l) => (/\S/.test(l) ? ' '.repeat(to) + l.replace(/\t/g, '    ').slice(Math.min(from, indentWidth(/^\s*/.exec(l)[0]))) : l))

function noteBlock(notes, indent) {
  if (!notes) return []
  return String(notes).replace(/\r/g, '').replace(/\n+$/, '').split('\n').map((l) => (l.trim() ? ' '.repeat(indent) + l : ''))
}

/**
 * Changes an item. `patch` may set any field (null removes it), `title`, `icon`,
 * `label`, `status` and `notes`. Completing a repeating task writes its next
 * occurrence below it. Returns { text, id, next } (`next`: the new occurrence's id).
 */
export function updateItem(text, id, patch, { today = todayIso(), events = false, makeId = newId } = {}) {
  const { parsed, item, lines } = locate(text, id, { events })
  const cr = crOf(lines)
  const p = stampStatus(item, patch, today)
  const changed = applyFields(item, p)
  if (!item.hasId) changed.id = p.id || makeId()
  lines[item.line] = formatLine(changed) + cr

  let nextId = null
  // notes: the item's own note lines are replaced by the new ones, right under it
  if ('notes' in patch) {
    const childIndent = item.subtasks[0]?.indent ?? item.indent + 4
    const own = new Set(item.noteLines)
    const kept = []
    for (let n = item.line + 1; n <= item.last; n++) if (!own.has(n)) kept.push(lines[n])
    while (kept.length && !/\S/.test(kept[kept.length - 1])) kept.pop()
    const notes = noteBlock(patch.notes, childIndent).map((l) => l + cr)
    lines.splice(item.line + 1, item.last - item.line, ...notes, ...kept)
  }

  // a repeating task that was just finished: its next occurrence, with a fresh checklist
  const rec = changed.recurrence && parseRecurrence(changed.recurrence)
  if (rec && item.kind === 'task' && isDone(changed.status) && !isDone(item.status)) {
    const fresh = parseItems(lines.join('\n'), { events })
    const me = fresh.all.get(changed.id)
    const from = item.date || item.scheduled || item.start || today
    const to = nextOccurrence(rec, rec.whenDone ? today : from, from)
    if (!rec.until || to <= rec.until) {
      const shift = daysBetween(from, to)
      const head = { ...changed, status: ' ', done: undefined, cancelled: undefined, id: makeId() }
      for (const k of ['date', 'scheduled', 'start', 'endDate']) if (changed[k]) head[k] = addDays(changed[k], shift)
      if (!changed.date && !changed.scheduled && !changed.start) head.date = to
      nextId = head.id
      const [, end] = blockRange(lines, me)
      const below = []
      for (let n = me.line + 1; n <= end; n++) {
        const sub = parseLine(lines[n].replace(/\r$/, ''))
        if (sub && sub.status != null) {
          const reopened = { ...sub, status: ' ', done: undefined, cancelled: undefined, id: makeId() }
          below.push(formatLine(reopened) + cr)
        } else below.push(lines[n])
      }
      lines.splice(end + 1, 0, formatLine(head) + cr, ...below)
    }
  }
  void parsed
  return { text: lines.join('\n'), id: changed.id, next: nextId }
}

/** Removes an item with everything nested under it. Returns { text, block } */
export function removeItem(text, id, opts = {}) {
  const { item, lines } = locate(text, id, opts)
  const [start, end] = blockRange(lines, item)
  const block = lines.splice(start, end - start + 1).map((l) => l.replace(/\r$/, ''))
  // don't leave two blank lines where the block was
  if (start > 0 && start < lines.length && !/\S/.test(lines[start]) && !/\S/.test(lines[start - 1])) lines.splice(start, 1)
  return { text: lines.join('\n'), block, indent: item.indent }
}

/**
 * Where a new line goes. `where`: { parent: id } (last in its checklist),
 * { after: id } / { before: id } (as a sibling), { section: name } (end of that
 * section), { top: true } (first in the file), or {} (end of the file).
 * Returns { at, indent }.
 */
function placeFor(text, lines, where, opts) {
  const parsed = parseItems(text, opts)
  if (where.parent) {
    const p = parsed.all.get(where.parent)
    if (!p) throw new ItemMissingError(where.parent)
    const [, end] = blockRange(lines, p)
    return { at: end + 1, indent: p.subtasks[0]?.indent ?? p.indent + 4 }
  }
  if (where.after || where.before) {
    const ref = parsed.all.get(where.after || where.before)
    if (!ref) throw new ItemMissingError(where.after || where.before)
    if (where.before) return { at: ref.line, indent: ref.indent }
    return { at: blockRange(lines, ref)[1] + 1, indent: ref.indent }
  }
  if (where.section != null) {
    const s = parsed.sections.find((x) => x.name === where.section)
    if (s) {
      const inSection = parsed.items.filter((i) => i.section === where.section)
      if (inSection.length) return { at: blockRange(lines, inSection[inSection.length - 1])[1] + 1, indent: 0 }
      return { at: s.line + 1, indent: 0, gapBefore: false }
    }
    // a new section at the end
    return { at: -1, indent: 0, newSection: where.section }
  }
  if (where.top) {
    const first = parsed.items.find((i) => !i.section)
    if (first) return { at: first.line, indent: 0 }
    const firstSection = parsed.sections[0]
    if (firstSection) return { at: firstSection.line, indent: 0, gapAfter: true }
    return { at: -1, indent: 0 }
  }
  return { at: -1, indent: 0 }
}

function insertLines(text, block, where, opts) {
  const lines = String(text ?? '').split('\n')
  const cr = crOf(lines)
  const place = placeFor(text, lines, where, opts)
  const blockIndent = Math.min(...block.filter((l) => /\S/.test(l)).map((l) => indentWidth(/^\s*/.exec(l)[0])))
  const put = reindent(block, blockIndent, place.indent).map((l) => l + cr)
  if (place.at === -1) {
    // at the end of the file, after a blank line unless it already ends in a list
    while (lines.length > 1 && lines[lines.length - 1] === '') lines.pop()
    const last = lines[lines.length - 1]?.replace(/\r$/, '') ?? ''
    const body = lines.length === 1 && last === ''
    const out = body ? [] : lines.map((l, i) => (i === lines.length - 1 && cr && !l.endsWith('\r') ? l + cr : l))
    if (place.newSection) out.push(...(out.length ? [cr] : []), `## ${place.newSection}${cr}`)
    else if (out.length && !LIST_LINE.test(last) && !/^---\s*$/.test(last) && !HEADING.test(last)) out.push(cr)
    out.push(...put)
    return `${out.join('\n')}\n`
  }
  if (place.gapAfter) put.push(cr)
  lines.splice(place.at, 0, ...put)
  return lines.join('\n')
}

/**
 * Adds an item. `fields`: { title, status (' ' for a task, null for an event),
 * notes, …fields }. Returns { text, id }.
 */
export function addItem(text, fields, where = {}, { events = false, makeId = newId } = {}) {
  const id = fields.id || makeId()
  const item = { bullet: '- ', indent: 0, status: fields.status === undefined ? ' ' : fields.status, title: joinIcon(fields.icon, fields.label ?? fields.title ?? '') }
  if (fields.title != null && fields.icon === undefined) item.title = String(fields.title).trim()
  for (const k of FIELD_KEYS) {
    if (fields[k] == null || k === 'id') continue
    validate(k, fields[k])
    item[k] = k === 'time' ? normTime(fields[k]) : fields[k]
  }
  item.id = id
  const block = [formatLine(item), ...noteBlock(fields.notes, 4)]
  return { text: insertLines(text, block, where, { events }), id }
}

/** Puts a block that removeItem took out back in (at `where`, as for addItem) */
export const insertBlock = (text, block, where = {}, opts = {}) => insertLines(text, block, where, opts)

/** Moves an item (and what's nested under it) within its file */
export function moveItem(text, id, where, opts = {}) {
  if (where.after === id || where.before === id || where.parent === id) return text
  const { text: without, block } = removeItem(text, id, opts)
  return insertLines(without, block, where, opts)
}

/** Leaves one occurrence of a repeating event out */
export function skipOccurrence(text, id, date, opts = {}) {
  const { item } = locate(text, id, opts)
  const skip = [...new Set([...(item.skip || []), date])].sort()
  return updateItem(text, id, { skip }, opts).text
}

/** Ends a repeating series the day before `date` (for "this and following" edits) */
export function endSeriesBefore(text, id, date, opts = {}) {
  const { item } = locate(text, id, opts)
  const rec = parseRecurrence(item.recurrence)
  if (!rec) return text
  const until = addDays(date, -1)
  if (until < (item.date || until)) return removeItem(text, id, opts).text
  const rule = item.recurrence.replace(/ until \d{4}-\d{2}-\d{2}$/, '') + ` until ${until}`
  return updateItem(text, id, { recurrence: rule }, opts).text
}

/** Adds a `## name` section at the end of a list */
export function addSection(text, name) {
  const body = String(text ?? '').replace(/\n+$/, '')
  return `${body}${body ? '\n\n' : ''}## ${name}\n`
}

export function renameSection(text, from, to) {
  const lines = String(text).split('\n')
  const { sections } = parseItems(text)
  const s = sections.find((x) => x.name === from)
  if (!s) return text
  lines[s.line] = `${'#'.repeat(s.level)} ${to}${crOf(lines)}`
  return lines.join('\n')
}

// ---------- reading items for views ----------

/** The day an item sits on */
export const itemDay = (i) => i.date || i.scheduled || i.start || null

export function compareItems(a, b) {
  const open = Number(!isOpen(a.status)) - Number(!isOpen(b.status))
  if (open) return open
  const da = itemDay(a)
  const db = itemDay(b)
  if (da !== db) return da == null ? 1 : db == null ? -1 : da < db ? -1 : 1
  const ta = a.time || ''
  const tb = b.time || ''
  if (ta !== tb) return !ta ? 1 : !tb ? -1 : ta < tb ? -1 : 1
  return priorityRank(b.priority) - priorityRank(a.priority)
}

/** The change that puts an item back the way it was before `patch` */
export function undoPatch(item, patch) {
  const back = {}
  for (const k of Object.keys(patch)) back[k] = k === 'title' ? item.title : k === 'notes' ? item.notes || '' : (item[k] ?? null)
  if ('status' in patch) Object.assign(back, { done: item.done ?? null, cancelled: item.cancelled ?? null })
  return back
}

/** Is the task under `tag` or one of its subtags (#home/bills is under #home)? */
export function hasTag(item, tag) {
  const want = tag.toLowerCase()
  return !!item.tags?.some((t) => t.toLowerCase() === want || t.toLowerCase().startsWith(`${want}/`))
}
