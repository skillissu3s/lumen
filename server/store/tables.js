// The tables that hold everything people make in Lumen (see docs/DATABASE.md),
// described once: their columns, which are JSON, and which record is the root
// of each row's file in a mirror. The write path (records.js) and the schema
// below both come from this list, so a column can't be added in one place and
// forgotten in the other.

// columns every user-data table has, in this order
export const COMMON = ['id', 'owner', 'rev', 'created_at', 'updated_at', 'deleted', 'extra']

export const TABLES = {
  board: {
    table: 'boards',
    root: true,
    columns: ['name', 'color', 'icon', 'share', 'view_mode', 'path', 'column_list', 'done', 'labels'],
    json: ['share', 'column_list', 'labels'],
  },
  calendar: {
    table: 'calendars',
    root: true,
    columns: ['name', 'color', 'icon', 'share', 'is_default', 'path', 'sections'],
    json: ['share', 'sections'],
    bool: ['is_default'],
  },
  // a card on a board, or an event (or task) in a calendar
  card: {
    table: 'cards',
    columns: ['root_type', 'root_id', 'parent', 'col', 'archived', 'position', 'kind', 'status', 'title', 'notes', 'priority', 'recurrence', 'start', 'scheduled', 'date', 'end_date', 'time', 'duration', 'location', 'color', 'skip', 'created', 'done', 'cancelled', 'cover'],
    json: ['skip'],
    bool: ['archived'],
    rootOf: (row) => ({ type: row.root_type, id: row.root_id }),
    index: ['root_type, root_id'],
  },
  doc: {
    table: 'docs',
    root: true,
    columns: ['title', 'icon', 'color', 'cover', 'width', 'folder', 'share', 'path'],
    json: ['share'],
  },
  block: {
    table: 'doc_blocks',
    columns: ['doc_id', 'position', 'type', 'attrs', 'text'],
    json: ['attrs'],
    rootOf: (row) => ({ type: 'doc', id: row.doc_id }),
    index: ['doc_id'],
  },
  idea_board: {
    table: 'idea_boards',
    root: true,
    columns: ['name', 'color', 'icon', 'share', 'path'],
    json: ['share'],
  },
  idea_node: {
    table: 'idea_nodes',
    columns: ['board_id', 'position', 'type', 'text', 'label', 'file_ref', 'url', 'x', 'y', 'width', 'height', 'color', 'style', 'shape', 'ink', 'ink_w', 'ink_h'],
    rootOf: (row) => ({ type: 'idea_board', id: row.board_id }),
    index: ['board_id'],
  },
  idea_edge: {
    table: 'idea_edges',
    columns: ['board_id', 'position', 'from_node', 'from_side', 'from_end', 'to_node', 'to_side', 'to_end', 'color', 'label'],
    rootOf: (row) => ({ type: 'idea_board', id: row.board_id }),
    index: ['board_id'],
  },
  // one person's preferences; the id is the user's id
  prefs: { table: 'prefs', root: true, columns: ['data'], json: ['data'] },
  // the workspace's own settings (one row, id 'workspace')
  workspace: { table: 'workspace', root: true, columns: ['name', 'inbox', 'plugins'], json: ['plugins'] },
  // an installed plugin's file (id: '<plugin>/<file>')
  plugin_file: { table: 'plugin_files', root: true, columns: ['plugin', 'file', 'content'], index: ['plugin'] },
  // what a plugin stored for one person (id: '<plugin>/<user>/<file>')
  plugin_data: { table: 'plugin_data', root: true, columns: ['plugin', 'user_id', 'file', 'content'], index: ['plugin, user_id'] },
  channel: { table: 'chat_channels', root: true, columns: ['name', 'dm', 'members', 'created', 'created_by'], json: ['members'], bool: ['dm'] },
  message: {
    table: 'chat_messages',
    columns: ['channel', 'at', 'author', 'text', 'reply', 'edited'],
    // a month of a channel is one file
    rootOf: (row) => ({ type: 'chat_month', id: `${row.channel}/${String(row.at).slice(0, 7)}` }),
    index: ['channel, at'],
  },
}

/** The root a row's changes rewrite: itself, or its parent record */
export const rootOf = (type, row) => (TABLES[type].rootOf ? TABLES[type].rootOf(row) : { type, id: row.id })

export function schemaSql() {
  const parts = []
  for (const def of Object.values(TABLES)) {
    const cols = def.columns.map((c) => `  ${c}`).join(',\n')
    parts.push(`CREATE TABLE IF NOT EXISTS ${def.table} (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  rev INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  extra TEXT,
${cols}
);
CREATE INDEX IF NOT EXISTS ${def.table}_owner ON ${def.table} (owner);`)
    for (const [i, cols] of (def.index || []).entries()) parts.push(`CREATE INDEX IF NOT EXISTS ${def.table}_ix${i} ON ${def.table} (${cols});`)
  }
  parts.push(`CREATE TABLE IF NOT EXISTS journal (
  seq INTEGER PRIMARY KEY,
  type TEXT NOT NULL,
  id TEXT NOT NULL,
  owner TEXT NOT NULL,
  root_type TEXT NOT NULL,
  root_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS journal_owner ON journal (owner, seq);`)
  return parts.join('\n')
}
