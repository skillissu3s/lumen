# Changelog

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
