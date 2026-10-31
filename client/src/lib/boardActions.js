// Board edits: cards moving between columns, columns themselves, and the
// board's look. All go through the workspace store as text → text edits.
import { useWorkspace } from '../store/workspace.js'
import { useUI } from '../store/ui.js'
import { addItem, isOpen, moveItem, parseItems, removeItem, insertBlock, updateItem as editItem, newId } from '../../../shared/items.js'
import { addColumn as addCol, boardOf, moveColumn as moveCol, removeColumn as removeCol, renameColumn as renameCol, setBoardSettings, columnize, DEFAULT_COLUMNS } from '../../../shared/board.js'
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
