// Turn a plugin's entry HTML + files into a single self-contained srcdoc string:
// inline local scripts/styles, strip dev scripts, and add the sandbox CSP, base
// styles and the SDK. Works on strings (a tiny tokenizer) so it can be tested
// in node without a DOMParser.

import { SDK_SOURCE } from './sdk.js'

// name → value for the attributes of a tag (bare attributes get ''), lower-cased
function attrMap(attrString) {
  const map = {}
  const re = /([a-zA-Z_:][a-zA-Z0-9:_.-]*)(?:\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+)))?/g
  let m
  while ((m = re.exec(attrString))) map[m[1].toLowerCase()] = m[3] ?? m[4] ?? m[5] ?? ''
  return map
}

// one tag: { name (lower), attrs, attrsStr, selfClosing, end } (end = index after '>')
function readTag(html, start) {
  let i = start + 1
  while (i < html.length && /\s/.test(html[i])) i++
  if (html[i] === '/') {
    i++
    while (i < html.length && /\s/.test(html[i])) i++
  }
  const nameStart = i
  while (i < html.length && /[a-zA-Z0-9-]/.test(html[i])) i++
  const name = html.slice(nameStart, i).toLowerCase()
  if (!name) return null
  const attrsStart = i
  while (i < html.length && html[i] !== '>') {
    if (html[i] === '"' || html[i] === "'") {
      const q = html[i]
      i++
      while (i < html.length && html[i] !== q) i++
    }
    if (i < html.length) i++
  }
  if (html[i] !== '>') return null
  let attrsStr = html.slice(attrsStart, i)
  const selfClosing = /\/\s*$/.test(attrsStr)
  if (selfClosing) attrsStr = attrsStr.replace(/\/\s*$/, '')
  return { name, attrs: attrMap(attrsStr), attrsStr, selfClosing, end: i + 1 }
}

// a flat list of tokens: { type: 'text' } | { type: 'raw', name, attrs, attrsStr, value } | { type: 'tag', name, attrs, attrsStr, selfClosing, raw }
function tokenize(html) {
  const tokens = []
  let i = 0
  const n = html.length
  while (i < n) {
    const lt = html.indexOf('<', i)
    if (lt < 0) {
      tokens.push({ type: 'text', value: html.slice(i) })
      break
    }
    if (lt > i) tokens.push({ type: 'text', value: html.slice(i, lt) })
    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt + 4)
      if (end < 0) {
        tokens.push({ type: 'text', value: html.slice(lt) })
        break
      }
      tokens.push({ type: 'text', value: html.slice(lt, end + 3) })
      i = end + 3
      continue
    }
    if (/^<!doctype/i.test(html.slice(lt, lt + 9))) {
      const end = html.indexOf('>', lt)
      if (end < 0) break
      tokens.push({ type: 'text', value: html.slice(lt, end + 1) })
      i = end + 1
      continue
    }
    const tag = readTag(html, lt)
    if (!tag) {
      const end = html.indexOf('>', lt)
      if (end < 0) {
        tokens.push({ type: 'text', value: html.slice(lt) })
        break
      }
      tokens.push({ type: 'text', value: html.slice(lt, end + 1) })
      i = end + 1
      continue
    }
    if (tag.name === 'script' || tag.name === 'style') {
      // 'g' so lastIndex is honoured — otherwise exec always finds the first
      // closing tag in the document and the loop walks backwards forever
      const closing = new RegExp('</' + tag.name + '\\s*>', 'ig')
      closing.lastIndex = tag.end
      const m = closing.exec(html)
      if (!m) {
        tokens.push({ type: 'tag', ...tag, raw: html.slice(lt, tag.end) })
        i = tag.end
        continue
      }
      tokens.push({ type: 'raw', name: tag.name, attrs: tag.attrs, attrsStr: tag.attrsStr, value: html.slice(tag.end, m.index) })
      i = m.index + m[0].length
      continue
    }
    tokens.push({ type: 'tag', ...tag, raw: html.slice(lt, tag.end) })
    i = tag.end
  }
  return tokens
}

// resolve a relative href/src to a file in the plugin's namespace, or null
function resolveFile(files, href) {
  if (typeof href !== 'string' || !href) return null
  const clean = href.split(/[?#]/)[0].trim()
  if (!clean || clean.startsWith('/') || clean.startsWith('//') || /^[a-z]+:/i.test(clean)) return null
  const stack = []
  for (const part of clean.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      stack.pop()
      continue
    }
    stack.push(part)
  }
  const name = stack.join('/')
  if (!name) return null
  return Object.prototype.hasOwnProperty.call(files, name) ? files[name] : null
}

function headBlock(network, theme) {
  const connect = network ? 'https:' : "'none'"
  const csp = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src " + connect + "; base-uri 'none'; form-action 'none'"
  const parts = [
    '<meta http-equiv="Content-Security-Policy" content="' + csp + '">',
    '<meta charset="utf-8">',
    '<style>html,body{margin:0;font-family:var(--font);background:var(--bg);color:var(--text)}</style>',
    '<script>' + SDK_SOURCE + '</script>',
  ]
  if (theme && theme.tokens) {
    const vars = Object.entries(theme.tokens).map(([k, v]) => k + ':' + v).join(';')
    parts.push('<style>:root{' + vars + '}</style>')
  }
  return parts.join('')
}

function injectHead(body, head) {
  const m = /<head[^>]*>/i.exec(body)
  if (m) return body.slice(0, m.index + m[0].length) + head + body.slice(m.index + m[0].length)
  const h = /<html[^>]*>/i.exec(body)
  if (h) return body.slice(0, h.index + h[0].length) + '<head>' + head + '</head>' + body.slice(h.index + h[0].length)
  return '<!doctype html><html><head>' + head + '</head><body>' + body + '</body></html>'
}

/**
 * `buildSrcdoc({ manifest, files, permissions, theme })` → the srcdoc string.
 * `files` is { name: text } for every plugin file; `manifest.entry` names the HTML.
 */
export function buildSrcdoc({ manifest, files = {}, permissions = [], theme = null }) {
  const entry = manifest.entry || 'index.html'
  const html = files[entry] ?? ''
  const network = (permissions || []).includes('network')
  const out = []

  for (const t of tokenize(html)) {
    if (t.type === 'text') {
      out.push(t.value)
      continue
    }
    if (t.type === 'raw') {
      if (t.name === 'script') {
        if (t.attrs['data-lumen-dev'] != null) continue
        const src = t.attrs.src
        if (src != null) {
          const text = resolveFile(files, src)
          if (text != null) out.push('<script>' + text + '</script>')
          continue
        }
        out.push('<script' + (t.attrsStr ? ' ' + t.attrsStr : '') + '>' + t.value + '</script>')
        continue
      }
      // style
      const href = t.attrs.href
      if (href != null) {
        const text = resolveFile(files, href)
        if (text != null) out.push('<style>' + text + '</style>')
        continue
      }
      out.push('<style' + (t.attrsStr ? ' ' + t.attrsStr : '') + '>' + t.value + '</style>')
      continue
    }
    // a stylesheet link: inline it (the only tag we transform)
    if (t.name === 'link' && /stylesheet/i.test(t.attrs.rel || '')) {
      const href = t.attrs.href
      if (href != null) {
        const text = resolveFile(files, href)
        if (text != null) out.push('<style>' + text + '</style>')
      }
      continue
    }
    out.push(t.raw)
  }

  return injectHead(out.join(''), headBlock(network, theme))
}
