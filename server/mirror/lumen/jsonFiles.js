// The JSON files of profile lumen/1, both ways: a person's preferences, the
// workspace (lumen.json), chat channels and chat messages. Plugin code and
// plugin data are not here: they are kept byte for byte as the plugin wrote
// them (see index.js).

const isObject = (v) => v && typeof v === 'object' && !Array.isArray(v)

// keys sorted at every depth (arrays keep their order)
function sortDeep(v) {
  if (Array.isArray(v)) return v.map(sortDeep)
  if (!isObject(v)) return v
  return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortDeep(v[k])]))
}

// known keys in order, then the others sorted
function ordered(obj, keys) {
  const out = {}
  for (const k of keys) if (obj[k] !== undefined) out[k] = obj[k]
  for (const k of Object.keys(obj).filter((k) => !keys.includes(k)).sort()) out[k] = obj[k]
  return out
}

function readJson(text, fallback, warnings) {
  try {
    const v = JSON.parse(String(text ?? '').replace(/^﻿/, '').normalize('NFC') || 'null')
    return v ?? fallback
  } catch {
    warnings.push('not valid JSON; read as empty')
    return fallback
  }
}

// ---- users/<handle>/settings.json ----

export const prefs = {
  parse(text) {
    const warnings = []
    const data = readJson(text, {}, warnings)
    return { data: isObject(data) ? data : {}, warnings }
  },
  render(data) {
    return `${JSON.stringify(sortDeep(data || {}), null, 2)}\n`
  },
}

// ---- lumen.json ----

export const workspace = {
  parse(text) {
    const warnings = []
    const data = readJson(text, {}, warnings)
    return { data: isObject(data) ? data : {}, warnings }
  },
  render(data) {
    const plugins = Object.fromEntries(
      Object.keys(data.plugins || {})
        .sort()
        .map((id) => {
          const p = data.plugins[id] || {}
          return [id, ordered({ ...sortDeep(p), ...(Array.isArray(p.permissions) ? { permissions: [...p.permissions].sort() } : {}) }, ['version', 'permissions', 'source'])]
        }),
    )
    const out = ordered({ version: 1, ...sortDeep(data), plugins }, ['version', 'name', 'inbox', 'plugins'])
    if (!Object.keys(plugins).length) delete out.plugins
    return `${JSON.stringify(out, null, 2)}\n`
  },
}

// ---- chat/channels.json ----

export const channels = {
  parse(text) {
    const warnings = []
    const list = readJson(text, [], warnings)
    return { channels: Array.isArray(list) ? list.filter((c) => isObject(c) && c.id) : [], warnings }
  },
  render(list) {
    const rows = [...list]
      .filter((c) => !c.deleted)
      .sort((a, b) => String(a.id).localeCompare(String(b.id)))
      .map((c) => ordered(sortDeep(c), ['id', 'name', 'dm', 'members', 'created', 'by']))
    return rows.length ? `[\n${rows.map((r) => `  ${JSON.stringify(r)}`).join(',\n')}\n]\n` : '[]\n'
  },
}

// ---- chat/<channel>/<yyyy-mm>.jsonl ----

export const messages = {
  /**
   * One message per line. Older logs write an edit or a deletion as a later
   * line with the same id; they are applied in order, so each message comes
   * out in its current state.
   */
  parse(text) {
    const warnings = []
    const byId = new Map()
    let bad = 0
    for (const line of String(text ?? '').replace(/\r\n?/g, '\n').split('\n')) {
      if (!line.trim()) continue
      let m
      try {
        m = JSON.parse(line)
      } catch {
        bad++
        continue
      }
      if (!isObject(m) || !m.id) {
        bad++
        continue
      }
      const prev = byId.get(m.id)
      if (!prev) byId.set(m.id, { ...m, edit: undefined })
      else if (m.deleted) byId.set(m.id, { id: prev.id, at: prev.at, from: prev.from, deleted: true })
      else if (m.edit) byId.set(m.id, { ...prev, text: m.text, edited: m.at })
      else byId.set(m.id, { ...prev, ...m })
    }
    if (bad) warnings.push(`skipped ${bad} line(s) that weren't messages`)
    const list = [...byId.values()].map((m) => Object.fromEntries(Object.entries(m).filter(([, v]) => v !== undefined)))
    return { messages: list, warnings }
  },
  render(list) {
    return list
      .slice()
      .sort((a, b) => String(a.at).localeCompare(String(b.at)) || String(a.id).localeCompare(String(b.id)))
      .map((m) => {
        const row = m.deleted ? { id: m.id, at: m.at, from: m.from, deleted: true } : { ...m }
        delete row.edit
        return JSON.stringify(ordered(sortDeep(row), ['id', 'at', 'from', 'text', 'reply', 'edited', 'deleted']))
      })
      .map((l) => `${l}\n`)
      .join('')
  },
}
