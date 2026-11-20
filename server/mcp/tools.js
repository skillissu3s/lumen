// The tools an AI agent gets (docs/MCP.md). Each works in its person's tree,
// with the same paths the app uses: `lists/…` in their candle,
// `workspaces/<slug>/…` in a workspace, `shared/<owner>/…` for what others
// share. Tasks and events are edited with the shared core's text functions, so
// the files stay exactly as the app writes them.
import * as chat from '../chat.js'
import { DESKTOP } from '../config.js'
import { addItem, updateItem, removeItem, moveItem, insertBlock, parseItems, isOpen, isDone, PRIORITIES } from '../../shared/items.js'
import { parseQuickAdd } from '../../shared/quickadd.js'
import { expand } from '../../shared/calendar.js'
import { withFrontMatter, splitFrontMatter } from '../../shared/frontmatter.js'
import { addDays, todayIso, isIsoDate } from '../../shared/dates.js'
import { DEFAULT_COLUMNS, boardOf } from '../../shared/board.js'
import { ToolError } from './protocol.js'
import { target, readAt, editAt, removeAt, spacesFor, prefixFor, filesFor, itemsFor, kindOf, placeOf } from './tree.js'

const STATUS = { ' ': 'open', '/': 'in_progress', x: 'done', X: 'done', '-': 'cancelled' }
const STATUS_MARK = { open: ' ', in_progress: '/', done: 'x', cancelled: '-' }
const LIMIT = 200

const drop = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && !v.length)))

function itemOut(i) {
  return drop({
    path: i.path,
    id: i.id,
    kind: i.kind,
    title: i.title,
    status: i.kind === 'task' ? STATUS[i.status] || i.status : undefined,
    in: i.source?.name,
    column: i.section,
    date: i.date,
    scheduled: i.scheduled,
    start: i.start,
    end_date: i.endDate,
    time: i.time,
    duration_minutes: i.duration,
    priority: i.priority,
    repeats: i.recurrence,
    location: i.location,
    tags: i.tags,
    notes: i.notes,
    parent: i.parent,
  })
}

function day(v, what) {
  if (v == null || v === '') return undefined
  if (!isIsoDate(String(v))) throw new ToolError(`${what} must be a date like 2026-11-20.`)
  return String(v)
}

function time(v) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(v))
  if (!m || +m[1] > 23 || +m[2] > 59) throw new ToolError('time must be 24-hour, like 09:30.')
  return `${m[1].padStart(2, '0')}:${m[2]}`
}

/** The item fields an agent may send → the shared core's names (null clears one) */
function fieldsFrom(a) {
  const out = {}
  // left out: unchanged; null or '': cleared
  const put = (key, v, read) => {
    if (v !== undefined) out[key] = v === null || v === '' ? null : read(v)
  }
  put('date', a.due !== undefined ? a.due : a.date, (v) => day(v, 'due'))
  put('scheduled', a.scheduled, (v) => day(v, 'scheduled'))
  put('endDate', a.end_date, (v) => day(v, 'end_date'))
  put('time', a.time, time)
  put('duration', a.duration_minutes, (v) => {
    const n = Math.round(Number(v))
    if (!(n > 0)) throw new ToolError('duration_minutes must be a number of minutes.')
    return n
  })
  put('priority', a.priority, (v) => {
    if (v === 'none') return null
    if (!PRIORITIES.includes(v)) throw new ToolError(`priority is one of ${PRIORITIES.join(', ')}, or none.`)
    return v
  })
  put('recurrence', a.repeats, String)
  put('location', a.location, String)
  if (a.notes !== undefined) out.notes = a.notes === null ? '' : String(a.notes)
  return out
}

const slugify = (name) =>
  String(name ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/g, '') || 'untitled'

function freePath(user, dir, name, ext) {
  const taken = new Set(filesFor(user).map((f) => f.path))
  const base = `${dir}/${slugify(name)}`
  let p = `${base}.${ext}`
  for (let n = 2; taken.has(p); n++) p = `${base}-${n}.${ext}`
  return p
}

async function configOf(user, prefix) {
  try {
    return JSON.parse((await readAt(user, `${prefix}lumen.json`)).text)
  } catch {
    return {}
  }
}

/** Where a task goes when the agent names no board: the inbox of your candle */
async function inboxOf(user) {
  const inbox = (await configOf(user, '')).inbox || 'inbox'
  return inbox.includes('/') ? inbox : `lists/${inbox}.md`
}

/** Where an event goes when the agent names no calendar: your default calendar */
async function calendarOf(user) {
  const mine = filesFor(user).filter((f) => placeOf(f.path) === '' && kindOf(f.path) === 'calendar')
  for (const f of mine) {
    const { meta } = splitFrontMatter((await readAt(user, f.path)).text)
    if (meta.default === true || meta.default === 'true') return f.path
  }
  return mine[0]?.path || 'calendars/personal.md'
}

function needItemFile(path) {
  if (!['board', 'calendar'].includes(kindOf(path))) throw new ToolError(`${path} isn’t a board or a calendar.`)
  return kindOf(path) === 'calendar'
}

/** Where a new card goes on a board, as the app adds them: the end of `column`, else of the first column */
function placeOnBoard(text, column) {
  if (column) return { section: String(column) }
  const first = boardOf(parseItems(text), text).columns[0]
  if (!first) return {}
  if (first.name) return { section: first.name }
  return first.items.length ? { after: first.items.at(-1).id } : { top: true }
}

/** A card in the done column is finished, and one taken out of it is open again (as on the board) */
function settleColumn(text, id) {
  const parsed = parseItems(text)
  const item = parsed.all.get(id)
  const { done } = boardOf(parsed, text)
  if (!item || item.parent || !done) return text
  if (item.section === done && isOpen(item.status)) return updateItem(text, id, { status: 'x' }).text
  if (item.section !== done && isDone(item.status)) return updateItem(text, id, { status: ' ' }).text
  return text
}

async function itemAt(user, path, id) {
  const events = needItemFile(path)
  const item = parseItems((await readAt(user, path)).text, { events }).all.get(String(id))
  if (!item) throw new ToolError(`No item ${id} in ${path}. list_tasks gives the ids.`)
  return { item, events }
}

/** A workspace as the agent names it (name, prefix or id) → the chat place; nothing → direct messages */
function chatPlace(user, workspace) {
  if (DESKTOP) throw new ToolError('Chat is only on a Lumen server.')
  if (workspace == null || workspace === '' || workspace === chat.DMS) return chat.DMS
  const { spaces } = spacesFor(user)
  const m = spaces.find((s) => s.space === workspace) || spaces.find((s) => s.prefix === prefixFor(user, workspace))
  if (m.kind !== 'workspace') throw new ToolError('Chat channels belong to a workspace; leave workspace out for direct messages.')
  return m.space
}

async function update(a, { user }) {
  const { events } = await itemAt(user, a.path, a.id)
  const patch = fieldsFrom(a)
  if (a.title !== undefined) patch.title = String(a.title).trim()
  if (a.status !== undefined) {
    if (events) throw new ToolError('Events have no status.')
    patch.status = STATUS_MARK[a.status]
  }
  if (!Object.keys(patch).length) throw new ToolError('Nothing to change.')
  let next = null
  const r = await editAt(user, a.path, (text) => {
    const out = updateItem(text, String(a.id), patch, { events })
    next = out.next
    return out.text
  })
  const all = parseItems(r.text, { events }).all
  return drop({ updated: itemOut({ ...all.get(String(a.id)), path: r.path }), next: next ? itemOut({ ...all.get(next), path: r.path }) : undefined })
}

const str = (description, extra = {}) => ({ type: 'string', description, ...extra })
const PATH = str('A path from list_files, e.g. lists/inbox.md or workspaces/crew/lists/plan.md')
const SPACE = str('Which space: a name or prefix from list_spaces. Leave out for your own candle.')
const ITEM_FIELDS = {
  due: str('Due date, YYYY-MM-DD (null clears it)', { type: ['string', 'null'] }),
  scheduled: str('The day you plan to do it, YYYY-MM-DD (null clears it)', { type: ['string', 'null'] }),
  time: str('Start time, 24-hour HH:MM (null clears it)', { type: ['string', 'null'] }),
  duration_minutes: { type: ['integer', 'null'], description: 'How long it takes, in minutes' },
  priority: { type: ['string', 'null'], enum: [...PRIORITIES, 'none', null] },
  repeats: str('How it repeats, e.g. "every week", "every weekday", "every 2 months" (null stops it)', { type: ['string', 'null'] }),
  notes: str('Notes under it (null clears them)', { type: ['string', 'null'] }),
}
const schema = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false })

const READ = { readOnlyHint: true, openWorldHint: false }
const ADD = { readOnlyHint: false, destructiveHint: false, openWorldHint: false }
const CHANGE = { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false }
const DELETE = { readOnlyHint: false, destructiveHint: true, openWorldHint: false }

export const tools = [
  // ---------- looking ----------
  {
    name: 'list_spaces',
    title: 'List spaces',
    access: 'read',
    description: 'Your candle (private to you), the workspaces you are in, and the boards and calendars others share with you. Each space has a prefix that its paths start with.',
    inputSchema: schema({}),
    annotations: READ,
    run: (a, { user }) => spacesFor(user),
  },
  {
    name: 'list_files',
    title: 'List files',
    access: 'read',
    description: 'Boards, calendars, docs and idea boards you can see, with their paths and names. Filter by kind and space.',
    inputSchema: schema({ kind: { type: 'string', enum: ['board', 'calendar', 'doc', 'idea_board', 'other', 'all'] }, space: SPACE }),
    annotations: READ,
    run: (a, { user }) => {
      const prefix = a.space == null ? null : prefixFor(user, a.space)
      const out = filesFor(user)
        .filter((f) => (prefix == null || placeOf(f.path) === prefix) && (!a.kind || a.kind === 'all' || kindOf(f.path) === a.kind))
        .map((f) => drop({ path: f.path, kind: kindOf(f.path), size: f.size, owner: f.meta?.owner }))
      return { files: out }
    },
  },
  {
    name: 'read_file',
    title: 'Read a file',
    access: 'read',
    description: 'The full text of a board, calendar, doc or other file, and its version (sha). Boards are markdown (## columns, "- [ ] task" lines); docs are markdown.',
    inputSchema: schema({ path: PATH }, ['path']),
    annotations: READ,
    run: (a, { user }) => readAt(user, a.path),
  },
  {
    name: 'list_tasks',
    title: 'List tasks',
    access: 'read',
    description: 'Tasks on your boards (and calendars), with the path and id each change needs. Open ones by default.',
    inputSchema: schema({
      board: str('Only this board or calendar (a path)'),
      space: SPACE,
      status: { type: 'string', enum: ['open', 'done', 'all'], description: 'open (default) includes in progress' },
      due_by: str('Only tasks due on or before this date, YYYY-MM-DD'),
      tag: str('Only tasks with this #tag (without the #)'),
      search: str('Only tasks whose title or notes contain this'),
      limit: { type: 'integer', description: `At most this many (default ${LIMIT})` },
    }),
    annotations: READ,
    run: async (a, { user }) => {
      if (a.board) target(user, a.board)
      const prefix = a.space == null ? null : prefixFor(user, a.space)
      const status = a.status || 'open'
      const due = day(a.due_by, 'due_by')
      const q = a.search ? String(a.search).toLowerCase() : null
      const items = (await itemsFor(user, (p) => (!a.board || p === a.board) && (prefix == null || placeOf(p) === prefix)))
        .filter((i) => i.kind === 'task')
        .filter((i) => status === 'all' || (status === 'open' ? isOpen(i.status) : isDone(i.status)))
        .filter((i) => !due || (i.date && i.date <= due))
        .filter((i) => !a.tag || i.tags?.includes(String(a.tag).replace(/^#/, '')))
        .filter((i) => !q || `${i.title}\n${i.notes || ''}`.toLowerCase().includes(q))
      const limit = Math.min(Math.max(1, a.limit || LIMIT), 1000)
      return { tasks: items.slice(0, limit).map(itemOut), ...(items.length > limit ? { more: items.length - limit } : {}) }
    },
  },
  {
    name: 'get_agenda',
    title: 'Get agenda',
    access: 'read',
    description: 'Everything on your days: events (repeating ones expanded) and dated tasks, from one day to another, in order.',
    inputSchema: schema({ from: str('First day, YYYY-MM-DD (default today)'), to: str('Last day, YYYY-MM-DD (default 6 days after from)'), space: SPACE, include_done: { type: 'boolean' } }),
    annotations: READ,
    run: async (a, { user }) => {
      const from = day(a.from, 'from') || todayIso()
      const to = day(a.to, 'to') || addDays(from, 6)
      if (to < from) throw new ToolError('to comes before from.')
      if (to > addDays(from, 366)) throw new ToolError('Ask for a year at most.')
      const prefix = a.space == null ? null : prefixFor(user, a.space)
      const items = await itemsFor(user, (p) => prefix == null || placeOf(p) === prefix)
      const occs = expand(items, from, to, { showDone: !!a.include_done, ghosts: false })
      occs.sort((x, y) => (x.date === y.date ? (x.time || '').localeCompare(y.time || '') : x.date.localeCompare(y.date)))
      return { from, to, agenda: occs.map((o) => drop({ ...itemOut(o.item), date: o.date, end_date: o.endDate !== o.date ? o.endDate : undefined, time: o.time, all_day: o.allDay || undefined, repeats: o.series ? o.item.recurrence : undefined })) }
    },
  },
  {
    name: 'search',
    title: 'Search',
    access: 'read',
    description: 'Finds text across everything you can see: file names and contents, tasks and events.',
    inputSchema: schema({ query: str('What to look for'), space: SPACE }, ['query']),
    annotations: READ,
    run: async (a, { user }) => {
      const q = String(a.query || '').trim().toLowerCase()
      if (!q) throw new ToolError('Say what to look for.')
      const prefix = a.space == null ? null : prefixFor(user, a.space)
      const out = []
      for (const f of filesFor(user)) {
        if (prefix != null && placeOf(f.path) !== prefix) continue
        const { text } = await readAt(user, f.path)
        const at = text.toLowerCase().indexOf(q)
        if (at < 0 && !f.path.toLowerCase().includes(q)) continue
        const line = at < 0 ? '' : text.slice(text.lastIndexOf('\n', at) + 1, (text.indexOf('\n', at) + 1 || text.length + 1) - 1)
        out.push(drop({ path: f.path, kind: kindOf(f.path), match: line.trim().slice(0, 200) }))
        if (out.length >= 50) break
      }
      return { results: out }
    },
  },

  // ---------- adding and changing ----------
  {
    name: 'add_task',
    title: 'Add a task',
    access: 'edit',
    description: 'Adds a task to a board (your inbox if none is given). The title may carry quick-add words like "tomorrow 5pm", "every monday", "!high" or "#tag"; explicit fields win over them.',
    inputSchema: schema({ title: str('What to do'), board: str('A board path (default: your inbox)'), column: str('Which column (## heading) to put it in; made if missing'), parent: str('Id of a task to put this under, as a subtask'), quick_add: { type: 'boolean', description: 'Read dates and the like from the title (default true)' }, ...ITEM_FIELDS }, ['title']),
    annotations: ADD,
    run: async (a, { user }) => {
      const path = a.board || (await inboxOf(user))
      const events = needItemFile(path)
      const typed = a.quick_add === false ? { title: String(a.title).trim() } : parseQuickAdd(String(a.title), { today: todayIso() })
      const { found, ...guessed } = typed
      const fields = drop({ ...guessed, ...fieldsFrom(a) })
      if (!fields.title) throw new ToolError('Give the task a title.')
      let id
      const r = await editAt(
        user,
        path,
        (text) => {
          const where = a.parent ? { parent: String(a.parent) } : events ? {} : placeOnBoard(text, a.column)
          const out = addItem(text, { ...fields, status: ' ' }, where, { events })
          id = out.id
          return events ? out.text : settleColumn(out.text, id)
        },
        { create: true },
      )
      return { added: itemOut({ ...parseItems(r.text, { events }).all.get(id), path: r.path }) }
    },
  },
  {
    name: 'add_event',
    title: 'Add an event',
    access: 'edit',
    description: 'Adds an event to a calendar (your default calendar if none is given).',
    inputSchema: schema({ title: str('What it is'), date: str('The day, YYYY-MM-DD'), calendar: str('A calendar path (default: your default calendar)'), end_date: str('Last day, for an event over several days'), location: str('Where'), ...ITEM_FIELDS }, ['title', 'date']),
    annotations: ADD,
    run: async (a, { user }) => {
      const path = a.calendar || (await calendarOf(user))
      if (!needItemFile(path)) throw new ToolError(`${path} isn’t a calendar.`)
      const fields = drop({ title: String(a.title).trim(), ...fieldsFrom({ ...a, due: a.date }) })
      if (!fields.title) throw new ToolError('Give the event a title.')
      let id
      const r = await editAt(
        user,
        path,
        (text) => {
          const out = addItem(text, { ...fields, status: null }, {}, { events: true })
          id = out.id
          return out.text
        },
        { create: true },
      )
      return { added: itemOut({ ...parseItems(r.text, { events: true }).all.get(id), path: r.path }) }
    },
  },
  {
    name: 'update_item',
    title: 'Change a task or event',
    access: 'edit',
    description: 'Changes a task or event: its title, status, dates, time, priority, repeat or notes. Send only what changes; null clears a field. Finishing a repeating task adds its next one.',
    inputSchema: schema({ path: PATH, id: str('The item id from list_tasks or get_agenda'), title: str('New title'), status: { type: 'string', enum: ['open', 'in_progress', 'done', 'cancelled'] }, date: str('For an event: its day, YYYY-MM-DD'), end_date: str('Last day (null clears)', { type: ['string', 'null'] }), location: str('Where (null clears)', { type: ['string', 'null'] }), ...ITEM_FIELDS }, ['path', 'id']),
    annotations: CHANGE,
    run: update,
  },
  {
    name: 'complete_task',
    title: 'Complete a task',
    access: 'edit',
    description: 'Marks a task done (or open again with done: false).',
    inputSchema: schema({ path: PATH, id: str('The task id'), done: { type: 'boolean', description: 'false reopens it' } }, ['path', 'id']),
    annotations: { ...CHANGE, destructiveHint: false },
    run: (a, ctx) => update({ path: a.path, id: a.id, status: a.done === false ? 'open' : 'done' }, ctx),
  },
  {
    name: 'move_item',
    title: 'Move a task or event',
    access: 'edit',
    description: 'Moves a task (with its subtasks and notes) to another column, under another task, or to another board or calendar.',
    inputSchema: schema({ path: PATH, id: str('The item id'), to: str('Another board or calendar path (default: the same one)'), column: str('Column to put it in'), parent: str('Id of a task to put it under'), after: str('Id of an item to put it after') }, ['path', 'id']),
    annotations: { ...CHANGE, idempotentHint: false },
    run: async (a, { user }) => {
      const { events } = await itemAt(user, a.path, a.id)
      const where = a.after ? { after: String(a.after) } : a.parent ? { parent: String(a.parent) } : a.column ? { section: String(a.column) } : {}
      const id = String(a.id)
      if (!a.to || a.to === a.path) {
        if (!Object.keys(where).length) throw new ToolError('Say where: a column, a parent, after an item, or another board.')
        const r = await editAt(user, a.path, (text) => {
          const moved = moveItem(text, id, where, { events })
          return events ? moved : settleColumn(moved, id)
        })
        return { moved: itemOut({ ...parseItems(r.text, { events }).all.get(id), path: r.path }) }
      }
      const toEvents = needItemFile(a.to)
      // into the new place first, so nothing is lost if taking it out fails
      const { block } = removeItem((await readAt(user, a.path)).text, id, { events })
      const r = await editAt(
        user,
        a.to,
        (text) => {
          if (toEvents) return insertBlock(text, block, where, { events: true })
          return settleColumn(insertBlock(text, block, Object.keys(where).length ? where : placeOnBoard(text), { events: false }), id)
        },
        { create: true },
      )
      await editAt(user, a.path, (text) => removeItem(text, id, { events }).text)
      return { moved: itemOut({ ...parseItems(r.text, { events: toEvents }).all.get(id), path: r.path }) }
    },
  },
  {
    name: 'create_board',
    title: 'Create a board',
    access: 'edit',
    description: 'Makes a new board with columns (To do, Doing, Done unless you give others).',
    inputSchema: schema({ name: str('The board’s name'), space: SPACE, columns: { type: 'array', items: { type: 'string' } }, share: { type: 'array', items: { type: 'string' }, description: 'In your candle: usernames to share it with; "name:view" may only look' } }, ['name']),
    annotations: ADD,
    run: async (a, { user }) => {
      const prefix = prefixFor(user, a.space)
      const path = freePath(user, `${prefix}lists`, a.name, 'md')
      const head = withFrontMatter({ name: String(a.name).trim(), color: 'blue', icon: 'kanban', owner: user.handle, share: a.share?.length ? a.share : null, 'kanban-plugin': 'board' }, '')
      const columns = a.columns?.length ? a.columns : DEFAULT_COLUMNS
      const r = await editAt(user, path, () => `${head}\n${columns.map((c) => `## ${c}\n`).join('\n')}`, { create: true, sha: null })
      return { created: r.path }
    },
  },
  {
    name: 'create_calendar',
    title: 'Create a calendar',
    access: 'edit',
    description: 'Makes a new calendar for events.',
    inputSchema: schema({ name: str('The calendar’s name'), space: SPACE, color: { type: 'string', enum: ['gray', 'red', 'orange', 'amber', 'green', 'teal', 'blue', 'indigo', 'violet', 'pink'] }, share: { type: 'array', items: { type: 'string' } } }, ['name']),
    annotations: ADD,
    run: async (a, { user }) => {
      const prefix = prefixFor(user, a.space)
      const path = freePath(user, `${prefix}calendars`, a.name, 'md')
      const text = withFrontMatter({ name: String(a.name).trim(), color: a.color || 'blue', owner: user.handle, share: a.share?.length ? a.share : null }, '')
      const r = await editAt(user, path, () => text, { create: true, sha: null })
      return { created: r.path }
    },
  },
  {
    name: 'create_doc',
    title: 'Create a doc',
    access: 'edit',
    description: 'Makes a new doc (a markdown page), optionally in a folder and with its text.',
    inputSchema: schema({ title: str('The doc’s title'), text: str('Its markdown body'), folder: str('A folder under docs/, e.g. "meetings"'), space: SPACE }, ['title']),
    annotations: ADD,
    run: async (a, { user }) => {
      const prefix = prefixFor(user, a.space)
      const folder = String(a.folder || '').split('/').map(slugify).filter((s) => s !== 'untitled').join('/')
      const path = freePath(user, `${prefix}docs${folder ? `/${folder}` : ''}`, a.title, 'md')
      const body = a.text ? `\n${String(a.text).replace(/\n*$/, '\n')}` : ''
      const r = await editAt(user, path, () => withFrontMatter({ title: String(a.title).trim(), owner: user.handle }, body), { create: true, sha: null })
      return { created: r.path }
    },
  },
  {
    name: 'write_file',
    title: 'Write a file',
    access: 'edit',
    description: 'Creates a file or replaces all of its text. To replace an existing file, pass the sha from read_file, so no one else’s newer change is lost. For a small change, edit_file is safer.',
    inputSchema: schema({ path: PATH, text: str('The whole new text'), sha: str('The version you read (needed when the file exists)') }, ['path', 'text']),
    annotations: CHANGE,
    run: async (a, { user }) => {
      const t = target(user, a.path)
      const exists = await readAt(user, t.view).catch(() => null)
      if (exists && !a.sha) throw new ToolError(`${t.view} already exists. Read it, then pass its sha to replace it.`)
      const r = await editAt(user, t.view, () => String(a.text), { create: true, sha: exists ? String(a.sha) : null })
      return { path: r.path, sha: r.sha }
    },
  },
  {
    name: 'edit_file',
    title: 'Edit a file',
    access: 'edit',
    description: 'Replaces exact text in a file: find must appear once (or set all). Good for docs and for board details the other tools don’t cover.',
    inputSchema: schema({ path: PATH, find: str('The exact text to replace'), replace: str('What to put instead'), all: { type: 'boolean', description: 'Replace every match' } }, ['path', 'find', 'replace']),
    annotations: CHANGE,
    run: async (a, { user }) => {
      const find = String(a.find)
      if (!find) throw new ToolError('find can’t be empty.')
      const r = await editAt(user, a.path, (text) => {
        const n = text.split(find).length - 1
        if (!n) throw new ToolError(`That text isn’t in ${a.path}.`)
        if (n > 1 && !a.all) throw new ToolError(`That text is in ${a.path} ${n} times. Give more of it, or set all.`)
        return a.all ? text.split(find).join(String(a.replace)) : text.replace(find, () => String(a.replace))
      })
      return { path: r.path, sha: r.sha }
    },
  },
  {
    name: 'append_to_doc',
    title: 'Add to a doc',
    access: 'edit',
    description: 'Adds text to the end of a doc.',
    inputSchema: schema({ path: PATH, text: str('Markdown to add') }, ['path', 'text']),
    annotations: ADD,
    run: async (a, { user }) => {
      const r = await editAt(user, a.path, (text) => `${text.replace(/\n*$/, '\n\n')}${String(a.text).replace(/\n*$/, '\n')}`)
      return { path: r.path, sha: r.sha }
    },
  },

  // ---------- chat ----------
  {
    name: 'list_channels',
    title: 'List chat channels',
    access: 'read',
    description: 'Chat channels of a workspace, and your direct messages.',
    inputSchema: schema({ workspace: str('A workspace name or prefix; leave out for direct messages only') }),
    annotations: READ,
    run: async (a, { user }) => {
      const names = new Map(spacesFor(user).spaces.map((s) => [s.space, s.name]))
      const channels = await chat.listChannels(user, chatPlace(user, a.workspace))
      return { channels: channels.map((c) => drop({ id: c.id, name: c.name, workspace: c.dm ? undefined : names.get(c.space), direct: c.dm || undefined, members: c.members, unread: c.unread })) }
    },
  },
  {
    name: 'read_messages',
    title: 'Read chat messages',
    access: 'read',
    description: 'The latest messages in a channel.',
    inputSchema: schema({ channel: str('Channel id from list_channels'), workspace: str('Its workspace (leave out for a direct message)') }, ['channel']),
    annotations: READ,
    run: async (a, { user }) => chat.listMessages(user, chatPlace(user, a.workspace), String(a.channel)),
  },
  {
    name: 'send_message',
    title: 'Send a chat message',
    access: 'edit',
    description: 'Posts a message in a channel, as you. People see it at once.',
    inputSchema: schema({ channel: str('Channel id from list_channels'), workspace: str('Its workspace (leave out for a direct message)'), text: str('The message') }, ['channel', 'text']),
    annotations: { ...ADD, openWorldHint: true },
    run: async (a, { user }) => ({ sent: await chat.postMessage(user, chatPlace(user, a.workspace), String(a.channel), a.text) }),
  },

  // ---------- deleting (an agent needs full access) ----------
  {
    name: 'delete_item',
    title: 'Delete a task or event',
    access: 'full',
    description: 'Deletes a task or event, with its subtasks and notes.',
    inputSchema: schema({ path: PATH, id: str('The item id') }, ['path', 'id']),
    annotations: DELETE,
    run: async (a, { user }) => {
      const { item, events } = await itemAt(user, a.path, a.id)
      await editAt(user, a.path, (text) => removeItem(text, String(a.id), { events }).text)
      return { deleted: itemOut({ ...item, path: a.path }) }
    },
  },
  {
    name: 'delete_file',
    title: 'Delete a file',
    access: 'full',
    description: 'Deletes a whole board, calendar, doc or idea board.',
    inputSchema: schema({ path: PATH }, ['path']),
    annotations: DELETE,
    run: async (a, { user }) => ({ deleted: (await removeAt(user, a.path)).path }),
  },
]
