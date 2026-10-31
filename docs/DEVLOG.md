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
