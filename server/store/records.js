// The one way user data is written: every insert, change and deletion goes
// through `write` or `remove`, which bump the row's revision, stamp the time and
// append to the journal in the same transaction (Repo Sync Protocol §3). Code
// that writes these tables any other way would be invisible to the GitHub
// mirror and to devices syncing with the server, so there is no other way.

import { COMMON, TABLES, rootOf, schemaSql } from './tables.js'

const sameValue = (a, b) => (a ?? null) === (b ?? null) || JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

/** Creates the tables (if they aren't there) and returns the store for `db` (a node:sqlite DatabaseSync) */
export function createStore(db, { clock = () => Date.now() } = {}) {
  db.exec(schemaSql())
  const stmts = new Map()
  const prep = (sql) => stmts.get(sql) || stmts.set(sql, db.prepare(sql)).get(sql)
  let depth = 0

  /** Runs `fn` in a transaction (nested calls join the outer one) */
  function tx(fn) {
    if (depth) return fn()
    db.exec('BEGIN IMMEDIATE')
    depth++
    try {
      const out = fn()
      db.exec('COMMIT')
      return out
    } catch (e) {
      db.exec('ROLLBACK')
      throw e
    } finally {
      depth--
    }
  }

  const def = (type) => {
    const d = TABLES[type]
    if (!d) throw new Error(`Unknown record type: ${type}`)
    return d
  }

  // a row from the database → a record (JSON columns parsed, booleans as booleans)
  function decode(type, row) {
    if (!row) return null
    const d = def(type)
    const out = { ...row, deleted: !!row.deleted, extra: row.extra ? JSON.parse(row.extra) : {} }
    for (const c of d.json || []) out[c] = row[c] == null ? null : JSON.parse(row[c])
    for (const c of d.bool || []) out[c] = row[c] == null ? null : !!row[c]
    return out
  }
  const encode = (type, col, v) => ((def(type).json || []).includes(col) ? (v == null ? null : JSON.stringify(v)) : typeof v === 'boolean' ? Number(v) : (v ?? null))

  const journal = (type, id, owner, root, kind, at) =>
    prep('INSERT INTO journal (type, id, owner, root_type, root_id, kind, at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(type, id, owner, root.type, root.id, kind, at)

  function get(type, id) {
    return decode(type, prep(`SELECT * FROM ${def(type).table} WHERE id = ?`).get(id))
  }

  /**
   * Inserts or changes a record. `fields` must have `id` (and `owner` for a new
   * record); other columns are set as given and the rest kept. A write that
   * changes nothing is skipped: no new revision, nothing journaled.
   * Returns { record, changed }.
   */
  function write(type, fields) {
    const d = def(type)
    const cols = ['owner', 'extra', ...d.columns]
    for (const k of Object.keys(fields)) if (!['id', 'deleted', ...cols].includes(k)) throw new Error(`${type} has no column ${k}`)
    return tx(() => {
      const now = clock()
      const before = get(type, fields.id)
      if (!before) {
        if (!fields.owner) throw new Error(`A new ${type} needs an owner`)
        const row = { id: fields.id, owner: fields.owner, rev: 1, created_at: now, updated_at: now, deleted: 0, extra: fields.extra && Object.keys(fields.extra).length ? JSON.stringify(fields.extra) : null }
        for (const c of d.columns) row[c] = encode(type, c, fields[c])
        const names = [...COMMON, ...d.columns]
        prep(`INSERT INTO ${d.table} (${names.join(', ')}) VALUES (${names.map(() => '?').join(', ')})`).run(...names.map((n) => row[n]))
        const record = get(type, fields.id)
        journal(type, record.id, record.owner, rootOf(type, record), 'upsert', now)
        return { record, changed: true }
      }
      const next = { ...before }
      let changed = before.deleted && fields.deleted === false
      for (const c of cols) {
        if (!(c in fields)) continue
        const v = c === 'extra' ? fields.extra || {} : fields[c]
        if (!sameValue(before[c], v)) {
          next[c] = v
          changed = true
        }
      }
      if (!changed) return { record: before, changed: false }
      next.deleted = false
      const sets = [...cols, 'deleted']
      prep(`UPDATE ${d.table} SET ${sets.map((c) => `${c} = ?`).join(', ')}, rev = rev + 1, updated_at = ? WHERE id = ?`).run(
        ...sets.map((c) => (c === 'extra' ? (next.extra && Object.keys(next.extra).length ? JSON.stringify(next.extra) : null) : c === 'deleted' ? 0 : encode(type, c, next[c]))),
        now,
        before.id,
      )
      const record = get(type, before.id)
      const oldRoot = rootOf(type, before)
      const newRoot = rootOf(type, record)
      journal(type, record.id, record.owner, newRoot, 'upsert', now)
      // the file it left, and the mirror it left, are rewritten too
      if (oldRoot.type !== newRoot.type || oldRoot.id !== newRoot.id) journal(type, record.id, record.owner, oldRoot, 'upsert', now)
      if (before.owner !== record.owner) journal(type, record.id, before.owner, oldRoot, 'delete', now)
      return { record, changed: true }
    })
  }

  /** Marks a record deleted (a tombstone the mirror and devices can see) */
  function remove(type, id) {
    return tx(() => {
      const before = get(type, id)
      if (!before || before.deleted) return { changed: false }
      const now = clock()
      prep(`UPDATE ${def(type).table} SET deleted = 1, rev = rev + 1, updated_at = ? WHERE id = ?`).run(now, id)
      journal(type, id, before.owner, rootOf(type, before), 'delete', now)
      return { changed: true }
    })
  }

  /** Live rows of `type` whose `column` is `value` (a board's cards, a doc's blocks…) */
  function where(type, column, value, { deleted = false } = {}) {
    const d = def(type)
    if (![...COMMON, ...d.columns].includes(column)) throw new Error(`${type} has no column ${column}`)
    const rows = prep(`SELECT * FROM ${d.table} WHERE ${column} = ?${deleted ? '' : ' AND deleted = 0'}`).all(value)
    return rows.map((r) => decode(type, r))
  }

  /** Journal rows after `seq` (for one owner, if given), oldest first */
  function changesSince(seq, { owner, limit = 10000 } = {}) {
    return owner
      ? prep('SELECT * FROM journal WHERE seq > ? AND owner = ? ORDER BY seq LIMIT ?').all(seq, owner, limit)
      : prep('SELECT * FROM journal WHERE seq > ? ORDER BY seq LIMIT ?').all(seq, limit)
  }

  const highWater = () => prep('SELECT COALESCE(MAX(seq), 0) AS seq FROM journal').get().seq

  return { tx, get, write, remove, where, changesSince, highWater }
}
