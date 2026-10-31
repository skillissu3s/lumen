// Board edits: cards moving between columns, columns themselves, and the
// board's look. All go through the workspace store as text → text edits.
import { useWorkspace } from '../store/workspace.js'
import { useUI } from '../store/ui.js'
import { addItem, isOpen, moveItem, parseItems, removeItem, insertBlock, updateItem as editItem, newId } from '../../../shared/items.js'
import { addColumn as addCol, archiveCard as archiveIn, archivedOf, boardOf, moveColumn as moveCol, nameLooseColumn, removeColumn as removeCol, renameColumn as renameCol, setBoardSettings, columnize, DEFAULT_COLUMNS } from '../../../shared/board.js'
import { withFrontMatter } from '../../../shared/frontmatter.js'
import { parseQuickAdd } from '../../../shared/quickadd.js'
import { todayIso } from '../../../shared/dates.js'
import { newCanvas, parseCanvas, serializeCanvas } from '../../../shared/canvas.js'
import { uniquePath } from './slug.js'

const ws = () => useWorkspace.getState()
const toast = (m, o) => useUI.getState().toast(m, o)
const edit = (path, fn) => ws().edit(path, fn)

// where a card goes in `column`: its end, or — for the unnamed first column — after its last loose card
function placeIn(text, column) {
  if (column) return { section: column }
  const loose = parseItems(text).items.filter((i) => !i.section)
  return loose.length ? { after: loose[loose.length - 1].id } : { top: true }
}

// a column change can mean a status change: into the done column completes, out of it reopens
function statusFor(text, item, column) {
  const board = boardOf(parseItems(text), text)
  if (board.done && column === board.done && isOpen(item.status)) return 'x'
  if (board.done && column !== board.done && !isOpen(item.status)) return ' '
  return null
}

/** A new card at the end of `column` (null: the unnamed first column). `typed` is read for dates etc. */
export function addCard(path, column, typed, extra = {}) {
  const fields = typeof typed === 'string' ? parseQuickAdd(typed, { today: todayIso() }) : typed
  const clean = Object.fromEntries(Object.entries({ ...fields, ...extra }).filter(([k, v]) => v != null && k !== 'found'))
  const id = newId()
  edit(path, (text) => {
    const board = boardOf(parseItems(text), text)
    const status = board.done && column === board.done ? 'x' : ' '
    let t = addItem(text, { ...clean, status: ' ', id }, placeIn(text, column)).text
    if (status === 'x') t = editItem(t, id, { status: 'x' }).text
    return t
  })
  return id
}

/**
 * Moves a card: to `column` of the board at `toPath`, before the card `before`
 * (or at the end of the column). Crossing into or out of the done column
 * completes or reopens it.
 */
export function moveCard(fromPath, id, toPath, column, before = null) {
  if (fromPath === toPath) {
    edit(fromPath, (text) => {
      const item = parseItems(text).all.get(id)
      if (!item || before === id) return text
      let t = moveItem(text, id, before ? { before } : placeIn(removeItem(text, id).text, column))
      const status = statusFor(t, item, column)
      if (status) t = editItem(t, id, { status }).text
      return t
    })
    return
  }
  let block = null
  let wasOpen = true
  edit(fromPath, (text) => {
    const item = parseItems(text).all.get(id)
    wasOpen = item ? isOpen(item.status) : true
    const r = removeItem(text, id)
    block = r.block
    return r.text
  })
  edit(toPath, (text) => {
    let t = insertBlock(text, block, before ? { before } : placeIn(text, column))
    const status = statusFor(t, { status: wasOpen ? ' ' : 'x' }, column)
    if (status) t = editItem(t, id, { status }).text
    return t
  })
}

// ---------- columns ----------

export const addColumn = (path, name) => edit(path, (t) => addCol(t, name))
export const renameColumn = (path, from, to) => edit(path, (t) => renameCol(t, from, to))
export const moveColumn = (path, name, before) => edit(path, (t) => moveCol(t, name, before))
export function removeColumn(path, name) {
  try {
    edit(path, (t) => removeCol(t, name))
  } catch (e) {
    toast(e.message, { tone: 'danger' })
  }
}
export const setColumnColor = (path, name, color) => edit(path, (t) => setBoardSettings(t, { columns: { [name]: color } }))
export const setDoneColumn = (path, name) => edit(path, (t) => setBoardSettings(t, { done: name }))
export const setLabelColor = (path, tag, color) => edit(path, (t) => setBoardSettings(t, { labels: { [tag]: color } }))
export const setCover = (path, id, color) => edit(path, (t) => setBoardSettings(t, { covers: { [id]: color } }))

// ---------- boards ----------

/** A new board file with the usual three columns. Returns its path. */
export function createBoard({ name, color = 'blue', icon = 'kanban', share = null, columns = DEFAULT_COLUMNS }) {
  const state = ws()
  const path = uniquePath('lists', name, 'md', state.paths)
  const head = withFrontMatter({ name, color, icon, owner: state.user?.handle, share, 'kanban-plugin': 'board' }, '')
  const body = columns.map((c) => `## ${c}\n`).join('\n')
  state.createFile(path, `${head}\n${body}`)
  return path
}

// ---- idea boards ----

export function createIdeaBoard({ name, color = 'violet', icon = 'lightbulb', share = null }) {
  const state = ws()
  const path = uniquePath('ideas', name, 'canvas', state.paths)
  state.createFile(path, newCanvas({ name, owner: state.user?.handle, share, color, icon }))
  return path
}

/** Changes an idea board's name, colour, icon or sharing, keeping its cards */
export function updateIdeaMeta(path, patch) {
  const text = ws().files[path]?.text
  if (text == null) return
  const canvas = parseCanvas(text)
  ws().setText(path, serializeCanvas({ ...canvas, lumen: { ...canvas.lumen, ...patch } }))
}

export const deleteIdeaBoard = (path) => ws().removeFile(path)

/** Gives a plain list the usual three columns */
export const setUpColumns = (path) => edit(path, (text) => columnize(text))

/** Names the cards above the first heading (the board's unnamed list) */
export const nameLooseList = (path, name) => edit(path, (text) => nameLooseColumn(text, name))

// ---------- the archive ----------

/** Puts a card away; Undo brings it back where it was */
export function archiveCard(path, id) {
  const before = ws().files[path]?.text
  edit(path, (text) => archiveIn(text, id))
  toast('Card archived', { action: { label: 'Undo', run: () => before != null && ws().setText(path, before) }, timeout: 7000 })
}

/** Takes an archived card back to `column` (null: the board's first list) */
export function restoreCard(path, id, column) {
  edit(path, (text) => {
    const { text: rest, block } = removeItem(text, id)
    const to = column ?? boardOf(parseItems(rest), rest).columns.find((c) => c.name)?.name ?? null
    return insertBlock(rest, block, placeIn(rest, to))
  })
}

export const archivedCards = (list, text) => archivedOf(list, text)

/** Deletes a card; Undo puts it back */
export function deleteCard(path, id) {
  const before = ws().files[path]?.text
  edit(path, (text) => removeItem(text, id).text)
  toast('Card deleted', { action: { label: 'Undo', run: () => before != null && ws().setText(path, before) }, timeout: 7000 })
}

// ---------- a list's menu ----------

const SORTS = {
  due: (a, b) => (a.date || '9999').localeCompare(b.date || '9999'),
  priority: (a, b) => rank(b.priority) - rank(a.priority),
  name: (a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }),
}
const rank = (p) => ['lowest', 'low', undefined, 'medium', 'high', 'highest'].indexOf(p ?? undefined)

/** Sorts a list's cards by due date, priority or name */
export function sortColumn(path, column, by) {
  edit(path, (text) => {
    const cards = boardOf(parseItems(text), text).columns.find((c) => c.name === column)?.items || []
    const order = [...cards].sort(SORTS[by])
    let t = text
    // each to the top, last first: the first ends up on top
    for (let i = order.length - 1; i >= 0; i--) {
      const first = boardOf(parseItems(t), t).columns.find((c) => c.name === column).items[0]
      if (first.id !== order[i].id) t = moveItem(t, order[i].id, { before: first.id })
    }
    return t
  })
}

/** Moves every card of one list to the end of another */
export function moveAllCards(path, from, to) {
  edit(path, (text) => {
    let t = text
    const cards = boardOf(parseItems(t), t).columns.find((c) => c.name === from)?.items || []
    for (const c of cards) {
      t = moveItem(t, c.id, placeIn(removeItem(t, c.id).text, to))
      const status = statusFor(t, c, to)
      if (status) t = editItem(t, c.id, { status }).text
    }
    return t
  })
}

/** Archives every card in a list */
export function archiveColumn(path, column) {
  const before = ws().files[path]?.text
  edit(path, (text) => {
    let t = text
    for (const c of boardOf(parseItems(t), t).columns.find((x) => x.name === column)?.items || []) t = archiveIn(t, c.id)
    return t
  })
  toast('List archived', { action: { label: 'Undo', run: () => before != null && ws().setText(path, before) }, timeout: 7000 })
}

/** Deletes a list and its cards; Undo brings both back */
export function deleteColumn(path, column) {
  const before = ws().files[path]?.text
  edit(path, (text) => {
    let t = text
    for (const c of boardOf(parseItems(t), t).columns.find((x) => x.name === column)?.items || []) t = removeItem(t, c.id).text
    return removeCol(t, column)
  })
  toast(`List “${column}” deleted`, { action: { label: 'Undo', run: () => before != null && ws().setText(path, before) }, timeout: 8000 })
}

