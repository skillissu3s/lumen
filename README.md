# Lumen

A calm, personal productivity app — **Kanban boards, a calendar, idea boards,
docs and chat** — whose data is plain text in your own GitHub repository. Extend
it with plugins (a Forest-style focus timer and a computer-usage monitor ship
with it).

- **Boards** — columns of cards you move along as work progresses, in the
  Obsidian Kanban format. Cards have labels, checklists, covers, due dates,
  repeats and priorities, and open in a card view. *All tasks* gathers every
  card into one board grouped by status, date, priority or board, with a
  schedule rail to drop cards on a day. Type in plain words:
  `Call Sam tomorrow 3pm for 30m !high every mon`.
- **Idea boards** — an open canvas of notes, groups and arrows (JSON Canvas);
  turn any idea into a card when it is ready.
- **Calendar** — a Structured-style **timeline** of your day plus day, 3-day,
  week, month and agenda views. Drag to create, move and resize; drag tasks from
  "To schedule" onto the day; repeating events ask *this / following / all*.
  Every option is adjustable (hours, hour height, snap, week start, colours,
  12/24 h, weekends, week numbers…) and everything works from the keyboard.
  Import and export `.ics`.
- **Docs** — pages you write the way you would in Notion (formatted as you
  type, "/" for blocks), saved as plain markdown files.
- **Chat** — channels and direct messages with the people you invite (server mode).
- **Plugins** — sandboxed, permissioned, installed from inside the app and
  stored as files in your workspace. See [docs/PLUGINS.md](docs/PLUGINS.md).
- **Your data stays yours** — kept in a database, and readable as plain files
  (`lists/*.md`, `calendars/*.md`, `ideas/*.canvas`, `docs/**/*.md`;
  Obsidian-Tasks compatible) that can be synced to your own GitHub repository.
  See [docs/STORAGE.md](docs/STORAGE.md) and [docs/DATABASE.md](docs/DATABASE.md).

## Two ways to run it

| | Self-hosted (web) | Desktop app |
|---|---|---|
| Who | you + people you invite | you |
| Data | the server's database, optionally synced to GitHub | this computer, or your account on a Lumen server |
| Sign in | email + password or an emailed code (invite-only; only admins invite) | first run: sign in to a server, or use this computer only |
| Chat | ✅ | with a server account |
| Usage monitor plugin | — | ✅ |

Used Lumen's old GitHub mode? Your data is still in that repository: an admin
can bring it in from **Settings → Sync → Bring in from GitHub**.

### Self-hosted (Docker)

```bash
cp .env.example .env    # set APP_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD, PUBLIC_URL
docker compose up -d --build
```

Open `http://your-host:3000`. Sign in as the admin, then **Settings → Members**
to create invite links and **Settings → Sync** to push the workspace to GitHub.
Without `ADMIN_EMAIL`/`ADMIN_PASSWORD`, the first visit shows a setup screen.
Everything lives in the `lumen-data` volume (`/data`).

### Desktop app

Download the installer from [Releases](https://github.com/skillissu3s/lumen/releases/latest) — it updates itself —
or build it yourself:

```bash
npm install
npm run desktop          # build the client and open the app
npm run desktop:build    # installer for this OS in release/
```

The first run asks: sign in to a Lumen server, or use this computer only.
On this computer, data lives in the app's own database; a workspace folder from
before is imported. GitHub sync needs `git` installed.

### GitHub Pages

`.github/workflows/pages.yml` builds the landing page and the web app and
publishes them. Enable *Settings → Pages → Source: GitHub Actions* in the
repository. The published app has no server of its own: it asks for your Lumen
server's address.

## Development

```bash
npm install
npm run dev        # API on :3000 (data in ./data), web on :5173
npm test           # shared core, server end-to-end, client store and views
npm run build      # client into dist/ (served by `npm start`)
```

Open http://localhost:5173/app.html. Without a server running, the app asks for
a server's address.

```
client/      React app (Vite) + landing page — client/src/{auth,shell,views,store,storage,plugins}
shared/      the text formats and date/recurrence logic, used everywhere
server/      Express + WebSocket: accounts, invites, file API with access control, chat, git sync
desktop/     Electron shell and the activity tracker
plugins/     starter plugins + registry.json (the in-app catalog)
docs/        ARCHITECTURE, STORAGE, PLUGINS, API, DEVLOG
```

Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) first. What was built and
why, step by step, is in [docs/DEVLOG.md](docs/DEVLOG.md).

## Releases

1. Bump `version` in `package.json` and add a `## X.Y.Z — …` section to `CHANGELOG.md`.
2. Commit, then push a tag: `git tag vX.Y.Z && git push origin vX.Y.Z`.

The Release workflow builds Windows, macOS and Linux installers (about 5
minutes), uses the changelog section as the notes and publishes the release.
Installed apps pick it up on their next check (at start and every 4 hours).
Direct links always point at the newest version:
`https://github.com/skillissu3s/lumen/releases/latest/download/Lumen-Setup.exe`
(also `Lumen.dmg`, `Lumen.AppImage`, `lumen.deb`).
