// The /ws WebSocket: realtime file-change notices (in each person's own tree,
// view.js, and only what they may read), chat, typing, presence and sync status.
// Each socket remembers which paths its person can see, so that gaining or
// losing access (joining or leaving a workspace, a share given or taken back)
// arrives as files appearing or going.
import { WebSocketServer } from 'ws'
import { userFromRequest } from './auth.js'
import { DESKTOP } from './config.js'
import { events as fileEvents } from './files.js'
import * as view from './view.js'
import { spaceEvents, isCandle, roleIn } from './spaces.js'
import { DMS, chatEvents, membersOf } from './chat.js'
import { syncEvents, status as syncStatus } from './git.js'
import { cloudEvents } from './sync/replica.js'

let wss = null
let heartbeat = null

const OPEN = 1

export function attachWs(httpServer) {
  wss = new WebSocketServer({ noServer: true })

  httpServer.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://x')
    if (url.pathname !== '/ws') {
      socket.destroy()
      return
    }
    const user = userFromRequest(req)
    if (user && DESKTOP) user.desktop = true
    if (!user) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n')
      socket.destroy()
      return
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req, user))
  })

  const sockets = new Set()

  const send = (ws, obj) => {
    if (ws.readyState === OPEN) ws.send(JSON.stringify(obj))
  }
  const broadcast = (obj, filter = () => true) => {
    for (const s of sockets) if (filter(s)) send(s.ws, obj)
  }
  const online = () => [...new Set([...sockets].map((s) => s.user.handle))]

  // a workspace's channel: you're in the workspace, and in the channel; a DM: you're one of the two
  const canSee = (user, space, members) => {
    if (!members) return false
    if (space !== DMS && !roleIn(user.id, space)) return false
    if (members === 'everyone') return true
    return Array.isArray(members) && members.map(String).includes(user.handle)
  }
  const canSeeChannel = (user, space, channel) => canSee(user, space, membersOf(space, channel))

  wss.on('connection', (ws, req, user) => {
    // known: path → sha of every file this person was told about
    const entry = { ws, user, alive: true, known: new Map(view.list(user).map((f) => [f.path, f.sha])) }
    sockets.add(entry)
    broadcast({ type: 'presence', online: online() })
    if (user.role === 'admin') send(ws, { type: 'sync', status: syncStatus() })

    ws.on('pong', () => {
      entry.alive = true
    })
    ws.on('message', (data) => {
      let msg
      try {
        msg = JSON.parse(data.toString())
      } catch {
        return
      }
      if (msg.type === 'ping') return send(ws, { type: 'pong' })
      const space = String(msg.space || DMS)
      if (msg.type === 'typing' && msg.channel && canSeeChannel(user, space, msg.channel)) {
        broadcast({ type: 'typing', space, channel: msg.channel, handle: user.handle }, (s) => s !== entry && canSeeChannel(s.user, space, msg.channel))
      }
    })
    ws.on('close', () => {
      sockets.delete(entry)
      broadcast({ type: 'presence', online: online() })
    })
    ws.on('error', () => {})
  })

  // 30 s heartbeat; a socket that missed two pings is gone
  heartbeat = setInterval(() => {
    for (const s of [...sockets]) {
      if (!s.alive) {
        s.ws.terminate()
        sockets.delete(s)
        continue
      }
      s.alive = false
      s.ws.ping()
    }
  }, 30000)

  // what a person sees now, against what they were told: the difference goes out
  function resync(entry) {
    const now = new Map(view.list(entry.user).map((f) => [f.path, f.sha]))
    const out = []
    for (const [p, sha] of now) if (entry.known.get(p) !== sha) out.push({ path: p, sha, deleted: false })
    for (const p of entry.known.keys()) if (!now.has(p)) out.push({ path: p, sha: null, deleted: true })
    entry.known = now
    if (out.length) send(entry.ws, { type: 'files', changes: out })
  }

  fileEvents.on('change', (changes, opts = {}) => {
    const space = opts.space
    for (const s of sockets) {
      // a change in someone's candle may share or unshare things: look again
      if (space && isCandle(space) && !s.user.desktop && !view.mounts(s.user).some((m) => m.space === space)) {
        resync(s)
        continue
      }
      const cache = view.lookups(s.user)
      const out = []
      for (const c of changes) {
        const p = view.toView(s.user, space, c.path, cache)
        if (!p) continue
        if (c.deleted) s.known.delete(p)
        else s.known.set(p, c.sha)
        out.push({ ...c, path: p })
      }
      if (out.length) send(s.ws, { type: 'files', changes: out })
    }
  })

  // joined, left, removed, a workspace renamed or deleted
  spaceEvents.on('access', (userIds) => {
    const who = new Set(userIds)
    for (const s of sockets) if (who.has(s.user.id)) resync(s)
  })
  // a username changed: shared/<owner>/ paths move for everyone
  fileEvents.on('renamed', () => {
    for (const s of sockets) resync(s)
  })

  chatEvents.on('message', ({ space, channel, message, members }) => {
    broadcast({ type: 'chat', space, channel, message }, (s) => canSee(s.user, space, members))
  })

  chatEvents.on('channels', ({ space } = {}) => broadcast({ type: 'channels', space }, (s) => space === DMS || !space || !!roleIn(s.user.id, space)))

  syncEvents.on('status', (st) => broadcast({ type: 'sync', status: st }, (s) => s.user.role === 'admin'))
  cloudEvents.on('status', (st) => broadcast({ type: 'cloud', status: st }))
}

export function closeWs() {
  clearInterval(heartbeat)
  heartbeat = null
  wss?.clients.forEach((c) => c.terminate())
  wss?.close()
  wss = null
}
