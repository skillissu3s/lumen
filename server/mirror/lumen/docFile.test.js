import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parse, render } from './docFile.js'

const LAUNCH = `---
id: d_q7x1m4k2p9
title: Launch plan
icon: rocket
color: pink
owner: nikhil
---

# Launch plan

We launch on **12 November**. Everything below has an owner and a date.

## Before

- [x] Pick the date
- [ ] Pricing page
- [ ] Launch email

> Keep the first email short: one link, one sentence.

---

## After

1. Watch sign-ups for a week
2. Write up what we learned
`

const WELCOME = `---
title: Welcome
owner: nikhil
cover: teal
icon: inbox
---
# Welcome to Lumen, Nikhil

Everything here is plain text in your workspace folder (or GitHub repository):

- **Tasks** live in \`lists/*.md\`, one markdown line each — \`- [ ] Call the bank 📅 2026-11-02 ⏰ 10:30\`.
- **Events** live in \`calendars/*.md\` — the same line, without the checkbox.

You can edit any of these files with another editor (Obsidian works well) and Lumen picks the changes up.

- [ ] Call the plumber
- [ ] Buy **milk**

/to`

test('a doc written by Lumen comes back byte for byte', () => {
  const { root, blocks } = parse(LAUNCH, { path: 'docs/plans/launch-plan.md' })
  assert.equal(root.id, 'd_q7x1m4k2p9')
  assert.equal(root.folder, 'plans')
  assert.deepEqual(
    blocks.map((b) => b.type),
    ['heading', 'paragraph', 'heading', 'todo', 'todo', 'todo', 'quote', 'divider', 'heading', 'number', 'number'],
  )
  assert.equal(blocks[3].attrs.checked, true)
  assert.equal(render(root, blocks), LAUNCH)
})

test('the welcome doc keeps every block, and settles after one pass', () => {
  const { root, blocks } = parse(WELCOME, { path: 'docs/welcome.md' })
  assert.equal(root.title, 'Welcome')
  assert.equal(root.folder, '')
  assert.equal(blocks.length, 8)
  assert.equal(blocks.at(-1).text, '/to')
  const once = render(root, blocks)
  // the changes: front matter keys in the profile's order, a blank line after
  // it, and the final newline
  const settled = WELCOME.replace('owner: nikhil\ncover: teal\nicon: inbox\n---\n# Welcome', 'icon: inbox\ncover: teal\nowner: nikhil\n---\n\n# Welcome') + '\n'
  assert.equal(once, settled)
  const again = parse(once, { path: 'docs/welcome.md' })
  assert.equal(render(again.root, again.blocks), once)
})

test('nested lists of mixed kinds, numbering and continuation lines', () => {
  const text = [
    '1. First',
    '   - a bullet under it',
    '     that runs on',
    '   - [ ] a task under it',
    '2. Second',
    '',
    '3. Third, after a gap',
    '',
    '- back to bullets',
    '',
    '5. Starts at five',
    '6. Six',
    '',
  ].join('\n')
  const { root, blocks } = parse(text)
  assert.deepEqual(
    blocks.map((b) => [b.type, b.attrs.indent || 0, b.attrs.start || null]),
    [
      ['number', 0, null],
      ['bullet', 1, null],
      ['todo', 1, null],
      ['number', 0, null],
      ['number', 0, null],
      ['bullet', 0, null],
      ['number', 0, 5],
    ].concat([['number', 0, null]]),
  )
  assert.equal(blocks[1].text, 'a bullet under it\nthat runs on')
  const once = render(root, blocks)
  const back = parse(once)
  assert.deepEqual(back.blocks, blocks)
  assert.match(once, /^5\. Starts at five\n6\. Six$/m)
})

test('code with backticks inside, quotes, tables and images', () => {
  const text = [
    '```js',
    'const s = `a ``` b`',
    '````',
    'not a fence',
    '````',
    '```',
    '',
    '> one',
    '>',
    '> two',
    '',
    '| a | b |',
    '|---|---|',
    '| 1 | 2 |',
    '',
    '![A chart](https://example.com/chart.png)',
    '',
  ].join('\n')
  const { root, blocks } = parse(text)
  assert.equal(blocks[0].type, 'code')
  assert.equal(blocks[0].attrs.language, 'js')
  const once = render(root, blocks)
  const back = parse(once)
  assert.deepEqual(back.blocks, blocks)
  assert.equal(render(back.root, back.blocks), once)
})

// ---- random docs: parse(render(blocks)) is the blocks ----

function rng(seed) {
  let s = seed >>> 0
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296)
}

function randomDoc(seed) {
  const r = rng(seed)
  const pick = (a) => a[Math.floor(r() * a.length)]
  const words = () => Array.from({ length: 1 + Math.floor(r() * 6) }, () => pick(['plan', '**bold**', 'call', '`code`', 'the', 'launch', '[a link](https://x.y)', 'note'])).join(' ')
  const blocks = []
  let level = 0
  const n = 1 + Math.floor(r() * 25)
  for (let i = 0; i < n; i++) {
    const kind = pick(['paragraph', 'heading', 'bullet', 'number', 'todo', 'quote', 'code', 'divider', 'image', 'bullet', 'todo'])
    const prevList = blocks.length && ['bullet', 'number', 'todo'].includes(blocks.at(-1).type)
    const b = { position: blocks.length, type: kind, attrs: {}, text: '' }
    if (kind === 'paragraph') b.text = r() < 0.2 ? `${words()}\n${words()}` : words()
    if (kind === 'heading') {
      b.attrs.level = 1 + Math.floor(r() * 3)
      b.text = words()
    }
    if (kind === 'quote') b.text = r() < 0.3 ? `${words()}\n\n${words()}` : words()
    if (kind === 'code') {
      if (r() < 0.5) b.attrs.language = pick(['js', 'python'])
      b.text = r() < 0.3 ? 'x = 1\n\ny = `z`' : 'print(1)'
    }
    if (kind === 'image') b.attrs = r() < 0.5 ? { alt: 'pic', url: 'https://example.com/a.png' } : { url: 'https://example.com/b.png' }
    if (['bullet', 'number', 'todo'].includes(kind)) {
      level = prevList ? Math.max(0, Math.min(level + pick([-1, 0, 0, 1]), level + 1)) : 0
      if (level) b.attrs.indent = level
      if (kind === 'todo' && r() < 0.5) b.attrs.checked = true
      b.text = r() < 0.15 ? `${words()}\n${words()}` : words()
    } else level = 0
    blocks.push(b)
  }
  return blocks
}

// numbered items say where a run starts only when it isn't at 1; the rest follow on
const normal = (blocks) => {
  const out = []
  const next = []
  for (const b of blocks) {
    const c = structuredClone(b)
    const list = ['bullet', 'number', 'todo'].includes(c.type)
    const level = c.attrs.indent || 0
    if (!list) next.length = 0
    else next.length = level + 1
    if (c.type === 'number') {
      if (next[level] != null) delete c.attrs.start
      next[level] = 1
    } else if (list) next[level] = null
    out.push(c)
  }
  return out
}

test('random docs survive render then parse', () => {
  for (let seed = 1; seed <= 400; seed++) {
    const blocks = randomDoc(seed)
    const root = { type: 'doc', id: 'd_x', title: 'T', extra: {} }
    const text = render(root, blocks)
    const back = parse(text)
    assert.deepEqual(back.blocks, normal(blocks), `seed ${seed}\n${text}`)
    assert.equal(render(back.root, back.blocks), text, `seed ${seed}`)
  }
})
