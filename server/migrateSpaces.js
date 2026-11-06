// The one-time move to spaces (docs/CANDLES.md → Migration of today's data).
// prepare() runs before the home space opens: it makes the home space (the
// desktop person's candle, or on a server a workspace from today's lumen.json
// with everyone in it) and gives it every row that has no space yet. finish()
// runs after: on a server, everything only its owner could see moves to that
// owner's candle, what stays is shared by the workspace's members, and plugins
// are installed in every candle. Both do nothing once spaces exist.

import { DESKTOP } from './config.js'
import { db, getSetting, setSetting } from './db.js'
import * as files from './files.js'
import * as spaces from './spaces.js'
import { TABLES } from './store/tables.js'
import { allUsers } from './auth.js'
import { seedSpace } from './seed.js'

const ROOTS = { board: [['cards', 'root_id']], calendar: [['cards', 'root_id']], doc: [['doc_blocks', 'doc_id']], idea_board: [['idea_nodes', 'board_id'], ['idea_edges', 'board_id']] }
const T = (type) => TABLES[type].table

function tx(fn) {
  db.exec('BEGIN IMMEDIATE')
  try {
    const out = fn()
    db.exec('COMMIT')
    return out
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
}

// rows from before spaces belong to `home`; records named after their file get it in their id
function claim(home) {
  const scoped = (table, column = 'id') => db.prepare(`UPDATE ${table} SET ${column} = ? || '/' || ${column} WHERE space = '' AND ${column} NOT LIKE ? || '/%'`).run(home, home)
  scoped(T('channel'))
  scoped(T('message'), 'channel')
  scoped(T('message'))
  scoped(T('plugin_file'))
  scoped(T('other_file'))
  db.prepare(`UPDATE ${T('workspace')} SET id = ? WHERE id = 'workspace' AND space = ''`).run(home)
  db.prepare(`UPDATE journal SET root_id = ? || '/' || root_id WHERE space = '' AND root_type IN ('channel', 'chat_month', 'plugin_file', 'other_file')`).run(home)
  db.prepare(`UPDATE journal SET root_id = ? WHERE space = '' AND root_type = 'workspace'`).run(home)
  for (const d of Object.values(TABLES)) db.prepare(`UPDATE ${d.table} SET space = ? WHERE space = ''`).run(home)
  db.prepare(`UPDATE journal SET space = ? WHERE space = ''`).run(home)
}

/** → { home, migrating } */
export function prepareSpaces({ desktopUser } = {}) {
  const have = getSetting('spaces.home')
  if (have && spaces.get(have)) return { home: have, migrating: false }
  let home
  if (DESKTOP) home = spaces.ensureCandle(desktopUser).space.id
  else {
    const ws = db.prepare(`SELECT name FROM ${T('workspace')} WHERE id IN ('workspace', ?) AND deleted = 0`).get(have || '')
    const people = allUsers()
    const owner = people.find((u) => u.role === 'admin' && !u.disabled) || null
    home = spaces.createWorkspace(owner, ws?.name || 'Workspace').id
    for (const u of people) if (u.id !== owner?.id) spaces.addMember(home, u.id, u.role === 'admin' ? 'admin' : 'member')
  }
  tx(() => claim(home))
  setSetting('spaces.home', home)
  return { home, migrating: true }
}

/** After the home space is open: the split, on a server, the first time only */
export async function finishSpaces({ home, migrating }) {
  if (!migrating || DESKTOP) return
  const people = allUsers()
  for (const u of people) spaces.ensureCandle(u)
  const ids = new Set(people.map((u) => u.id))
  const plugins = db.prepare(`SELECT plugin, file, content FROM ${T('plugin_file')} WHERE space = ? AND deleted = 0`).all(home)
  const wsRow = db.prepare(`SELECT plugins FROM ${T('workspace')} WHERE id = ?`).get(home)
  tx(() => {
    for (const [type, children] of Object.entries(ROOTS)) {
      const rows = db.prepare(`SELECT id, owner, share FROM ${T(type)} WHERE space = ? AND deleted = 0`).all(home)
      for (const r of rows) {
        let share = null
        try {
          share = r.share ? JSON.parse(r.share) : null
        } catch {
          share = null
        }
        const isShared = share === 'everyone' || share === true || (Array.isArray(share) && share.length > 0) || (share && typeof share === 'object' && Object.keys(share).length > 0)
        if (!isShared && ids.has(r.owner)) {
          // only its owner could see it: it's theirs, in their candle
          const to = spaces.candleId(r.owner)
          db.prepare(`UPDATE ${T(type)} SET space = ? WHERE id = ?`).run(to, r.id)
          for (const [table, col] of children) db.prepare(`UPDATE ${table} SET space = ? WHERE ${col} = ?`).run(to, r.id)
        } else if (share != null) {
          // the workspace's members see it now; sharing lists belong to candles
          db.prepare(`UPDATE ${T(type)} SET share = NULL WHERE id = ?`).run(r.id)
        }
      }
    }
    // preferences and plugin data are each person's
    db.prepare(`UPDATE ${T('prefs')} SET space = 'c_' || id WHERE space = ?`).run(home)
    db.prepare(`UPDATE ${T('plugin_data')} SET space = 'c_' || user_id WHERE space = ?`).run(home)
    // the old GitHub mirror connections: the workspace's, or each person's candle
    const conns = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'sync_connections'").get()
    if (conns) {
      const cols = db.prepare('PRAGMA table_info(sync_connections)').all().map((c) => c.name)
      if (!cols.includes('space')) db.exec("ALTER TABLE sync_connections ADD COLUMN space TEXT NOT NULL DEFAULT ''")
      db.prepare("UPDATE sync_connections SET space = CASE scope WHEN 'workspace' THEN ? ELSE 'c_' || owner END, last_full_at = NULL, next_run_at = ?").run(home, Date.now())
    }
  })
  files.reopenAll()

  // plugins are installed per person now: everyone gets today's, and the workspace keeps none
  const pluginMap = wsRow?.plugins ? JSON.parse(wsRow.plugins) : {}
  for (const u of people) {
    const candle = files.space(spaces.candleId(u.id))
    await seedSpace(candle, { handle: u.handle, name: u.name, title: spaces.get(candle.id)?.name })
    for (const p of plugins) await candle.write(`plugins/${p.plugin}/${p.file}`, p.content, { by: 'migration' })
    if (Object.keys(pluginMap).length) {
      const cur = await candle.read('lumen.json')
      const cfg = cur ? JSON.parse(cur.text) : {}
      await candle.write('lumen.json', `${JSON.stringify({ ...cfg, plugins: { ...pluginMap, ...(cfg.plugins || {}) } }, null, 2)}\n`, { by: 'migration' })
    }
  }
  const h = files.home()
  for (const p of plugins) await h.remove(`plugins/${p.plugin}/${p.file}`, { by: 'migration' })
  const cur = await h.read('lumen.json')
  if (cur) await h.write('lumen.json', `${JSON.stringify({ ...JSON.parse(cur.text), plugins: {} }, null, 2)}\n`, { by: 'migration' })
  // a workspace whose inbox or calendar went to someone's candle gets fresh ones
  const owner = spaces.get(home)?.owner_id
  const handle = owner ? files.people.handleOf(owner) : 'admin'
  await seedSpace(h, { handle, name: '', title: spaces.get(home)?.name, chat: false })
  h.settle()
}
