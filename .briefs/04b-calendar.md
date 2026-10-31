# Brief 04b — the Calendar {{VARIANT_NOTE}}

Read `AGENTS.md`, `docs/STORAGE.md` (items, events, `⏰ ⏱ 🔚 🚫 🔁 📍 🎨`), and the client code you build on — use its real exports: `client/src/store/{workspace,derived,prefs,ui}.js`, `client/src/lib/{actions,router}.js`, the UI kit `client/src/components/ui/`, `shared/{calendar,dates,recurrence,items,quickadd,ics}.js`. Create ONLY: `{{ROOT}}/**` (React components + `calendar.css`), and replace the stub `{{ENTRY}}` (default export `CalendarView({ route })`). If you need something missing from store/actions, add it minimally and report it.

## Idea
The calendar is the person's **day plan**, modeled on the app *Structured*: tasks and events are coloured time blocks with an emoji icon on a vertical timeline; free time between them is visible; things without a time sit in an **inbox** you drag onto the day. It shows events (from `calendars/*.md`) and dated tasks (from `lists/*.md`) together. Everything is **customizable** (prefs `calendar.*` in `store/prefs.js`) and **fully keyboard- and screen-reader-accessible**.

## Views (Segmented control in the header; URL `#/calendar?view=…&date=yyyy-mm-dd`; default `prefs.calendar.view`)
1. **Timeline** (Day, Structured-style): one column. Each timed item is a row on a vertical line: time on the left (start–end), a rounded **icon pill** on the line whose height grows with duration (min 40 px, ~`hourHeight` px per hour, capped), title + duration + list/calendar name on the right, checkbox for tasks. Between items, when `prefs.calendar.timeline.showGaps`, a faint "Free · 1 h 30 min" gap row you can click to add an item there. All-day items and the day's **untimed tasks** sit above the line. The current time is a marker on the line ("now"). An "inbox" of undated open tasks and overdue tasks in a side panel (collapsible).
2. **Day**, 3. **3 days**, 4. **Week** (`showWeekends` false → 5 days): classic time grid. Hour rows from `dayStart` to `dayEnd` at `hourHeight` px/hour; working hours (`workStart`–`workEnd`) slightly brighter when `highlightWork`; an all-day row on top (multi-day items span columns); current-time line in today's column; overlapping items side by side via `layoutDay` from shared/calendar.js; each block shows icon, title, time, and is tinted with its colour (`--c-<color>-bg` background, `--c-<color>` 3px left border, `--c-<color>-fg` text). Short blocks (< 30 min) show one line.
5. **Month**: grid via `monthGrid`; each cell lists up to N items (icon + time + title), "+3 more" opens a popover with the day; week numbers if `showWeekNumbers`.
6. **Agenda**: the next 30 days (or a chosen range) as a list grouped by day, with empty days collapsed.

Header: Today button, ‹ › (by view span), the period title ("November 2026", "Mon 2 – Sun 8 Nov"), view switcher, a **"+ New"** button, a search box filtering visible items by text, and a **Customize** button (gear) opening the settings popover (below). Left panel (collapsible, remembered in prefs): `MiniMonth` (dots on days with items, click → go), **Calendars** list (checkbox to show/hide → `prefs.calendar.hidden`, colour dot opens `ColorPicker` → `updateCalendarMeta`, "+ New calendar", right-click: rename, set as default, share (server mode), export .ics, delete), **Lists** (show/hide tasks per list), and **Inbox** (undated open tasks; draggable).

## Colours
`prefs.calendar.colorBy`: `calendar` (the item's calendar/list colour; tasks from lists use the list colour), `priority`, or `item` (the item's own `🎨` if set, else its source). Default colour `blue` for calendars, `gray` for lists without one.

## Creating and editing
- **Drag on empty grid** to create (snaps to `snap` minutes; Esc cancels) → opens the **editor popover** anchored to the new block with the title field focused. Click on an empty slot → same with `defaultDuration`. In Month, click a day → all-day item. Timeline: click a gap.
- **Editor** (popover on wide screens, bottom sheet under 640 px): a quick-add title input (natural language via `parseQuickAdd`: "Gym 7am for 1h every mon" fills fields; recognised phrases shown as removable `Chip`s), icon (`EmojiPicker`), Event/Task toggle (event → calendar picker, task → list picker), date (`DateField`), all-day switch, start `TimeField` and end time or `DurationField`, end date (multi-day), repeat (None, Daily, Weekdays, Weekly on <day>, Every 2 weeks, Monthly, Yearly, Custom… text validated by `parseRecurrence`, optional "until" date), colour override, location, notes (textarea), and for tasks: priority. Buttons: Save (Enter), Delete, Duplicate, "Open in list" (tasks). New items go to `prefs.calendar.defaultCalendar` (or the calendar with `default: true`, or the first).
- **Move**: drag a block to another time/day (ghost preview with the new time shown; snap). **Resize**: drag the bottom edge. Month: drag to another day. Timeline: drag within the line. Dragging an **inbox task** onto the grid gives it that date + time (+ default duration).
- **Repeating events**: changing one occurrence asks *"This event / This and following / All events"* — this = `detachOccurrence`, following = `endSeriesBefore` + a new series from that date, all = edit the series line. Deleting likewise offers *"This event / All"* (this = `skipOccurrence`). Ghost occurrences of repeating **tasks** are faint and only open the real task.
- **Tasks**: checkbox on the block completes it (`toggleTask`); completed ones dim and strike through (hidden when `showCompleted` is false).
- Every change goes through `client/src/lib/actions.js` so undo toasts work. Moving shows a toast "Moved to Tue 3 Nov, 10:30" with Undo.

## Customize popover (writes `prefs.calendar.*` via `setPrefs`)
Default view; week starts on (Sunday/Monday — top-level `prefs.weekStart`); show weekends; show week numbers; time format 12/24 h (`prefs.timeFormat`); day starts / ends (hours); working hours + highlight; hour height (zoom slider 32–120 px; also `Ctrl` + mouse wheel and `Ctrl +/-` over the grid); snap (5/10/15/30); default duration; colour by; show completed; show tasks; show free-time gaps (timeline); default calendar for new events. Changes apply live.

## Accessibility (must)
- The grid is navigable without a mouse: days are columns with `role="grid"`/`row`/`gridcell` or an equivalent listbox structure; each block is a focusable button with an `aria-label` like "Standup, 9:30 to 9:45 AM, Monday 2 November, Work calendar, repeats every weekday".
- Keys: `T` today; `←/→` previous/next period (when focus isn't in a block); `1`–`6` switch view (Timeline, Day, 3 days, Week, Month, Agenda); `N` new item at the focused slot/day (or now); in the grid `↑/↓` move a focus cursor by `snap`, `←/→` by day, `Enter` creates there; on a focused block: `Enter` open editor, `Space` toggle task, `Delete` delete (with the repeat question), `Alt+↑/↓` move by `snap`, `Alt+←/→` move by a day, `Shift+Alt+↑/↓` shorten/lengthen, `Esc` back to the grid. Announce moves in an `aria-live` region ("Moved Standup to 10:00").
- Visible focus rings; colour is never the only signal (icons/text too); respects `prefers-reduced-motion`; usable at 200% zoom; 360 px wide → Timeline/Day/Agenda work, Week becomes horizontally scrollable with sticky time column.
- Register palette commands via `registerCommands('calendar', …)`: "Calendar: go to today", "Calendar: new event", "Calendar: switch to week view", etc., and shortcuts via the shell's `useShortcut` if it exists in `client/src/shell/shortcuts.js`.

## Import / export
From the Calendars list menu: export a calendar (or all) to `.ics` (`exportIcs` → download), import an `.ics` file into a chosen calendar (`importIcs` → toast with the count and any warnings).

## Performance
Expand only the visible range (`expand(items, from, to)`); memoize per range + data; pointer-move handlers use `requestAnimationFrame`; no re-render of the whole grid on every pointer move (keep drag preview state local to the dragged block / an overlay).

{{DIRECTION}}

Done when: `npx vite build` and `npm test` pass; you have run the app (`npm run dev`, set up an admin through the API, sign in via the API with a cookie jar if needed) and exercised create / move / resize / repeat-edit flows as far as you can without a screen (unit-test the pure helpers you write: slot ↔ time maths, drag snapping, range per view — put them in `{{ROOT}}/calendarMath.js` with `calendarMath.test.js`). Report what you built, what you verified and what you could not.
