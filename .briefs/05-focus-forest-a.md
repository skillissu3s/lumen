# Brief 05 — "Focus Forest" plugin (variant a)

Read `AGENTS.md` and `docs/PLUGINS.md` (the plugin format and the `window.lumen` SDK — use only what's documented there). Create ONLY files in `plugins/focus-forest-a/`:
`manifest.json`, `index.html`, `main.js`, `style.css` (and `trees.js` if you want the tree drawings separate). Plain browser JS (no imports from the app, no build step, no frameworks, no network). Everything must work inside a sandboxed iframe with an opaque origin: **no localStorage, no cookies** — persist only through `lumen.storage`.

For development, `index.html` must load the mock SDK first with `<script src="../_dev/mock-lumen.js" data-lumen-dev></script>` (Lumen strips that tag). Then `<link rel="stylesheet" href="style.css">` and `<script src="main.js"></script>` (plus `trees.js` before main if used). It must run by opening `http://localhost:<port>/plugins/focus-forest-a/index.html` from a static server at the repo root (e.g. `npx vite --root . --port 5199` or `python -m http.server`).

manifest: `id` = `focus-forest` (yes, the same id for both variants), name "Focus Forest", version 1.0.0, `icon`/`view.icon` "trees", `view.title` "Focus", permissions `["storage", "tasks:read", "tasks:write", "notify"]`, `background: true` (the timer must keep running when you switch to another page of Lumen), `statusBar: true`, commands `start` ("Start a focus session"), `stop` ("Give up the current session"), `files` listing every file.

## What it does (in the spirit of the Forest app)
1. **Plant**: choose a duration (presets 15, 25, 45, 60, 90 min + a slider 10–180 in 5-min steps), optionally pick a task to focus on (from `lumen.tasks.list({ open: true })`, a searchable select; today's tasks first), optionally a tag (free text, remembered), and a tree species (at least 4: oak, pine, cherry blossom, cactus — each drawn as inline SVG). Big "Plant" button.
2. **Growing**: a large circular progress ring with the tree in the centre growing through **5 visible stages** (seed → sprout → sapling → young tree → full tree) as time passes, remaining time in big tabular numerals, the task name under it, and a "Give up" button (asks to confirm — giving up kills the tree). `lumen.ui.setStatus('🌳 18:42')` every second while running, `''` when idle.
3. **Strict mode** (setting, off by default): if Lumen's window loses focus (`app-focus` event, `focused: false`) for more than 10 s during a session, the tree withers (warn with `lumen.notify` at the first second away: "Come back to keep your tree alive").
4. **Done**: when time is up → `lumen.notify({ title: 'Your tree has grown', body })`, a celebration state (tree complete, total today), buttons "Take a break" (5 min, or 15 after every 4th session; a break timer, no tree), "Mark task done" (if a task was chosen → `lumen.tasks.complete(path, id)`), "Plant another".
5. **Forest**: a tab showing your trees as a garden — a grid of small tree drawings (dead ones withered/grey) for **Today / Week / Month / Year**, with totals: focused time, trees grown, trees lost, current streak (days in a row with ≥ 1 grown tree), and a per-tag and per-task breakdown (simple horizontal bars, no chart library). Tapping a tree shows its session (time, duration, task, tag).
6. **Settings** (small panel): default duration, default species, strict mode, break lengths, sound on finish (a short WebAudio chime, generated — no audio files).

## Data
- `sessions.jsonl` via `lumen.storage.append`: one line per finished session: `{ "id", "start": iso, "end": iso, "planned": minutes, "actual": minutes, "status": "grown"|"dead", "species", "task": { "path", "id", "title" } | null, "tag": string | null }`.
- `current.json` via `lumen.storage.set('current', …)`: the running session `{ start, planned, species, task, tag }` so a reload of Lumen resumes it (if its end time already passed while closed → it counts as grown). Clear it when finished.
- `settings.json` via `lumen.storage.get/set('settings')`.
- Commands: listen to `lumen.on('command', ({ id }) => …)`: `start` plants with the defaults, `stop` gives up.

## Look
Use the theme variables (`var(--bg)`, `var(--surface)`, `var(--text)`, `var(--text-muted)`, `var(--border)`, `var(--accent)`, `var(--c-green)`, …) so it follows Lumen's light/dark theme; listen to `lumen.on('theme', …)` only if you need to redraw. Calm, professional, generous spacing; the tree is the only illustration. Tabular numerals for times. Must look right from 360 px wide to a full page. Keyboard accessible (all controls reachable, visible focus, the ring has `role="timer"` with an `aria-label` updated every minute).

Variant direction: Minimal and centred: one column, the ring and tree dominate the Plant/Growing screens, the forest is a calm square grid of small trees on soft ground tiles.

Done when it fully works with the mock SDK in a browser (plant → grow → finish/give up → forest stats persist across reloads via mock storage). Report what you built and how you tested it.
