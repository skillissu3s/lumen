# Brief 06 — "Usage Monitor" plugin

Read `AGENTS.md` and `docs/PLUGINS.md` (use only the documented SDK). Create ONLY files in `plugins/usage-monitor/`: `manifest.json`, `index.html`, `main.js`, `style.css` (split `charts.js` if useful). Plain browser JS, no frameworks, no network, no localStorage/cookies (sandboxed iframe) — persist only via `lumen.storage`.

`index.html` loads `<script src="../_dev/mock-lumen.js" data-lumen-dev></script>` first (stripped inside Lumen), then the CSS and scripts. It must run from a static server at the repo root, e.g. `http://localhost:5199/plugins/usage-monitor/index.html` — the mock returns fake but realistic activity days.

manifest: id `usage-monitor`, name "Usage Monitor", version 1.0.0, icon/view.icon "activity", view.title "Usage", permissions `["storage", "system:activity", "notify"]`, `background: true`, `statusBar: false`, commands `pause` ("Pause tracking"), `resume` ("Resume tracking"), `files` listing every file.

Inspired by open-source focus trackers (flowstate-style): Lumen's desktop app records which application is in front and the system idle time; this plugin turns that into insight.

## Behaviour
- On start: `lumen.system.activity.status()`. If `available` is false (web version), show a friendly empty state: "Usage tracking needs the Lumen desktop app" with one line on what it would show, and stop.
- **Today** view (default):
  - Header: date with ‹ › to move between days, and a Day / Week / Month segmented control.
  - Summary cards: Active time, Productive, Distracting, Focus score (0–100 = productive ÷ (productive + distracting) weighted: score = round(100 × (productive + 0.5 × neutral) ÷ active)), Idle, App switches.
  - **Timeline**: a horizontal bar for the day (from first to last activity, at least 8:00–18:00), each segment coloured by category (productive `--c-green`, neutral `--c-gray`, distracting `--c-red`), hover/focus shows app, time range and duration. Hour ticks below.
  - **Top apps**: list sorted by time with a bar, duration, and a category select per app (Productive / Neutral / Distracting) — changing it saves to settings and recomputes everything.
  - **Longest focus stretch**: the longest run of productive time with < 2 min interruptions.
- **Week / Month** view: a bar per day (stacked by category), totals, average focus score, best day; click a day → Today view for that day.
- Live: while viewing today, refresh every 60 s; show "Tracking" / "Paused" status with a toggle (`setTracking`), and the current app.
- **Limits**: in settings, a daily limit for distracting time (minutes, off by default). In the background (the plugin stays loaded), check every 5 min; when today's distracting time first passes the limit → `lumen.notify({ title: 'Distracting time limit reached', body: '…' })` (once per day — remember in storage).
- **Daily summaries**: after computing a past day (or at day change for yesterday), save `days/<yyyy-mm-dd>.json` with `{ date, activeMs, idleMs, switches, byApp: { app: ms }, byCategory: { productive, neutral, distracting }, score }`, so history survives even if the desktop app's raw log is cleared and syncs to other devices. Week/Month views use summaries when present, otherwise ask `activity.day()`.
- **Settings** panel: categories per app (with sensible defaults: Code, Visual Studio Code, Terminal, Windows Terminal, Figma, Lumen, Obsidian, Notion → productive; Slack, Teams, Outlook, Mail → neutral; YouTube, Netflix, Steam, Discord, Instagram, Reddit, TikTok → distracting; everything else neutral; matching is case-insensitive substring), the distracting limit, "Record window titles" note (that's a desktop app setting — just explain where it is), and "Clear saved summaries".
- Commands `pause`/`resume` via `lumen.on('command')`.

## Look
Theme variables only (`var(--bg)`, `var(--surface)`, `var(--border)`, `var(--text)`, `var(--text-muted)`, `var(--c-green)`, `var(--c-red)`, `var(--c-gray)`, `var(--accent)`), so it follows Lumen's theme. Clean dashboard, no chart library — SVG or divs. Tabular numerals; durations like "3 h 12 min". Responsive to 360 px. Accessible: charts have text alternatives (a visually hidden table or `aria-label`s), all controls keyboard-operable.

Done when it works end-to-end with the mock SDK (days navigate, categories change and persist, week/month views render). Report what you built and how you tested it.
