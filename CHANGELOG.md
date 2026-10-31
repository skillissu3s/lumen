# Changelog

## Unreleased — boards as obi has them, Notion-style docs

- **Boards feel like obi's.** Cards lift and tilt as you drag them and the
  others slide out of the way; lists drag the same way. Each list has a menu
  (rename, colour, done list, sort by due date, priority or name, move all
  cards, archive all, delete), each card a right-click menu, and the board a
  filter card and an **archive** (Obsidian Kanban's `***` section). Labels show
  as thin bars until clicked; a card's tick appears where its title starts, and
  ticking it off strikes it through with a small celebration.
- **Card view laid out like obi's**: status and priority rows, due date,
  repeat, time, cover, a label picker with colours, description and checklist.
- No banner on a board without lists: its loose cards are a list you can name,
  and the board menu can set up To do, Doing and Done.
- **Docs are written the way Notion does it**: formatted as you type, never
  showing markdown, with "/" for blocks (headings, to-dos, lists, quotes, code,
  dividers) and a small bar over selected text. They are still saved as
  markdown files.
- **Idea boards**: drag to select, Space to pan, undo and redo, copy and paste
  (a pasted link becomes a link card), link cards, labels on arrows and arrow
  ends, right-click menus, snap to grid, group a selection with Ctrl+G.
- **Settings** open as a dialog over the app, grouped into You, Workspace and
  App, with flat rows.
- **Notifications** sit in the bottom-right corner with an icon, a countdown
  and Undo; the same note again counts up instead of stacking.
- **The sidebar collapses** to a slim rail of icons (button or Ctrl+\).
- **Calendar**: more room everywhere: stacked day headers, a wider time
  gutter, events inset from the column edges.
- Small motion throughout: pages rise in, views fade, buttons give on press.

## 0.2.0 — boards, idea boards and a calmer look

- **Boards at the centre.** Every list is now a Kanban board: columns of cards
  you drag along, in the Obsidian Kanban format. Columns can be renamed,
  coloured, reordered and marked as the *done* column (moving a card in
  completes it). Old plain lists offer *Set up columns* (To do, Doing, Done).
- **Card view.** Open a card for its description, checklist, labels with
  colours, cover, due date and time, repeat, priority, and to move it to
  another board or column.
- **All tasks** — every card in one board, grouped by status, date, priority or
  board, with filters and a schedule rail to drop cards on a day.
- **Idea boards** — a canvas for notes, groups and arrows, saved as JSON Canvas
  (`ideas/*.canvas`). Colour cards, connect them, and make any idea a task.
- **Icons instead of emoji** — boards, calendars and idea boards pick an icon
  and colour; emoji are gone from the interface.
- **Calendar** — the grid fills the window; overlapping events stay readable;
  task checkboxes no longer cover titles; month days show as much as fits; tags
  are left out of event titles; the side panel starts closed on small screens.
- **Settings** redesigned: icons, a heading per page, and settings grouped in cards.
- A new workspace starts with a real board instead of a single task.

## 0.1.3 — downloads, automatic updates and email codes

- **Sign in with an email code** on a self-hosted server — no password needed —
  and **forgot password** by email. Admins confirm every sign-in with a code.
  Invites are emailed when you invite someone by email. Set `SMTP_HOST`,
  `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` and `MAIL_FROM` to turn email on.

- **Lumen updates itself.** On Windows and the Linux AppImage, new versions
  download in the background; a note in the sidebar says when one is ready and
  *Restart* installs it (or it installs the next time you quit). On macOS and
  with the .deb, Lumen tells you a new version is out and links straight to it.
- **Direct downloads** from the website and from
  [Releases](https://github.com/skillissu3s/lumen/releases/latest), with file
  names that always point at the newest version (`Lumen-Setup.exe`, `Lumen.dmg`,
  `Lumen.AppImage`, `lumen.deb`).
- Settings → About shows the update status and has *Check now*.
- Quitting Lumen now always finishes saving and syncing before an update installs.

## 0.1.0 — first release

The first version of Lumen: a personal productivity app whose data is plain
text in your own GitHub repository.

**Tasks**
- Today, Inbox, Upcoming and your own lists, with sections and subtasks.
- Type in plain words: “Call Sam tomorrow 3pm for 30m !high every mon”.
- Task panel: status, dates, time and duration, repeat, priority, notes, checklist.
- Board view by status, priority or date; drag and drop between lists.
- Keyboard: `j`/`k`, `x` to complete, `e` rename, `t`/`m` today/tomorrow, `1`–`4` priority, `Ctrl+Z` undo.

**Calendar**
- A Structured-style timeline of your day, plus day, 3-day, week, month and agenda views.
- Drag to create, move and resize; drag tasks from “To schedule” onto the day.
- Repeating events (“every weekday”, “every 2 weeks on tue, thu”, “… until …”) with this / following / all edits.
- Customize everything: day hours, working hours, hour height, snap, default duration, week start, 12/24 h, weekends, week numbers, colours.
- Fully keyboard-operable grid; `.ics` import and export.

**Docs** — markdown documents with write, split and preview modes.

**Chat** — channels and direct messages with the people you invite (self-hosted server).

**Plugins** — sandboxed, permission-based plugins installed from inside the app. Included:
- **Focus Forest** — grow a tree while you focus on a task.
- **Usage Monitor** — see which apps you use, your focus score and distracting time (desktop app).

**Run it three ways** — with GitHub and no server, self-hosted with Docker (invite-only, only admins invite), or as the desktop app for Windows, macOS and Linux.

**Installing the desktop app** — the installers aren’t code-signed yet. On Windows,
SmartScreen asks: choose *More info → Run anyway*. On macOS, open it once from
*System Settings → Privacy & Security → Open Anyway*.
