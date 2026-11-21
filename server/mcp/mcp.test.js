// Agents over MCP (docs/MCP.md), against a real server: tokens and what each
// may do, every tool on a person's candle and workspace, the stdio bridge, and
// sign-ins that last while they're used.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import readline from 'node:readline'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let base = ''
let port = 0
let server = null
let dataDir = ''
let ada = ''
let bob = ''
let crew = null

function freePort() {
  return new Promise((resolve) => {
    const s = net.createServer()
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port
      s.close(() => resolve(p))
    })
  })
}

async function call(cookie, method, url, body) {
  const res = await fetch(base + url, { method, headers: { cookie: cookie || '', 'content-type': 'application/json', 'x-lumen': '1' }, body: body === undefined ? undefined : JSON.stringify(body) })
  const json = await res.json().catch(() => null)
  if (!res.ok) throw Object.assign(new Error(json?.error || String(res.status)), { status: res.status })
  return { json, cookies: res.headers.getSetCookie(), cookie: res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ') }
}

let seq = 0
async function rpc(token, method, params, headers = {}) {
  const res = await fetch(`${base}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }, body: JSON.stringify({ jsonrpc: '2.0', id: ++seq, method, params }) })
  return { status: res.status, body: await res.json().catch(() => null) }
}

/** A tool call → its parsed answer, or { error } when the tool said no */
async function tool(token, name, args = {}) {
  const { body } = await rpc(token, 'tools/call', { name, arguments: args })
  if (body.error) throw new Error(body.error.message)
  const text = body.result.content[0].text
  if (body.result.isError) return { error: text }
  return JSON.parse(text)
}

const agent = async (access, cookie = ada) => (await call(cookie, 'POST', '/api/me/agents', { name: `Claude (${access})`, access })).json

before(async () => {
  port = await freePort()
  base = `http://127.0.0.1:${port}`
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-mcp-'))
  server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(here, '..', 'index.js')], {
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DATA_DIR: dataDir, MAIL_LOG_CODES: '', SMTP_URL: '', SMTP_HOST: '', ADMIN_EMAIL: '', ADMIN_PASSWORD: '', PUBLIC_URL: '' },
    stdio: ['ignore', 'ignore', 'inherit'],
  })
  for (let i = 0; i < 150; i++) {
    try {
      if ((await fetch(`${base}/healthz`)).ok) break
    } catch {
      /* not up yet */
    }
    await sleep(100)
  }
  ada = (await call('', 'POST', '/api/setup', { email: 'ada@example.com', name: 'Ada', password: 'password123' })).cookie
  const inv = (await call(ada, 'POST', '/api/admin/invites', { role: 'member' })).json
  bob = (await call('', 'POST', `/api/invites/${inv.url.split('/invite/')[1]}/accept`, { name: 'Bob', email: 'bob@example.com', password: 'password123' })).cookie
  crew = (await call(ada, 'POST', '/api/spaces', { name: 'Crew' })).json.space
  const link = (await call(ada, 'POST', `/api/spaces/${crew.id}/invites`, {})).json.token
  await call(bob, 'POST', `/api/join/${link}`)
})

after(() => server?.kill())

test('a sign-in lasts while it is used, under a cookie of this server’s own', async () => {
  assert.match(ada, new RegExp(`^lumen_session_${port}=`), 'the cookie carries the port')
  const token = ada.split('=')[1]
  const db = new DatabaseSync(path.join(dataDir, 'lumen.db'))
  const soon = Date.now() + 2 * 86400000
  db.prepare('UPDATE sessions SET expires_at = ?').run(soon)
  const r = await call(ada, 'GET', '/api/info')
  assert.equal(r.json.user.name, 'Ada')
  assert.ok(r.cookies.some((c) => c.startsWith(`lumen_session_${port}=${token}`) && /Max-Age=2592000/i.test(c)), 'the cookie goes out again')
  const row = db.prepare('SELECT expires_at FROM sessions WHERE expires_at > ?').all(soon)
  assert.ok(row.length >= 1, 'the session runs from now')
  // used again within the day: nothing to renew
  assert.equal((await call(ada, 'GET', '/api/info')).cookies.length, 0)
  // a cookie under the old name still signs in, and moves to the new one
  const old = await call(`lumen_session=${token}`, 'GET', '/api/info')
  assert.equal(old.json.user.name, 'Ada')
  assert.ok(old.cookies.some((c) => c.startsWith(`lumen_session_${port}=${token}`)))
  assert.ok(old.cookies.some((c) => /^lumen_session=;/.test(c)))
  db.close()
})

test('tokens: made, listed without the secret, and only good for /mcp', async () => {
  const made = await agent('edit')
  assert.match(made.token, /^lumen_/)
  assert.equal(made.url, `${base}/mcp`)
  const { agents } = (await call(ada, 'GET', '/api/me/agents')).json
  assert.ok(agents.some((a) => a.id === made.agent.id && a.access === 'edit' && !('token' in a)))
  // not the app's own API
  const res = await fetch(`${base}/api/files`, { headers: { authorization: `Bearer ${made.token}` } })
  assert.equal(res.status, 401)
  // no token, a wrong one, another site's page
  assert.equal((await rpc(null, 'ping')).status, 401)
  assert.equal((await rpc('lumen_nope', 'ping')).status, 401)
  assert.equal((await rpc(made.token, 'ping', {}, { origin: 'https://evil.example' })).status, 403)
  assert.equal((await fetch(`${base}/mcp`)).status, 405)
  // for apps that won't let you name a header Authorization
  const viaHeader = await fetch(`${base}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-lumen-token': made.token }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }) })
  assert.equal(viaHeader.status, 200)
  // no OAuth to send an app looking for
  assert.equal((await fetch(`${base}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).headers.get('www-authenticate'), null)
  // revoked: gone
  await call(ada, 'DELETE', `/api/me/agents/${made.agent.id}`)
  assert.equal((await rpc(made.token, 'ping')).status, 401)
})

test('the handshake, and the tools each access level gets', async () => {
  const { token } = await agent('edit')
  const init = (await rpc(token, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } })).body.result
  assert.equal(init.protocolVersion, '2025-06-18')
  assert.equal(init.serverInfo.name, 'lumen')
  assert.match(init.instructions, /@ada/)
  const note = await fetch(`${base}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) })
  assert.equal(note.status, 202)
  const names = (t) => rpc(t, 'tools/list').then((r) => r.body.result.tools.map((x) => x.name))
  const edit = await names(token)
  assert.ok(edit.includes('add_task') && !edit.includes('delete_item'))
  const read = await names((await agent('read')).token)
  assert.ok(read.includes('list_tasks') && !read.includes('add_task'))
  const full = await names((await agent('full')).token)
  assert.ok(full.includes('delete_file'))
  const del = (await rpc(token, 'tools/list')).body.result.tools.find((t) => t.name === 'update_item')
  assert.equal(del.annotations.destructiveHint, true)
})

test('tasks: add (with quick-add words), list, change, complete, move', async () => {
  const { token } = await agent('edit')
  const spaces = await tool(token, 'list_spaces')
  assert.ok(spaces.spaces.some((s) => s.prefix === '' && s.kind === 'candle'))
  assert.ok(spaces.spaces.some((s) => s.prefix === 'workspaces/crew/' && s.name === 'Crew'))
  const { added } = await tool(token, 'add_task', { title: 'Call the bank !high #admin', due: '2026-12-01', time: '10:30', duration_minutes: 15, notes: 'Ask about limits' })
  assert.equal(added.path, 'lists/inbox.md')
  assert.equal(added.status, 'open')
  assert.notEqual(added.column, 'Done', 'a new card goes in the first column, as the app adds them')
  assert.equal(added.priority, 'high')
  assert.deepEqual(added.tags, ['admin'])
  assert.equal(added.date, '2026-12-01')
  const inbox = await tool(token, 'read_file', { path: 'lists/inbox.md' })
  assert.match(inbox.text, /- \[ \] Call the bank #admin ⏫ 📅 2026-12-01 ⏰ 10:30 ⏱ 15m 🆔 \w+\n\s+Ask about limits/)
  const found = await tool(token, 'list_tasks', { search: 'bank' })
  assert.equal(found.tasks.length, 1)
  assert.equal(found.tasks[0].id, added.id)
  const changed = await tool(token, 'update_item', { path: added.path, id: added.id, title: 'Call the bank today', priority: 'none', time: null })
  assert.equal(changed.updated.title, 'Call the bank today')
  assert.equal(changed.updated.priority, undefined)
  assert.equal(changed.updated.time, undefined)
  const sub = await tool(token, 'add_task', { title: 'Find the account number', parent: added.id, quick_add: false })
  assert.equal(sub.added.parent, added.id)
  const done = await tool(token, 'complete_task', { path: added.path, id: added.id })
  assert.equal(done.updated.status, 'done')
  assert.equal((await tool(token, 'list_tasks', { search: 'Call the bank' })).tasks.length, 0)
  assert.equal((await tool(token, 'list_tasks', { search: 'Call the bank', status: 'done' })).tasks.length, 1)
  // to a workspace board, subtask and all
  const board = await tool(token, 'create_board', { name: 'Plan', space: 'Crew', columns: ['Next', 'Later'] })
  assert.equal(board.created, 'workspaces/crew/lists/plan.md')
  const moved = await tool(token, 'move_item', { path: added.path, id: added.id, to: board.created, column: 'Later' })
  assert.equal(moved.moved.column, 'Later')
  const plan = await tool(token, 'read_file', { path: board.created })
  assert.match(plan.text, /## Later\n+- \[x\] Call the bank today[^\n]*\n\s+Ask about limits\n\s+- \[ \] Find the account number/)
  assert.doesNotMatch((await tool(token, 'read_file', { path: 'lists/inbox.md' })).text, /Call the bank/)
  // into the done column: finished; out of it: open again
  const flow = (await tool(token, 'create_board', { name: 'Flow' })).created
  const card = (await tool(token, 'add_task', { title: 'Write the brief', board: flow })).added
  assert.equal(card.column, 'To do')
  assert.equal((await tool(token, 'move_item', { path: flow, id: card.id, column: 'Done' })).moved.status, 'done')
  assert.equal((await tool(token, 'move_item', { path: flow, id: card.id, column: 'Doing' })).moved.status, 'open')
  // Bob sees it in the workspace
  const bobs = (await agent('read', bob)).token
  assert.equal((await tool(bobs, 'list_tasks', { board: board.created, status: 'all' })).tasks.length, 2)
  // a mistake says what to fix
  assert.match((await tool(token, 'update_item', { path: board.created, id: 'nope', title: 'x' })).error, /No item nope/)
  assert.match((await tool(token, 'add_task', { title: 'x', due: 'Friday' })).error, /due must be a date/)
})

test('events and the agenda, repeating ones expanded', async () => {
  const { token } = await agent('edit')
  const cal = await tool(token, 'create_calendar', { name: 'Work', color: 'blue' })
  assert.equal(cal.created, 'calendars/work.md')
  await tool(token, 'add_event', { calendar: cal.created, title: 'Standup', date: '2026-12-07', time: '09:30', duration_minutes: 15, repeats: 'every weekday' })
  await tool(token, 'add_event', { calendar: cal.created, title: 'Offsite', date: '2026-12-09', end_date: '2026-12-10' })
  await tool(token, 'add_task', { title: 'Send the deck', due: '2026-12-08' })
  const { agenda } = await tool(token, 'get_agenda', { from: '2026-12-07', to: '2026-12-11' })
  assert.equal(agenda.filter((o) => o.title === 'Standup').length, 5)
  assert.ok(agenda.some((o) => o.title === 'Send the deck' && o.date === '2026-12-08'))
  assert.ok(agenda.some((o) => o.title === 'Offsite' && o.end_date === '2026-12-10'))
  assert.deepEqual(agenda.map((o) => o.date), [...agenda.map((o) => o.date)].sort())
})

test('docs: create, append, edit exactly, write with the version read', async () => {
  const { token } = await agent('edit')
  const doc = await tool(token, 'create_doc', { title: 'Meeting notes', folder: 'meetings', text: 'First point.' })
  assert.equal(doc.created, 'docs/meetings/meeting-notes.md')
  await tool(token, 'append_to_doc', { path: doc.created, text: '- Second point' })
  await tool(token, 'edit_file', { path: doc.created, find: 'First point.', replace: 'The first point.' })
  const r = await tool(token, 'read_file', { path: doc.created })
  assert.match(r.text, /^---\n(id: \S+\n)?title: Meeting notes\nowner: ada\n---\n\nThe first point\.\n\n- Second point\n$/)
  assert.match((await tool(token, 'write_file', { path: doc.created, text: 'x' })).error, /already exists/)
  assert.match((await tool(token, 'write_file', { path: doc.created, text: 'x', sha: 'old' })).error, /changed since you read it/)
  await tool(token, 'write_file', { path: doc.created, text: '---\ntitle: Meeting notes\n---\n\nRewritten.\n', sha: r.sha })
  assert.match((await tool(token, 'read_file', { path: doc.created })).text, /Rewritten/)
  assert.ok((await tool(token, 'search', { query: 'rewritten' })).results.some((x) => x.path === doc.created))
})

test('what the person can’t do, the agent can’t either', async () => {
  const bobs = (await agent('full', bob)).token
  // Ada's candle isn't Bob's
  assert.match((await tool(bobs, 'read_file', { path: 'shared/ada/lists/inbox.md' })).error, /Nothing you can see/)
  // shared to view: looking yes, changing no
  await call(ada, 'PUT', '/api/files', { path: 'lists/ours.md', text: '---\nname: Ours\nowner: ada\nshare: [bob:view]\n---\n\n- [ ] milk 🆔 o1\n', sha: null })
  assert.equal((await tool(bobs, 'list_tasks', { board: 'shared/ada/lists/ours.md' })).tasks[0].title, 'milk')
  assert.match((await tool(bobs, 'complete_task', { path: 'shared/ada/lists/ours.md', id: 'o1' })).error, /view/i)
})

test('deleting needs full access, and a read-only agent only looks', async () => {
  const made = await agent('edit')
  const { added } = await tool(made.token, 'add_task', { title: 'Throwaway' })
  assert.match((await tool(made.token, 'delete_item', { path: added.path, id: added.id })).error, /can’t delete/)
  await call(ada, 'PATCH', `/api/me/agents/${made.agent.id}`, { access: 'full' })
  assert.equal((await tool(made.token, 'delete_item', { path: added.path, id: added.id })).deleted.title, 'Throwaway')
  const doc = await tool(made.token, 'create_doc', { title: 'Scratch' })
  assert.equal((await tool(made.token, 'delete_file', { path: doc.created })).deleted, doc.created)
  const reader = (await agent('read')).token
  assert.match((await tool(reader, 'add_task', { title: 'x' })).error, /only look/)
})

test('per space: an agent reaches only the spaces it was given, each at its own level', async () => {
  const candle = (await call(ada, 'GET', '/api/spaces')).json.spaces.find((s) => s.kind === 'candle')
  const { token } = (await call(ada, 'POST', '/api/me/agents', { name: 'Planner', access: 'edit', scopes: { [candle.id]: 'read', [crew.id]: 'edit' } })).json
  const { spaces } = await tool(token, 'list_spaces')
  assert.deepEqual(spaces.map((s) => [s.prefix, s.agent_may]).sort(), [['', 'read'], ['workspaces/crew/', 'edit']])
  // looks in the candle, changes only in Crew
  assert.ok((await tool(token, 'list_tasks', { status: 'all' })).tasks.length > 0)
  assert.match((await tool(token, 'add_task', { title: 'Not here' })).error, /may not change your candle/)
  const plan = (await tool(token, 'create_board', { name: 'Scoped', space: 'Crew' })).created
  assert.equal((await tool(token, 'add_task', { title: 'Here', board: plan })).added.path, plan)
  // a workspace left out is out of sight
  const narrow = (await call(ada, 'POST', '/api/me/agents', { name: 'Crew only', access: 'read', scopes: { [crew.id]: 'read' } })).json
  assert.ok((await tool(narrow.token, 'list_files')).files.every((f) => f.path.startsWith('workspaces/crew/')))
  assert.match((await tool(narrow.token, 'read_file', { path: 'lists/inbox.md' })).error, /Nothing you can see/)
  // chat follows the same: no direct messages unless given, and reading isn't writing
  const { channels } = await tool(narrow.token, 'list_channels', { workspace: 'Crew' })
  assert.ok(channels.length && channels.every((c) => !c.direct))
  const general = channels.find((c) => c.name === 'general')
  assert.match((await tool(narrow.token, 'list_channels')).error || '', /direct messages/)
  // changing the spaces later takes effect at once
  await call(ada, 'PATCH', `/api/me/agents/${narrow.agent.id}`, { scopes: null, access: 'edit' })
  assert.ok((await tool(narrow.token, 'send_message', { workspace: 'Crew', channel: general.id, text: 'widened' })).sent)
  await assert.rejects(call(ada, 'POST', '/api/me/agents', { name: 'Bad', access: 'edit', scopes: { nowhere: 'edit' } }), /Unknown space/)
})

test('chat: channels of a workspace, reading and sending', async () => {
  const { token } = await agent('edit')
  const { channels } = await tool(token, 'list_channels', { workspace: 'Crew' })
  const general = channels.find((c) => c.name === 'general')
  assert.ok(general, 'the workspace has #general')
  await tool(token, 'send_message', { workspace: 'Crew', channel: general.id, text: 'Hello from an agent' })
  const { messages } = await tool((await agent('read', bob)).token, 'read_messages', { workspace: general.workspace, channel: general.id })
  assert.ok(messages.some((m) => m.text === 'Hello from an agent' && m.from === 'ada'))
})

test('the stdio bridge passes lines through to /mcp', async () => {
  const { token } = await agent('read')
  const child = spawn(process.execPath, [path.join(here, 'stdio.js')], { env: { ...process.env, LUMEN_URL: base, LUMEN_TOKEN: token }, stdio: ['pipe', 'pipe', 'inherit'] })
  const lines = readline.createInterface({ input: child.stdout })
  const answers = new Map()
  lines.on('line', (l) => {
    const m = JSON.parse(l)
    answers.set(m.id, m)
  })
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } })}\n`)
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`)
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'list_spaces', arguments: {} } })}\n`)
  for (let i = 0; i < 100 && answers.size < 2; i++) await sleep(50)
  child.kill()
  assert.equal(answers.get(1).result.serverInfo.name, 'lumen')
  assert.match(answers.get(2).result.content[0].text, /workspaces\/crew\//)
  assert.equal(answers.size, 2, 'nothing back for the notification')
})
