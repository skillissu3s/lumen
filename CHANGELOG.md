# Changelog

## Unreleased

- **Your own candle, and workspaces you share.** Everyone now has a private
  candle of their own: boards, calendars, docs, idea boards and plugins that
  are yours alone. From the menu at the top of the sidebar, make a workspace
  and invite people with a link (they can sign up through it), or join one.
  Everyone in a workspace sees and edits all of it. Move between your candle
  and your workspaces from the same menu.
- **Share one thing from your candle.** A board, calendar, doc or idea board
  can be shared with chosen people, each able to view or to edit. What others
  share with you appears in the menu as *Shared by* them.
- **One view of everything, from your candle.** Today, All tasks and Calendar
  in your candle also show the tasks and events of your workspaces and of what
  people shared with you, each marked with where it's from. Choose which spaces
  to include from "Your candle and N more", or from the calendar panel, where
  calendars are grouped by space. Tick, move and edit them right there.
- New events and tasks can go to any calendar or board you may change, in any
  of your spaces.
- **Move to…** a board, calendar, doc or idea board between your candle and
  your workspaces, with everything in it.
- **Workspace members and invites** in Settings: roles, invite links, leaving,
  and deleting a workspace you own.
- **The desktop app and offline browsers have your spaces too.** Signed in to
  a server, the desktop app moves between your candle, workspaces and what's
  shared with you like the web app, with everything kept on the computer.
  Something shared with you to view only can't be changed there either: the
  owner's version comes back.
- **A GitHub copy per space.** Choose which space a repository keeps: your
  candle, or a workspace you run. Restoring brings it back into the same.
- If you lose access to something while a change is on its way (a share
  taken back, removed from a workspace), Lumen says your change wasn't saved
  instead of trying again and again.
- **Chat per workspace.** Every workspace has its own channels, for the people
  in it. Direct messages are between the two of you, wherever you are: in a
  workspace beside its channels, and in your candle on their own.
- Moving to this version: what only its owner could see moves into that
  person's candle; what was shared stays in the workspace, for everyone in it.
  Plugins are now installed per person.

- **The timeline tells the time right.** While something is under way, now is
  marked on it, with how long is left, instead of a line after it. Free time
  today only counts what is still ahead, and 12-hour times no longer wrap.
- **A tidier small month** in the calendar panel: round days in even columns,
  lined up with the rest of the panel.
- **Pop-ups stay in the window.** The event form, menus and the time and
  duration lists flip to the side with more room, move as they grow, and
  scroll when they are taller than the window.

## 0.7.2 — obi's look

- **obi's look is Lumen's default**: warm ink on paper, with obi's jade accent.
  The earlier plain grey is still there as the Neutral theme, and indigo is
  still an accent.
- **The sidebar starts closed**, as the icon rail; open it with the button at
  its top or `Ctrl+\`. Lumen still remembers what you chose.
- **Double-click a card on an idea board to edit it.** It used to make a new
  card instead.
- **A calmer calendar panel**: more room between its parts, a colour dot for
  each calendar and board instead of a checkbox (an eye shows which are
  hidden), and a line saying what separate calendars are for.
- **The 3-day view is gone.** The view keys are now 1 timeline, 2 day, 3 week,
  4 month and 5 agenda.
- With 12-hour times, the time now no longer wraps onto two lines, and the
  hours have room.
- **New folder sits at the top of the docs list**, next to New doc.

## 0.7.1 — easier to read

- **Easier to read.** Secondary text (dates, counts, section names, hints and
  placeholders) is darker in light themes and brighter in dark ones, in every
  theme. Body text is no longer squeezed together, and docs have a little more
  space between lines.

## 0.7.0 — a calmer, tidier Lumen

- **The sidebar is easier to read.** The top is your workspace: its settings,
  inviting people, plugins and its copy on GitHub. The bottom is you: your
  profile, the theme, settings, shortcuts and signing out.
- **Make the sidebar wider or narrower** by dragging its edge. Lumen remembers
  the width; double-click the edge to put it back.
- **A profile that looks like you.** In Settings → Account, add a photo, pick
  the colour behind your initials, and change your name and username, each
  saved as you go. Others see your photo and colour in chat and in the members
  list.
- **See where you're signed in**, and sign out of every other device at once.
- **Delete a chat channel** you made (admins can delete any channel).
- In the desktop app on Windows, the title bar and the sidebar are one surface,
  with no line where they meet the page.
- **Idea boards keep what you type.** Text written in a card or text box is no
  longer lost when you click the canvas afterwards.
- **A grid switch on idea boards**, by the zoom controls. With the grid off,
  cards move freely; hold Alt while dragging to do the opposite of the switch.
- **Arrows join the side you drop them on**, or the side facing the card they
  come from when you let go in the middle. While you drag, the side they will
  join is highlighted.
- The idea board's tools fit any window: they move aside, then show icons
  only, then sit in two rows on narrow screens.
- **Docs: the block handle shows whenever the pointer is beside a block**, and
  the line showing where a dragged block will land appears straight away.
- Doc and folder icons in the docs list line up, whether or not a doc has its
  own icon.
- **Delete from where you made it.** Docs and folders have a menu in the docs
  list (and on right-click), idea boards have one on their tile, alongside
  the existing ways to delete boards, calendars and messages. Each asks first.
- **The calendar's panel is on the right**, and shows the day you're on, a
  coloured tick per calendar and board, and tasks still waiting for a day.
  Each part folds away. On a narrow window it opens over the calendar.
- Dropdown lists, checkboxes and sliders follow the dark theme everywhere,
  including in the desktop app.
- Forms that open in a small panel (a new board, calendar or idea board) put
  the cursor in the name field, and the new idea board form opens by the tile
  you clicked.

## 0.6.1 — choose your username

- **Choose your username** in Settings → Account. It's how you're shown in
  chat (@username) and as the owner in your files and their GitHub copy. Lists
  shared with you, your chats and DMs follow the new name; your GitHub copy
  moves your files at its next sync, which starts straight away.

## 0.6.0 — a readable copy of your data on GitHub

- **A readable copy of your data on GitHub.** In Settings → GitHub, add a
  repository and a token for it, and choose when to sync: after
  you make changes, every few hours, once a day or week at a time you pick, or
  only when you ask. Each sync is one commit with only the files that changed,
  in formats you can read (boards and calendars as Markdown task lists, docs as
  Markdown, idea boards as JSON Canvas). Files you add to the repository
  yourself are left alone, and edits made on GitHub are reported and put back.
- Admins sync the whole workspace or only what they own; everyone else syncs
  what they own.
- **Restore from a repository**: see what a mirror holds, then bring it in.
  Nothing is deleted, and anything you changed here since keeps your version
  unless you choose the repository's.
- Syncing pauses with a clear reason when it needs you: the token expired or
  was revoked (add a new one), the repository became public, or another Lumen
  server writes there (you can take it over).
- The token is kept encrypted on the server and never shown again;
  disconnecting deletes it. *Bring in from GitHub* moved into Settings →
  GitHub as *Restore from it*.

## 0.5.0 — works offline, in the app and in the browser

- **The desktop app works offline with your server account.** Sign in to your
  Lumen server from the app: your account's boards, docs and tasks are kept on
  the computer too, so everything works without a connection, and changes go
  both ways as soon as the server can be reached (on start, a moment after you
  change something, and every half minute).
- **Changes made in two places at once are merged** card by card, setting by
  setting; docs keep both sets of edits where they don't overlap. If the same
  thing was changed in both places, the server's version is kept and Settings →
  Account lists the file.
- If this computer already has work of its own when you sign in, you choose:
  keep both, or use only your account's (this computer's is backed up first).
- The sidebar shows Synced, Syncing…, Offline or Sign in again; Settings →
  Account has Sync now and Sign out of the server.
- **The web app works offline too.** A browser you've signed in on keeps a copy
  of your workspace and of the app, so it opens without a connection (the
  sidebar says Offline), keeps your changes, and sends them when your server
  answers again. Signing out removes the copy from that browser.

## 0.4.0 — your data in a database, and a sign-in wall

- **Your data now lives in a database.** The server and the desktop app keep
  everything in SQLite instead of files. On first start, your existing
  workspace folder is imported and left where it is as a backup. Nothing looks
  different in the app.
- Git sync keeps working for now (its folder mirrors the database); it will be
  replaced by the GitHub mirror (see docs/DATABASE.md).
- **Sign in first.** The desktop app asks on first start: sign in to your Lumen
  server, or use it on this computer only (switch later in Settings →
  Account). If your server can't be reached, it says so and offers to use
  this computer instead.
- **GitHub mode is retired.** The web app runs on a Lumen server; a copy with
  no server (like the GitHub Pages site) asks for your server's address. Data
  from GitHub mode is still in your repository: an admin can bring it in from
  Settings → Sync → Bring in from GitHub.

## 0.3.6 — a sliding sidebar, themes, and a fuller idea board

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
