# Brief 03a — client core: build setup, storage backends, stores, actions

Read first: `AGENTS.md`, `docs/ARCHITECTURE.md`, `docs/STORAGE.md`, `docs/API.md`. No UI in this brief (another agent builds the UI against the APIs you write here — **keep every export name exactly as specified**).

Create only these files: `vite.config.js`, `client/app.html`, `client/public/favicon.svg`, `client/public/manifest.webmanifest`, and everything under `client/src/lib/`, `client/src/storage/`, `client/src/store/`, plus `client/src/main.jsx` (minimal: imports `./styles/tokens.css`, `@fontsource-variable/inter`, renders `<App />` from `./App.jsx`) and a placeholder `client/src/App.jsx` that renders "Lumen" (the UI agent replaces it). Tests: `client/src/**/*.test.js` (node:test, no DOM).

## Build — `vite.config.js`
- `root: 'client'`, `base: './'`, `build.outDir: '../dist'`, `emptyOutDir: true`, inputs `client/index.html` (landing page — may not exist yet; create an empty-ish placeholder `client/index.html` only if missing, with a link to `app.html`) and `client/app.html`.
- `@vitejs/plugin-react`. Dev server port 5173 proxying `/api`, `/ws` (ws: true), `/catalog`, `/healthz` → `http://localhost:3000`.
- A tiny inline plugin that, at `closeBundle`, copies the repo's `plugins/` folder (if it exists) into `dist/catalog/`; and in dev serves `/catalog/*` from `plugins/` when the API server isn't running (fallback middleware is fine to skip — proxy is enough).
- No path aliases: client code imports shared modules with relative paths (`../../../shared/items.js`) so the same files run under `node --test`.
- `client/app.html`: `<div id="root">`, title "Lumen", theme-color, `color-scheme` meta, favicon, manifest, a tiny inline script that sets `document.documentElement.dataset.theme` from `localStorage['lumen.theme']` (values `light|dark|system`; system → matchMedia) before paint.

## `client/src/lib/`
- `router.js` — hash router. `parseHash(hash)` → `{ path, parts: [...], query: {...} }`; `navigate(path, { replace })`; React hook `useRoute()`. Paths like `/calendar?view=week&date=2026-11-02`, `/list/inbox`, `/docs/notes/a.md`, `/plugin/focus-forest`.
- `api.js` — `api(method, path, body)` for server mode: `fetch('api' + path)` (relative, works under any base), JSON in/out, header `X-Lumen: 1` on non-GET, `credentials: 'same-origin'`. Throws `ApiError { status, message, body }`.
- `socket.js` — `connectSocket()` to `ws(s)://<host><dir of location.pathname>ws`; auto-reconnect with backoff (1s → 15s), heartbeat ping every 25 s; `onSocket(type, fn)` → unsubscribe; `sendSocket(msg)`; `socketState()` + `onSocketState(fn)` ('connecting'|'open'|'closed').
- `emitter.js` — a tiny `createEmitter()` → `{ on, off, emit }`.
- `idb.js` — minimal IndexedDB key-value (`idbGet`, `idbSet`, `idbDel`) used for the GitHub blob cache; must no-op gracefully when IndexedDB isn't available (tests).
- `slug.js` — `slugify(name)` (lowercase, a-z0-9 and `-`, max 48, fallback `untitled`), `uniquePath(dir, name, ext, existingPaths)` → `lists/groceries-2.md` etc.

## `client/src/storage/` — backends (same interface)
`export class ConflictError extends Error { current /* {text, sha} | null */ }` in `storage/errors.js`, plus `AuthError` (401/403 token problems) and `OfflineError`.

Interface (both backends):
```js
backend.kind                       // 'server' | 'github'
await backend.list()               // → [{ path, sha }]
await backend.readMany(paths)      // → { [path]: { text, sha } | null }
await backend.write(path, text, sha)  // sha null = create. → { sha }. ConflictError if moved on.
await backend.remove(path, sha)
backend.subscribe(fn)              // fn(changes: [{ path, sha, deleted }]); returns unsubscribe
backend.start() / backend.stop()   // begin/stop listening for remote changes
```

### `storage/server.js` — `createServerBackend()`
Over `api.js` and `socket.js` per docs/API.md (`GET /api/files`, `POST /api/files/read` in chunks of 200, `PUT`/`DELETE /api/files`; 409 → `ConflictError(body.current)`). `subscribe` listens to socket `files` messages. On socket reconnect, emit a synthetic full refresh: call `list()` and emit changes for every path whose sha differs from the last list (keep a map).

### `storage/github.js` — `createGitHubBackend({ token, owner, repo, branch })`
REST v3 at `https://api.github.com`, headers `Authorization: Bearer <token>`, `Accept: application/vnd.github+json`, `X-GitHub-Api-Version: 2022-11-28`.
- `list()`: `GET /repos/{o}/{r}/git/trees/{branch}?recursive=1` → blobs whose path is a text file (`.md .json .jsonl .js .css .html .svg .txt .ics`) and not under `.git`/`.obsidian`/`node_modules`. A 409 "Git Repository is empty" or 404 for the branch on an empty repo → `[]`.
- `readMany(paths)`: needs each file's blob sha (from the last `list()`; call `list()` if unknown). Content cache in IndexedDB keyed by `blob:<sha>`; otherwise `GET /repos/{o}/{r}/git/blobs/{sha}`, decode base64 → UTF-8 with `TextDecoder`. Concurrency 6.
- `write(path, text, sha)`: `PUT /repos/{o}/{r}/contents/{encodeURI(path)}` `{ message: 'Lumen: update <path>' (or 'Lumen: add <path>'), content: base64(UTF-8), branch, sha? }`. **All writes and removes go through one global queue** (the GitHub ref can't take parallel commits). On 409/422: GET the file's current sha (`GET /contents/{path}?ref=branch`); if it equals our `sha` the failure was a race on the branch → retry (max 3); else throw `ConflictError({ text, sha })` with the current content. Update the known-sha map and blob cache after success.
- `remove(path, sha)`: `DELETE /contents/{path}` `{ message, sha, branch }`, same queue/409 handling.
- Remote changes: when started, poll `GET /repos/{o}/{r}/branches/{branch}` every 30 s while `document.visibilityState === 'visible'` and immediately on window `focus`/`online`, with `If-None-Match` ETag (304 costs no rate limit). When the head commit sha changed and it wasn't our own write, `list()` and emit the paths whose sha changed (deleted ones with `deleted: true`).
- 401 → `AuthError('Your GitHub token is no longer valid')`; 403 with `x-ratelimit-remaining: 0` → error saying when the limit resets.
- Helpers exported from the same file: `githubUser(token)` (GET /user), `listRepos(token)` (GET /user/repos?per_page=100&sort=updated&affiliation=owner,collaborator), `repoInfo(token, owner, repo)` (default branch, permissions.push, empty?).

## `client/src/store/` (zustand)

### `session.js` — `useSession`
State: `{ status: 'booting'|'signed-out'|'needs-setup'|'ready'|'error', mode: 'server'|'desktop'|'github'|null, info, user /* { handle, name, email?, role } */, github /* { owner, repo, branch, login } */, error }`.
Actions:
- `boot()`: `GET api/info` (timeout 4 s). JSON with `app: 'lumen'` → mode `info.mode`; `user` present → `ready`, `needsSetup` → `needs-setup`, else `signed-out`. Anything else (404, HTML, network error) → GitHub mode: read `localStorage['lumen.github']` `{ token, owner, repo, branch }`; if present, `githubUser(token)` → user `{ handle: login, name: name||login, role: 'admin' }` → `ready`; if missing → `signed-out`.
- `login(email, password)`, `setup({ email, name, password })`, `acceptInvite(token, {...})`, `logout()` (server); `connectGitHub({ token, owner, repo, branch })` (validates with `repoInfo`, needs `permissions.push`, saves to localStorage) and `disconnectGitHub()`.
- `backend()` → the backend instance for the current mode (memoized).

### `workspace.js` — `useWorkspace` (the heart — read carefully)
State:
```js
{
  status: 'idle'|'loading'|'ready'|'error', error,
  files: { [path]: { text, sha } },   // current LOCAL text (pending edits applied) and the last known REMOTE sha
  paths: [ ...every path in the workspace, loaded or not ],
  saving: { state: 'saved'|'saving'|'offline'|'error', pending: 0, error: null, lastSaved: null },
}
```
Which files are loaded at start (`load()`): `lumen.json`, all `lists/*.md`, `calendars/*.md`, `plugins/*/manifest.json`, `users/<me>/settings.json`, `chat/channels.json` is NOT loaded (server API). Docs content is loaded lazily via `ensure(path)`. After load: `backend.start()`, subscribe to remote changes. If the workspace has no `lumen.json` and the mode is github, seed it with `seedFiles` from `shared/seed.js` (`handle` = user.handle, `chat: false`) — write each file.

Edits — **operation queue per file**:
```js
await edit(path, op, { create = false } = {})   // op: (text) => newText. Applies at once (optimistic).
await setText(path, newText)                      // for docs: a 'text' op that remembers the text it was based on
await createFile(path, text)                      // sha null
await removeFile(path)
await ensure(path) → { text, sha }                // load on demand
```
Per path keep `{ base: { text, sha } | null, ops: [], inflight: null, timer }`. Local text = ops applied in order to `base.text`. Debounce writes: 400 ms (server), 1500 ms (github); flush immediately on `beforeunload`/`visibilitychange→hidden` when possible. Flushing writes the local text with `base.sha`; ops added while a write is in flight stay queued for the next write. On success → base = { text: writtenText, sha }, drop the written ops. On `ConflictError(current)` → base = current, **re-apply the pending ops** to it (a 'text' op uses `rebaseText(op.base, op.text, current.text)` from `shared/merge.js`; a function op that throws, e.g. `ItemMissingError`, is dropped and reported via `onProblem`), then retry (max 5 in a row, then `saving.state = 'error'`). Network failure → `saving.state = 'offline'`, retry with backoff, keep ops (persist pending ops' resulting text per path in localStorage `lumen.pending.<scope>` so a reload can replay them as 'text' ops; scope = mode+repo/user).
Remote change for a path (subscription): no pending ops → fetch and replace; pending ops → set base to the remote version and re-apply (same as conflict). Deleted remotely with no pending ops → drop it.
`onProblem(fn)` export: subscribe to human-readable problems (`{ message }`) for toasts.

Derived data — **selectors with per-file memoization** (parse a file only when its text changed), exported from `store/derived.js`:
- `selectLists(state)` → `[{ path, id (file name without .md), name, color, icon, owner, share, sections, items (top-level), all (Map) }]` from `parseItems(text)`; sorted by name, Inbox first (path from `lumen.json.inbox`, default `lists/inbox.md`).
- `selectCalendars(state)` → same shape plus `default`, from `parseItems(text, { events: true })`.
- `selectAllItems(state)` → every item (subtasks included, `flatItems`) from lists and calendars, each copied with `{ path, source: { kind: 'list'|'calendar', name, color, icon } }`.
- `selectConfig(state)` → parsed `lumen.json` (or defaults).
- `selectPlugins(state)` → `[{ id, manifest, granted: [perms] }]` for manifests present AND listed in `lumen.json.plugins`.
- `selectDocs(state)` → `[{ path, title (front matter title or file name), folder }]` from `paths` (titles of unloaded docs = file name).

### `prefs.js` — `usePrefs`
Per-person settings in `users/<handle>/settings.json` (through `useWorkspace.edit`, JSON merge). `DEFAULT_PREFS`:
```js
{ theme: 'system', accent: 'indigo', density: 'default', weekStart: 1, timeFormat: '24h' (12h if navigator.language is en-US),
  calendar: { view: 'week', dayStart: 6, dayEnd: 23, hourHeight: 48, snap: 15, defaultDuration: 30, showWeekends: true,
    showWeekNumbers: false, showCompleted: true, showTasks: true, colorBy: 'calendar', workStart: 9, workEnd: 17,
    highlightWork: true, timeline: { showGaps: true }, hidden: [], defaultCalendar: null },
  tasks: { defaultList: null, showCompleted: false, view: 'list', groupBy: 'section', sort: 'manual' },
  plugins: { disabled: [] }, sidebar: { collapsed: false } }
```
`usePrefs()` returns merged prefs (deep merge with defaults); `setPrefs(patch)` deep-merges and saves; `applyTheme(prefs)` sets `data-theme` (resolving system + listening to changes), `data-accent`, `data-density` on `<html>` and mirrors theme to `localStorage['lumen.theme']`.

### `ui.js` — `useUI`
Toasts `{ id, message, action?: { label, run }, tone }` (`toast(message, opts)`, auto-dismiss 5 s), `paletteOpen`, `openPalette/closePalette`, a command registry (`registerCommands(source, [{ id, title, section, shortcut?, run }])` → unregister; `commands()`), `selection` for views.

## `client/src/lib/actions.js` — what views call
All built on `useWorkspace.getState().edit(...)` with `shared/items.js` functions. Undo via toast where noted.
- `addTask(listPath, typedOrFields, where = {})` — a string goes through `parseQuickAdd`; returns new id.
- `addEvent(calendarPath, fields)`; `updateItem(path, id, patch)` (events: pass `{ events: true }` for calendar paths automatically — decide by path prefix `calendars/`)
- `toggleTask(path, id)` (done ↔ open; toast "Completed" with Undo that reopens — and for repeating tasks also removes the spawned next occurrence by its id)
- `deleteItem(path, id)` with Undo (re-inserts the removed block where it was: remember the previous sibling id)
- `moveItem(path, id, where)`; `moveItemToFile(fromPath, id, toPath, where)` (remove from one, insertBlock into the other)
- `skipOccurrence(path, id, date)`, `endSeriesBefore(path, id, date)`, `detachOccurrence(path, id, date, patch)` (skip that date in the series and add a standalone copy with the patch applied)
- `createList({ name, color, icon, share })` → path (`uniquePath('lists', name, 'md', paths)`, front matter with `owner: me`); `updateListMeta(path, patch)` (setFrontMatter); `deleteList(path)`
- `createCalendar(...)`, `updateCalendarMeta`, `deleteCalendar` — same for `calendars/`
- `createDoc({ title, folder })` → path; `saveDoc(path, text)` (setText); `renameDoc(path, title)` (front matter only); `deleteDoc(path)`
- `importIcs(calendarPath, icsText)` → `{ added, warnings }`; `exportIcs(calendarPathOrAll)` → text

## Tests
`client/src/store/workspace.test.js` with a fake in-memory backend (inject it — make `useWorkspace` accept a backend via `initWorkspace({ backend, user, mode })`): optimistic edit visible at once; two quick edits → one write; conflict → ops re-applied on the newer text (e.g. remote added a task while we toggled another → both survive); op that throws on rebase is dropped and reported; remote change with no pending ops replaces text; text op rebase for docs. Also `client/src/lib/router.test.js` for `parseHash`, `client/src/lib/slug.test.js`.

Done when: `npm test` passes (old + new), `npx vite build` succeeds, and no file outside the list above was changed. In your final message list every exported function per file.
