// Chat (docs/CANDLES.md): every workspace has its own channels, for its
// members; direct messages between two people live in a place of their own,
// outside any space ('dm'). Either way a place keeps chat/channels.json plus
// one append-only JSONL file per channel per month (see docs/STORAGE.md), so
// edits and deletes are new lines that refer back to an earlier message id.
import { EventEmitter } from 'node:events'
import { db } from './db.js'
import { HttpError, userByHandle } from './auth.js'
import { newId } from '../shared/items.js'
import * as files from './files.js'
import * as spaces from './spaces.js'

export const chatEvents = new EventEmitter()
chatEvents.setMaxListeners(100)

/** Where direct messages live */
export const DMS = 'dm'

const CHANNELS = 'chat/channels.json'
const MAX_TEXT = 4000
const HISTORY = 100

const nowIso = () => new Date().toISOString()
const monthOf = (iso) => String(iso).slice(0, 7)
const monthFile = (channel, month) => `chat/${channel}/${month}.jsonl`
const dirOf = (channel) => `chat/${channel}/`
const place = (space) => files.space(space)

function slugify(name) {
  const s = String(name || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)
  return s || 'channel'
}

const dmId = (a, b) => `dm-${[...[a, b]].sort().join('-')}`

/** May `user` use chat in `space`? → their role there ('dm' for direct messages) */
function roleFor(user, space) {
  if (space === DMS) return 'dm'
  const s = spaces.get(space)
  const role = s && s.kind === 'workspace' && spaces.roleIn(user.id, space)
  if (!role) throw new HttpError(404, 'No such workspace.')
  return role
}

// ---------- channels ----------

const cache = new Map() // space → channel list
const chains = new Map() // space → the last read-modify-write of its list

async function readChannels(space) {
  const r = await place(space).read(CHANNELS)
  if (!r) return []
  try {
    const v = JSON.parse(r.text)
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}

/** Serialized read-modify-write of a place's channel list. `fn` mutates the
 *  array and returns `{ value, changed }`. */
function withChannels(space, fn) {
  const run = (chains.get(space) || Promise.resolve()).then(async () => {
    const list = await readChannels(space)
    const { value, changed } = await fn(list)
    if (changed) {
      await place(space).write(CHANNELS, JSON.stringify(list, null, 2) + '\n', { by: 'chat' })
      cache.set(space, list)
    }
    return value
  })
  chains.set(
    space,
    run.catch(() => {}),
  )
  return run
}

// in a workspace 'everyone' is everyone in it (they got this far by being in it)
function visibleTo(channel, handle) {
  if (!channel) return false
  if (channel.members === 'everyone') return true
  return Array.isArray(channel.members) && channel.members.map(String).includes(handle)
}

/** The channel's members ('everyone' or a list), or null if there is no such channel (for ws typing) */
export function membersOf(space, id) {
  const c = (cache.get(space) || []).find((x) => x.id === id)
  return c ? c.members : null
}

export async function initChat() {
  // keep each place's list fresh if anything rewrites its channels.json
  files.events.on('change', (changes, opts) => {
    if (!opts?.space || !changes.some((c) => c.path === CHANNELS)) return
    readChannels(opts.space)
      .then((list) => cache.set(opts.space, list))
      .catch(() => {})
  })
  cache.set(DMS, await readChannels(DMS))
  for (const s of spaces.allWorkspaces()) cache.set(s.id, await readChannels(s.id))
}

async function getChannelForUser(user, space, id) {
  roleFor(user, space)
  const c = (await readChannels(space)).find((x) => x.id === id)
  if (!c || !visibleTo(c, user.handle)) throw new HttpError(404, 'No such channel.')
  return c
}

async function shapeFor(user, space, c) {
  return {
    id: c.id,
    space,
    name: c.name ?? (c.dm ? c.members.find((h) => h !== user.handle) : null),
    dm: !!c.dm,
    members: c.members,
    by: c.by || null,
    unread: await unread(user, space, c),
    lastAt: await lastActivity(space, c),
  }
}

/** The channels of a workspace you're in (if `space` is one), and your direct messages */
export async function listChannels(user, space) {
  const out = []
  if (space && space !== DMS) for (const c of (await readChannels(space)).filter((x) => visibleTo(x, user.handle))) out.push(await shapeFor(user, space, c))
  for (const c of (await readChannels(DMS)).filter((x) => visibleTo(x, user.handle))) out.push(await shapeFor(user, DMS, c))
  if (space && space !== DMS) roleFor(user, space)
  return out
}

export async function createChannel(user, space, { name, members }) {
  if (space === DMS) throw new HttpError(400, 'Channels belong to a workspace.')
  roleFor(user, space)
  const n = String(name || '').trim()
  if (!n) throw new HttpError(400, 'Give the channel a name.')
  if (n.length > 40) throw new HttpError(400, 'Channel names are 40 characters at most.')
  let memberList = 'everyone'
  if (members != null && members !== 'everyone') {
    if (!Array.isArray(members)) throw new HttpError(400, 'Members must be "everyone" or a list of handles.')
    memberList = [...new Set([user.handle, ...members.map(String).filter(Boolean)])]
  }
  const id = slugify(n)
  const channel = await withChannels(space, (list) => {
    if (list.some((x) => x.id === id)) throw new HttpError(409, 'There is already a channel with that name.')
    const c = { id, name: n, members: memberList, created: nowIso(), by: user.handle }
    list.push(c)
    return { value: c, changed: true }
  })
  chatEvents.emit('channels', { space })
  return { ...channel, space }
}

export async function createDm(user, handle) {
  const other = String(handle || '').trim().replace(/^@/, '')
  if (!other) throw new HttpError(400, 'Say who to message.')
  if (other === user.handle) throw new HttpError(400, 'You can’t message yourself.')
  if (!userByHandle(other)) throw new HttpError(404, 'There’s no one here with that username.')
  const id = dmId(user.handle, other)
  const pair = [user.handle, other].sort().join('\n')
  const channel = await withChannels(DMS, (list) => {
    // by who's in it: a DM made before a rename keeps its old id
    const found = list.find((x) => x.id === id || (x.dm && Array.isArray(x.members) && [...x.members].map(String).sort().join('\n') === pair))
    if (found) return { value: found, changed: false }
    const c = { id, dm: true, members: [user.handle, other].sort(), created: nowIso(), by: user.handle }
    list.push(c)
    return { value: c, changed: true }
  })
  chatEvents.emit('channels', { space: DMS })
  return { ...channel, space: DMS }
}

/** Removes a channel and its messages: whoever made it, or the workspace's owner or admins. A DM stays. */
export async function deleteChannel(user, space, id) {
  const c = await getChannelForUser(user, space, id)
  if (c.dm) throw new HttpError(400, 'Direct messages can’t be deleted.')
  const role = roleFor(user, space)
  if (c.by !== user.handle && role !== 'owner' && role !== 'admin') throw new HttpError(403, 'Only whoever made the channel, or the workspace’s owner and admins, can delete it.')
  await withChannels(space, (list) => {
    const at = list.findIndex((x) => x.id === id)
    if (at >= 0) list.splice(at, 1)
    return { value: null, changed: at >= 0 }
  })
  for (const p of listMonthFiles(space, id)) await place(space).remove(p, { by: 'chat' })
  chatEvents.emit('channels', { space })
  return { ok: true }
}

// ---------- messages ----------

function listMonthFiles(space, channel) {
  const prefix = dirOf(channel)
  return place(space)
    .list()
    .map((f) => f.path)
    .filter((p) => p.startsWith(prefix) && p.endsWith('.jsonl'))
    .sort()
}

/** Folds a channel's month files into a map of id → final message, plus the id
 *  order (oldest first). Edits overwrite text; deletes blank it out. */
async function foldMessages(space, channel) {
  const map = new Map()
  const order = []
  for (const month of listMonthFiles(space, channel)) {
    const r = await place(space).read(month)
    if (!r) continue
    for (const line of r.text.split('\n')) {
      const t = line.trim()
      if (!t) continue
      let o
      try {
        o = JSON.parse(t)
      } catch {
        continue
      }
      if (!o || typeof o.id !== 'string') continue
      if (o.edit) {
        const msg = map.get(o.id)
        if (msg && !msg.deleted) {
          msg.text = o.text
          msg.edited = true
        }
      } else if (o.deleted) {
        const msg = map.get(o.id)
        if (msg) {
          msg.deleted = true
          msg.text = ''
          delete msg.edited
        } else {
          // a log written from the database has each message once, as it is now
          map.set(o.id, { id: o.id, at: o.at, from: o.from, text: '', deleted: true })
          order.push(o.id)
        }
      } else if (!map.has(o.id)) {
        map.set(o.id, { id: o.id, at: o.at, from: o.from, text: o.text, reply: o.reply, ...(o.edited ? { edited: true } : {}) })
        order.push(o.id)
      }
    }
  }
  return { map, order }
}

async function findMessage(space, channel, id) {
  const { map } = await foldMessages(space, channel)
  return map.get(id) || null
}

export async function listMessages(user, space, channel, before) {
  await getChannelForUser(user, space, channel)
  const { map, order } = await foldMessages(space, channel)
  const all = order.map((id) => map.get(id)).filter((m) => !before || m.at < before)
  return { messages: all.slice(-HISTORY), more: all.length > HISTORY }
}

export async function postMessage(user, space, channel, text, reply) {
  const c = await getChannelForUser(user, space, channel)
  const t = String(text || '').trim()
  if (!t) throw new HttpError(400, 'Say something.')
  if (t.length > MAX_TEXT) throw new HttpError(400, 'Messages are 4000 characters at most.')
  if (reply != null && typeof reply !== 'string') throw new HttpError(400, 'Bad reply target.')
  const at = nowIso()
  const message = { id: newId(8), at, from: user.handle, text: t }
  if (reply) message.reply = reply
  await place(space).append(monthFile(channel, monthOf(at)), JSON.stringify(message) + '\n', { by: 'chat' })
  chatEvents.emit('message', { space, channel, message, members: c.members })
  return message
}

export async function editMessage(user, space, channel, id, text) {
  const c = await getChannelForUser(user, space, channel)
  const t = String(text || '').trim()
  if (!t) throw new HttpError(400, 'Say something.')
  if (t.length > MAX_TEXT) throw new HttpError(400, 'Messages are 4000 characters at most.')
  const message = await findMessage(space, channel, id)
  if (!message || message.deleted) throw new HttpError(404, 'That message is gone.')
  if (message.from !== user.handle) throw new HttpError(403, 'You can only edit your own messages.')
  const edit = { id, at: nowIso(), from: user.handle, edit: true, text: t }
  await place(space).append(monthFile(channel, monthOf(edit.at)), JSON.stringify(edit) + '\n', { by: 'chat' })
  const out = { ...message, text: t, edited: true }
  chatEvents.emit('message', { space, channel, message: out, members: c.members })
  return out
}

export async function deleteMessage(user, space, channel, id) {
  const c = await getChannelForUser(user, space, channel)
  const message = await findMessage(space, channel, id)
  if (!message) throw new HttpError(404, 'That message is gone.')
  if (message.deleted) return { ok: true }
  const role = roleFor(user, space)
  if (message.from !== user.handle && role !== 'owner' && role !== 'admin') throw new HttpError(403, 'You can only delete your own messages.')
  const del = { id, at: nowIso(), from: user.handle, deleted: true }
  await place(space).append(monthFile(channel, monthOf(del.at)), JSON.stringify(del) + '\n', { by: 'chat' })
  chatEvents.emit('message', { space, channel, message: { id, at: message.at, from: message.from, text: '', deleted: true }, members: c.members })
  return { ok: true }
}

// ---------- read markers and unread ----------

// markers are kept per place: channel ids repeat between workspaces
const markerOf = (space, channel) => `${space}/${channel}`

function getReadAt(userId, channel) {
  const row = db.prepare('SELECT last_at FROM chat_reads WHERE user_id = ? AND channel = ?').get(userId, channel)
  return row ? row.last_at : null
}

function setReadAt(userId, channel, at) {
  db.prepare('INSERT INTO chat_reads (user_id, channel, last_at) VALUES (?, ?, ?) ON CONFLICT(user_id, channel) DO UPDATE SET last_at = excluded.last_at').run(userId, channel, at)
}

export async function markRead(user, space, channel, at) {
  await getChannelForUser(user, space, channel)
  setReadAt(user.id, markerOf(space, channel), typeof at === 'string' && at ? at : nowIso())
  return { ok: true }
}

const prevMonth = () => {
  const d = new Date(Date.now() - 32 * 86400000)
  return d.toISOString().slice(0, 7)
}

/** Messages from others after this user's read marker, in this and last month. */
async function unread(user, space, channel) {
  const lastAt = getReadAt(user.id, markerOf(space, channel.id))
  const months = [...new Set([nowIso().slice(0, 7), prevMonth()])]
  const seen = new Set()
  for (const m of months) {
    const r = await place(space).read(monthFile(channel.id, m))
    if (!r) continue
    for (const line of r.text.split('\n')) {
      const t = line.trim()
      if (!t) continue
      let o
      try {
        o = JSON.parse(t)
      } catch {
        continue
      }
      if (!o || typeof o.id !== 'string' || o.from === user.handle) continue
      if (!lastAt || o.at > lastAt) seen.add(o.id)
    }
  }
  return seen.size
}

/** The timestamp of the newest line in the channel (last activity). */
async function lastActivity(space, channel) {
  const months = listMonthFiles(space, channel.id)
  for (let i = months.length - 1; i >= 0; i--) {
    const r = await place(space).read(months[i])
    if (!r) continue
    const lines = r.text.split('\n')
    for (let j = lines.length - 1; j >= 0; j--) {
      const t = lines[j].trim()
      if (!t) continue
      try {
        const o = JSON.parse(t)
        if (o.at) return o.at
      } catch {
        continue
      }
    }
  }
  return null
}
