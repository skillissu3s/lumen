# Lumen — what's in the workspace folder

Everything Lumen stores about your work is a text file in one folder (or one
GitHub repository). You can read and edit all of it by hand; Lumen picks the
changes up.

```
lumen.json                       workspace name and settings
lists/<id>.md                    a todo list
calendars/<id>.md                a calendar (events)
docs/<path>.md                   documents (folders allowed)
chat/channels.json               chat channels           (server mode)
chat/<channel>/<yyyy-mm>.jsonl   chat messages, one JSON object per line
users/<handle>/settings.json     one person's preferences (theme, calendar options…)
plugins/<id>/manifest.json       an installed plugin (code: html/js/css/svg)
data/plugins/<id>/<handle>/…     a plugin's data for one person
.gitattributes                   merge rules for git sync (written by Lumen)
```

## lumen.json

```json
{
  "version": 1,
  "name": "Nikhil's workspace",
  "inbox": "inbox",
  "plugins": { "focus-forest": { "version": "1.0.0", "permissions": ["tasks:read", "notify", "storage"] } }
}
```

`plugins` records what is installed and **which permissions were granted** at
install time — a plugin can never use more than what is listed here.

## Front matter

List, calendar and doc files start with a small front matter block. Only simple
`key: value` lines and `[a, b]` lists are used:

```markdown
---
name: Groceries
color: green
icon: 🛒
owner: nikhil
share: [ana, sam]
---
```

| key | meaning |
|---|---|
| `name` | display name (docs use `title`) |
| `color` | one of `gray red orange amber green teal blue indigo violet pink`, or `#rrggbb` |
| `icon` | an emoji (optional) |
| `owner` | handle of the person who made it |
| `share` | missing = private to the owner · `everyone` · `[handle, handle]` |
| `default` | (calendars) `true` on the calendar new events go to |

## Items: tasks and events

Lists and calendars hold **items**, one per markdown list line, in the
[Obsidian Tasks](https://publish.obsidian.md/tasks/) emoji format plus a few
additions for time-blocking. A line with a checkbox is a **task**; a plain list
line in a calendar file is an **event** (nothing to tick off).

```markdown
## This week
- [ ] 📞 Call the bank #admin ⏫ 📅 2026-11-02 ⏰ 10:30 ⏱ 15m 🆔 k3j9x2
    Ask about the international transfer limit.
    - [ ] Find the account number 🆔 p0q81a
    - [x] Check last statement ✅ 2026-10-30 🆔 m2n7bb
- [/] Write the quarterly report ⏳ 2026-11-03 🔁 every 3 months 🆔 a9d0ee
- [x] Renew passport ✅ 2026-10-28 🆔 zz81kd
```

```markdown
---
name: Work
color: blue
default: true
---
- 🧍 Standup 📅 2026-11-02 ⏰ 09:30 ⏱ 15m 🔁 every weekday 🚫 2026-11-11 🆔 ev01st
- ✈️ Conference 📅 2026-11-18 🔚 2026-11-20 🆔 ev02cf
- Dentist 📅 2026-11-05 ⏰ 16:00 ⏱ 1h 📍 Main St clinic 🆔 ev03dn
```

| token | field | notes |
|---|---|---|
| `[ ]` `[/]` `[x]` `[-]` | status | open · in progress · done · cancelled (tasks only) |
| leading emoji in the title | icon | shown on the calendar timeline (`🏃 Run`) |
| `#tag` `#area/sub` | tags | anywhere in the title |
| `🔺` `⏫` `🔼` `🔽` `⏬` | priority | highest · high · medium · low · lowest |
| `📅 yyyy-mm-dd` | date | due date for tasks, the day of an event |
| `⏳ yyyy-mm-dd` | scheduled | the day you plan to work on it |
| `🛫 yyyy-mm-dd` | start | not before this day |
| `🔚 yyyy-mm-dd` | end date | last day of a multi-day item |
| `⏰ HH:MM` | time | start time (24-hour). No time = all day |
| `⏱ 45m` `⏱ 1h30m` | duration | default comes from your calendar settings |
| `🔁 every …` | repeat | `every day`, `every 2 weeks`, `every weekday`, `every mon and fri`, `every month`, `every year`, `… when done` |
| `🚫 d1,d2` | skipped | occurrences of a repeating event that were removed |
| `📍 text` | location | events; runs to the next field |
| `🎨 color` | color | overrides the list/calendar colour for this item |
| `✅ yyyy-mm-dd` `❌ yyyy-mm-dd` | done / cancelled on | stamped automatically |
| `➕ yyyy-mm-dd` | created | |
| `🆔 xxxxxx` | id | stable identity, added by Lumen to lines it edits |

Lines nested under an item belong to it: nested checkbox lines are its
**subtasks** (checklist), any other nested text is its **notes**. `## Headings`
group a list into **sections**. Everything else in the file is kept as it is.

When a repeating **task** is completed its next occurrence is written as a new
line (as Obsidian Tasks does). A repeating **event** is a single line; its
occurrences are worked out when the calendar is drawn, and deleting just one
occurrence adds its date to `🚫`.

A line Lumen didn't write and has no `🆔` still works — Lumen finds it by
position and title, and adds an id the first time it changes it. If git's union
merge ever leaves two lines with the same id, the later one wins and the
duplicate is dropped on the next save.

## Chat

`chat/channels.json`:

```json
[{ "id": "general", "name": "general", "members": "everyone", "created": "2026-10-31T10:00:00Z", "by": "nikhil" },
 { "id": "dm-ana-nikhil", "dm": true, "members": ["ana", "nikhil"] }]
```

`chat/general/2026-10.jsonl` — one message per line, append-only:

```json
{"id":"m1x9","at":"2026-10-31T10:02:11.120Z","from":"nikhil","text":"Morning! Plan for today is in **Team**."}
{"id":"m1xa","at":"2026-10-31T10:03:40.002Z","from":"ana","text":"👍","reply":"m1x9"}
{"id":"m1x9","at":"2026-10-31T10:05:00.000Z","from":"nikhil","edit":true,"text":"Morning! Plan is in **Team**."}
{"id":"m1xa","at":"2026-10-31T10:06:00.000Z","from":"ana","deleted":true}
```

Edits and deletions are new lines that refer to an earlier id, so the file only
ever grows and git can always merge it.

## Preferences

`users/<handle>/settings.json` holds one person's settings (theme, accent,
calendar options, enabled plugins). It is plain JSON; unknown keys are kept.

## Plugin data

A plugin's `lumen.storage` API reads and writes files below
`data/plugins/<id>/<handle>/` — JSON or JSON-lines that the plugin chooses. The
starter plugins use:

- Focus Forest: `sessions.jsonl` (one line per focus session), `settings.json`
- Usage Monitor: `days/<yyyy-mm-dd>.json` (daily summary: minutes per app,
  category totals, focus score), `settings.json` (categories, limits)

## Git merge rules

Lumen writes this `.gitattributes` into the workspace so that git sync merges
item files and chat logs line by line instead of raising conflicts:

```
lists/*.md      merge=union
calendars/*.md  merge=union
chat/**/*.jsonl merge=union
```
