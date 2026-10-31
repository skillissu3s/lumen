// A board is a list file read the way the Obsidian Kanban plugin reads it: each
// `## heading` is a column, each task line under it a card. Lumen keeps the
// board's look (column colours, label colours, card covers, which column means
// "done") where the plugin keeps its settings, so the file works in both:
//
//   ---
//   name: Launch
//   kanban-plugin: board
//   ---
//   ## To do
//   - [ ] Write the brief #design 🆔 a1b2c3
//   ## Done
//   - [x] Set up the repo ✅ 2026-10-14 🆔 d4e5f6
//
//   %% kanban:settings
//   ```
//   {"kanban-plugin":"board","lumen":{"columns":{"To do":"blue"},"labels":{"design":"violet"},"covers":{"a1b2c3":"green"},"done":"Done"}}
//   ```
//   %%

import { addSection, isOpen, moveItem, parseItems, renameSection } from './items.js'

export const BOARD_COLORS = ['gray', 'red', 'orange', 'amber', 'green', 'teal', 'blue', 'indigo', 'violet', 'pink']
export const DEFAULT_COLUMNS = ['To do', 'Doing', 'Done']

const START = /^%%\s*kanban:settings\s*$/
const END = /^%%\s*$/

// where the settings block is: [first line, last line] or null
function settingsRange(lines) {
  const start = lines.findIndex((l) => START.test(l.replace(/\r$/, '')))
  if (start < 0) return null
  for (let i = start + 1; i < lines.length; i++) if (END.test(lines[i].replace(/\r$/, ''))) return [start, i]
  return null
}

/** The whole settings object of a board file ({} if none) */
export function readSettings(text) {
  const lines = String(text ?? '').split('\n')
  const r = settingsRange(lines)
  if (!r) return {}
  const json = lines
    .slice(r[0] + 1, r[1])
    .filter((l) => !/^\s*```/.test(l))
    .join('\n')
    .trim()
  try {
    const v = JSON.parse(json || '{}')
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {}
  } catch {
    return {}
  }
}

/** Lumen's part of the settings: { columns, labels, covers, done } */
export function boardSettings(text) {
  const s = readSettings(text).lumen || {}
  return { columns: s.columns || {}, labels: s.labels || {}, covers: s.covers || {}, done: s.done ?? null }
}

/** Merges `patch` into Lumen's settings (a key set to null is removed) and writes the block back */
export function setBoardSettings(text, patch) {
  const all = readSettings(text)
  const lumen = { ...(all.lumen || {}) }
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete lumen[k]
    else if (v && typeof v === 'object' && !Array.isArray(v)) {
      const merged = { ...(lumen[k] || {}), ...v }
      for (const [kk, vv] of Object.entries(merged)) if (vv === null) delete merged[kk]
      lumen[k] = merged
    } else lumen[k] = v
  }
  const next = { 'kanban-plugin': 'board', ...all, lumen }
  const block = ['%% kanban:settings', '```', JSON.stringify(next), '```', '%%']
  const lines = String(text ?? '').split('\n')
  const r = settingsRange(lines)
  if (r) {
    lines.splice(r[0], r[1] - r[0] + 1, ...block)
    return lines.join('\n')
  }
  const body = String(text ?? '').replace(/\n+$/, '')
  return `${body}\n\n${block.join('\n')}\n`
}

const same = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase()

/** The column that means done: the one set in settings, else one called "Done" */
export function doneColumn(columns, settings) {
  const named = settings.done && columns.find((c) => same(c.name, settings.done))
  return named || columns.find((c) => same(c.name, 'done') || same(c.name, 'complete') || same(c.name, 'completed')) || null
}

/**
 * The board of a parsed list: columns in file order, each with its top-level
 * tasks. Tasks before the first heading go into a column with no name.
 * `archived`: cards under a heading after a `***` line are left out.
 */
export function boardOf(list, text) {
  const settings = boardSettings(text)
  const lines = String(text ?? '').split('\n')
  const rule = lines.findIndex((l) => /^\*\*\*\s*$/.test(l.replace(/\r$/, '')))
  const columns = []
  const loose = list.items.filter((i) => i.kind === 'task' && !i.section)
  if (loose.length || !list.sections.length) columns.push({ name: null, line: -1, color: null, items: loose })
  for (const s of list.sections) {
    if (rule >= 0 && s.line > rule) continue
    if (columns.some((c) => c.name === s.name)) continue
    columns.push({ name: s.name, line: s.line, color: settings.columns[s.name] || null, items: list.items.filter((i) => i.kind === 'task' && i.section === s.name) })
  }
  const done = doneColumn(columns.filter((c) => c.name), settings)
  return { columns, settings, done: done?.name ?? null }
}

/** A board's progress: open and finished cards */
export function boardProgress(board) {
  let open = 0
  let finished = 0
  for (const c of board.columns) for (const i of c.items) isOpen(i.status) ? open++ : finished++
  return { open, finished, total: open + finished }
}

const NL = String.fromCharCode(10)

// a new column goes at the end, before the settings block (which stays last)
export function addColumn(text, name) {
  const lines = String(text ?? '').split(NL)
  const r = settingsRange(lines)
  if (!r) return addSection(text, name)
  const body = addSection(lines.slice(0, r[0]).join(NL), name)
  return body + NL + lines.slice(r[0]).join(NL).trimEnd() + NL
}

/** A plain list (no headings) as a board: open cards under "To do", finished ones under "Done" */
export function columnize(text) {
  const parsed = parseItems(text)
  if (parsed.sections.length) return text
  const [todo, doing, done] = DEFAULT_COLUMNS
  let t
  const first = parsed.items[0]
  if (first) {
    const lines = String(text).split(NL)
    lines.splice(first.line, 0, `## ${todo}`, '')
    t = lines.join(NL)
  } else t = addColumn(text, todo)
  t = addColumn(addColumn(t, doing), done)
  for (const item of parseItems(t).items) if (!isOpen(item.status) && item.section === todo) t = moveItem(t, item.id, { section: done })
  return setBoardSettings(t, { done, columns: { [doing]: 'blue', [done]: 'green' } })
}

/** Renames a column, carrying its colour (and done-ness) along */
export function renameColumn(text, from, to) {
  let t = renameSection(text, from, to)
  const s = boardSettings(t)
  if (s.columns[from]) t = setBoardSettings(t, { columns: { [from]: null, [to]: s.columns[from] } })
  if (s.done && same(s.done, from)) t = setBoardSettings(t, { done: to })
  return t
}

/** Removes an empty column's heading */
export function removeColumn(text, name) {
  const { sections, items } = parseItems(text)
  const s = sections.find((x) => x.name === name)
  if (!s) return text
  if (items.some((i) => i.section === name)) throw new RangeError('Move or delete the cards in this column first')
  const lines = String(text).split('\n')
  lines.splice(s.line, 1)
  let t = lines.join('\n').replace(/\n{3,}/g, '\n\n')
  if (boardSettings(t).columns[name]) t = setBoardSettings(t, { columns: { [name]: null } })
  return t
}

/** Moves a column (its heading and every line under it) before another, or to the end */
export function moveColumn(text, name, before = null) {
  const lines = String(text).split('\n')
  const { sections } = parseItems(text)
  const i = sections.findIndex((s) => s.name === name)
  if (i < 0 || name === before) return text
  const settings = settingsRange(lines)
  const endOf = (k) => (k + 1 < sections.length ? sections[k + 1].line : settings ? settings[0] : lines.length)
  const block = lines.slice(sections[i].line, endOf(i))
  while (block.length > 1 && !/\S/.test(block[block.length - 1])) block.pop()
  lines.splice(sections[i].line, endOf(i) - sections[i].line)
  const rest = parseItems(lines.join('\n')).sections
  const target = before ? rest.find((s) => s.name === before) : null
  let at = target ? target.line : (settingsRange(lines)?.[0] ?? lines.length)
  if (!target) {
    while (at > 0 && !/\S/.test(lines[at - 1])) at--
    lines.splice(at, 0, '', ...block)
  } else lines.splice(at, 0, ...block, '')
  return lines.join('\n').replace(/\n{3,}/g, '\n\n')
}
