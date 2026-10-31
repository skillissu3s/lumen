// What views call. Every action is a small, optimistic edit through the workspace
// store, built from the pure text→text functions in shared/items.js.

import { useWorkspace } from '../store/workspace.js'
import { useUI } from '../store/ui.js'
import {
  addItem,
  updateItem as editItem,
  removeItem,
  moveItem as moveItemInFile,
  skipOccurrence as skipOcc,
  endSeriesBefore as endSeries,
  parseItems,
  newId,
  insertBlock,
  isDone,
} from '../../../shared/items.js'
import { parseQuickAdd } from '../../../shared/quickadd.js'
import { setFrontMatter, withFrontMatter } from '../../../shared/frontmatter.js'
import { todayIso } from '../../../shared/dates.js'
import { fromIcs, toIcs } from '../../../shared/ics.js'
import { uniquePath, slugify } from './slug.js'

const ws = () => useWorkspace.getState()
const toast = (message, action, tone) => useUI.getState().toast(message, { ...(action ? { action } : {}), ...(tone ? { tone } : {}) })

export function addTask(listPath, typedOrFields, where = {}) {
  const fields = typeof typedOrFields === 'string' ? parseQuickAdd(typedOrFields, { today: todayIso() }) : { ...typedOrFields }
  const id = newId()
  ws().edit(listPath, (text) => addItem(text, { ...fields, status: fields.status === '/' ? '/' : ' ', id }, where).text, { create: true })
  return id
}

export function addEvent(calendarPath, fields) {
  const id = newId()
  ws().edit(calendarPath, (text) => addItem(text, { ...fields, status: null, id }, {}, { events: true }).text, { create: true })
  return id
}

export function updateItem(path, id, patch) {
  const events = path.startsWith('calendars/')
  ws().edit(path, (text) => editItem(text, id, patch, { events }).text)
}

export function toggleTask(path, id) {
  const file = ws().files[path]
  if (!file) return
  const events = path.startsWith('calendars/')
  const item = parseItems(file.text, { events }).all.get(id)
  if (!item) return
  const nextStatus = isDone(item.status) ? ' ' : 'x'
  let nextId = null
  ws().edit(path, (text) => {
    const r = editItem(text, id, { status: nextStatus }, { events })
    nextId = r.next
    return r.text
  })
  if (nextStatus === 'x') {
    toast('Completed', {
      label: 'Undo',
      run: () =>
        ws().edit(path, (text) => {
          let t = editItem(text, id, { status: ' ' }, { events }).text
          if (nextId) t = removeItem(t, nextId, { events }).text
          return t
        }),
    }, 'success')
  }
}

export function deleteItem(path, id) {
  const file = ws().files[path]
  if (!file) return
  const events = path.startsWith('calendars/')
  const parsed = parseItems(file.text, { events })
  const item = parsed.all.get(id)
  if (!item) return
  const siblings = item.parent ? (parsed.all.get(item.parent)?.subtasks || []) : parsed.items
  const idx = siblings.indexOf(item)
  const prevSibling = idx > 0 ? siblings[idx - 1] : null
  const where = prevSibling ? { after: prevSibling.id } : item.parent ? { parent: item.parent } : { top: true }
  let block = null
  ws().edit(path, (text) => {
    const r = removeItem(text, id, { events })
    block = r.block
    return r.text
  })
  toast('Deleted', { label: 'Undo', run: () => ws().edit(path, (text) => insertBlock(text, block, where, { events })) })
}

export function moveItem(path, id, where) {
  const events = path.startsWith('calendars/')
  ws().edit(path, (text) => moveItemInFile(text, id, where, { events }))
}

export function moveItemToFile(fromPath, id, toPath, where) {
  const fromEvents = fromPath.startsWith('calendars/')
  const toEvents = toPath.startsWith('calendars/')
  let block = null
  ws().edit(fromPath, (text) => {
    const r = removeItem(text, id, { events: fromEvents })
    block = r.block
    return r.text
  })
  ws().edit(toPath, (text) => insertBlock(text, block, where, { events: toEvents }), { create: true })
}

export function skipOccurrence(path, id, date) {
  ws().edit(path, (text) => skipOcc(text, id, date, { events: true }))
}

export function endSeriesBefore(path, id, date) {
  ws().edit(path, (text) => endSeries(text, id, date, { events: true }))
}

export function detachOccurrence(path, id, date, patch) {
  ws().edit(path, (text) => {
    const item = parseItems(text, { events: true }).all.get(id)
    if (!item) return text
    const copy = { ...item, id: newId(), date, skip: null, recurrence: null, status: null, ...patch }
    const withCopy = addItem(text, copy, { after: id }, { events: true }).text
    return skipOcc(withCopy, id, date, { events: true })
  })
}

export function createList({ name, color, icon, share } = {}) {
  const path = uniquePath('lists', name, 'md', ws().paths)
  ws().createFile(path, withFrontMatter({ name, color, icon, owner: ws().user?.handle, share }, ''))
  return path
}

export function updateListMeta(path, patch) {
  ws().edit(path, (text) => setFrontMatter(text, patch))
}

export function deleteList(path) {
  ws().removeFile(path)
}

export function createCalendar({ name, color, icon, share, default: isDefault } = {}) {
  const path = uniquePath('calendars', name, 'md', ws().paths)
  ws().createFile(path, withFrontMatter({ name, color, icon, owner: ws().user?.handle, share, default: isDefault }, ''))
  return path
}

export function updateCalendarMeta(path, patch) {
  ws().edit(path, (text) => setFrontMatter(text, patch))
}

export function deleteCalendar(path) {
  ws().removeFile(path)
}

export function createDoc({ title, folder } = {}) {
  const dir = folder ? `docs/${slugify(folder)}` : 'docs'
  const path = uniquePath(dir, title, 'md', ws().paths)
  ws().createFile(path, withFrontMatter({ title, owner: ws().user?.handle }, ''))
  return path
}

export function saveDoc(path, text) {
  ws().setText(path, text)
}

export function renameDoc(path, title) {
  ws().edit(path, (text) => setFrontMatter(text, { title }))
}

export function deleteDoc(path) {
  ws().removeFile(path)
}

export function importIcs(calendarPath, icsText) {
  const { items, warnings } = fromIcs(icsText)
  ws().edit(
    calendarPath,
    (text) => {
      let t = text
      for (const it of items) {
        const { uid, recurrenceId, ...fields } = it
        t = addItem(t, { ...fields, status: null }, {}, { events: true }).text
      }
      return t
    },
    { create: true },
  )
  return { added: items.length, warnings }
}

export function exportIcs(calendarPathOrAll) {
  const all = calendarPathOrAll === 'all' || calendarPathOrAll === '*' || calendarPathOrAll === true
  const items = []
  for (const [path, file] of Object.entries(ws().files)) {
    if (!path.startsWith('calendars/')) continue
    if (!all && path !== calendarPathOrAll) continue
    for (const it of parseItems(file.text, { events: true }).items) items.push({ ...it, path })
  }
  return toIcs(items)
}
