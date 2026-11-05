import { test } from 'node:test'
import assert from 'node:assert/strict'
import { copyPath, merge3 } from './merge.js'

const board = (lines, extra = '') => `---
id: b_launch0001
name: Launch${extra}
kanban-plugin: board
---

## To do

${lines.join('\n')}

%% kanban:settings
\`\`\`
{"kanban-plugin":"board"}
\`\`\`
%%
`

const BASE = board(['- [ ] Pricing page 🆔 aaaaaa', '- [ ] Launch email 🆔 bbbbbb', '- [ ] Press kit 🆔 cccccc'])

test('changes to different cards on each side both land', () => {
  const local = BASE.replace('- [ ] Pricing page', '- [x] Pricing page')
  const remote = BASE.replace('Launch email', 'Launch email, short')
  const out = merge3('lists/launch.md', BASE, local, remote)
  assert.equal(out.conflict, false)
  assert.match(out.text, /- \[x\] Pricing page/)
  assert.match(out.text, /Launch email, short/)
})

test('the same field changed on both sides: the server’s wins, and it says so', () => {
  const local = BASE.replace('Press kit', 'Press kit (mine)')
  const remote = BASE.replace('Press kit', 'Press kit (theirs)')
  const out = merge3('lists/launch.md', BASE, local, remote)
  assert.equal(out.conflict, true)
  assert.match(out.text, /Press kit \(theirs\)/)
  assert.doesNotMatch(out.text, /mine/)
})

test('a card added on each side: both kept', () => {
  const local = BASE.replace('- [ ] Press kit 🆔 cccccc', '- [ ] Press kit 🆔 cccccc\n- [ ] Local idea 🆔 dddddd')
  const remote = BASE.replace('- [ ] Press kit 🆔 cccccc', '- [ ] Press kit 🆔 cccccc\n- [ ] Remote idea 🆔 eeeeee')
  const out = merge3('lists/launch.md', BASE, local, remote).text
  assert.match(out, /Local idea/)
  assert.match(out, /Remote idea/)
})

test('deleted on one side and untouched on the other: gone; deleted and changed: kept', () => {
  const noEmail = BASE.replace('- [ ] Launch email 🆔 bbbbbb\n', '')
  assert.doesNotMatch(merge3('lists/launch.md', BASE, noEmail, BASE.replace('Launch', 'Launched')).text, /Launch email/)
  const changed = BASE.replace('Launch email', 'Launch email v2')
  assert.match(merge3('lists/launch.md', BASE, noEmail, changed).text, /Launch email v2/)
})

test('the board’s own fields merge too', () => {
  const local = BASE.replace('name: Launch', 'name: Launch\ncolor: pink')
  const remote = BASE.replace('name: Launch', 'name: Big launch')
  const out = merge3('lists/launch.md', BASE, local, remote).text
  assert.match(out, /^name: Big launch$/m)
  assert.match(out, /^color: pink$/m)
})

test('docs merge paragraph edits made in different places', () => {
  const base = '---\nid: d_1\ntitle: Plan\n---\n\nFirst paragraph.\n\nSecond paragraph.\n'
  const local = base.replace('First paragraph.', 'First paragraph, edited here.')
  const remote = base.replace('Second paragraph.', 'Second paragraph, edited there.')
  const out = merge3('docs/plan.md', base, local, remote)
  assert.equal(out.copy, false)
  assert.match(out.text, /edited here/)
  assert.match(out.text, /edited there/)
})

test('a doc made separately in both places is kept twice', () => {
  const out = merge3('docs/plan.md', '', 'mine\n', 'theirs\n')
  assert.equal(out.copy, true)
  assert.equal(out.text, 'theirs\n')
  assert.equal(copyPath('docs/plans/launch.md'), 'docs/plans/launch (this computer).md')
})

test('a plugin’s log keeps the lines both sides added', () => {
  const base = '{"n":1}\n'
  const out = merge3('data/plugins/focus-forest/nikhil/sessions.jsonl', base, `${base}{"n":2}\n`, `${base}{"n":3}\n`)
  assert.equal(out.text, '{"n":1}\n{"n":3}\n{"n":2}\n')
})

test('settings merge key by key', () => {
  const base = '{\n  "theme": "light"\n}\n'
  const out = merge3('users/nikhil/settings.json', base, '{\n  "palette": "paper",\n  "theme": "light"\n}\n', '{\n  "theme": "dark"\n}\n')
  assert.equal(out.text, '{\n  "palette": "paper",\n  "theme": "dark"\n}\n')
})

test('with no common version, two boards’ cards are put together', () => {
  const a = board(['- [ ] One 🆔 aaaaaa'])
  const b = board(['- [ ] Two 🆔 bbbbbb'])
  const out = merge3('lists/launch.md', '', a, b).text
  assert.match(out, /One/)
  assert.match(out, /Two/)
})
