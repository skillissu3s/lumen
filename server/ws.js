// The /ws WebSocket: realtime file-change notices (filtered to what the user may
// read), chat, typing, presence and sync status.
import { WebSocketServer } from 'ws'
import { userFromRequest } from './auth.js'
import { DESKTOP } from './config.js'
import { events as fileEvents, info as fileInfo, list as fileList } from './files.js'
import { canRead } from './access.js'
import { chatEvents, membersOf } from './chat.js'
import { syncEvents, status as syncStatus } from './git.js'

let wss = null
let heartbeat = null
const lastMeta = new Map()

const OPEN = 1

export function attachWs(httpServer) {
  wss = new WebSocketServer({ noServer: true })
  for (const f of fileList()) lastMeta.set(f.path, f.meta)

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

  const canSeeChannel = (user, channel) => {
    const members = membersOf(channel)
    if (!members) return false
    if (members === 'everyone') return true
    return Array.isArray(members) && members.map(String).includes(user.handle)
  }

  wss.on('connection', (ws, req, user) => {
    const entry = { ws, user, alive: true }
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
      if (msg.type === 'typing' && msg.channel && canSeeChannel(user, msg.channel)) {
        broadcast({ type: 'typing', channel: msg.channel, handle: user.handle }, (s) => s !== entry && canSeeChannel(s.user, msg.channel))
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

  fileEvents.on('change', (changes) => {
    const metas = new Map()
    for (const c of changes) {
      const meta = c.deleted ? lastMeta.get(c.path) ?? null : fileInfo(c.path)?.meta ?? null
      metas.set(c.path, meta)
      if (c.deleted) lastMeta.delete(c.path)
      else lastMeta.set(c.path, meta)
    }
    for (const s of sockets) {
      const visible = changes.filter((c) => canRead(s.user, c.path, metas.get(c.path)))
      if (visible.length) send(s.ws, { type: 'files', changes: visible })
    }
  })

  chatEvents.on('message', ({ channel, message, members }) => {
    const can = (u) => members === 'everyone' || (Array.isArray(members) && members.map(String).includes(u.handle))
    broadcast({ type: 'chat', channel, message }, (s) => can(s.user))
  })

  chatEvents.on('channels', () => broadcast({ type: 'channels' }))

  syncEvents.on('status', (st) => broadcast({ type: 'sync', status: st }, (s) => s.user.role === 'admin'))
}

export function closeWs() {
  clearInterval(heartbeat)
  heartbeat = null
  wss?.clients.forEach((c) => c.terminate())
  wss?.close()
  wss = null
}
