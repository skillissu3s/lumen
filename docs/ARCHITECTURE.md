# Lumen — architecture

> **Changing.** Lumen is moving its data into databases with GitHub as a
> readable mirror written by the server ([DATABASE.md](DATABASE.md)). Phase 1
> is in: the server and the desktop app keep everything in SQLite, and the
> file API below is answered from the database (files are rendered from rows
> and parsed back into them). The rest of this page still describes the app's
> side as it is.

Lumen is a personal productivity app: tasks, a calendar, docs and chat, with a
plugin system for everything else. It grew out of the todo and calendar parts of
[obi](https://github.com/skillissu3s/obi), which is staying a note-taking app.

Three ideas shape everything below:

1. **Your data is plain text in a folder** — markdown and JSON lines, readable in
   any editor, diffable in git, Obsidian-friendly. A GitHub repository can be the
   only place it lives.
2. **The client does the thinking; storage just holds files.** Parsing tasks,
   expanding recurring events, merging edits — all of it happens in shared code
   that runs in the browser (and in tests). A storage backend only lists, reads,
   writes and deletes files. That is what lets the same app run against GitHub
   directly, against a Lumen server, or against a folder on your computer.
3. **Small core, plugins for the rest.** Tasks, calendar, docs and chat are built
   in. Anything else (focus timers, usage tracking, …) is a plugin installed from
   inside the app, stored as text files in the workspace.

## Ways to run it

| | **Server** (web, self-hosted) | **Desktop app** |
|---|---|---|
| Who | you (admin) + people you invite | you |
| Where data lives | the server's database, optionally synced to a GitHub repository | this computer's database, or your account on a Lumen server |
| Sign in | email + password or an emailed code, invite-only | first run: sign in to a Lumen server, or use this computer only |
| Chat, sharing | ✅ | with a server account |
| Computer-usage tracking (plugin) | — | ✅ (on this computer) |
| Hosting | Docker | installers built by GitHub Actions |

Nothing shows before signing in. The client asks `/api/info` where it is: a
Lumen server (sign in), or the desktop app's embedded server (the first-run
choice, then the local app). A static copy of the app with no server behind it
(GitHub Pages) asks for your server's address. The old GitHub-token mode is
retired; Settings → Sync → *Bring in from GitHub* takes in a repository it
wrote.

## Repository layout

```
client/           React app (Vite). Hash routing so static hosting works.
  landing/        The landing page — plain HTML/CSS, no app JS.
  src/storage/    Storage backends: server.js, github.js (same interface)
  src/store/      Zustand stores: workspace (files + parsed items), prefs, ui
  src/views/      Tasks, Calendar, Docs, Chat, Plugins, Settings, Admin
  src/plugins/    Plugin host: sandboxed iframes + permissioned RPC
shared/           Pure JS used by client, server and tests
  dates.js        ISO date helpers (UTC arithmetic, no time-zone drift)
  items.js        The task/event line format: parse, edit, serialize
  recurrence.js   "every 2 weeks", "every mon and fri", occurrences in a range
  quickadd.js     Natural-language entry: "Gym tomorrow 7am for 1h every mon"
  frontmatter.js  Tiny YAML-subset front matter for list/calendar/doc files
  ics.js          iCalendar import/export
  merge.js        Rebase of pending edits onto a newer remote version
server/           Express + ws. Auth, invites, file API with access control,
                  chat, git sync. Runs standalone or inside the desktop app.
desktop/          Electron shell: embedded server, folder picker, activity tracker
plugins/          Source of the starter plugins + registry.json (the catalog)
docs/             This file, STORAGE.md (formats), PLUGINS.md (plugin API), DEVLOG.md
```

## Storage interface

Every backend implements the same small interface (`client/src/storage/`):

```js
list()                      // → [{ path, sha }] for every file the user may read
read(path)                  // → { text, sha } | null
write(path, text, { sha })  // sha = version we based the edit on (null = must not exist)
                            // → { sha }; throws ConflictError if the file moved on
remove(path, { sha })
subscribe(fn)               // remote changes → fn([{ path, sha, deleted }])
```

`sha` is the **git blob hash** of the content in every backend (the server
computes it the same way GitHub does), so versions mean the same thing
everywhere.

### Edits, conflicts and offline

The workspace store keeps every loaded file as `{ text, sha, base }` and every
change as an *operation* — a function from old text to new text, e.g. "set the
status of item `k3j9x2` to done". An edit is applied locally at once
(optimistic), then written with the `sha` it was based on. If the backend says
the file changed meanwhile (HTTP 409 / GitHub 409), the store fetches the new
version and **re-applies the pending operations on top of it** — because
operations name items by id rather than by line number, this merges cleanly
almost always. Free-form text (docs) uses a diff-match-patch rebase instead.
Writes to the same file are debounced and coalesced, so ticking off five tasks
quickly is one commit in GitHub mode, not five.

## Server mode

- **Accounts.** SQLite (`node:sqlite`) holds users, sessions and invites — the
  only things not stored as workspace text, because they are secrets (password
  hashes, session tokens). The admin is created from `ADMIN_EMAIL` /
  `ADMIN_PASSWORD`, or by the first-run setup screen when there are no users.
  **There is no public sign-up**: only an admin can create invite links.
- **Access control** is per file, enforced by the server:
  - lists, calendars and docs carry `owner:` and `share:` in their front matter;
    without `share` a file is private to its owner. `share: everyone` or
    `share: [ana, sam]` opens it up. Only the owner (or an admin) may change
    those two fields.
  - `users/<handle>/…` (preferences) and `data/plugins/<id>/<handle>/…` (plugin
    data) belong to that user alone.
  - `plugins/…` (plugin code) and `lumen.json` are readable by everyone and
    writable by admins only — installing a plugin is an admin action.
  - `chat/…` is written only by the server's chat API.
- **Realtime.** One WebSocket per tab carries file-change notices (filtered to
  what the user may read), chat messages, typing and presence.
- **GitHub sync.** If a remote is configured, the data folder is a git working
  copy: changes are committed a few seconds after they stop, pushed, and the
  remote is pulled on an interval. Item files merge with git's *union* driver
  (both sides' lines are kept; the client de-duplicates by item id), chat logs
  are append-only JSON lines and merge the same way, and a doc that truly
  conflicts keeps both versions (`Doc (conflict 2026-10-31 1230).md`).
  > Everything in the workspace — including other members' private lists and
  > chat — ends up in the admin's repository. Members should know that.

## Desktop app

Electron starts the Lumen server in-process on `127.0.0.1` with a single local
user. The first run asks where data should live (the `desktop.mode` setting):

- **This computer only**: the window loads the local app, signed in as the
  local user. Data is in the app's own SQLite database; a folder from before is
  imported, and Settings → Sync can bring in another folder or a repository.
- **A Lumen server**: the window loads that server's app, behind its sign-in.
  If the server can't be reached the local app says so, with *Try again* and
  *Use this computer only*. Pages from the server can't use the desktop's
  local-only calls (folders, the activity log). Keeping a copy on the computer
  that syncs with the server, so it works offline, is phase 3 of
  [DATABASE.md](DATABASE.md).

GitHub sync (git) is optional and configured in Settings. The
desktop app also provides the **activity tracker** used by the Usage Monitor
plugin: it samples the foreground app (and, if enabled, window title) every few
seconds and the system idle time, keeps the raw log in the app's local data
folder (never synced), and exposes summaries to plugins that hold the
`system:activity` permission.

## Plugins

See [PLUGINS.md](PLUGINS.md). In short: a plugin is a folder with a
`manifest.json` and an HTML entry, stored in the workspace under
`plugins/<id>/`. It runs in a sandboxed iframe with no access to the app's
cookies, storage or DOM, under a CSP that blocks network access unless the
plugin asked for (and you granted) `network`. It talks to Lumen through a
promise-based RPC (`lumen.tasks.list()`, `lumen.storage.set()`, …) where each
call is checked against the permissions you approved at install time.
