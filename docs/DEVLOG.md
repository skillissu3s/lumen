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

### The repository goes public; releases like obi
- Uploading the release through the owner's PC ran at ~90 KB/s (an hour per
  release), so the owner made `skillissu3s/lumen` public. The history was
  scanned first: no tokens, passwords, keys or data files were ever committed
  (commit emails were already public via obi).
- Releases now live in `lumen` itself, published by the built-in token — no
  secrets: a tag creates a draft with the changelog section as notes, the three
  platform builds upload into it, then it is published as latest. About 5 minutes.
- `scripts/publish-release.mjs` removed; links and the update feed point at
  `skillissu3s/lumen/releases`. `lumen-releases` is no longer used.
- GitHub Pages stays off for now (turning it on publishes a public website; the
  owner can enable it under Settings → Pages → Source: GitHub Actions).

### Email codes (0.1.3)
- Server (OpenCode, DeepSeek): `server/mail.js`, `server/codes.js`, routes for
  admin two-step, passwordless member sign-in, forgot/reset password, invite
  emails; 8 tests. Screens by hand. Verified the admin two-step in the browser
  with `MAIL_LOG_CODES` capturing the email.

### 0.2.0 — boards, idea boards, colour and icons (all by Claude, no OpenCode)
The owner's feedback: the UX had problems (settings, calendar), there was no
colour, everything felt like a to-do list, and Lumen should handle work the way
obi does, as Kanban boards; also an idea board page, and no emoji anywhere.
- `shared/board.js` (+ tests): boards over list files in the Obsidian Kanban
  format: columns from `##` headings, Lumen's look in the plugin's settings
  block under `lumen` (column colours, label colours, covers, done column).
  `columnize` turns a plain list into To do / Doing / Done; new columns go in
  before the settings block.
- `shared/canvas.js` (+ tests): JSON Canvas read/write, one node per line,
  geometry helpers (anchors, facing sides, bezier edges, bounds).
- Client: `views/boards/` (BoardPage, Card, CardDialog), `views/tasks/AllTasks`,
  `views/ideas/` (gallery and canvas editor: pan, zoom, groups, arrows, colours,
  keyboard), `lib/boardActions.js`, `IconPicker`/`IconBadge`, an icon registry
  (`shell/icons.js`). `/list/<id>` routes redirect to `/board/<id>`.
- Storage: `.canvas` is a text type on the server and in GitHub mode; idea
  boards are shared kinds with `lumen.owner`/`lumen.share` for access control.
- Emoji removed from the UI: the emoji picker, calendar item icons, the command
  palette, the seed, the Focus plugin's status and the landing page. Emoji typed
  into titles are still the user's content; leading ones are not shown on the
  calendar.
- Calendar fixes found by testing at ~1060px: dark mode squashed the
  working-hours band to 30px (a stray `!important`); the grid left empty space
  below 23:00; overlapping events became 10px slivers (now stacked with an
  offset when columns are narrow); task checkboxes covered titles; month cells
  capped at 4 items regardless of height.
- Settings: icon nav, page header with a tinted icon, cards of rows, profile
  header; texts updated for boards.
- Landing page rewritten around boards with a board mock instead of the emoji
  timeline.
- Dev note: editing a file the workspace store imports (e.g. `shared/seed.js`)
  hot-reloads the store and leaves the app on its boot screen; reload the page.

### Boards ported from obi; Notion-style docs; settings, toasts, sidebar
The owner asked for the board to feel exactly like obi's, settings like obi's,
more on idea boards, Notion-like docs (markdown underneath, none showing),
small animations, a collapsible sidebar, calendar spacing, no banner on boards
without lists, and notifications in the corner rather than the middle.
- Boards: obi's `ProjectBoard.jsx`, `CardDialog.jsx`, `boardDrag.js`,
  `celebrate.js` and `projects.css` ported onto Lumen's data (list files via
  `shared/items.js` and `shared/board.js`), not obi's kanban model, so Today,
  the calendar and All tasks keep reading the same files. `boardDrag.js` and
  `celebrate.js` are copied nearly verbatim. Added to `shared/board.js` (+
  tests): `archiveCard`, `archivedOf`, `nameLooseColumn`, and `boardEnd` so new
  or moved columns land before the archive. `MenuPopup` is exported from the UI
  kit for menus at a point (a wrapper element would break the drag geometry).
- Settings: a dialog over the page you were on (`AppShell` keeps the route
  behind it); obi's nav groups, flat `.setting` rows, summary header.
- Docs: Tiptap 3 with `@tiptap/markdown` (`views/docs/RichEditor.jsx`):
  StarterKit, task lists, placeholder; a "/" menu and a bubble menu written
  here. Saves `editor.getMarkdown()` half a second after typing stops, and
  takes in changes from elsewhere only while the editor isn't focused.
- Found while testing: Chrome's `scrollIntoView` now returns a Promise, so an
  effect written as `() => el.scrollIntoView()` returns it and React crashes
  ("destroy is not a function"). Effects must use braces around such calls.
- Toasts: bottom-right, an icon per tone, a countdown line, slide in and out,
  repeats merge (`×3`). `actions.js` gives "Completed" the success tone.
- Sidebar: collapses to a 52px rail of icons (titles as tooltips).
- Idea boards: box select, Space/middle-button pan, a 100-step undo history,
  clipboard (internal copies keep their arrows; text and URLs become cards),
  JSON Canvas link nodes, edge labels and ends, context menus, 12px snap
  (Alt frees it). `shared/canvas.js` gained `edgeMid` and `overlaps` (+ test).

### Quick pickers on cards; calendar details card; no coloured edges
Owner feedback after 0.3.0: All tasks still had the old cards; no coloured
lines along tops or left edges; the calendar needed real UX work; the board's
buttons hid under the desktop window controls; due date and priority should be
settable right on a card; drop the calendar's New button.
- `views/boards/pickers.jsx` now holds the pickers the card and its dialog
  share (PopHead, Colors, LabelPicker) plus DuePicker and PriorityPicker.
  A picker's popover renders in a portal, but React events still bubble to
  the card, so it is wrapped in an element that stops click, pointerdown,
  keydown and contextmenu (else the card would open or start a drag).
- `views/boards/Composer.jsx` (from BoardPage) so All tasks uses the same
  "Add a card" box; All tasks renders `.pb-list`s in `.pb-lanes`.
- `AllTasks.jsx` has CRLF line endings: a multi-line Python replace silently
  missed there, which left the old wrapper in place. Line-based edits work.
- Calendar: `EventPreview.jsx` (details first, editor second); EventEditor
  starts short for new items; TimeGrid shows a hover ghost, a draft block while
  the new-item form is open, a now pill in the hours column, dimmed past time,
  and day headings that open the day.
- `.is-desktop-titlebar` padding now covers `.pb-bar` as well as
  `.view-header`.

### Fixes from 0.3.1 feedback; idea tools; Notion-style pages
- The card's quick controls used the class `pb-ghost`, which is also the drag
  ghost's class (`position: fixed`), so all three sat on one spot. Renamed to
  `pb-unset`.
- Drop smoothness: `boardDrag.js` now commits the move and clears the drag
  inside `flushSync` and removes the floating copy right after, so React paints
  the card in its new place in the same frame (before, React rendered a frame
  after the copy was removed, leaving a blank gap).
- Desktop title bar: `.is-desktop-titlebar .main` gets a 34px strip (drag
  region, sidebar colour, hairline under it) instead of padding every header
  clear of the window buttons.
- `shell/AccountMenu.jsx` replaces the workspace dropdown.
- Idea boards: text nodes may carry `style: "sticky" | "label"` (JSON Canvas
  keeps unknown keys); a link node whose URL is an image renders the image;
  `Minimap`, arrange (align, distribute, tidy) and find live in IdeaCanvas.
- Docs: `@tiptap/extension-drag-handle-react` for the block handle; page
  `icon`, `color`, `cover` and `width` are front matter keys.
- Removed the narrow-screen `min-width` on the week grid: the all-day row did
  not scroll with it, which cut Sunday off.

