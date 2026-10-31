# Lumen plugins

A plugin adds a feature to Lumen without changing the app: a page in the
sidebar, commands in the command palette, a status-bar item, and code that can
keep running in the background. Plugins are installed from inside the app and
stored as text files in the workspace, so they sync with everything else.

## A plugin is a folder

```
plugins/focus-forest/
  manifest.json
  index.html        the entry (may load other files of the folder)
  main.js
  style.css
```

### manifest.json

```json
{
  "id": "focus-forest",
  "name": "Focus Forest",
  "version": "1.0.0",
  "description": "Grow a tree while you focus.",
  "author": "Lumen",
  "entry": "index.html",
  "files": ["index.html", "main.js", "style.css"],
  "icon": "trees",
  "permissions": ["tasks:read", "tasks:write", "notify", "storage"],
  "background": false,
  "view": { "title": "Focus", "icon": "trees" },
  "commands": [{ "id": "start", "title": "Start a focus session" }],
  "statusBar": true,
  "minLumen": "0.1.0"
}
```

| field | |
|---|---|
| `id` | lowercase letters, digits and `-`; the folder name |
| `files` | every file of the plugin (the installer copies exactly these; text files only, ≤ 512 KB each) |
| `icon` / `view.icon` | a [Lucide](https://lucide.dev/icons) icon name |
| `view` | the plugin gets a page in the sidebar showing its entry |
| `background` | `true`: the entry is loaded when Lumen starts and keeps running while you use other pages |
| `commands` | appear in the command palette as "<Plugin name>: <title>"; running one sends a `command` event |
| `statusBar` | the plugin may show a short text in the status bar (`lumen.ui.setStatus`) |

### Permissions

| permission | allows |
|---|---|
| `storage` | always granted: the plugin's own files under `data/plugins/<id>/<you>/` |
| `tasks:read` | reading your tasks (all lists you can see) |
| `tasks:write` | creating, changing and completing tasks |
| `calendar:read` / `calendar:write` | the same for calendar events |
| `notify` | in-app toasts and desktop notifications |
| `system:activity` | the desktop app's record of which apps you use (desktop only) |
| `network` | `fetch` to the internet (otherwise blocked by the sandbox) |

Lumen shows the permissions when you install a plugin and records the ones you
granted in `lumen.json`. A call needing a permission that wasn't granted is
rejected with an error.

## The sandbox

Each plugin runs in its own `<iframe sandbox="allow-scripts allow-forms">` built
from `srcdoc` — an opaque origin with no access to Lumen's page, cookies or
storage. Lumen inlines the entry's local `<script src>` and `<link rel=stylesheet>`
files, adds the SDK (below) before them, and adds a Content-Security-Policy:

```
default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline';
img-src data: blob:; font-src data:; connect-src <none, or https: with "network">
```

What the sandbox can't stop: a plugin can still navigate its own frame to an
outside address (CSP has no rule for that), which could leak what it was allowed
to read. Install plugins you trust — the permission prompt shows exactly what
each one can read.

The page's theme (light/dark and the colour tokens) is applied to the plugin's
`:root` as CSS variables, so `var(--bg)`, `var(--text)`, `var(--accent)` etc.
work inside the plugin and follow theme changes. Plugin pages should style
themselves with them.

## The SDK: `window.lumen`

Every method returns a promise. Under the hood it is `postMessage` RPC:
`{ lumen: 1, id, method, params }` → `{ lumen: 1, id, result }` or `{ lumen: 1, id, error }`.

```js
// about Lumen and you
await lumen.app.info()          // { version, mode: 'github'|'server'|'desktop', user: { handle, name }, theme: 'light'|'dark' }

// storage (your own files of this plugin)
await lumen.storage.get('settings')           // parsed JSON of settings.json, or null
await lumen.storage.set('settings', { a: 1 }) // writes settings.json
await lumen.storage.read('notes.txt')         // text or null
await lumen.storage.write('notes.txt', 'hi')
await lumen.storage.append('sessions.jsonl', JSON.stringify(row) + '\n')
await lumen.storage.list('days/')             // ['days/2026-10-31.json', …]
await lumen.storage.remove('old.json')

// tasks — items are the objects from shared/items.js plus { path, list: { name, color } }
await lumen.tasks.list({ open: true, date: '2026-10-31' })   // filters: open, date, from, to, tag, list (path), q
await lumen.tasks.lists()                                      // [{ path, name, color, icon }]
await lumen.tasks.create({ title, list?, date?, time?, duration?, priority?, notes? }) // → item
await lumen.tasks.update(path, id, patch)                      // patch as in updateItem
await lumen.tasks.complete(path, id)

// calendar
await lumen.calendar.list({ from, to })   // expanded occurrences (shared/calendar.js expand)
await lumen.calendar.create({ title, date, time?, duration?, calendar? })

// talking to you
await lumen.notify({ title, body })       // needs "notify"
await lumen.ui.setStatus('🌳 18:42')      // status bar text ('' clears); needs statusBar
await lumen.ui.setBadge('3')              // badge on the sidebar entry ('' clears)
await lumen.ui.open()                     // show this plugin's page

// the computer (desktop app, "system:activity")
await lumen.system.activity.status()     // { available, tracking, current: { app, title?, since, idle } }
await lumen.system.activity.day('2026-10-31') // { segments: [{ app, title?, start, end }], idleMs, switches }
await lumen.system.activity.setTracking(true)

// events
lumen.on('theme', ({ theme, tokens }) => {})
lumen.on('command', ({ id }) => {})
lumen.on('visibility', ({ visible }) => {})    // the plugin's page shown/hidden in Lumen
lumen.on('app-focus', ({ focused }) => {})     // Lumen's window gained/lost focus
lumen.on('task.completed', ({ path, id, title }) => {})
```

## Installing

Settings → Plugins (admins only in server mode):

- **Catalog** — the starter plugins that ship with Lumen (`plugins/registry.json`
  in this repository, served by the app).
- **From GitHub** — `owner/repo` or `owner/repo/path/to/plugin`: Lumen reads
  `manifest.json` there and downloads the files it lists.
- **From a folder** — pick a plugin folder on your computer.

Installing copies the files into `plugins/<id>/` and records the plugin and its
granted permissions in `lumen.json`. Each person can switch an installed plugin
off for themselves (Settings → Plugins); that's kept in their own settings file.
Uninstalling removes the folder (the plugin's data stays, under `data/plugins/<id>/`).

## Starter plugins

- **Focus Forest** (`plugins/focus-forest`) — a focus timer in the spirit of
  Forest: pick a task and a duration, a tree grows on a hill while you focus
  (the sky follows the time of day), giving up leaves a withered tree, and
  your sessions fill a meadow day by day.
- **Usage Monitor** (`plugins/usage-monitor`) — on the desktop app, records which
  applications you use, splits time into productive / neutral / distracting,
  shows a timeline, totals and a focus score per day, week and month, and can
  warn you when distracting time passes a limit.
