# Brief 03c — app shell, sign-in screens, navigation

Read `AGENTS.md`, `docs/ARCHITECTURE.md`, `docs/API.md`. Then read the existing client code you build on — **use its real exports, don't re-implement them**: `client/src/lib/*` (router, api, socket), `client/src/store/*` (session, workspace, derived, prefs, ui), `client/src/lib/actions.js`, and the UI kit in `client/src/components/ui/` (+ `client/src/styles/ui.css`, `base.css`, `tokens.css`). If something you need is missing from those modules, add it there in the smallest way and say so in your report.

Create/replace: `client/src/App.jsx`, `client/src/main.jsx` (import `tokens.css`, `base.css`, `ui.css`, `shell.css`, fonts `@fontsource-variable/inter` and `@fontsource-variable/jetbrains-mono`), `client/src/styles/shell.css`, `client/src/shell/*` (layout, sidebar, palette, status, shortcuts), `client/src/auth/*` (screens), and **stub views** `client/src/views/{TodayView,TasksView,CalendarView,DocsView,ChatView,SettingsView,PluginView}.jsx` — each a simple placeholder with the view's title (other agents replace them; keep each stub's default export and props: `{ route }`).

## Boot and routing (`App.jsx`)
- On mount: `useSession.getState().boot()`. While booting show a quiet centred spinner (no flash of sign-in).
- Not signed in: `#/signin` (default), `#/setup` (server, `needsSetup`), `#/invite/<token>`, `#/github`. When `mode === 'github'` (no server), `#/signin` shows the GitHub connect screen.
- Signed in: init the workspace (`initWorkspace` with the session's backend, user, mode) and `load()`; apply prefs theme (`applyTheme`); show `<AppShell>`. Routes: `/today` (default), `/inbox`, `/upcoming`, `/list/<id>`, `/board/<id>` (optional), `/calendar`, `/docs`, `/docs/<path…>`, `/chat`, `/chat/<channel>` (server mode only), `/plugin/<id>`, `/settings`, `/settings/<tab>`. Unknown → `/today`. Tasks routes (`/today`, `/inbox`, `/upcoming`, `/list/…`) all render `TasksView` with the route (Today is `TodayView`).

## Auth screens (`client/src/auth/`)
One centred card layout (logo mark + "Lumen", max-width 380, subtle border, no illustrations), shared by:
- **Sign in** (server/desktop): email, password, "Sign in" button, errors inline (from the API message), "Have an invite? Use the link you were sent." note. Link "Use with GitHub instead" → `#/github`.
- **Set up** (server, `needsSetup`): "Create the admin account" — name, email, password (≥ 8), confirm. Explains "Only the admin can invite people."
- **Accept invite** `#/invite/<token>`: fetch `GET /api/invites/:token` (410 → "This invite has expired…"), then name, email (prefilled and locked if the invite has one), password → `acceptInvite`.
- **Connect GitHub** `#/github`: explains in 2 lines (your data lives in a repository you choose; the token stays in this browser). Steps: (1) token field (password input) + link "Create a token" → `https://github.com/settings/personal-access-tokens/new` with the text "Fine-grained token → Repository access: only the repo you'll use → Permissions → Contents: Read and write"; on blur/continue validate with `githubUser`. (2) pick a repository from `listRepos(token)` (searchable list showing private/public and push access; disabled if no push) or type `owner/name`; note "Create an empty private repository on GitHub first if you don't have one." (3) branch (prefilled with the default). "Connect" → `connectGitHub(...)` → app. In server mode this screen also explains that GitHub mode is separate from the server account.
- Sign out lives in the user menu (sidebar).

## AppShell (`client/src/shell/`)
Two columns: **Sidebar** (`--sidebar-w`, `--bg-subtle`, right border) and **Main** (`--bg`). On the desktop app on Windows (`window.lumenDesktop?.titleBar`), leave a 34 px draggable strip at the top (`-webkit-app-region: drag`, buttons inside `no-drag`) and keep 140 px clear on the right for the window buttons.
- Sidebar top: workspace name (from `lumen.json`) with a menu (Settings, Keyboard shortcuts, Sign out / Disconnect GitHub), then a **search / command button** ("Search or jump to…" with `Ctrl K`).
- Nav (icon + label, active state = `--bg-active` + `--text`, others `--text-muted`): Today (`CalendarCheck`), Inbox (`Inbox`, count of open tasks), Upcoming (`CalendarClock`), Calendar (`CalendarDays`), Docs (`FileText`), Chat (`MessagesSquare`, server mode only, unread badge from `GET /api/chat/channels` refreshed on socket `chat` events).
- **Lists** section: every list except the inbox (color dot or emoji icon, name, open-task count), a "+" to create a list (small popover: name, colour, icon → `createList` → navigate). Right-click a list: Rename, Change colour/icon, Share… (server mode: popover with "Private / Everyone / Specific people" using `GET /api/users`), Delete (confirm Dialog).
- **Plugins** section: one entry per enabled plugin that has a `view` (Lucide icon by name — map the name to the `lucide-react` component, fall back to `Puzzle`), with a badge if set. (Plugin host is another agent's job: read entries from `selectPlugins` + prefs; badge from `useUI` key `pluginBadges[id]` — add that state to `ui.js`.)
- Bottom: **sync status** (from `useWorkspace().saving`: "Saved" / "Saving…" / "Offline — changes kept" / "Couldn't save" with tooltip error; in GitHub mode show `owner/repo`), Settings (`Settings` icon), and the user avatar + name.
- Sidebar collapses to a 52 px icon rail with `Ctrl \` (pref `sidebar.collapsed`) and becomes an overlay drawer under 760 px wide (hamburger in a top bar).
- Plugin status-bar texts (from `useUI` key `pluginStatus[id]`, add it) show at the bottom of the sidebar above sync status, as small pills.

## Command palette (`Ctrl/⌘ K`)
Dialog with an input and a list: "Go to" (Today, Inbox, Upcoming, Calendar, Docs, Chat, Settings, each list, each doc title, each plugin view), "Create" (New task — opens quick add prefilled, New event, New list, New doc), and everything from `useUI` `commands()` (registered by views and plugins). Fuzzy-ish matching (subsequence, scored), arrow keys + Enter, `Esc`. Show shortcuts with `Kbd`.

## Keyboard shortcuts (`client/src/shell/shortcuts.js`)
A small registry: `useShortcut(combo, handler, { when })` ignoring events from inputs/textareas/contenteditable (unless `allowInInput`). Global: `Ctrl K` palette, `Ctrl \` sidebar, `G T` Today, `G I` Inbox, `G U` Upcoming, `G C` Calendar, `G D` Docs, `G H` Chat, `G S` Settings, `?` shortcuts dialog (lists all registered shortcuts with descriptions, grouped), `Q` quick add (dispatches a `lumen:quick-add` window event that the tasks view handles; if not on a tasks route, navigate to Inbox first).

## Toasts and problems
Render `Toaster` from `useUI` toasts; subscribe to the workspace `onProblem` and show them as danger toasts.

## Responsive and accessible
Works from 360 px to wide screens; landmarks (`nav` aria-label "Main", `main`), skip link "Skip to content", sidebar items are links (`<a href="#/…">`), `aria-current="page"` on the active one, focus visible everywhere, no keyboard traps.

Done when: `npx vite build` passes, `npm test` passes, and running `npm run dev` (server on :3000 from the existing `server/`, Vite on :5173) lets you set up an admin, sign in, see the shell with lists from the seeded workspace, open the palette, and sign out — test it with real HTTP calls (e.g. a small node script against the API) since you can't see the screen; describe what you verified.
