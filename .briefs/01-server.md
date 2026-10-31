# Brief 01 — finish the Lumen server

Read first: `AGENTS.md`, `docs/ARCHITECTURE.md`, `docs/STORAGE.md`, `docs/API.md` (the contract you implement — follow it exactly).

Already written (use them; small fixes allowed if you find a real bug — say so in your report):
`server/config.js`, `server/db.js`, `server/auth.js`, `server/access.js`, `server/files.js`.

## Files to create

### `server/seed.js`
`seedWorkspace({ handle, name, chat })` — called on an empty workspace. Writes (via `files.write`, only files that don't exist):
- `lumen.json` → `{ "version": 1, "name": "<name>'s workspace", "inbox": "inbox", "plugins": {} }` (pretty JSON, 2 spaces, trailing newline)
- `.gitattributes` exactly as in STORAGE.md "Git merge rules"
- `lists/inbox.md` → front matter `name: Inbox`, `owner: <handle>`, `icon: 📥`, then one task `- [ ] Try Lumen: add a task with "tomorrow 9am for 30m" 🆔 <newId()>` (use `newId` from `shared/items.js`)
- `calendars/personal.md` → `name: Personal`, `color: blue`, `owner: <handle>`, `default: true`
- `docs/welcome.md` → `title: Welcome`, `owner: <handle>`, short markdown body (5–10 lines) explaining where data lives (folder/repo), and that tasks/events are plain markdown lines.
- if `chat`: `chat/channels.json` → `[{ "id": "general", "name": "general", "members": "everyone", "created": <iso>, "by": <handle> }]`

### `server/chat.js`
Implements the chat part of API.md over files `chat/channels.json` and `chat/<channel>/<yyyy-mm>.jsonl` (format in STORAGE.md). Write with `files.write` (channels) and `files.append` (messages).
- Channel ids: `[a-z0-9-]{1,40}` from the name; DM id `dm-<a>-<b>` with handles sorted.
- Visible to a user: `members === 'everyone'` or members includes their handle.
- Message: `{ id: newId(8), at: new Date().toISOString(), from: handle, text, reply? }`; text 1–4000 chars after trim.
- Reading history: walk month files newest → oldest, parse lines (skip bad JSON), fold edits (`edit: true` replaces text, sets `edited: true`) and deletes (`deleted: true` → keep the message with `deleted: true`, `text: ''`), return the last 100 before `before`, oldest first, plus `more`.
- Unread: count messages after `chat_reads.last_at` for that user and channel, not from themselves (only the current and previous month file need checking).
- Emits (via an EventEmitter export `chatEvents`) `message` `{ channel, message, members }` and `channels` so ws.js can broadcast.

### `server/git.js`
Git sync of the workspace folder (adapt ideas from obi: spawn `git`, auth with `http.extraHeader` Basic `x-access-token:<token>` set via `GIT_CONFIG_COUNT/KEY/VALUE` env, `GIT_TERMINAL_PROMPT=0`, scrub the token from all error text). Config is the `sync` setting (`getSetting/setSetting` in db.js): `{ remote, branch, authorName, authorEmail, interval (minutes, default 2), enabled, token (encrypted with config.encrypt) }`.
- `normalizeRepoUrl` (https only; `owner/repo` shorthand → github https; `git@github.com:o/r` → https). Local paths/`file://` only when `process.env.LUMEN_ALLOW_FILE_REMOTES === '1'` (tests).
- `configure(cfg)`: tests with `git ls-remote`, saves, (re)starts the loop.
- On start / configure: if the folder has no `.git`: `git init -b <branch>`, add `origin`. If the remote branch exists: fetch it; if the local folder has no commits yet, commit local files first (if any) then merge `origin/<branch>` with `--allow-unrelated-histories`.
- `syncNow()` (serialized, never two at once): `git add -A`; commit if anything changed (message `Lumen: update <n> file(s)`; author from config or `Lumen <lumen@localhost>`); `git fetch origin <branch>`; if it exists, `git merge --no-edit origin/<branch>`; on conflicts: for each conflicted file keep ours (`git checkout --ours`), write theirs (`git show :3:<file>`) next to it as `<name> (conflict yyyy-mm-dd hhmm).<ext>`, `git add -A`, commit. Then `git push origin HEAD:<branch>`. After any merge call `files.rescan()` so changes reach clients.
- Triggers: `files.events` `change` (not `external`) → debounce 8 s → `syncNow`; plus every `interval` minutes.
- `status()` per API.md; emit `status` events on change (EventEmitter export `syncEvents`).
- Missing `git` binary → status error "git is not installed".

### `server/ws.js`
`attachWs(httpServer)`: `ws` server on path `/ws`; authenticate with `userFromRequest(req)` (desktop: the local user). Track sockets per user. Broadcast:
- `files.events` `change` → per socket, only changes the user `canRead` (use `files.info(path)?.meta`; deleted paths: send if the user could read it before — keep the last meta you saw per path).
- chat `message` → sockets of channel members (`everyone` = all); `channels` → everyone.
- typing from client → other members of that channel.
- presence: on connect/disconnect broadcast `{ type: 'presence', online }` (handles).
- sync status → admin sockets.
- ping/pong; also a 30 s server heartbeat that terminates dead sockets.

### `server/api.js`
An `express.Router()` implementing every route of API.md (except desktop-only ones, which go in `desktop.js`). Middleware: JSON body (limit 3 MB), CSRF header check for non-GET, `req.user` from session, `requireUser`, `requireAdmin`. Map `HttpError`, `ConflictError` (409 with `current`), `RangeError` (400) to JSON errors; never leak stack traces.
- Files: `GET /api/files` filters `files.list()` with `canRead`. `PUT` uses `cleanPath`, then `files.write(path, text, { baseSha: sha, check })` where `check(cur)` computes `writeProblem(user, path, metaOf(path, cur?.text ?? ''), metaOf(path, text), !!cur)` and throws 403. `DELETE` similarly with `after = null`. Reading a file you can't read → 404 (don't reveal it exists).
- `POST /api/setup` only when `countUsers() === 0` (else 403); creates admin, seeds the workspace (`seedWorkspace({ handle, name, chat: true })`), signs in.
- Admin rules: can't demote/disable/delete yourself or the last admin; disabling ends their sessions.
- Invite `url`: `${PUBLIC_URL || req origin}/app.html#/invite/<token>`.

### `server/desktop.js`
Desktop mode (`config.DESKTOP`): one local admin user (email `local@lumen.desktop`, name from `os.userInfo().username`), created on first start; `desktopSessionToken()` returns a session token for it (the Electron shell sets the cookie). Workspace folder: setting `desktop.workspace` (default `<Documents>/Lumen`, Documents = `path.join(os.homedir(), 'Documents')`); routes `GET/PUT /api/desktop/workspace` (PUT opens the folder via `files.openWorkspace`, seeds if it has no `lumen.json` with `chat: false`), and `/api/desktop/sync` (GET/PUT/POST now) delegating to git.js. Mark `req.user.desktop = true` for every request in desktop mode (access.js relies on it). Chat routes answer 404 in desktop mode.

### `server/index.js`
- Express app, `app.set('trust proxy', TRUST_PROXY)`, security headers (`X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`, `X-Frame-Options: DENY` except nothing else), `compression` is NOT available — skip it.
- `await ensureEnvAdmin()`; open the workspace (`WORKSPACE_DIR`, or the desktop setting); if no users yet but ENV admin was created, seed for them; start git sync if configured.
- Static: `dist/` (built client). `GET /` → `dist/index.html` (landing) — but in desktop mode redirect `/` to `/app.html`. `GET /healthz` → `ok`. `/catalog/*` → static from the repo's `plugins/` folder (starter plugins + `registry.json`).
- `export const listening` = promise of the port once listening (HOST/PORT from config; PORT 0 allowed). `export async function stopServer()` — stop sync loop (one last `syncNow` if configured, max 10 s), close ws and http.
- Graceful SIGINT/SIGTERM → `stopServer()` then exit.
- Only call `listen` when run directly or imported by the desktop shell — i.e. always (tests import with `PORT=0`).

### `scripts/dev.js`
Runs `node --watch server/index.js` (PORT 3000, DATA_DIR ./data) and `vite` together; prefix output lines `[server]`/`[web]`; Ctrl-C stops both.

## Tests — `server/server.test.js` (node:test)
Start the server in a child process (`node server/index.js` with `PORT=0`? — simpler: pick a free port yourself, e.g. 0-bind trick, and pass `PORT`), `DATA_DIR` = a fresh temp dir, `LUMEN_ALLOW_FILE_REMOTES=1`. Use global `fetch` with a small cookie jar. Cover at least:
1. `/api/info` needsSetup → setup → info shows user; seeded files listed.
2. CSRF: PUT without `X-Lumen` → 403.
3. Files: create (sha null), update with right sha, 409 with stale sha (body has `current`), delete.
4. Access: admin invites a member (accept via token), member can't read admin's private list (404) nor list it; admin shares it (`share: [member]`) → member can read and edit; member can't change `share` (403); member can't write `plugins/x/manifest.json` (403); member creates own list with `owner: <their handle>` OK, with someone else's owner → 403.
5. Chat: post in general, list messages, edit own, can't edit other's, delete, DM visible only to the two.
6. Git sync to a local bare repo (`git init --bare` in temp) — configure, write a file, `POST /api/admin/sync/now`, then `git --git-dir=<bare> log --oneline` has a commit; skip this test if `git` isn't installed.
7. Login rate limit and wrong password → 401.

Done when: all routes in API.md exist and behave as specified, `npm test` passes (all old + new tests), and `node server/index.js` starts cleanly with `DATA_DIR=./data` (then stop it). Report anything in API.md you think is wrong instead of silently deviating.
