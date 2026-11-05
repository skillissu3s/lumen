# Lumen on databases: the plan

Lumen is moving from "your data is files in a folder" to "your data is rows in a
database, with GitHub as a readable mirror". This document is the plan and the
target design. The file formats live on as the **mirror format**, specified in
the [Repo Sync Protocol](https://github.com/skillissu3s/repo-sync-protocol)
(private) and its profile `lumen/1`.

Decisions (2026-11-02, from the owner):

| | |
|---|---|
| Server database | **SQLite** (`node:sqlite`), behind a small adapter so Postgres can come later. |
| Accounts | **Invite-only** cloud accounts, as now. |
| GitHub | **One way out, plus restore**: the server writes the mirror; the repository can rebuild everything. Edits made in the repository are not read back (yet). |
| Old modes | **Replaced.** The browser-only GitHub-token mode and folder workspaces go; their data imports once. |

## Target picture

```
 Web app ──────────┐                          ┌──► GitHub repository (mirror, per user)
 (IndexedDB copy,  │  sign in, sync records   │    written by the server's sync worker:
  works offline)   ├──────────────────────────┤    after changes, hourly, daily…
                   │                          │
 Desktop app ──────┤      Cloud server        │
 (embedded server, │  SQLite: users, records, │
  local SQLite,    │  journal; the source of  │
  works offline)   │  truth for accounts      │
                   └──────────────────────────┘
```

- **Cloud server**: users, invites and sessions as now, plus every piece of user
  data in typed tables, plus the change journal. It serves the web app, syncs
  with devices and runs the GitHub mirror.
- **Desktop app**: the same server code embedded, with its own SQLite file. It
  works with no account at all ("Use on this computer only"), or signed in to a
  cloud server, in which case it is a **replica**: it syncs its records with the
  cloud whenever it is online.
- **Web app**: always signed in to a cloud server. It keeps a copy of what it
  has loaded, plus unsent changes, in IndexedDB, so it keeps working when the
  connection drops and catches up when it returns.
- **GitHub**: a mirror only the server writes, in readable files, on the
  schedule the user picks. Restoring from it rebuilds the records.

## Signing in (the login wall)

| Where | First screen |
|---|---|
| Web | Sign in (email and password, or an emailed code), or accept an invite. Nothing is visible before signing in. |
| Desktop, first start | **Sign in to a Lumen server** (address, email, password) or **Use on this computer only**. |
| Desktop, local only | Settings → Account → *Sign in to a server* uploads the local data into that account (a merge by id), then keeps them in sync. |

Sessions stay as they are (HTTP-only cookie on the web; on the desktop the
embedded server holds the cloud session token in its database, encrypted with
the OS keychain through Electron's `safeStorage`).

## Tables

Every user-data table has the common columns from the protocol:

```sql
id TEXT PRIMARY KEY, owner TEXT NOT NULL, rev INTEGER NOT NULL DEFAULT 1,
created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0,
extra TEXT   -- JSON: anything not modelled yet, kept and written back
```

| Table | Main columns | Mirror file |
|---|---|---|
| `boards` | name, color, icon, share, view_mode, path, column_list (JSON: names and colours), done, labels (JSON) | `lists/<slug>.md` |
| `cards` | root_type, root_id, col, parent, position, kind (task/event), status, title (with its icon and tags), notes, priority, recurrence, start, scheduled, date, end_date, time, duration, location, color, skip (JSON), created, done, cancelled, cover, archived | inside its board or calendar |
| `calendars` | name, color, icon, share, is_default, path, sections (JSON) | `calendars/<slug>.md` |
| `docs` | title, icon, color, cover, width, folder, share, path | `docs/…/<slug>.md` |
| `doc_blocks` | doc_id, position, type, attrs (JSON), text | inside its doc |
| `idea_boards` | name, color, icon, share, path | `ideas/<slug>.canvas` |
| `idea_nodes` | board_id, position, type, text, label, file_ref, url, x, y, width, height, color, style, shape, ink, ink_w, ink_h | inside its idea board |
| `idea_edges` | board_id, position, from_node, from_side, from_end, to_node, to_side, to_end, color, label | inside its idea board |
| `prefs` | user_id, data (JSON) | `users/<handle>/settings.json` |
| `workspace` | name, inbox, plugins (JSON) | `lumen.json` |
| `plugins`, `plugin_files` | id, version, granted; path, content | `plugins/<id>/…` |
| `plugin_data` | plugin, user, path, content | `data/plugins/…` |
| `chat_channels`, `chat_messages` | name, dm, members, created, created_by; channel, at, author, text, reply, edited | `chat/…` |
| `journal` | seq, type, id, owner, root_type, root_id, kind, at | (the protocol's journal) |
| `sync_connections`, `sync_drift` | (the protocol's) | — |

Access control moves from files to rows: a record is readable by its owner,
by everyone it is shared with (`share` on the root; children follow their
root), and by admins; writable by the same people, except that only the owner
or an admin changes `share`.

## Devices and the cloud

Lumen's own sync between a device and the cloud server (separate from GitHub).
What is built (phase 3) carries **file units** (a board with its cards, a doc,
an idea board…) through the server's file API, which already checks who may
read and write what and gives every file a version, and merges them **record by
record**:

- The device remembers, per file, the last version both sides agreed on
  (`sync_files`: the text, the server's sha, the local sha).
- A round lists both sides and compares each with that: a file changed on one
  side is copied to the other; changed on both, it is merged three ways
  (`server/sync/merge.js`): cards, idea board nodes and arrows, chat messages
  and settings keys merge one by one, field by field where both changed the same
  record, with the server's value winning a true clash (and the app listing
  the file under *Changed in both places*). Docs merge as text
  (diff-match-patch); a doc the two can't combine keeps this computer's
  version beside the server's as `… (this computer).md`. Deleted on one side
  and changed on the other keeps it.
- A change the server refuses (not yours to change) stays on the device and is
  listed under *Kept on this computer*.
- Rounds run on start, 1.5 s after a change on the device, every 30 s, and on
  *Sync now*. Offline, changes wait in the local database; the next round that
  reaches the server sends them.

Record-level operations (`base_rev`, field sets) between the app and the
server, and docs syncing block by block, belong to phase 5, when the client
itself works on records.

## The way there

Each phase leaves Lumen working and shippable.

### Phase 1: the database underneath

Everything moves into SQLite on the server and in the desktop app, while the app
in the browser keeps working unchanged.

1. Tables, the single write path and the journal (`server/store/`).
2. **Codecs** for profile `lumen/1`: `render` and `parse` for every file type,
   with round-trip and golden-file tests (`server/mirror/lumen/`). These are the
   mirror's renderers and restore's parsers, so nothing here is throwaway.
3. **A file facade**: today's file API (`list`, `read`, `write`) answered from
   the database through the codecs. Reading renders; writing parses and updates
   only the rows that changed. The client keeps its file-based model for now.
4. **Import**: on start, an existing data folder (server or desktop) is parsed
   into the database once, and kept as a backup rather than deleted.

Done when the server and desktop write no user data to files, every existing
test passes, and an imported folder renders back identically (or as documented
normalisations).

Progress:

- [x] Codecs for every file kind (`server/mirror/lumen/`): boards and
  calendars, docs as blocks, idea boards, preferences, `lumen.json`, chat
  channels and messages; plugin files pass through. Tested with golden files,
  hand-made files and random round trips; the dev workspace round-trips with
  nothing lost (first pass adds ids and settles formatting, second pass is
  stable).
- [x] Tables, the single write path and the journal (`server/store/`).
- [x] Mapping between files and rows (`server/store/units.js`): children
  keyed per file (`<root>/<card>`), doc blocks keeping their rows when their
  content didn't change, a hand-copied file's id clash giving the copy its own
  id, and no writes when nothing changed.
- [x] The file facade (`server/files.js`): the same interface as before,
  answered from the database. A write returns the stored text when it differs
  (ids added, formatting settled) and the app carries on from it.
- [x] Import on first start: an empty database takes in the workspace folder,
  which is left in place as a backup (recorded under the `store.imported`
  setting). Picking a folder on the desktop imports it too.
- [x] Git sync keeps working until phase 4 replaces it: while it is on, the
  folder is its working copy, a mirror of the database written after every
  change, and outside edits (a git pull) are taken back in.

Phase 1 is done: the server and the desktop app keep everything in SQLite.

### Phase 2: accounts everywhere

The login wall: the desktop's first-run choice (cloud or this computer only),
the web always signed in, GitHub-token mode removed (with a one-time import of
such repositories through restore's legacy path).

Progress:

- [x] The web app shows nothing before signing in. A copy with no server
  behind it (GitHub Pages) asks for your server's address instead of offering
  GitHub-token mode, which is gone from the client.
- [x] The desktop app's first run: *Sign in to a Lumen server* (the local
  server checks a Lumen server answers at that address, then the window loads
  that server's app, behind its sign-in) or *Use on this computer only*.
  Switching later: Settings → Account. A server that can't be reached shows
  *Try again* / *Use this computer only*. Pages from the server can't use the
  desktop's local-only calls.
- [x] *Bring in from GitHub* (Settings → Sync, admins): reads a repository
  once through the REST API (`server/github/readRepo.js`, which restore will
  reuse) and imports its files by id. The token is never stored.

Phase 2 is done. Until phase 3, a desktop signed in to a server needs the
server to be reachable; phase 3 gives it a local copy that syncs.

### Phase 3: devices in sync

The device ↔ cloud protocol above: desktop as a replica of the cloud, the web
app's IndexedDB copy and outbox, conflict reporting in the app.

Progress:

- [x] The desktop app as a replica (`server/sync/replica.js`): signing in
  happens in the local app (address, email, password, and the emailed code for
  admins); the window always shows the local app, which works offline. The
  local user takes the account's handle, so what is made here is theirs on the
  server. On a fresh install the account's data simply arrives; a computer
  with work of its own asks whether to keep both or only the account's (this
  computer's is backed up to `DATA_DIR/backups/<time>/` first). Signing in
  again after a session ends carries on where it was. Signing out leaves the
  computer its copy.
- [x] Sync state in the app: the sidebar (Synced, Syncing…, Offline · changes
  kept, Sign in again) and Settings → Account (Sync now, files changed in both
  places, changes the server refused, Sign out).
- [x] Tests: `server/sync/merge.test.js` (the merge rules) and
  `server/sync/replica.e2e.test.js` (a real server and a desktop server:
  signing in, changes both ways, the same board changed on both sides,
  offline and back, deletions, signing out).
- [ ] The web app's copy in IndexedDB, so a browser tab also opens and works
  without a connection.

### Phase 4: the GitHub mirror

The GitHub App connection flow, the sync worker and scheduler (manual, after
changes, interval, daily, weekly), *Rebuild the mirror*, the drift report,
Settings → GitHub, and **Restore from a repository**. Replaces today's git sync.

### Phase 5: the app on records

The client moves from files to records (queries and operations instead of text
edits), docs edit and sync as blocks, and the file facade is retired.
