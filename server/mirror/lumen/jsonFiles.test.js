import { test } from 'node:test'
import assert from 'node:assert/strict'
import { channels, messages, prefs, workspace } from './jsonFiles.js'
import { fileKind } from './index.js'

test('preferences: keys sorted at every depth, the same bytes every time', () => {
  const text = prefs.render({ theme: 'dark', calendar: { view: 'week', dayStart: 6 }, accent: 'indigo' })
  assert.equal(text, '{\n  "accent": "indigo",\n  "calendar": {\n    "dayStart": 6,\n    "view": "week"\n  },\n  "theme": "dark"\n}\n')
  assert.equal(prefs.render(prefs.parse(text).data), text)
})

test('lumen.json: version, name, inbox, plugins first; permissions sorted', () => {
  const text = workspace.render({ inbox: 'inbox', name: 'Home', plugins: { 'usage-monitor': { permissions: ['storage', 'notify'], version: '1.0.0' }, 'focus-forest': { version: '1.1.1', permissions: ['tasks:read'] } }, extraThing: true })
  assert.match(text, /^\{\n {2}"version": 1,\n {2}"name": "Home",\n {2}"inbox": "inbox",\n {2}"plugins": \{\n {4}"focus-forest"/)
  assert.match(text, /"notify",\n\s+"storage"/)
  assert.match(text, /"extraThing": true\n\}\n$/)
  assert.equal(workspace.render(workspace.parse(text).data), text)
})

test('channels: one per line, by id', () => {
  const text = channels.render([{ id: 'general', members: 'everyone', name: 'general', created: '2026-10-31T10:00:00Z', by: 'nikhil' }, { id: 'dm-ana-nikhil', dm: true, members: ['ana', 'nikhil'] }])
  assert.equal(text, '[\n  {"id":"dm-ana-nikhil","dm":true,"members":["ana","nikhil"]},\n  {"id":"general","name":"general","members":"everyone","created":"2026-10-31T10:00:00Z","by":"nikhil"}\n]\n')
  assert.equal(channels.render(channels.parse(text).channels), text)
})

test('messages: an old log with edit and delete lines comes out as current state', () => {
  const old = [
    '{"id":"m1x9","at":"2026-10-31T10:02:11.120Z","from":"nikhil","text":"Morning! Plan for today is in **Team**."}',
    '{"id":"m1xa","at":"2026-10-31T10:03:40.002Z","from":"ana","text":"👍","reply":"m1x9"}',
    '{"id":"m1x9","at":"2026-10-31T10:05:00.000Z","from":"nikhil","edit":true,"text":"Morning! Plan is in **Team**."}',
    '{"id":"m1xa","at":"2026-10-31T10:06:00.000Z","from":"ana","deleted":true}',
    'not json',
    '',
  ].join('\n')
  const { messages: list, warnings } = messages.parse(old)
  assert.equal(warnings.length, 1)
  const text = messages.render(list)
  assert.equal(
    text,
    '{"id":"m1x9","at":"2026-10-31T10:02:11.120Z","from":"nikhil","text":"Morning! Plan is in **Team**.","edited":"2026-10-31T10:05:00.000Z"}\n' +
      '{"id":"m1xa","at":"2026-10-31T10:03:40.002Z","from":"ana","deleted":true}\n',
  )
  assert.equal(messages.render(messages.parse(text).messages), text)
})

test('every path in a mirror has a kind, and .sync/ has none', () => {
  assert.deepEqual(fileKind('lists/inbox.md'), { kind: 'board' })
  assert.deepEqual(fileKind('calendars/work.md'), { kind: 'calendar' })
  assert.deepEqual(fileKind('docs/a/b/c.md'), { kind: 'doc' })
  assert.deepEqual(fileKind('ideas/launch.canvas'), { kind: 'idea' })
  assert.deepEqual(fileKind('users/ana/settings.json'), { kind: 'prefs', handle: 'ana' })
  assert.deepEqual(fileKind('chat/general/2026-10.jsonl'), { kind: 'messages', channel: 'general', month: '2026-10' })
  assert.deepEqual(fileKind('plugins/focus-forest/main.js'), { kind: 'plugin_file', plugin: 'focus-forest', file: 'main.js' })
  assert.deepEqual(fileKind('data/plugins/focus-forest/nikhil/sessions.jsonl'), { kind: 'plugin_data', plugin: 'focus-forest', handle: 'nikhil', file: 'sessions.jsonl' })
  assert.equal(fileKind('.sync/manifest.json'), null)
  assert.equal(fileKind('notes.txt'), null)
})
