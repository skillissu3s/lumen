# Brief 04a — Tasks (Today, Inbox, Upcoming, lists, board, task panel)

Read `AGENTS.md`, `docs/STORAGE.md`, and the client code you build on — use its real exports: `client/src/store/{workspace,derived,prefs,ui}.js`, `client/src/lib/{actions,router}.js`, `client/src/shell/shortcuts.js` (if present), the UI kit `client/src/components/ui/`, `shared/{items,quickadd,dates,recurrence}.js`. Create ONLY `client/src/views/tasks/**` (components + `tasks.css`) and replace the stubs `client/src/views/TasksView.jsx` and `client/src/views/TodayView.jsx` (default exports, props `{ route }`). If you need something missing from store/actions, add it minimally and report it.

The todo part should feel like obi's (which the owner liked) — a fast keyboard-friendly list with natural-language entry and a Trello-like board — but cleaner, like Things/Todoist.

## Pages
- **Today** (`/today`): greeting line with the date; sections **Overdue** (with "Move all to today"), **Today** (tasks dated today — `date`, `scheduled` or `start` = today; ordered by time then priority then file order), **Today's schedule** (compact read-only strip of today's timed events and tasks from `expand`, linking to `#/calendar?view=timeline`), and **Done today** (collapsed). Quick add defaults the date to today.
- **Inbox** (`/inbox`): the inbox list (`lumen.json.inbox`).
- **Upcoming** (`/upcoming`): next 14 days grouped by day (Tomorrow, Wed 4 Nov, …), then "Later" and "No date" (collapsed). Adding inside a day group dates the task to that day.
- **List** (`/list/<id>` = `lists/<id>.md`): header with icon, name (click to rename inline), colour, share state (server mode), item counts, view switch **List / Board**, menu (Show completed, Group by section/none/date/priority, Sort manual/date/priority/title, Add section, Delete list). Sections (`## Heading`) render as collapsible groups with their own "+ Add task"; "Add section" appends one (`addSection`).

## Rows
Checkbox (`TaskCheckbox`, coloured by priority: highest red, high orange, medium blue, else gray), icon + title (tags rendered as subtle `#tag` text links that filter), then right-aligned meta chips: date (`relativeDay`, red if overdue), time (+ duration), repeat icon with tooltip (`describeRecurrence`), subtasks progress `2/5`, notes icon, list name+dot (in Today/Upcoming). Hover shows a drag handle and a "…" menu. Completed rows dim + strike (kept until you leave the page, so an accidental tick can be undone in place).
- Click title → inline edit (Enter saves, Esc cancels). Click elsewhere on the row → opens the **task panel**.
- Drag to reorder within a list or move between sections (`moveItem`), drop onto a sidebar list to move it to that list (`moveItemToFile`; use a custom drag payload type `application/x-lumen-item` with `{ path, id }` — the sidebar agent may not handle drops; if not, also offer "Move to list…" in the menu). Drag onto a day group in Upcoming → re-date.
- Right-click / "…" menu: Complete, Start (in progress `/`), Today, Tomorrow, Next week, No date, Priority ›, Move to list ›, Duplicate, Copy as text, Delete (Undo toast).
- Subtasks show nested (indented) under their parent when the parent is expanded (chevron); they're real items with checkboxes.

## Quick add
An input at the top of every page ("Add a task — try ‘Call Sam tomorrow 3pm !high’"). As you type, `parseQuickAdd` result phrases show as `Chip`s (date, time/duration, repeat, priority) — clicking a chip's × keeps those words in the title (pass them as `ignore`). Enter adds (`addTask`) to the current list (Today/Upcoming → default list from prefs or the inbox) with the page's implied date if none typed, and keeps focus for the next one. `Q` anywhere (window event `lumen:quick-add`) focuses it. `#tags` stay in the title.

## Task panel (right side, ~380 px; bottom sheet under 760 px)
Title (textarea, icon picker button), status (open / in progress / done / cancelled), list (move), date, scheduled, start (`DateField`s; scheduled/start under "More dates"), time + duration, repeat (same options as the calendar editor: None, Daily, Weekdays, Weekly on <day>, Every 2 weeks, Monthly, Yearly, Custom… validated by `parseRecurrence`, "when done" toggle, until date), priority (Segmented with icons), tags (chips + add), **notes** (textarea, autosaved with debounce via `updateItem(path, id, { notes })`), **subtasks** (checklist with add/rename/delete/reorder), created/done dates, and actions: Delete, Duplicate, Open in calendar (if dated). Esc closes; changes save immediately (optimistic); the panel follows the task if it moves.

## Board view (per list)
Columns by **Status** (To do / Doing / Done), **Priority**, or **Date** (Overdue, Today, Tomorrow, Next 7 days, Later, No date — like obi). Cards show icon, title, chips, subtask progress. Drag a card between columns → the corresponding patch (status `' '`/`'/'`/`'x'`, priority, or date). "+ Add" at the bottom of each column adds with that column's value. Keyboard: arrow keys move focus between cards/columns, `Enter` opens the panel, `Space` completes, `Alt+←/→` moves the card to the neighbouring column.

## Keyboard (register via the shell's shortcut helper if present; and palette commands via `registerCommands('tasks', …)`)
`↑/↓` or `J/K` move focus between rows; `Enter` open panel; `Space` or `X` toggle; `E` or `F2` rename; `Delete` delete (Undo); `T` today, `M` tomorrow, `Shift+D` clear date; `1–4` priority (highest/high/medium/low), `0` none; `Alt+↑/↓` move up/down; `Ctrl+Shift+↑/↓` move to the top/bottom; `N` or `Q` quick add; `Esc` close panel/clear selection. Multi-select with `Shift+click`/`Shift+↑↓` and `Ctrl+click` for bulk complete/date/move/delete (a bulk bar appears).

## Empty states
Inbox empty: "Inbox zero." Today empty: "Nothing planned for today." List empty: a one-line hint about natural-language entry.

## Accessibility
Rows are `role="listitem"` in a `role="list"` (or `treegrid` if you implement nesting properly) with labels; the checkbox announces its state; drag & drop always has a keyboard/menu alternative; focus is never lost after completing/deleting (moves to the next row); live region announces "Completed ‘Call Sam’. Press Ctrl+Z to undo." (`Ctrl+Z` triggers the last toast's Undo).

Done when: `npx vite build` and `npm test` pass; unit tests for the pure helpers you write (grouping/sorting/filters, which tasks belong to Today/Upcoming groups) in `client/src/views/tasks/*.test.js`; you exercised add/complete/move/edit through the actions against a running dev server as far as possible without a screen. Report what you built, what you verified and what you could not.
