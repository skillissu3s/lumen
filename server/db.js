// Accounts and sessions — the only things Lumen keeps outside the workspace
// folder, because they are secrets (password hashes, session tokens) or plain
// bookkeeping (chat read markers). Everything people make is text in the workspace.
import { DatabaseSync } from 'node:sqlite'
import path from 'node:path'
import { DATA_DIR } from './config.js'

export const db = new DatabaseSync(path.join(DATA_DIR, 'lumen.db'))
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;')

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  handle TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  pass_hash TEXT,
  role TEXT NOT NULL DEFAULT 'member',
  disabled INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  agent TEXT
);
CREATE TABLE IF NOT EXISTS invites (
  token_hash TEXT PRIMARY KEY,
  email TEXT,
  role TEXT NOT NULL DEFAULT 'member',
  note TEXT,
  created_by TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_by TEXT,
  used_at INTEGER
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
CREATE TABLE IF NOT EXISTS chat_reads (
  user_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  last_at TEXT NOT NULL,
  PRIMARY KEY (user_id, channel)
);
CREATE TABLE IF NOT EXISTS codes (
  id TEXT PRIMARY KEY,
  email TEXT,
  purpose TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  challenge_hash TEXT,
  user_id TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);
`)

export function getSetting(key, fallback = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key)
  if (!row) return fallback
  try {
    return JSON.parse(row.value)
  } catch {
    return fallback
  }
}

export function setSetting(key, value) {
  if (value === undefined || value === null) db.prepare('DELETE FROM settings WHERE key = ?').run(key)
  else db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, JSON.stringify(value))
}
