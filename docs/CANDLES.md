# Candles and workspaces

Lumen today has one workspace per server: every account sees the same set of
boards, calendars, docs and idea boards, each private to its owner or shared
with chosen people. This document plans the move to a model built around the
person:

- Every account has a **candle**: a private root of its own ("Nikhil's
  candle"). It is a full workspace (boards, calendars, docs, idea boards,
  settings, plugins) that nobody else can enter.
- From the candle a person **creates or joins workspaces**. Everything in a
  workspace is shared by its members, and only with them.
- Single things in a candle (a board, a calendar, a doc, an idea board) can be
  **shared with chosen people**, each either able to view or to edit.
- The candle gives the **unified view**: Today, All tasks and Calendar there
  can show the candle's own items, what others shared with you, and the boards
  and calendars of any workspaces you choose, together. Inside a workspace the
  same views show only that workspace.

Decisions made with the user (2026-11-06):

| Question | Decision |
|---|---|
| Who sees what inside a workspace | All members see and edit everything in it. Private things belong in the candle. |
| Today's data | Today's workspace stays a workspace with every current account as a member. Items nobody else could see (private to their owner) move into that owner's candle. |
| Creating and joining | Any signed-in person can create a workspace. Its owner shares an invite link; someone without an account can sign up through that link. There is no other public sign-up. |
| Sharing from a candle | Per person: can view, or can edit. Only the candle's owner changes sharing or deletes the thing. |

## Words

| Word | Meaning |
|---|---|
| **Space** | A candle or a workspace: the unit that holds boards, calendars, docs and idea boards. Every record belongs to exactly one space. |
| **Candle** | A person's own space. One per account, made with the account, never shared as a whole, never deleted while the account exists. |
| **Workspace** | A shared space with members. Roles: owner (one), admin, member. |
| **Share** | One candle root (board, calendar, doc, idea board) opened to one other person, with `view` or `edit`. Workspace things are never shared outside their workspace. |
| **Root** | A board, calendar, doc or idea board: what can be opened, shared, moved and deleted as one. |

## What lives where

| Thing | Candle | Workspace |
|---|---|---|
| Boards, calendars, docs, idea boards | yes, private unless shared | yes, all members |
| `lumen.json` (name, inbox, settings) | yes | yes |
| Chat channels | no | yes, all members |
| Direct messages | between two people, outside any space |  |
| Plugins | installed per person, in the candle; they run wherever that person is | no |
| Preferences, plugin data | per person, with the candle | no |
| GitHub mirror | one per space: your candle, or a workspace you own or administer |  |

## The view: paths per person

Every part of Lumen that moves data around (the file API, the browser's
offline copy, the desktop's replica, the realtime notices) speaks in paths.
Rather than teach all of them about spaces, each person gets **one tree** in
which every space they can reach has its place:

```
lists/inbox.md                         ← your candle, at the top, as today
calendars/personal.md
users/nikhil/settings.json
shared/ana/lists/groceries.md          ← Ana's board, shared with you
workspaces/acme/lists/launch.md        ← the Acme workspace
workspaces/acme/calendars/team.md
workspaces/acme/chat/general/2026-11.jsonl
workspaces/acme/lumen.json
```

- The server stores each root with its space and its path **inside** the
  space (`lists/launch.md`); the prefix is added on the way out and taken off
  on the way in, per person. Two people see the same workspace file under the
  same `workspaces/<slug>/` path; a shared board appears under
  `shared/<owner>/` for each person it is shared with.
- A workspace's slug is unique on the server and changes only if its owner
  renames it (the view moves, as with usernames).
- The desktop app on "this computer only" has just a candle, so its tree is
  exactly today's.
- The GitHub mirror of a space uses the paths inside that space, so the
  repository layout (profile `lumen/1`) does not change.

## Access rules

For a person `p` and a root `r` in space `s`:

| | Candle of `p` | Workspace, `p` a member | Candle of someone else |
|---|---|---|---|
| See | yes | yes | if shared with `p` |
| Edit content | yes | yes | if shared with `p` for edit |
| Share, unshare | yes | no (shared with the members already) | no |
| Delete, move to another space | yes | yes (soft delete, as everywhere) | no |
| Rename the space, invite, remove members | — | owner and admins | — |
| Delete the space | — | owner | — |

- Removing someone from a workspace, or taking back a share, ends their access
  at once: the server stops listing and sending those files, their open
  sockets get the matching "deleted" notices, and their offline copy drops
  them at the next sync.
- A person can **move** a root between spaces they can edit (candle →
  workspace and back). It keeps its id, so links and the mirror's history
  follow it.
- Server roles stay: a server admin manages accounts and server settings; that
  role gives no access to other people's candles.

## Unified views

In the candle:

- **Today, All tasks**: tasks from the candle's boards, boards shared with you,
  and the boards of workspaces you turn on.
- **Calendar**: events from the candle's calendars, calendars shared with you,
  and the calendars of workspaces you turn on. The side panel lists the
  sources in groups (Your candle, Shared with you, then each workspace), each
  group and each calendar with its own show/hide. Choices are saved in your
  preferences.
- Creating a task or event from a unified view asks where it goes (default:
  the candle's inbox or default calendar), and lists only places you may edit.
- Every item shows where it lives (a small label with the space's name) when
  more than one space is on screen.

Inside a workspace the views are that workspace's only.

## Data model

```sql
spaces        (id, kind 'candle'|'workspace', slug, name, owner_id, created_at, deleted)
space_members (space_id, user_id, role 'owner'|'admin'|'member', joined_at)
space_invites (token_hash, space_id, role, created_by, created_at, expires_at, max_uses, uses)
shares        (root_type, root_id, user_id, can 'view'|'edit', by, created_at)
```

- Root tables (`boards`, `calendars`, `docs`, `idea_boards`, `workspace`,
  `chat_channels`, `plugin_files`) get a `space` column; children follow their
  root. The journal gets `space` too, so the mirror and the realtime filter can
  select by space cheaply.
- `prefs` and `plugin_data` stay per person (they already are).
- Shares are journaled like records, so a change of sharing reaches devices
  and is rendered into the file (`share: { ana: view, sam: edit }` in front
  matter) for the mirror's readers.

## Migration of today's data

One transaction on first start of the new version:

1. Make a candle for every account, named "<Name>'s candle", with its own
   `lumen.json`, inbox and default calendar.
2. Make one workspace from today's `lumen.json` (its name, slug from the name),
   with every current account as a member; the server's admins become its
   owner and admins.
3. Every root that today has no `share` (only its owner can see it) moves to
   its owner's candle. Everything else stays in the workspace, and its `share`
   list is dropped (the workspace's members see it now). Roots without an
   owner stay in the workspace.
4. Chat stays with the workspace; direct messages become direct messages.
5. Plugins installed today are installed in every account's candle.
6. GitHub mirror connections: a `workspace` scope becomes the workspace's
   mirror; an `owner` scope becomes the candle's.

The desktop app on "this computer only" makes its single account's candle and
moves everything there.

## Many people at once

Several people editing the same board, doc or calendar must keep working as
today, now across spaces:

- Edits stay optimistic and are rebased onto newer versions (`shared/merge.js`
  and the item-level merges); an end-to-end test drives three accounts
  editing one workspace board, a shared candle board and a doc at once, with
  sockets, and checks every edit lands once and everyone converges.
- Losing access in the middle of editing (removed from the workspace, share
  taken back, share lowered to view) turns pending edits into a clear message
  instead of retries.

## The way there

1. **Spaces on the server.** Tables, membership, invites, shares, the `space`
   column, per-person views in the file facade and the realtime notices,
   access rules, the migration. Tests for every rule above.
2. **Spaces in the app.** The switcher at the top of the sidebar (your candle,
   then your workspaces; create, join with a link), workspace settings
   (members, invites, roles, rename, leave, delete), moving a root between
   spaces, sharing a candle root with people (view or edit), *Shared with you*
   in the candle.
3. **Unified views.** Today, All tasks and Calendar across the candle, shares
   and chosen workspaces, with grouped sources and "where does this go".
4. **Chat and plugins.** Channels per workspace, direct messages between
   people, plugins per person.
5. **Sync.** The desktop replica and the browser's offline copy with the new
   tree; the GitHub mirror per space (connections choose a space).
6. **Many people at once.** The multi-account end-to-end tests and the
   losing-access cases; then a release.

Each phase ends with tests, the docs updated, a commit and a push; releases
only when the user says so.
