// Files ⇄ rows. Each path in a workspace is one "unit": a board and its cards, a
// doc and its blocks, a person's settings… `save(path, text)` parses the file
// with the lumen/1 codecs and writes only the rows that changed (through the one
// write path, so everything is journaled); `render(path)` turns the rows back
// into the file. This is what lets the app keep reading and writing files while
// the data lives in the database.
//
// A unit's children are stored with ids scoped to it (`<root id>/<card id>`):
// the ids in a file only need to be unique in that file, and a card copied into
// another file by hand can never make two files fight over one row.

import * as L from '../mirror/lumen/index.js'
import { newId } from '../../shared/items.js'

const ROOT_TYPE = { board: 'board', calendar: 'calendar', doc: 'doc', idea: 'idea_board' }
const ROOT_PREFIX = { board: 'b_', calendar: 'c_', doc: 'd_', idea_board: 'i_' }
const CARD_FIELDS = ['priority', 'recurrence', 'start', 'scheduled', 'date', 'time', 'duration', 'location', 'color', 'skip', 'created', 'done', 'cancelled']
const NODE_KNOWN = ['id', 'type', 'text', 'label', 'file', 'url', 'x', 'y', 'width', 'height', 'color', 'style', 'shape', 'ink', 'inkW', 'inkH', 'position']
const EDGE_KNOWN = ['id', 'fromNode', 'fromSide', 'fromEnd', 'toNode', 'toSide', 'toEnd', 'color', 'label', 'position']

const scoped = (rootId, id) => `${rootId}/${id}`
const local = (rootId, rowId) => (rowId && rowId.startsWith(`${rootId}/`) ? rowId.slice(rootId.length + 1) : rowId)
const pickExtra = (obj, known) => Object.fromEntries(Object.entries(obj).filter(([k, v]) => !known.includes(k) && v !== undefined))
const nullish = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v != null))

/**
 * `store`: from records.js. `people`: { idOf(handle), handleOf(id) } — owners
 * are user ids in the database and handles in files.
 */
export function createUnits(store, people, { makeId = newId } = {}) {
  const ownerId = (handle) => (handle ? people.idOf(String(handle)) : '')
  const ownerHandle = (id) => (id ? people.handleOf(id) : undefined)

  // the live root a path belongs to
  const rootAt = (type, path) => store.where(type, 'path', path)[0] || null

  // which id a saved file's root gets: its own, unless another file has it
  function chooseRootId(type, path, fileId) {
    const here = rootAt(type, path)
    if (fileId) {
      const other = store.get(type, fileId)
      if (!other || other.deleted || other.path === path) return { id: fileId, here }
    }
    return { id: here?.id || `${ROOT_PREFIX[type]}${makeId(10)}`, here }
  }

  // writes `rows` as the children of a root, and tombstones the ones not among them
  function replaceChildren(type, column, rootId, rows, keep = () => true) {
    const ids = new Set(rows.map((r) => r.id))
    for (const r of rows) store.write(type, r)
    for (const old of store.where(type, column, rootId)) if (!ids.has(old.id) && keep(old)) store.remove(type, old.id)
  }

  function removeRoot(type, root) {
    const children = { board: [['card', 'root_id']], calendar: [['card', 'root_id']], doc: [['block', 'doc_id']], idea_board: [['idea_node', 'board_id'], ['idea_edge', 'board_id']] }[type] || []
    for (const [t, col] of children) for (const c of store.where(t, col, root.id)) store.remove(t, c.id)
    store.remove(type, root.id)
  }

  // ---- boards and calendars ----

  function saveItems(kind, path, text) {
    const type = ROOT_TYPE[kind]
    const parsed = L.items.parse(text, { kind })
    const { id, here } = chooseRootId(type, path, parsed.root.id)
    if (here && here.id !== id) removeRoot(type, here)
    const r = parsed.root
    const owner = r.owner ? ownerId(r.owner) : here?.owner ?? ''
    const common = { id, owner, name: r.name ?? null, color: r.color ?? null, icon: r.icon ?? null, share: r.share ?? null, path, extra: r.extra }
    if (type === 'board') store.write('board', { ...common, view_mode: r.view ?? null, column_list: r.columns || [], done: r.done ?? null, labels: r.labels || {} })
    else store.write('calendar', { ...common, is_default: r.isDefault ?? null, sections: r.sections || [] })
    // cards without an id get one; ids stay unique within the file
    const seen = new Set()
    const ids = new Map()
    for (const c of parsed.cards) {
      let cid = c.id && !seen.has(c.id) ? c.id : null
      while (!cid || seen.has(cid)) cid = makeId(6)
      seen.add(cid)
      ids.set(c.ref, cid)
    }
    const rows = parsed.cards.map((c) => {
      const row = { id: scoped(id, ids.get(c.ref)), owner, root_type: type, root_id: id, parent: c.parent ? scoped(id, ids.get(c.parent)) : null, col: c.column ?? null, archived: !!c.archived, position: c.position, kind: c.kind, status: c.status ?? null, title: c.title, notes: c.notes || '', end_date: c.endDate ?? null, cover: c.cover ?? null }
      for (const f of CARD_FIELDS) row[f] = c[f] ?? null
      return row
    })
    replaceChildren('card', 'root_id', id, rows, (old) => old.root_type === type)
  }

  function renderItems(kind, root) {
    const cards = store
      .where('card', 'root_id', root.id)
      .filter((c) => c.root_type === root.type || c.root_type === ROOT_TYPE[kind])
      .map((c) => ({ ...nullish({ priority: c.priority, recurrence: c.recurrence, start: c.start, scheduled: c.scheduled, date: c.date, endDate: c.end_date, time: c.time, duration: c.duration, location: c.location, color: c.color, skip: c.skip, created: c.created, done: c.done, cancelled: c.cancelled, cover: c.cover }), id: local(root.id, c.id), parent: c.parent ? local(root.id, c.parent) : null, column: c.col, archived: !!c.archived, position: c.position, kind: c.kind, status: c.status, title: c.title, notes: c.notes || '' }))
    const base = { type: kind, id: root.id, name: root.name ?? undefined, color: root.color ?? undefined, icon: root.icon ?? undefined, owner: ownerHandle(root.owner), share: root.share ?? undefined, extra: root.extra || {} }
    const r = kind === 'board' ? { ...base, view: root.view_mode ?? undefined, columns: root.column_list || [], done: root.done ?? null, labels: root.labels || {} } : { ...base, isDefault: root.is_default ?? undefined, sections: root.sections || [] }
    return L.items.render(r, cards, { kind })
  }

  // ---- docs: blocks keep their rows when their content didn't change ----

  const blockKey = (b) => JSON.stringify([b.type, b.attrs || {}, b.text || ''])

  function saveDoc(path, text) {
    const parsed = L.doc.parse(text, { path })
    const { id, here } = chooseRootId('doc', path, parsed.root.id)
    if (here && here.id !== id) removeRoot('doc', here)
    const r = parsed.root
    const owner = r.owner ? ownerId(r.owner) : here?.owner ?? ''
    store.write('doc', { id, owner, title: r.title ?? null, icon: r.icon ?? null, color: r.color ?? null, cover: r.cover ?? null, width: r.width ?? null, folder: r.folder ?? '', share: r.share ?? null, path, extra: r.extra })
    const old = store.where('block', 'doc_id', id).sort((a, b) => a.position - b.position)
    const byKey = new Map()
    for (const b of old) (byKey.get(blockKey(b)) || byKey.set(blockKey(b), []).get(blockKey(b))).push(b.id)
    const used = new Set()
    const take = (bid) => (bid && !used.has(bid) ? (used.add(bid), bid) : null)
    // same content: the same row; otherwise the row that sat at that place; otherwise a new one
    const chosen = parsed.blocks.map((b) => take((byKey.get(blockKey(b)) || []).find((x) => !used.has(x))))
    const rows = parsed.blocks.map((b, i) => ({ id: chosen[i] || take(old[i]?.id) || scoped(id, makeId(10)), owner, doc_id: id, position: b.position, type: b.type, attrs: b.attrs || {}, text: b.text || '' }))
    replaceChildren('block', 'doc_id', id, rows)
  }

  function renderDoc(root) {
    const blocks = store.where('block', 'doc_id', root.id).map((b) => ({ position: b.position, type: b.type, attrs: b.attrs || {}, text: b.text || '' }))
    return L.doc.render({ type: 'doc', id: root.id, title: root.title ?? undefined, icon: root.icon ?? undefined, color: root.color ?? undefined, cover: root.cover ?? undefined, width: root.width ?? undefined, owner: ownerHandle(root.owner), share: root.share ?? undefined, extra: root.extra || {} }, blocks)
  }

  // ---- idea boards ----

  function saveIdea(path, text) {
    const parsed = L.idea.parse(text)
    const { id, here } = chooseRootId('idea_board', path, parsed.root.id)
    if (here && here.id !== id) removeRoot('idea_board', here)
    const r = parsed.root
    const owner = r.owner ? ownerId(r.owner) : here?.owner ?? ''
    store.write('idea_board', { id, owner, name: r.name ?? null, color: r.color ?? null, icon: r.icon ?? null, share: r.share ?? null, path, extra: r.extra })
    const nodes = parsed.nodes.map((n) => ({ id: scoped(id, n.id), owner, board_id: id, position: n.position, type: n.type ?? null, text: n.text ?? null, label: n.label ?? null, file_ref: n.file ?? null, url: n.url ?? null, x: n.x ?? null, y: n.y ?? null, width: n.width ?? null, height: n.height ?? null, color: n.color ?? null, style: n.style ?? null, shape: n.shape ?? null, ink: n.ink ?? null, ink_w: n.inkW ?? null, ink_h: n.inkH ?? null, extra: pickExtra(n, NODE_KNOWN) }))
    const edges = parsed.edges.map((e) => ({ id: scoped(id, e.id), owner, board_id: id, position: e.position, from_node: e.fromNode, from_side: e.fromSide ?? null, from_end: e.fromEnd ?? null, to_node: e.toNode, to_side: e.toSide ?? null, to_end: e.toEnd ?? null, color: e.color ?? null, label: e.label ?? null, extra: pickExtra(e, EDGE_KNOWN) }))
    replaceChildren('idea_node', 'board_id', id, nodes)
    replaceChildren('idea_edge', 'board_id', id, edges)
  }

  function renderIdea(root) {
    const nodes = store.where('idea_node', 'board_id', root.id).map((n) => ({ ...(n.extra || {}), ...nullish({ id: local(root.id, n.id), type: n.type, text: n.text, label: n.label, file: n.file_ref, url: n.url, x: n.x, y: n.y, width: n.width, height: n.height, color: n.color, style: n.style, shape: n.shape, ink: n.ink, inkW: n.ink_w, inkH: n.ink_h }), position: n.position }))
    const edges = store.where('idea_edge', 'board_id', root.id).map((e) => ({ ...(e.extra || {}), ...nullish({ id: local(root.id, e.id), fromNode: e.from_node, fromSide: e.from_side, fromEnd: e.from_end, toNode: e.to_node, toSide: e.to_side, toEnd: e.to_end, color: e.color, label: e.label }), position: e.position }))
    return L.idea.render({ type: 'idea_board', id: root.id, name: root.name ?? undefined, color: root.color ?? undefined, icon: root.icon ?? undefined, owner: ownerHandle(root.owner), share: root.share ?? undefined, extra: root.extra || {} }, nodes, edges)
  }

  // ---- chat ----

  function saveChannels(text) {
    const rows = L.channels.parse(text).channels.map((c) => ({ id: String(c.id), owner: '', name: c.name ?? null, dm: c.dm ?? null, members: c.members ?? null, created: c.created ?? null, created_by: c.by ?? null, extra: pickExtra(c, ['id', 'name', 'dm', 'members', 'created', 'by']) }))
    const keep = new Set(rows.map((r) => r.id))
    for (const r of rows) store.write('channel', r)
    for (const old of store.all('channel')) if (!keep.has(old.id)) store.remove('channel', old.id)
  }

  const channelsOut = () => store.all('channel').map((c) => ({ ...(c.extra || {}), ...nullish({ id: c.id, name: c.name, dm: c.dm, members: c.members, created: c.created, by: c.created_by }) }))

  const monthRows = (channel, month) => store.where('message', 'channel', channel).filter((m) => String(m.at).startsWith(month))

  function saveMessages(channel, month, text) {
    const rows = L.messages.parse(text).messages.map((m) => ({ id: scoped(channel, m.id), owner: ownerId(m.from), channel, at: m.at ?? null, author: m.from ?? null, text: m.text ?? null, reply: m.reply ?? null, edited: m.edited ?? null, extra: pickExtra(m, ['id', 'at', 'from', 'text', 'reply', 'edited']) }))
    const keep = new Set(rows.map((r) => r.id))
    for (const r of rows) store.write('message', r)
    for (const old of monthRows(channel, month)) if (!keep.has(old.id)) store.remove('message', old.id)
  }

  const messagesOut = (channel, month) => monthRows(channel, month).map((m) => ({ ...(m.extra || {}), ...nullish({ id: local(channel, m.id), at: m.at, from: m.author, text: m.text, reply: m.reply, edited: m.edited }) }))

  // ---- the whole workspace ----

  function kindOf(path) {
    return L.fileKind(path) || { kind: 'other' }
  }

  /** The file at `path`, rendered from the database, or null */
  function render(path) {
    const k = kindOf(path)
    const type = ROOT_TYPE[k.kind]
    if (type) {
      const root = rootAt(type, path)
      if (!root) return null
      if (k.kind === 'doc') return renderDoc(root)
      if (k.kind === 'idea') return renderIdea(root)
      return renderItems(k.kind, root)
    }
    if (k.kind === 'prefs') {
      const row = store.get('prefs', people.idOf(k.handle))
      return row && !row.deleted ? L.prefs.render(row.data || {}) : null
    }
    if (k.kind === 'workspace') {
      const row = store.get('workspace', 'workspace')
      return row && !row.deleted ? L.workspace.render({ ...(row.extra || {}), name: row.name ?? undefined, inbox: row.inbox ?? undefined, plugins: row.plugins || {} }) : null
    }
    if (k.kind === 'plugin_file') {
      const row = store.get('plugin_file', `${k.plugin}/${k.file}`)
      return row && !row.deleted ? row.content : null
    }
    if (k.kind === 'plugin_data') {
      const row = store.get('plugin_data', `${k.plugin}/${people.idOf(k.handle)}/${k.file}`)
      return row && !row.deleted ? row.content : null
    }
    if (k.kind === 'channels') {
      const list = channelsOut()
      return list.length ? L.channels.render(list) : null
    }
    if (k.kind === 'messages') {
      const list = messagesOut(k.channel, k.month)
      return list.length ? L.messages.render(list) : null
    }
    const row = store.get('other_file', path)
    return row && !row.deleted ? row.content : null
  }

  /** Stores the file at `path` as rows; returns the file as it now renders */
  function save(path, text) {
    const k = kindOf(path)
    store.tx(() => {
      if (k.kind === 'board' || k.kind === 'calendar') saveItems(k.kind, path, text)
      else if (k.kind === 'doc') saveDoc(path, text)
      else if (k.kind === 'idea') saveIdea(path, text)
      else if (k.kind === 'prefs') {
        const id = people.idOf(k.handle)
        store.write('prefs', { id, owner: id, data: L.prefs.parse(text).data })
      } else if (k.kind === 'workspace') {
        const { name, inbox, plugins, version, ...rest } = L.workspace.parse(text).data
        store.write('workspace', { id: 'workspace', owner: '', name: name ?? null, inbox: inbox ?? null, plugins: plugins || {}, extra: rest })
      } else if (k.kind === 'plugin_file') store.write('plugin_file', { id: `${k.plugin}/${k.file}`, owner: '', plugin: k.plugin, file: k.file, content: text })
      else if (k.kind === 'plugin_data') {
        const user = people.idOf(k.handle)
        store.write('plugin_data', { id: `${k.plugin}/${user}/${k.file}`, owner: user, plugin: k.plugin, user_id: user, file: k.file, content: text })
      } else if (k.kind === 'channels') saveChannels(text)
      else if (k.kind === 'messages') saveMessages(k.channel, k.month, text)
      else store.write('other_file', { id: path, owner: '', content: text })
    })
    return render(path)
  }

  /** Removes the file at `path`: its rows become tombstones */
  function remove(path) {
    const k = kindOf(path)
    store.tx(() => {
      const type = ROOT_TYPE[k.kind]
      if (type) {
        const root = rootAt(type, path)
        if (root) removeRoot(type, root)
      } else if (k.kind === 'prefs') store.remove('prefs', people.idOf(k.handle))
      else if (k.kind === 'workspace') store.remove('workspace', 'workspace')
      else if (k.kind === 'plugin_file') store.remove('plugin_file', `${k.plugin}/${k.file}`)
      else if (k.kind === 'plugin_data') store.remove('plugin_data', `${k.plugin}/${people.idOf(k.handle)}/${k.file}`)
      else if (k.kind === 'channels') for (const c of store.all('channel')) store.remove('channel', c.id)
      else if (k.kind === 'messages') for (const m of monthRows(k.channel, k.month)) store.remove('message', m.id)
      else store.remove('other_file', path)
    })
  }

  /** Every path the database holds */
  function paths() {
    const out = []
    for (const type of Object.values(ROOT_TYPE)) for (const r of store.all(type)) if (r.path) out.push(r.path)
    for (const r of store.all('prefs')) out.push(`users/${people.handleOf(r.id)}/settings.json`)
    if (store.get('workspace', 'workspace') && !store.get('workspace', 'workspace').deleted) out.push('lumen.json')
    for (const r of store.all('plugin_file')) out.push(`plugins/${r.plugin}/${r.file}`)
    for (const r of store.all('plugin_data')) out.push(`data/plugins/${r.plugin}/${people.handleOf(r.user_id)}/${r.file}`)
    if (store.all('channel').length) out.push('chat/channels.json')
    const months = new Set(store.all('message').map((m) => `chat/${m.channel}/${String(m.at).slice(0, 7)}.jsonl`))
    out.push(...months)
    for (const r of store.all('other_file')) out.push(r.id)
    return [...new Set(out)].sort()
  }

  return { render, save, remove, paths, kindOf }
}
