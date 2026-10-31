// A single WebSocket to the server, with auto-reconnect and a heartbeat.

import { createEmitter } from './emitter.js'

const messages = createEmitter()
const states = createEmitter()

let ws = null
let state = 'closed'
let reconnectDelay = 1000
let reconnectTimer = null
let heartbeatTimer = null
let closedOnPurpose = false

function setState(next) {
  state = next
  states.emit('state', next)
}

function wsUrl() {
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
  const dir = window.location.pathname.replace(/[^/]*$/, '')
  return `${proto}://${window.location.host}${dir}ws`
}

function open() {
  if (typeof WebSocket === 'undefined') return
  setState('connecting')
  ws = new WebSocket(wsUrl())
  ws.onopen = () => {
    setState('open')
    reconnectDelay = 1000
    heartbeatTimer = setInterval(() => sendSocket({ type: 'ping' }), 25000)
  }
  ws.onmessage = (ev) => {
    let msg
    try {
      msg = JSON.parse(ev.data)
    } catch {
      return
    }
    if (msg.type === 'pong') return
    messages.emit(msg.type, msg)
  }
  ws.onclose = () => {
    setState('closed')
    clearInterval(heartbeatTimer)
    ws = null
    if (!closedOnPurpose) {
      reconnectTimer = setTimeout(open, reconnectDelay)
      reconnectDelay = Math.min(reconnectDelay * 2, 15000)
    }
  }
  ws.onerror = () => {}
}

/** Begin connecting (idempotent). */
export function connectSocket() {
  if (ws || closedOnPurpose) {
    closedOnPurpose = false
    if (!ws && !reconnectTimer) open()
    return ws
  }
  open()
  return ws
}

/** Subscribe to a server → client message type. Returns an unsubscribe function. */
export function onSocket(type, fn) {
  messages.on(type, fn)
  return () => messages.off(type, fn)
}

export function sendSocket(msg) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg))
}

export function socketState() {
  return state
}

export function onSocketState(fn) {
  states.on('state', fn)
  return () => states.off('state', fn)
}
