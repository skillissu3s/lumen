// Front matter: the `---` block at the top of a list, calendar or doc file.
// Lumen only writes `key: value` lines and `[a, b]` lists, and keeps every line it
// doesn't understand exactly as it was.

const FENCE = /^---\s*$/

/** Splits a file into { meta, raw (front matter lines), body, bodyStart (line index) } */
export function splitFrontMatter(text) {
  const lines = String(text ?? '').split('\n')
  if (!FENCE.test(lines[0]?.replace(/\r$/, '') ?? '')) return { meta: {}, raw: null, body: String(text ?? ''), bodyStart: 0 }
  let end = -1
  for (let i = 1; i < lines.length; i++) {
    if (FENCE.test(lines[i].replace(/\r$/, ''))) {
      end = i
      break
    }
  }
  if (end < 0) return { meta: {}, raw: null, body: String(text ?? ''), bodyStart: 0 }
  const raw = lines.slice(1, end).map((l) => l.replace(/\r$/, ''))
  return { meta: parseMeta(raw), raw, body: lines.slice(end + 1).join('\n'), bodyStart: end + 1 }
}

function parseValue(v) {
  const s = v.trim()
  if (s === '') return ''
  if (s === 'true') return true
  if (s === 'false') return false
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s)
  if (/^\[.*\]$/.test(s)) {
    const inner = s.slice(1, -1).trim()
    return inner ? inner.split(',').map((x) => unquote(x.trim())).filter((x) => x !== '') : []
  }
  return unquote(s)
}

function unquote(s) {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    const inner = s.slice(1, -1)
    return s[0] === '"' ? inner.replace(/\\"/g, '"').replace(/\\\\/g, '\\') : inner.replace(/''/g, "'")
  }
  return s
}

function parseMeta(raw) {
  const meta = {}
  for (let i = 0; i < raw.length; i++) {
    const m = /^([A-Za-z_][\w-]*):(.*)$/.exec(raw[i])
    if (!m) continue
    let value = m[2]
    // a YAML block list:  key:\n  - a\n  - b
    if (!value.trim() && i + 1 < raw.length && /^\s+-\s/.test(raw[i + 1])) {
      const list = []
      while (i + 1 < raw.length && /^\s+-\s/.test(raw[i + 1])) list.push(unquote(raw[++i].replace(/^\s+-\s+/, '').trim()))
      meta[m[1]] = list
      continue
    }
    meta[m[1]] = parseValue(value)
  }
  return meta
}

const needsQuotes = (s) => /^[\s[{>|*&!%@`'"]|: |#|^(true|false|-?\d+(\.\d+)?)$|\s$/.test(s) || s === ''

function formatValue(v) {
  if (Array.isArray(v)) return `[${v.map((x) => (needsQuotes(String(x)) || /[,\]]/.test(String(x)) ? JSON.stringify(String(x)) : String(x))).join(', ')}]`
  if (typeof v === 'boolean' || typeof v === 'number') return String(v)
  const s = String(v)
  return needsQuotes(s) ? JSON.stringify(s) : s
}

/**
 * Sets keys in a file's front matter (value null/undefined removes the key),
 * creating the block if there is none. Other lines are kept as they are.
 */
export function setFrontMatter(text, patch) {
  const src = String(text ?? '')
  const { raw, body } = splitFrontMatter(src)
  const lines = raw ? [...raw] : []
  for (const [key, value] of Object.entries(patch)) {
    // where the key is now (and its block-list continuation lines)
    let at = lines.findIndex((l) => new RegExp(`^${key}:`).test(l))
    let len = 0
    if (at >= 0) {
      len = 1
      while (at + len < lines.length && /^\s+-\s/.test(lines[at + len])) len++
    }
    const remove = value == null || (Array.isArray(value) && value.length === 0 && key !== 'share')
    if (remove) {
      if (at >= 0) lines.splice(at, len)
      continue
    }
    const line = `${key}: ${formatValue(value)}`
    if (at >= 0) lines.splice(at, len, line)
    else lines.push(line)
  }
  if (!lines.length) return raw ? body.replace(/^\n/, '') : src
  return `---\n${lines.join('\n')}\n---\n${raw ? body : body.replace(/^\n/, '')}`
}

/** A new file's text from meta and body */
export function withFrontMatter(meta, body = '') {
  return setFrontMatter(body ? `\n${body}` : '', meta)
}
