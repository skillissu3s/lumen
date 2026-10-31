# Brief 08 — desktop app (Electron) + activity tracker

Read `AGENTS.md`, `docs/ARCHITECTURE.md` (Desktop app), `docs/API.md` (desktop routes), `docs/PLUGINS.md` (`system.activity`), and `server/index.js`, `server/desktop.js`, `server/config.js`. Create ONLY `desktop/main.js`, `desktop/preload.cjs`, `desktop/activity.js`, `desktop/activity-win.ps1` (if you use PowerShell), `desktop/updates.js`, `desktop/icon.png` generation script `scripts/make-icon.cjs` (+ run it to produce `desktop/icon.png` 512×512 and `client/public/favicon.svg` if missing — a simple geometric mark in the accent indigo `#4f46e5`, matching the landing page mark in `client/index.html`), and `desktop/activity.test.js`. Electron 44 is installed (`npx electron`).

## main.js (ESM; adapt the proven design from the owner's obi app — summarised here)
- Single instance lock; focus the existing window on second launch.
- Before importing the server: `process.env.LUMEN_DESKTOP = '1'`, `NODE_ENV=production`, `DATA_DIR = <userData>/data` (override `LUMEN_DATA_DIR`), `HOST=127.0.0.1`, `PORT` = first free port from 7720–7731 (stable port keeps the page's localStorage), override `LUMEN_PORT`.
- `const server = await import('../server/index.js'); const port = await server.listening`. Set the session cookie for `http://127.0.0.1:<port>` with `desktopSessionToken()` from `server/desktop.js` (httpOnly, sameSite lax, 30 days) and load `<base>/app.html`.
- Window: 1320×860, min 420×480, `show: false` until ready, `backgroundColor` by `nativeTheme`, `autoHideMenuBar`, icon, Windows: `titleBarStyle: 'hidden'` + `titleBarOverlay` 34 px (colours updatable from the page via IPC); `contextIsolation`, `sandbox: true`, preload.
- External links open in the browser (`setWindowOpenHandler`, `will-navigate`); only http(s)/mailto.
- `before-quit`: `await server.stopServer()` (max 10 s) then quit. Error during start → `dialog.showErrorBox` and exit.
- IPC: `lumen:pick-folder` (dialog), `lumen:reveal` (shell.openPath), `lumen:titlebar` (colours), `lumen:reauth` (fresh cookie), `lumen:notify` (`new Notification({ title, body }).show()`), activity calls (below), update calls (below).
- Tray is not needed. Power: when the system resumes from sleep, tell the activity tracker.
- `LUMEN_SCREENSHOT=file.png` env: capture the window 2.5 s after load to that file (for docs/QA), then keep running.

## preload.cjs
`contextBridge.exposeInMainWorld('lumenDesktop', { platform, titleBar: platform === 'win32', setTitleBarColors, pickFolder, reveal, reauth, notify, activity: { status, day, setTracking, settings, setSettings }, updates: { state, check, install, onChange } })`.

## activity.js — the computer-usage tracker (used by the Usage Monitor plugin)
- Samples the **foreground application** every 5 s:
  - Windows: one long-running `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File activity-win.ps1` that uses `Add-Type` (C#: `GetForegroundWindow`, `GetWindowThreadProcessId`, `GetWindowText`) and prints one JSON line per sample `{ "app": <process MainModule FileVersionInfo.FileDescription or ProcessName>, "exe": "<name>.exe", "title": "<window title>" }`, sleeping 5 s between; restart it if it dies (with backoff). Watch out for packaged apps: the script file must be read from the asar-unpacked location (`app.asar.unpacked`) or written to a temp file at runtime — writing the script text to `os.tmpdir()` at start is the simplest robust option.
  - macOS: `osascript -e 'tell application "System Events" to get name of first application process whose frontmost is true'` every 5 s (title optional, skip).
  - Linux: `xdotool getactivewindow getwindowname` + `xprop -id … WM_CLASS` when available; otherwise mark unavailable.
- Idle: `powerMonitor.getSystemIdleTime()`; idle ≥ 120 s (setting) → the current segment ends and an idle period starts; also treat lock/suspend (`powerMonitor` events `lock-screen`, `suspend`) as idle.
- Segments: consecutive samples of the same app merge into `{ app, title?, start, end }` (ms). Window titles are recorded **only if** the setting `recordTitles` is on (default **off** — privacy). Append finished segments as JSON lines to `<userData>/activity/<yyyy-mm-dd>.jsonl` (split at midnight), flush the open segment every 60 s so a crash loses little.
- API (via IPC): `status()` → `{ available, tracking, current: { app, title?, since, idle } }`; `day(iso)` → `{ segments, idleMs, switches }` read from that day's file (+ the open segment if today); `setTracking(bool)` (persisted); `settings()`/`setSettings({ idleSeconds, recordTitles, excluded: [apps] })` persisted in `<userData>/activity/settings.json`. Excluded apps are recorded as "Private".
- Retention: delete raw files older than 90 days on start.
- Never throw into the main process; log and mark unavailable.
- `activity.test.js`: the pure parts (segment merging, idle splitting, midnight split, day summary) with fake samples.

## updates.js
`electron-updater` is NOT installed — implement a light check instead: on start (+10 s) and every 6 h, `GET https://api.github.com/repos/skillissu3s/lumen/releases/latest`; if its tag is newer than `app.getVersion()`, state `{ available: true, version, url }`; `install()` opens the release page in the browser. Expose `state`, `check`, `install`, `onChange` via IPC.

## Also
- The page knows it's on the desktop via `window.lumenDesktop`; Settings (another agent) will call `pickFolder` then `PUT /api/desktop/workspace`.
- Check `server/desktop.js` exports what you need; fix minimally if not and report it.

Done when: `npm test` passes, and `npx electron .` (after `npx vite build`) starts, shows the app signed in as the local user with the seeded workspace in `~/Documents/Lumen` (**never touch the real Documents folder while testing**: run with a temp `LUMEN_DATA_DIR` and `WORKSPACE_DIR=<temp dir>`; make sure `server/desktop.js` lets an explicitly set `WORKSPACE_DIR` env win over its Documents default — fix it if not), and `activity.status()` reports `available: true` on Windows. Use `LUMEN_SCREENSHOT` to capture proof and mention the file path. Report what you verified.
