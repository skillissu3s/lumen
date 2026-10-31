# Changelog

## Unreleased

- **The sidebar slides** open and closed, as obi's does: the full sidebar and
  the icon rail are two columns, and one slides shut as the other opens, with
  nothing inside them jumping about.
- **Themes**: Lumen, Paper, Slate, Sage, Dusk and High contrast, each in light
  and dark (Settings → Appearance; Mode is now its own setting).
- **Idea boards** have more to add: shapes (rectangle, ellipse, diamond, key
  S), to-do lists you can tick, drawing with a pen in any colour (P), cards
  for your docs and boards that open them, and templates (mind map,
  flowchart, pros and cons, to do / doing / done, strengths and weaknesses,
  retrospective). The map in the corner is off unless you turn it on (M).
- **New board**: the name field is ready to type in as soon as it opens.
- A card's highlight is no longer cut off next to a list's scrollbar.
- Focus Forest 1.1.1: switching between Focus and Forest no longer shifts the
  page sideways.

## 0.3.5 — a forest worth growing

- **Focus Forest 1.1**, redrawn: your tree grows on a hill in a small landscape
  whose sky follows the time of day (dawn, day, dusk, a starry night), with
  drifting clouds. It grows smoothly through the session and sways a little;
  cherry and maple drop petals once they are big. A thin line along the bottom
  shows progress, with a large timer under it. A new tree: maple.
- **Your forest** is now one meadow: every session stands in it as a tree,
  bigger for longer sessions, further back for older ones, withered for one
  you gave up. Click a tree for its details.
- An updated plugin takes effect straight away, even with its page open.
- Collapsed sidebar: the icons sit in the middle of the rail, and the
  workspace button stays at the same height as when the sidebar is open.

## 0.3.4 — a held card lets go cleanly

- Letting go of a held card no longer flashes it as completed for a moment.

## 0.3.3 — steadier and smoother

- Idea boards no longer have sticky notes.
- Pressing on a card no longer shrinks it, so clicking its due date or flag
  doesn't nudge the layout.
- Docs: headings sit closer to what is around them, and closer still when one
  heading follows another.
- A scrollbar appearing no longer shifts the page sideways: its room is kept.
- Ticking off a card is one smooth motion: the words slide over for the tick
  while it is struck through, with no jump at the end.
- The sidebar's profile stays exactly in place when the sidebar collapses; the
  save state shows as a small dot on the avatar.

## 0.3.2 — tidier cards, a desktop title bar, Notion-style pages

- **Cards**: the quick controls for due date, priority and labels sit in a
  neat row instead of piling up; due dates use a plain calendar icon and a
  soft tint (red when late, amber today, green when done).
- **Every list has a tag**: a dot in its colour, grey until you pick one;
  click it to choose.
- **Desktop app**: a title strip across the top holds the window's buttons, so
  every page lines up below it.
- **Account menu** on the workspace button: who you are and where Lumen keeps
  your work, Light / Dark / System, Settings (Ctrl+,), your account, keyboard
  shortcuts, About, sign out. The collapsed sidebar shows the workspace first.
- **Smoother drops**: a dropped card is drawn in its new place before the
  floating copy disappears. No press effect on sidebar items.
- **Idea boards**: sticky notes (S), text (T), image cards from a link,
  line up / space out / tidy a selection, a minimap, find on the board
  (Ctrl+F), and checklists you can tick inside a card.
- **Docs, closer to Notion**: hover a block for + (add a block below) and a
  grip (drag it somewhere else); add a page icon and a cover; full width;
  Notion's measure; page icons in the list.
- The week view fits narrow windows instead of scrolling sideways.

## 0.3.1 — quick pickers on cards, a calmer calendar

- **Set a card's due date, priority and labels right on the card.** Every open
  card shows faint controls for them; a due date or priority already set is
  itself the button. Each opens a small picker in place.
- **All tasks** uses the same lists and cards as a board.
- **Calendar**: a click on an event or task shows its details first (when,
  repeat, place, calendar or board, notes) with edit, duplicate and delete;
  tasks can be ticked off there or opened as their card. New items ask only for
  what they need, with the rest behind More options, and a placeholder shows
  where they will go. Hovering empty time shows where a click would start; the
  time now sits in a pill on the hours; time already gone is a little dimmer;
  a day's heading opens that day. The New button is gone (click the grid or
  press N).
- No coloured lines along the top or left of lists, events or idea cards: a
  dot and a soft fill instead.
- In the desktop app, the board's buttons no longer slip under the window's
  minimise, maximise and close buttons.

## 0.3.0 — boards as obi has them, Notion-style docs

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
