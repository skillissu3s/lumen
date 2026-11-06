// One person using Lumen, for the many-people tests (multi.e2e.test.js): the
// app's own store, server backend and socket, run in a process of its own (the
// client keeps one store and one socket per page), with fetch and the socket
// pointed at the test server and signed in with this person's cookie. The test
// drives it over IPC: { seq, cmd, args } in, { seq, ok, value | error } out.

import WS from 'ws'

const base = process.env.LUMEN_BASE
const cookie = process.env.LUMEN_COOKIE
const memory = new Map()
globalThis.localStorage = {
  getItem: (k) => (memory.has(k) ? memory.get(k) : null),
  setItem: (k, v) => memory.set(k, String(v)),
  removeItem: (k) => memory.delete(k),
}
globalThis.window = { location: { protocol: 'http:', host: new URL(base).host, pathname: '/app.html' }, addEventListener() {} }
globalThis.document = { addEventListener() {}, visibilityState: 'visible', documentElement: { dataset: {}, style: { setProperty() {} }, classList: { add() {}, remove() {}, toggle() {} } } }
const realFetch = globalThis.fetch
globalThis.fetch = (url, opts = {}) => realFetch(new URL(String(url), `${base}/`), { ...opts, headers: { ...(opts.headers || {}), cookie } })
globalThis.WebSocket = class extends WS {
  constructor(url) {
    super(url, { headers: { cookie } })
  }
}

const { useWorkspace, onProblem } = await import('../client/src/store/workspace.js')
const { createServerBackend } = await import('../client/src/storage/server.js')
const { connectSocket, socketState } = await import('../client/src/lib/socket.js')
const items = await import('../shared/items.js')

const ws = () => useWorkspace.getState()
const problems = []
onProblem((p) => problems.push(p.message))
const user = JSON.parse(process.env.LUMEN_USER)

const commands = {
  async load() {
    ws().initWorkspace({ backend: createServerBackend(), user, mode: 'server' })
    await ws().load()
    connectSocket()
    for (let i = 0; i < 50 && socketState() !== 'open'; i++) await new Promise((r) => setTimeout(r, 50))
    return ws().status
  },
  // edits, as the app makes them (tree paths: this person stays in their candle)
  add: ({ path, title }) => ws().editAt(path, (t) => items.addItem(t, { title, status: ' ' }).text),
  tick: ({ path, id }) => ws().editAt(path, (t) => items.updateItem(t, id, { status: 'x' }).text),
  type: ({ path, line }) => ws().setTextAt(path, `${ws().tree[path].text.replace(/\n*$/, '\n')}${line}\n`),
  flush: () => ws().flushNow(),
  state: ({ paths }) => ({
    files: Object.fromEntries(paths.map((p) => [p, ws().tree[p]?.text ?? null])),
    has: Object.fromEntries(paths.map((p) => [p, p in ws().tree])),
    pending: ws().saving.pending,
    saving: ws().saving.state,
    problems: [...problems],
  }),
}

process.on('message', async ({ seq, cmd, args }) => {
  try {
    const value = await commands[cmd](args)
    process.send({ seq, ok: true, value: value ?? null })
  } catch (e) {
    process.send({ seq, ok: false, error: e.message })
  }
})
process.send({ ready: true })
