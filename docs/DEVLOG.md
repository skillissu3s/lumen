# Lumen — development log

A running record of what was built, why, and what's left. Newest entries at the
bottom of each day.

## 2026-10-31

### Starting point
- Lumen is a new repository, separate from [obi](https://github.com/skillissu3s/obi)
  (which stays focused on note taking). Ideas and some code are carried over from
  obi: the Obsidian-Tasks line format and its natural-language quick add, the
  embedded-server desktop design, and git sync.
- Goals (from the brief): personal productivity app; tasks + calendar built in,
  plus chat and docs; landing page with sign-in; admin-only invites; GitHub as
  the source of truth so it works for one person without a server, but can also
  run online; a calendar inspired by Structured and fully customizable and
  accessible; a plugin system with two starter plugins (a Forest-like focus timer
  and a computer-usage monitor inspired by flowstate-style trackers); a
  professional, uncluttered UI; web and desktop builds; everything stored as text.

### Design decisions
- **Three run modes, one client** — GitHub mode (browser ↔ GitHub API, no
  server), server mode (self-hosted, multi-user) and the desktop app (embedded
  server, local folder). See [ARCHITECTURE.md](ARCHITECTURE.md).
- **Storage is a file API; all logic is in the client/shared code.** That's what
  makes GitHub mode possible and keeps the server small.
- **Edits are operations by item id**, re-applied on top of newer versions after
  a conflict, instead of line-number patches.
- **Plugins run in sandboxed iframes** with a permissioned RPC bridge and a CSP
  that blocks network access unless granted.
- **File formats** are documented in [STORAGE.md](STORAGE.md). Tasks and events
  share one line grammar (Obsidian Tasks + `⏰` time, `⏱` duration, `🔚` end
  date, `🚫` skipped dates, `📍` location, `🎨` colour, `🆔` id).

### Step 1 — shared core (`shared/`)
- `dates.js`: ISO date/time helpers in UTC (no DST drift), durations, labels.
- `recurrence.js`: repeat rules incl. `every 2 weeks on tue, thu` and
  `… until yyyy-mm-dd`; occurrences in a range.
- `items.js`: parse/format item lines and whole files (sections, notes,
  subtasks, duplicate-id handling), and pure edit functions: update (with done
  stamps and next occurrence of repeating tasks), add (end/top/section/subtask),
  remove, move, skip an occurrence, end a series.
- `quickadd.js`: natural-language entry, extended from obi with times
  (`7am`, `at 4`, `19:30`, `noon`), ranges (`9-10am`, `12-1pm`) and durations
  (`for 1h`, `for 45m`).
- `calendar.js`: expand items into day occurrences (repeating events, ghost
  occurrences of repeating tasks), side-by-side layout, free gaps.
- `ics.js`: .ics export and import (UTC/TZID conversion, RRULE incl.
  COUNT/UNTIL/EXDATE, overridden occurrences).
- `frontmatter.js`, `merge.js` (diff-match-patch rebase, git blob sha).
- 23 tests (`npm test`), all passing.

### Step 2 — server foundation (written directly)
- `server/config.js` (env, secret key, AES-GCM token encryption), `server/db.js`
  (SQLite: users, sessions, invites, settings, chat read markers), `server/auth.js`
  (scrypt passwords, cookie sessions, invite-only accounts, login rate limit),
  `server/access.js` (per-file access rules), `server/files.js` (workspace file
  store with git-blob shas, optimistic concurrency, change events, folder watch).
- `shared/seed.js`: the starter files of a new workspace (used by server and GitHub mode).
- `client/src/styles/tokens.css`: the design tokens (light/dark, 8 accents,
  10 item colours, density) every UI piece uses.
- Specs: `docs/API.md` (HTTP + WebSocket contract), `docs/PLUGINS.md` (plugin
  format, sandbox, SDK, permissions). `plugins/_dev/mock-lumen.js` lets a plugin
  run in a plain browser tab during development.

### How the rest is being built — delegated to OpenCode
To keep costs down, implementation is handed to the OpenCode CLI with written
briefs, and every result is reviewed, tested and committed by Claude:

- **DeepSeek V4 Pro** for heavy pieces: server (01), client core (03a), app
  shell (03c), tasks (04a), calendar (04b), plugin host (07), desktop app (08).
- **Big Pickle** (free) for smaller pieces: landing page (02), UI kit (03b),
  docs (04c), chat (04d), settings (04e), the starter plugins (05, 06), Docker/CI (09).
- Where it helps, cheap models build **competing variants** and the best one is
  kept: landing page (2 variants), Focus Forest (2), calendar (DeepSeek vs Big Pickle).
- Briefs live in `.briefs/` (see `AGENTS.md` for the rules every agent follows).

### Landing page
- Two variants built. **B kept** (product-first: headline beside a CSS-built app
  window; features as a two-column list) — it shows the product above the fold.
  A (editorial, centred) was set aside.

### Change of course: the UI is written by hand
The owner saw the delegated UI (the UI kit's first look, the plugin pages) and
asked for the UI to be done directly — "beautiful, clean, minimalistic and
professional". From here on OpenCode only gets non-UI work.

- **Visual system rewritten** (`tokens.css`, `base.css`, `ui.css`): warm
  neutrals, hairline borders, ink-coloured primary actions, the accent reserved
  for focus/selection/today, soft layered shadows on floating surfaces only,
  Inter with tightened headings. Light and dark, 8 accents, 3 densities.
  The kit's component *behaviour* (keyboard, ARIA, focus traps) was kept.
- **Sign-in screens**: sign in, first-run admin setup, invite acceptance,
  GitHub connect (token → pick a repository → branch).
- **Shell**: sidebar (workspace menu, search, Today/Inbox/Upcoming/Calendar/
  Docs/Chat, lists with drag-onto-list, plugin pages, save status), command
  palette (go to, create, tasks, docs, commands), shortcuts registry + help
  dialog (`?`), toasts with undo (Ctrl+Z), mobile drawer, error boundary per view.
- **Tasks**: grouping logic in `taskQueries.js` (tested); natural-language quick
  add with removable chips; rows with drag reorder/move; task panel (status,
  dates, time + duration, repeat, priority, notes, subtasks); board view by
  status / priority / date; Today's schedule strip; keyboard (j/k, x, e, t, m,
  1–4, Alt+↑/↓…).
- **Calendar**: `calendarMath.js` (tested); Structured-style timeline with
  free-time gaps; day/3-day/week grid with drag to create/move/resize and a
  keyboard slot cursor; month with drag between days; agenda; editor popover
  that reads "Gym 7am for 1h every mon"; this/following/all for repeating
  events; side panel with mini month, calendars, task lists and "To schedule"
  (drag onto the grid); Customize panel; .ics import/export.
  Verified in the browser: creating, moving (file shows the right lines), the
  repeat dialog writing `🚫` + a detached copy.
- **Docs**: tree, write/split/preview, toolbar + shortcuts, list continuation,
  clickable checklists, autosave.
- **Chat**: channels + DMs, grouping, markdown, mentions, replies, edit/delete,
  typing, presence, unread, optimistic send.
- **Settings**: account, appearance, calendar, tasks, members + invites,
  sync (server/desktop git, GitHub mode status), workspace export, shortcuts, about.
- **Landing page** rewritten to match (the client-core agent's placeholder had
  replaced the delegated one).
- **Focus Forest**: of two Big Pickle variants, A (single calm column) was kept.

### Bugs found in review and fixed
- 409 conflict responses returned private file text to users without access.
- The git auth header was malformed (pushes to GitHub would always fail).
- WebSocket users in desktop mode weren't marked as the desktop user.
- Workspace store: repeated conflicts flattened by-id operations into text
  diffs; remote notices during an in-flight write corrupted the queue; restored
  offline edits overwrote newer remote text.
- `useRoute` returned a new object per read (render loop); the command registry
  name clashed with a method; prefs re-rendered on every workspace change.
- New docs had no owner (the server rejects those).
- Vite re-bundling mid-session produced two copies of React; deps are now
  pre-bundled.

### Plugin host (OpenCode, DeepSeek) + plugin pages (by hand)
- `client/src/plugins/`: manifest validation, the injected SDK, srcdoc builder
  (inlines the plugin's files, strips dev scripts, adds CSP), the host bridge
  (one sandboxed iframe per plugin kept alive across pages, permission-checked
  RPC, storage under `data/plugins/<id>/<you>/`, tasks/calendar/notify/ui/
  system.activity, events, palette commands, rate limits), and the installer
  (catalog, GitHub, folder). 76 tests pass.
- Two OpenCode runs stalled before starting: a `<…/>` tag in the prompt text
  made `opencode run` hang. Plain prompts only from now on.
- By hand: the plugin page (frame laid over a content box, loading/error
  states, reload) and Settings → Plugins (installed list with per-person on/off,
  catalog, install from GitHub or a folder, a permission prompt in plain words,
  update, uninstall).
- Fixed in review: theme tokens never reached plugins — the token collector
  skipped every rule because, with CSS nesting, style rules also have a
  (usually empty) `cssRules` list.
- Verified in the browser: installing Focus Forest from the catalog, the
  plugin loading inside Lumen with the app's theme, and its RPC calls
  (storage, tasks.list, ui.setStatus).

### Release
- Local Windows installer built and the packaged app started (signed-in local
  user, seeded workspace folder).
- Release workflow dry run: Windows .exe, macOS .dmg, Linux AppImage + .deb all
  built on GitHub Actions. Package author/homepage added (Linux packages need them).
- Pages workflow made manual until GitHub Pages is enabled.

### 0.1.1 — direct downloads and automatic updates
- The source repo stays private; installers are published to the **public**
  `skillissu3s/lumen-releases` (the owner chose this over making the source
  public). The release workflow publishes there directly (not as a draft) with
  a `RELEASES_TOKEN` secret (fine-grained token, Contents: read and write on
  lumen-releases only).
- `desktop/updates.js` now uses **electron-updater**: Windows and the Linux
  AppImage download new versions in the background and install on restart or
  quit; macOS (unsigned, can't self-replace) and .deb get a notice with a
  direct link. Checks 10 s after start and every 4 h.
- Fixed: the quit handler used `app.exit()`, which skips the `quit` event that
  install-on-quit relies on; it now cleans up (save, sync, stop the server) and
  quits normally. "Restart to update" runs the same clean-up first.
- UI: an update note at the bottom of the sidebar (downloading → ready →
  Restart), and update status + Check now in Settings → About.
- Stable file names (`Lumen-Setup.exe`, `Lumen.dmg`, `Lumen.AppImage`,
  `lumen.deb`) so `…/releases/latest/download/<name>` always means the newest
  version; the landing page has a Download section with one button per platform.
- Verified locally: the packaged 0.1.1 reads its update feed from
  lumen-releases (`app-update.yml`) and reaches GitHub ("no published versions"
  until the first release there).
- Publishing changed so no secret is needed: the owner shouldn't have to make
  tokens, and storing one in Actions isn't something the assistant may do. The
  private repo's Release workflow builds into a draft with its built-in token;
  `scripts/publish-release.mjs vX.Y.Z` copies the files to lumen-releases with
  the changelog section as notes (run with the GitHub CLI already signed in).
