// Chat lives in the workspace as chat/channels.json plus one append-only JSONL
// file per channel per month (see docs/STORAGE.md). Appending means git sync can
// always merge it (union driver) and edits/deletes are new lines that refer back
// to an earlier message id.
import { EventEmitter } from 'node:events'
import { db } from './db.js'
import { HttpError } from './auth.js'
import { newId } from '../shared/items.js'
import * as files from './files.js'

export const chatEvents = new EventEmitter()
chatEvents.setMaxListeners(100)

const CHANNELS = 'chat/channels.json'
const MAX_TEXT = 4000
const HISTORY = 100

const nowIso = () => new Date().toISOString()
const monthOf = (iso) => String(iso).slice(0, 7)
const monthFile = (channel, month) => `chat/${channel}/${month}.jsonl`
const dirOf = (channel) => `chat/${channel}/`

function slugify(name) {
  const s = String(name || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)
  return s || 'channel'
}

const dmId = (a, b) => `dm-${[...[a, b]].sort().join('-')}`

// ---------- channels ----------

let cache = []
let channelsChain = Promise.resolve()

async function readChannels() {
  const r = await files.read(CHANNELS)
  if (!r) return []
  try {
    const v = JSON.parse(r.text)
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}

function setCache(list) {
  cache = list
}

/** Serialized read-modify-write of the channel list. `fn` mutates the array and
 *  returns `{ value, changed }`. */
function withChannels(fn) {
  const run = channelsChain.then(async () => {
    const list = await readChannels()
    const { value, changed } = await fn(list)
    if (changed) {
      await files.write(CHANNELS, JSON.stringify(list, null, 2) + '\n', { by: 'chat' })
      setCache(list)
    }
    return value
  })
  channelsChain = run.catch(() => {})
  return run
}

function visibleTo(channel, handle) {
  if (!channel) return false
  if (channel.members === 'everyone') return true
  return Array.isArray(channel.members) && channel.members.map(String).includes(handle)
}

/** The channel members ('everyone' or a list), or null if there is no such channel (for ws typing). */
export function membersOf(id) {
  const c = cache.find((x) => x.id === id)
  return c ? c.members : null
}

export async function initChat() {
  setCache(await readChannels())
  // keep the cache fresh if git sync (or anything) rewrites channels.json
  files.events.on('change', (changes) => {
    if (changes.some((c) => c.path === CHANNELS)) readChannels().then(setCache).catch(() => {})
  })
}

async function getChannelForUser(user, id) {
  const c = (await readChannels()).find((x) => x.id === id)
  if (!c || !visibleTo(c, user.handle)) throw new HttpError(404, 'No such channel.')
  return c
}

export async function listChannels(user) {
  const list = (await readChannels()).filter((c) => visibleTo(c, user.handle))
  const out = []
  for (const c of list) out.push({
    id: c.id,
    name: c.name ?? (c.dm ? c.members.find((h) => h !== user.handle) : null),
    dm: !!c.dm,
    members: c.members,
    unread: await unread(user, c),
    lastAt: await lastActivity(c),
  })
  return out
}

export async function createChannel(user, { name, members }) {
  const n = String(name || '').trim()
  if (!n) throw new HttpError(400, 'Give the channel a name.')
  if (n.length > 40) throw new HttpError(400, 'Channel names are 40 characters at most.')
  let memberList = 'everyone'
  if (members != null && members !== 'everyone') {
    if (!Array.isArray(members)) throw new HttpError(400, 'Members must be "everyone" or a list of handles.')
    memberList = [...new Set(members.map(String).filter(Boolean))]
  }
  const id = slugify(n)
  const channel = await withChannels((list) => {
    if (list.some((x) => x.id === id)) throw new HttpError(409, 'There is already a channel with that name.')
    const c = { id, name: n, members: memberList, created: nowIso(), by: user.handle }
    list.push(c)
    return { value: c, changed: true }
  })
  chatEvents.emit('channels')
  return channel
}

export async function createDm(user, handle) {
  const other = String(handle || '').trim()
  if (!other) throw new HttpError(400, 'Say who to message.')
  if (other === user.handle) throw new HttpError(400, 'You can’t message yourself.')
  const id = dmId(user.handle, other)
  const channel = await withChannels((list) => {
    const found = list.find((x) => x.id === id)
    if (found) return { value: found, changed: false }
    const c = { id, dm: true, members: [user.handle, other].sort(), created: nowIso(), by: user.handle }
    list.push(c)
    return { value: c, changed: true }
  })
  chatEvents.emit('channels')
  return channel
}

// ---------- messages ----------

function listMonthFiles(channel) {
  const prefix = dirOf(channel)
  return files
    .list()
    .map((f) => f.path)
    .filter((p) => p.startsWith(prefix) && p.endsWith('.jsonl'))
    .sort()
}

/** Folds a channel's month files into a map of id → final message, plus the id
 *  order (oldest first). Edits overwrite text; deletes blank it out. */
async function foldMessages(channel) {
  const map = new Map()
  const order = []
  for (const month of listMonthFiles(channel)) {
    const r = await files.read(month)
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
        }
      } else if (!map.has(o.id)) {
        map.set(o.id, { id: o.id, at: o.at, from: o.from, text: o.text, reply: o.reply })
        order.push(o.id)
      }
    }
  }
  return { map, order }
}

async function findMessage(channel, id) {
  const { map } = await foldMessages(channel)
  return map.get(id) || null
}

export async function listMessages(user, channel, before) {
  await getChannelForUser(user, channel)
  const { map, order } = await foldMessages(channel)
  const all = order.map((id) => map.get(id)).filter((m) => !before || m.at < before)
  return { messages: all.slice(-HISTORY), more: all.length > HISTORY }
}

export async function postMessage(user, channel, text, reply) {
  const c = await getChannelForUser(user, channel)
  const t = String(text || '').trim()
  if (!t) throw new HttpError(400, 'Say something.')
  if (t.length > MAX_TEXT) throw new HttpError(400, 'Messages are 4000 characters at most.')
  if (reply != null && typeof reply !== 'string') throw new HttpError(400, 'Bad reply target.')
  const at = nowIso()
  const message = { id: newId(8), at, from: user.handle, text: t }
  if (reply) message.reply = reply
  await files.append(monthFile(channel, monthOf(at)), JSON.stringify(message) + '\n', { by: 'chat' })
  chatEvents.emit('message', { channel, message, members: c.members })
  return message
}

export async function editMessage(user, channel, id, text) {
  const c = await getChannelForUser(user, channel)
  const t = String(text || '').trim()
  if (!t) throw new HttpError(400, 'Say something.')
  if (t.length > MAX_TEXT) throw new HttpError(400, 'Messages are 4000 characters at most.')
  const message = await findMessage(channel, id)
  if (!message || message.deleted) throw new HttpError(404, 'That message is gone.')
  if (message.from !== user.handle) throw new HttpError(403, 'You can only edit your own messages.')
  const edit = { id, at: nowIso(), from: user.handle, edit: true, text: t }
  await files.append(monthFile(channel, monthOf(edit.at)), JSON.stringify(edit) + '\n', { by: 'chat' })
  const out = { ...message, text: t, edited: true }
  chatEvents.emit('message', { channel, message: out, members: c.members })
  return out
}

export async function deleteMessage(user, channel, id) {
  const c = await getChannelForUser(user, channel)
  const message = await findMessage(channel, id)
  if (!message) throw new HttpError(404, 'That message is gone.')
  if (message.deleted) return { ok: true }
  if (message.from !== user.handle && user.role !== 'admin') throw new HttpError(403, 'You can only delete your own messages.')
  const del = { id, at: nowIso(), from: user.handle, deleted: true }
  await files.append(monthFile(channel, monthOf(del.at)), JSON.stringify(del) + '\n', { by: 'chat' })
  chatEvents.emit('message', { channel, message: { id, at: message.at, from: message.from, text: '', deleted: true }, members: c.members })
  return { ok: true }
}

// ---------- read markers and unread ----------

function getReadAt(userId, channel) {
  const row = db.prepare('SELECT last_at FROM chat_reads WHERE user_id = ? AND channel = ?').get(userId, channel)
  return row ? row.last_at : null
}

function setReadAt(userId, channel, at) {
  db.prepare('INSERT INTO chat_reads (user_id, channel, last_at) VALUES (?, ?, ?) ON CONFLICT(user_id, channel) DO UPDATE SET last_at = excluded.last_at').run(userId, channel, at)
}

export async function markRead(user, channel, at) {
  await getChannelForUser(user, channel)
  setReadAt(user.id, channel, typeof at === 'string' && at ? at : nowIso())
  return { ok: true }
}

const prevMonth = () => {
  const d = new Date(Date.now() - 32 * 86400000)
  return d.toISOString().slice(0, 7)
}

/** Messages from others after this user's read marker, in this and last month. */
async function unread(user, channel) {
  const lastAt = getReadAt(user.id, channel.id)
  const months = [...new Set([nowIso().slice(0, 7), prevMonth()])]
  const seen = new Set()
  for (const m of months) {
    const r = await files.read(monthFile(channel.id, m))
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
async function lastActivity(channel) {
  const months = listMonthFiles(channel.id)
  for (let i = months.length - 1; i >= 0; i--) {
    const r = await files.read(months[i])
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
