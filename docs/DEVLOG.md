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

### Polish after 0.3.2
- Sticky notes removed from idea boards (old `style: "sticky"` nodes now draw
  as ordinary cards).
- `.pb-card:active` no longer scales the card (it moved the quick controls
  under the pointer).
- `scrollbar-gutter: stable` on every scrolling area (`both-edges` where the
  content is centred) so a scrollbar appearing doesn't shift anything.
- The card's tick is always positioned the same way; done, doing and settling
  cards pad the words and badges by 23px with a 320ms transition, so the
  settle animation and the layout change are one movement.
- Collapsed sidebar: the footer keeps one row; the sync state is a dot on the
  avatar.

### Focus Forest 1.1
- `trees.js` draws trees generatively: layered crowns (a fixed number of
  overlapping circles per species from a seeded random, shaded with two radial
  gradients inside a clip path), tapered trunks, tiered pines and a cactus.
  `grow(species, progress, dead, { ground, box })` gives a tree at any
  progress, so it grows continuously; `render(species, stage)` remains for the
  five named stages. The crown's circle count is fixed so it swells instead of
  reshuffling as it grows.
- The focus screen is one SVG scene (`viewBox 0 0 600 260`, `slice`, so phones
  crop the sides): sky colours come from CSS variables per `sky-dawn/day/dusk/
  night` (from the clock, re-checked each tick), and the tree sits in it
  through `box` so the ground line meets the hill's crest. The sway is on a
  wrapper group, so redrawing the tree (every 1/400 of a session) doesn't
  restart it.
- The forest grove places trees with golden-ratio steps across and a
  plastic-number sequence for depth, so any count fills the meadow evenly
  (`meet`, so nothing is cropped on phones; at most 160 shown).
- Plugin host: a version change in `lumen.json` (written after the files)
  reloads that plugin's frame where it sat; before, an open view kept the old
  copy until Lumen reloaded.
- `plugins/_dev/trees.html` previews every species at every stage.

### Sliding sidebar, themes, more for idea boards
- Sidebar: following obi (`AppShell.jsx`/`layout.css` there), the open
  sidebar and the closed rail are separate columns, both mounted
  (`shell/Rail.jsx`, `inert` when hidden). Each slides on `width` (190ms) with
  `opacity` (130ms); their children keep a fixed width so nothing reflows
  mid-slide. Under 761px there is no rail and the sidebar stays a drawer.
  The rail's classes are `app-rail*`, since All tasks already has a `.rail`.
- Themes are `data-palette` on `<html>`, beside `data-theme` (the mode). Each
  palette sets only the neutral tokens, light and dark; light rules come after
  the base dark block and dark palette rules are more specific, so every
  combination resolves. Preview tiles set `data-palette-preview` and carry the
  same variables. `app.html` applies the saved palette before first paint; the
  plugin host re-sends tokens when it changes.
- Popover focuses `[data-autofocus]` before the first focusable element (it
  used to move focus from the list editor's name field to the icon button).
- `.pb-cards` has 3–4px on the sides it scrolls against, so a card's ring
  isn't clipped by the scroll container beside the reserved scrollbar gutter.
- Idea boards: shapes and drawings are text nodes with extra keys (`shape`;
  `ink`, `inkW`, `inkH`), doc and board cards are JSON Canvas `file` nodes.
  The pen records pointer points in world units and smooths them through
  midpoints (quadratic curves); each stroke becomes one node sized to it.
  Templates are built from (0, 0) and centred where you are. The minimap is
  `prefs.ideas.minimap`, off by default.

### Towards databases, with GitHub as a mirror
- The owner asked for: user data in databases (SQLite on the server and in the
  desktop app, not files), a login wall, offline use with sync to the cloud,
  and GitHub kept as a readable, restorable mirror written by the server on a
  schedule, through a GitHub App. Decisions: SQLite on the server too,
  invite-only accounts, one-way mirror plus restore, old modes replaced.
- The mirror's rules are written up as a separate, private, app-agnostic spec:
  the Repo Sync Protocol (skillissu3s/repo-sync-protocol), with Lumen as
  profile `lumen/1`. Lumen's existing file formats are the mirror's formats,
  so old repositories import through restore's parser.
- docs/DATABASE.md is the plan, in five phases. Phase 1 starts with the codecs:
  `server/mirror/lumen/itemsFile.js` parses and renders boards and calendars,
  pure and deterministic, keeping unknown front matter, Obsidian Kanban
  settings and loose text in `extra`. Tests: golden files byte for byte, a
  hand-made file settling after one pass, and 300 random boards round-tripping.
- Codecs for the rest: docs as Notion-style blocks (each list item its own
  block with an indent; tables and HTML kept as `raw`), idea boards (keys in a
  fixed order, unknown ones sorted), preferences and `lumen.json` (sorted),
  chat channels, and chat messages as current-state lines (old logs with edit
  and delete lines are replayed). `index.js` maps a path to its kind.
- Checked against the dev workspace: every file is stable on a second pass and
  boards, idea boards, docs and settings keep exactly their content.
- `server/store/`: `tables.js` declares every table once (columns, JSON and
  boolean columns, each row's root), `records.js` is the only write path:
  `write` skips no-op writes, bumps `rev`, and journals the row's root (both
  roots when a card moves; the old owner too when ownership changes); `remove`
  leaves a tombstone. SQL keywords were avoided as column names (`view_mode`,
  `column_list`, `created_by`, `author`).
- Phase 1 finished. `server/store/units.js` maps each path to rows and back;
  `server/files.js` is rewritten on top of it with the same exports, so api.js,
  chat.js, ws.js, seed.js and git.js keep working. The old folder-based module
  is gone (git history has it).
- Details that mattered: children are keyed per file (`<root>/<id>`), so ids
  only need to be unique within a file; a file whose root id another live file
  already has gets an id of its own (a hand-made copy, not a move); value
  comparison ignores JSON key order and parsers produce canonical data (sorted
  permissions), so a second save of anything writes nothing; the write path
  accepts owner '' for the workspace's own records.
- The file API answers a write with the stored text when it differs; the
  client rebases its pending edits onto it (`workspace.js`), so ids added by
  the server reach the app at once.
- chat.js reads current-state lines (a lone `deleted` line, `edited`) as well
  as old edit and delete lines.
- Checked in the app: the dev workspace imported into rows (15 files: 17
  cards, 10 doc blocks, 5 idea nodes…); ticking a task changed one card row
  and wrote one journal row; docs and the idea board render from their
  tables; the folder was not touched.

### Phase 2: the login wall
- GitHub-token mode removed from the client (session store, the connect
  screen, `storage/github.js`, settings, account menu, sidebar, plugin
  installer token). `session.boot()` now ends in `no-server` when no Lumen
  server answers, and in `choose` when the desktop hasn't been told where data
  lives (`/api/info` sends `desktopChoice`).
- New screens in `auth/AuthScreens.jsx`: `NoServer` (a server address, which
  is remembered; or the desktop app), `DesktopWelcome` (server or this computer
  only), `Unreachable`.
- Desktop: `POST /api/desktop/mode` stores `{ mode: 'local' }` or
  `{ mode: 'cloud', server }` after checking `${server}/api/info` answers as a
  Lumen server (`'ask'` clears it). Electron reads it at start and loads the
  local app or the server's; IPC `open-server` and `use-local` switch;
  `did-fail-load` on the server shows the local `#/unreachable` screen. IPC that
  touches this computer (folder picker, reveal, re-auth, the activity log)
  answers only the local origin, since a server's page runs in the same window.
- `server/github/readRepo.js` reads a repository's text files with one
  recursive tree request and the blobs, 8 at a time; `POST
  /api/admin/import/github` imports them through `files.importTexts`, which
  the folder import now uses too.
- Checked: a static copy of the app asks for a server and goes to it; in a
  throwaway Electron profile, the first run shows the choice, a server choice
  loads that server's sign-in, and an unreachable server shows the warning
  (a first attempt went straight to Today because `unreachable` was listed as
  a sign-in route the app leaves once signed in).

### Phase 3: the desktop app as an offline copy
- Chose file units as the sync unit, merged record by record, over the
  record-level protocol sketched in DATABASE.md: it reuses the server's file
  API (access control, versions, conflict answers), the units are the same as
  the GitHub mirror's, and the codecs already turn each file into records. The
  record-level protocol is now phase 5.
- `server/sync/merge.js`: three-way merge per kind through the codecs. Records
  keyed by id; one side changed → that side; both → field by field, the
  server winning a clash; deleted vs changed → kept. Docs by diff-match-patch,
  and a doc the two can't combine is kept twice. Plugin JSON Lines keep lines
  either side added.
- `server/sync/replica.js`: `sync_files` keeps each file's agreed text and both
  shas; a round lists both sides, reads the changed remote files in batches,
  copies or merges, and saves the new agreement. A 409 makes another round
  run; 403/400/413 keep the change local and report it; 401 means sign in
  again; no answer means offline. The session token is stored encrypted
  (`config.encrypt`). Signing in again with the same account resumes.
- The window always loads the local app again; phase 2's "load the server's
  app" path and its Unreachable screen are gone.
- Fixes found by the end-to-end test: writing a deleted record now brings it
  back even with the same content (sign-in cleared `.gitattributes`, then
  pulled the identical file, which stayed deleted); the desktop routes had no
  error handler, so errors came back as Express's HTML page (`apiErrors` is
  now shared).
- Checked in the app with a throwaway server and desktop server: the welcome
  screen, signing in, the account's workspace arriving, "Synced" in the
  sidebar, Settings → Account, and the offline state when the server stopped.

### Phase 3: the browser offline
- `lib/offlineCache.js`: IndexedDB store `workspaces`, one record per scope
  (`mode:handle`) with the files as last confirmed by the server, and the last
  signed-in session in localStorage. The workspace store saves the copy 1.5 s
  after changes, fills in files not loaded at the start (docs, plugin data) in
  the background, and on a failed first load with no connection opens the
  copy. `reconnect()` lists the server, turns differences into the same change
  notices the socket gives (`handleRemoteChange` already merges them with
  queued edits), starts the live connection and flushes.
- `session.boot()` tells "no Lumen server here" (a static copy: no-server)
  from "nothing answered" (offline: open the last session's copy, or an error
  if there is none). The backend's `list`/`readMany` now report network
  failures as `OfflineError`, 502–504 from a proxy count as offline, and every
  API call gives up after 20 s.
- `public/sw.js`: precaches the files the build lists in `sw-assets.json`
  (written by a small Vite plugin, which also stamps the worker so each build
  installs afresh and drops older caches); the page is network-first with a
  1.5 s limit, everything else cache-first; `api/`, `ws`, `catalog` are never
  touched. Registered in production builds, not in the desktop app.
- Checked in a real Chromium (Electron, a fresh profile; the preview pane
  can't register service workers): signed in, the worker kept 52 files; with
  the dev server stopped, a reload opened Today from the copy, marked offline;
  a task ticked offline reached the database once the server was back. The
  first runs took up to 10 s to open offline: Windows takes ~2 s to refuse each
  connection to a stopped server, and the page and the file list each paid it.
  Fixed with the 1.5 s page limit and by opening the copy straight away when
  the session already knows it's offline.

### Phase 4: the GitHub mirror
- `mirror/run.js` is the protocol's sync run behind a five-call interface
  (`repo`, `head`, `tree`, `read`, `commit`), so the same code runs against
  `mirror/fakeRepo.js` in tests and `github/repo.js` for real. Candidates come
  from the journal (root type and id mapped to a path by `units.pathOfRoot`,
  plus the root's old path from the index, which is how renames become a
  delete and an add). Everything is compared by git blob sha, so a run with
  nothing new writes nothing.
- Restore can't use root revs to tell "changed here since the mirror": a card
  edit journals the card, not its board. It uses the journal instead: when
  the mirror is this database's own, any row after the manifest's cursor for
  that root means changed here; from another database everything that differs
  counts as changed in both, and this workspace's version is kept.
- Moving to a new server: restore, then *Take it over* (or connect after
  restoring), which lets the new server write to a mirror whose manifest names
  the old one.
- A local stand-in for GitHub (OAuth redirects, the Git Data API, raw contents)
  run beside a Lumen server with `GITHUB_URL` pointing at it found one real
  bug: with the raw media type `ghFetch` still parsed JSON files, so reading
  `.sync/manifest.json` failed and an existing mirror looked foreign. Raw
  answers are now returned as text, with a test. `GITHUB_URL`/`GITHUB_API_URL`
  stay as settings: they are also how GitHub Enterprise Server is reached.
- Tests: run (11), token check and Git Data client (3), schedules (7), worker
  (6), restore (4), and the server routes' checks.
- First built on a GitHub App (JWT, installation tokens, the OAuth check that
  an installation is the person's). Replaced with a fine-grained token per
  connection at the user's request: one step to set up and nothing for the
  server's owner to configure. The token is checked before it's kept
  (`permissions.push` from `GET /repos/{owner}/{name}`), stored encrypted, and
  a replacement must open the same repository id. The App route stays
  documented in the protocol repo for servers with many users.

### Usernames
- An admin made from ADMIN_EMAIL without ADMIN_NAME is "Admin", @admin, and
  that handle is what files and the GitHub mirror show. Handles can now be
  changed (`PATCH /api/me { handle }`). Owners are user ids in the database,
  so owned files render with the new handle by themselves; `files.renameHandle`
  rewrites the places that keep handles as text (sharing lists, channel
  members and creators, message authors) in the same transaction as the
  account change, reindexes, and reports moved paths as changes. A DM keeps
  its id (`dm-a-b` from the old handles) and is now found by its members, so
  it isn't doubled. The rename writes no journal rows for the paths that
  moved, so it asks every mirror connection for a full pass at once.

### Polish: the sidebar, accounts
- The crease in the desktop app: the main area drew its own 34 px strip with a
  bottom border, while the sidebar ran up into the title bar with none, so the
  line stopped at the sidebar's edge. Now one drag strip spans the window
  (`.app::before`), the sidebar has no right border there, and `.main` is a
  sheet under the strip with a top and left border and a rounded corner.
- Workspace and account are two menus (`WorkspaceMenu.jsx` at the top,
  `AccountMenu.jsx` at the bottom, both with a compact form for the rail).
- `SidebarResizer.jsx`, after obi's `Resizer`: while dragging it sets
  `--sidebar-w` on `.app` once a frame with the slide transition off, and saves
  `prefs.sidebar.width` on release (200–420 px; arrows and double-click work).
- Users have `color` and `avatar` columns (added by `ALTER TABLE` when
  missing). The photo is cropped and shrunk to 160 px WebP in the browser, and
  the server takes only PNG/JPEG/WebP data URLs under 200 kB, since every list
  of people carries it. `PATCH /api/me` now checks every field before writing
  any. `GET/DELETE /api/me/sessions` list and end the account's other
  sessions; `DELETE /api/chat/channels/:id` removes a channel and its month
  files (creator or admin, never a DM).

### Polish: idea boards, docs, the calendar panel, controls
- Lost card text: a pointerdown on the canvas set `editing` to null, React
  removed the textarea before the browser moved focus, so its `onBlur` (which
  saves) never ran. `endEdit()` blurs the field first.
- Arrows: `dropSide` picks the handle under the pointer, else the nearest
  edge within ~30% of the card, else `facingSide`. The draft arrow and a
  `data-link-to` highlight show the side while dragging.
- The canvas is a size container (`container: canvas / inline-size`), so the
  tool bars react to the canvas's width, not the window's: the measured bars
  (526 px tools, 253 px zoom) set the 1090 / 830 / 710 px steps.
- `prefs.ideas.grid` (default on) hides the dots and turns snapping off.
- Docs handle: Tiptap's drag handle listens for `mousemove` on the editor
  element only, and the drop cursor for `dragover` there too, but the handle
  sits in the page's left padding, outside it. `.doc-prose` now has a 64 px
  left padding with a matching negative margin, so the gutter belongs to the
  editor (checked: handle shown with the pointer at x 600 for a block at 642;
  a synthetic `dragover` at x 600 draws the line).
- Popover autofocus ran while the popover was still `visibility: hidden`
  (placed in a layout effect, focused in a passive one), so the field never
  got focus; it now focuses on the next tick.
- Native selects: Chromium on Windows draws a select's list from the
  options' colours; a transparent select leaves them white. Options get
  `--surface`; checkboxes, radios and ranges get the accent (two used `--ink`,
  which is near white in dark). The desktop app sets `nativeTheme.themeSource`
  from the theme setting, through the title-bar IPC.
- The calendar panel is `CalendarSide.jsx`, on the right; folded sections are
  kept in localStorage (`lumen.cal.folded`), like the panel's open state.

### Readability, measured against obi
- Same font as obi (Inter, 13.5 px), so the gap was contrast. Lumen used
  `--text-faint` for secondary text in 137 places (more than `--text-muted`),
  and it measured 2.3:1 in light and 2.8:1 in dark on `--bg-muted`. obi keeps
  its faintest tier for a few decorative spots and uses a ~4.5:1 grey for the
  rest.
- Every theme's `--text-muted` now reaches 6.3:1 and `--text-faint` 4.5:1 on
  the worst of `--bg`, `--bg-subtle`, `--bg-muted` and `--surface`, each moved
  toward the next-stronger tier so its hue stays. High contrast already met
  both, so it is unchanged.
- Body `--tracking` is 0 (was -0.006em); headings keep the tight tracking.
  Docs line height is 1.7 (was 1.6; obi uses 1.75).
