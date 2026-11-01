// Docs (docs/<folders…>/<slug>.md) as files, both ways, for profile lumen/1.
// A doc is stored the way Notion stores one: a row for the doc and a row per
// block. Each list item is its own block with an indent level, so a list is a
// run of blocks. Markdown the blocks don't model (tables, HTML) is kept as a
// `raw` block, verbatim. Pure and deterministic, like the other codecs.

import { splitFrontMatter } from '../../../shared/frontmatter.js'
import { frontMatter } from './frontMatter.js'

const ROOT_KEYS = ['id', 'title', 'icon', 'color', 'cover', 'width', 'owner', 'share']
const LIST = /^(\s*)([-*+]|(\d{1,9})[.)])(?:\s+|$)(?:\[([ xX])\](?:\s+|$))?(.*)$/
const FENCE = /^(\s*)(`{3,}|~{3,})\s*([^`\s]*)\s*$/
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/
const DIVIDER = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/
const IMAGE = /^!\[([^\]]*)\]\(([^)\s]+)\)\s*$/
const LIST_TYPES = new Set(['bullet', 'number', 'todo'])

const width = (s) => s.replace(/\t/g, '    ').length
const sortKeys = (obj) => Object.fromEntries(Object.keys(obj || {}).sort().map((k) => [k, obj[k]]))

/** A doc file → { root, blocks, warnings }. `path` gives the folder. */
export function parse(text, { path = '' } = {}) {
  const src = String(text ?? '').replace(/\r\n?/g, '\n').normalize('NFC')
  const { meta, bodyStart } = splitFrontMatter(src)
  const lines = src.split('\n').slice(bodyStart)
  const root = { type: 'doc', id: typeof meta.id === 'string' && meta.id ? meta.id : null, extra: {} }
  for (const k of ROOT_KEYS) if (k !== 'id' && meta[k] !== undefined && meta[k] !== '') root[k] = meta[k]
  const unknown = Object.keys(meta).filter((k) => !ROOT_KEYS.includes(k))
  if (unknown.length) root.extra.meta = sortKeys(Object.fromEntries(unknown.map((k) => [k, meta[k]])))
  const m = /^docs\/(.+)\/[^/]+\.md$/.exec(path)
  root.folder = m ? m[1] : ''

  const blocks = []
  const push = (b) => blocks.push({ position: blocks.length, ...b })
  // list nesting: the content column of each open item, outermost first
  let stack = []
  let numbering = [] // per level: the number the next item of a run would have
  let i = 0
  const isBlank = (l) => !/\S/.test(l)
  const startsBlock = (l) => FENCE.test(l) || HEADING.test(l) || DIVIDER.test(l) || /^\s{0,3}>/.test(l) || LIST.test(l)
  const endLists = () => {
    stack = []
    numbering = []
  }

  while (i < lines.length) {
    const line = lines[i]
    if (isBlank(line)) {
      i++
      continue
    }
    let f
    if ((f = FENCE.exec(line))) {
      const fence = f[2]
      const body = []
      i++
      while (i < lines.length && !new RegExp(`^\\s*${fence[0] === '`' ? '`' : '~'}{${fence.length},}\\s*$`).test(lines[i])) body.push(lines[i++])
      i++ // the closing fence (or the end of the file)
      endLists()
      push({ type: 'code', attrs: f[3] ? { language: f[3] } : {}, text: body.join('\n') })
      continue
    }
    let h
    if ((h = HEADING.exec(line)) && !/^\s/.test(line)) {
      endLists()
      push({ type: 'heading', attrs: { level: h[1].length }, text: h[2] })
      i++
      continue
    }
    if (DIVIDER.test(line) && !LIST.test(line.replace(/^\s+/, ''))) {
      endLists()
      push({ type: 'divider', attrs: {}, text: '' })
      i++
      continue
    }
    if (/^\s{0,3}>/.test(line)) {
      const body = []
      while (i < lines.length && /^\s{0,3}>/.test(lines[i])) body.push(lines[i++].replace(/^\s{0,3}> ?/, ''))
      endLists()
      push({ type: 'quote', attrs: {}, text: body.join('\n') })
      continue
    }
    let l
    if ((l = LIST.exec(line))) {
      const indent = width(l[1])
      while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop()
      const level = stack.length
      numbering.length = level + 1
      const marker = l[2]
      const content = indent + marker.length + 1
      stack.push({ indent, content })
      const type = l[4] !== undefined ? 'todo' : l[3] !== undefined ? 'number' : 'bullet'
      const attrs = {}
      if (level) attrs.indent = level
      if (type === 'todo' && /[xX]/.test(l[4])) attrs.checked = true
      if (type === 'number') {
        const n = Number(l[3])
        if (numbering[level] == null && n !== 1) attrs.start = n
        numbering[level] = (numbering[level] ?? n) + 1
      } else numbering[level] = null
      // lines that continue the item: indented to its text, not a new item
      const text = [l[5]]
      i++
      while (i < lines.length && !isBlank(lines[i]) && !LIST.test(lines[i]) && width(/^\s*/.exec(lines[i])[0]) >= Math.min(content, indent + 2)) text.push(lines[i++].trim())
      push({ type, attrs, text: text.join('\n') })
      continue
    }
    let img
    if ((img = IMAGE.exec(line.trim()))) {
      endLists()
      push({ type: 'image', attrs: img[1] ? { alt: img[1], url: img[2] } : { url: img[2] }, text: '' })
      i++
      continue
    }
    // a table or HTML: kept as it is
    if (/^\s*(\||<[a-zA-Z!/])/.test(line)) {
      const body = []
      while (i < lines.length && !isBlank(lines[i])) body.push(lines[i++])
      endLists()
      push({ type: 'raw', attrs: {}, text: body.join('\n') })
      continue
    }
    const body = [line]
    i++
    while (i < lines.length && !isBlank(lines[i]) && !startsBlock(lines[i])) body.push(lines[i++])
    endLists()
    push({ type: 'paragraph', attrs: {}, text: body.join('\n').replace(/\s+$/, '') })
  }
  return { root, blocks, warnings: [] }
}

const byPosition = (a, b) => a.position - b.position

/** A doc and its blocks → the file's text */
export function render(root, blocks) {
  const meta = {}
  for (const k of ROOT_KEYS) if (root[k] != null && root[k] !== '') meta[k] = root[k]
  Object.assign(meta, sortKeys(root.extra?.meta))
  const out = []

  const live = blocks.filter((b) => !b.deleted).sort(byPosition)
  let widths = [] // per level: the column where an item's text starts
  let numbering = []
  let prev = null
  for (const b of live) {
    const attrs = b.attrs || {}
    const isList = LIST_TYPES.has(b.type)
    // lists of one kind sit together; everything else is set apart by a blank line
    if (prev) out.push(isList && LIST_TYPES.has(prev.type) && (prev.type === b.type || (prev.attrs?.indent || 0) !== (attrs.indent || 0)) ? null : '')
    if (!isList) {
      widths = []
      numbering = []
    }
    if (b.type === 'heading') out.push(`${'#'.repeat(Math.min(6, Math.max(1, attrs.level || 1)))} ${b.text}`)
    else if (b.type === 'divider') out.push('---')
    else if (b.type === 'quote') out.push(b.text.split('\n').map((l) => (l ? `> ${l}` : '>')).join('\n'))
    else if (b.type === 'code') {
      const longest = Math.max(2, ...[...b.text.matchAll(/`+/g)].map((m) => m[0].length))
      const fence = '`'.repeat(longest + 1)
      out.push(`${fence}${attrs.language || ''}\n${b.text}${b.text ? '\n' : ''}${fence}`)
    } else if (b.type === 'image') out.push(`![${attrs.alt || ''}](${attrs.url || ''})`)
    else if (b.type === 'raw' || b.type === 'paragraph') out.push(b.text)
    else if (isList) {
      const level = Math.min(attrs.indent || 0, widths.length)
      widths.length = level
      numbering.length = level + 1
      const pad = widths.reduce((s, w) => s + w, 0)
      let marker = '-'
      if (b.type === 'number') {
        const n = numbering[level] ?? attrs.start ?? 1
        numbering[level] = n + 1
        marker = `${n}.`
      } else numbering[level] = null
      widths[level] = marker.length + 1
      const box = b.type === 'todo' ? (attrs.checked ? '[x] ' : '[ ] ') : ''
      const [first, ...rest] = String(b.text ?? '').split('\n')
      const cont = ' '.repeat(pad + marker.length + 1)
      out.push(`${' '.repeat(pad)}${marker} ${box}${first}`.replace(/\s+$/, '') + rest.map((r) => `\n${cont}${r}`).join(''))
    }
    prev = b
  }
  const head = frontMatter(meta)
  const body = out.filter((x) => x !== null).join('\n')
  return `${[head, body].filter(Boolean).join('\n\n').replace(/\n+$/, '')}\n`
}
