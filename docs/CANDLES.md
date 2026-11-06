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
```

- Root tables (`boards`, `calendars`, `docs`, `idea_boards`, `workspace`,
  `chat_channels`, `plugin_files`) get a `space` column; children follow their
  root. The journal gets `space` too, so the mirror and the realtime filter can
  select by space cheaply.
- `prefs` and `plugin_data` stay per person (they already are).
- A share is the root's `share` list, journaled like everything else and
  written into the file for the mirror's readers: `share: [sam, ana:view]`
  (a bare name may edit, `:view` may only look; lists from before spaces are
  all-edit). Shared things are found by asking the root tables for a `share`
  in candles, so no separate table is needed.

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
only when the user says so. Phase 1 alone wasn't releasable (the app showed
only the candle); from phase 2 on you work in one space at a time, and phase 3
brings the views across spaces.

### Phase 1 progress

- [x] Every record table and the journal carry `space`; old databases get the
  column on start (`tables.js` `upgradeSql`). The store can list, look up and
  read the journal per space.
- [x] Units per space (`createUnits(store, people, { space, owner })`): paths
  are looked up inside the space, records named after their file (settings,
  channels, plugin files, other files) get the space in their id, and in a
  candle everything is its person's.
- [x] `spaces.js`: spaces, members and roles (owner, admin, member), invite
  links (reusable until they expire or are revoked), rename (a new slug moves
  everyone's paths), leave, remove, hand over, delete.
- [x] `files.js` per space, with a *home* space for what had one workspace
  before (on the desktop the candle, on a server the shared workspace): chat,
  git sync's folder and the desktop replica keep working on it.
- [x] `view.js` and `access.js`: each person's tree and the rules above;
  `share: [sam, ana:view]` (the front matter has no nested maps, so a share is
  a list, and lists from before mean edit).
- [x] Realtime per person, with access gained or lost arriving as files
  appearing or going.
- [x] `/api/spaces`, `/api/join` (including signing up through a link).
- [x] The migration (`migrateSpaces.js`), tested on a database from before
  spaces and on a copy of real data: private things to their owner's candle,
  shared ones stay (their lists dropped), plugins installed in every candle,
  preferences and plugin data to their person, chat with the workspace, the
  GitHub mirror's connections mapped to a space and checked in full.
- [x] The GitHub mirror runs per space (a connection has a `space`; its
  journal is that space's); restore goes into a space the person manages.
- [x] Tests: spaces kept apart in units, candle privacy and view/edit
  sharing, workspaces (create, invite, join, edit, rename, leave, sign up by
  link, delete), live updates for shares and membership, the migration.

### Phase 2 progress

- [x] The store keeps the whole tree (`tree`, `treePaths`) and shows the
  current space as if it were the whole workspace: `files` and `paths` are
  that space's, with paths inside it, so boards, calendars, docs, ideas and
  their routes work unchanged in any space. `edit` and friends take those
  paths; `editAt` and friends take tree paths, for what is the person's
  wherever they are (preferences, plugins, plugin data, all in the candle).
- [x] `store/spaces.js`: the list from `/api/spaces` (offline, worked out from
  the tree), each person's shares as a space of its own ("Shared by Ana" at
  `shared/ana/`), the open space remembered per account, a fresh look when a
  space appears or goes (joined, left, removed, deleted: back to the candle).
- [x] The space menu at the top of the sidebar: the open space and what it
  offers (settings, members and invites, plugins in the candle, its GitHub
  copy), every space to move to, a new workspace, joining with a link.
- [x] `#/join/<token>`: one button when signed in; a sign-up form without an
  account; "I have an account" signs in and comes back to the link.
- [x] Settings → Members for a workspace: roles, removing people, invite links
  (made, copied, revoked, how many joined), leaving. General names the open
  space (renaming goes through the server, which updates its `lumen.json`),
  and the owner can delete a workspace. Accounts and git sync sit under
  *Server*, for server admins; Plugins under *You*.
- [x] Sharing from a candle: only me, or chosen people, each "Can view" or
  "Can edit" (`share: [sam, ana:view]`); in a workspace the field says everyone
  in it can see and edit.
- [x] Move to…: boards, calendars, docs and idea boards move between your
  candle and your workspaces (`POST /api/files/move`, one transaction on the
  server, the same id, sharing left behind, a free path if the name is taken).
- [x] Refusals: a write the server refuses (403, or 404 once access is gone)
  is dropped, the server's version put back and the reason shown; edits to
  things shared to view only aren't even sent.
- [x] Chat showed only in the home workspace until phase 4.
- [x] Checked in the browser with two accounts: making a workspace, an invite
  link, joining through it after signing in, sharing a board to view, the
  view-only refusal, the space menu and Move to.

### Phase 3 progress

- [x] In your candle, Today, All tasks, the schedule strip, Calendar and the
  sidebar's counts take in the boards and calendars of your other spaces
  (`useAcross` and the `…Across` hooks in `store/hooks.js`). Your candle's
  prefix is empty, so a path in the tree is also a path you can edit there:
  ticking another space's task or dragging its event uses the usual actions.
  Anywhere else the views are that space's only.
- [x] Which spaces: all, unless turned off (`prefs.across.off`, a list of
  space prefixes), from the "Your candle and N more" picker on Today and All
  tasks, or a space's heading in the calendar panel; one setting for all three
  views. Single calendars still hide one by one (`prefs.calendar.hidden`).
- [x] The calendar panel groups calendars by space (Your candle, each
  workspace, each person sharing); a space turned off still shows its heading,
  struck through, to turn back on. Another space's calendar is managed in its
  own space; from the candle it can be the default or exported.
- [x] Where things are from: a task from another space says so beside its
  board ("Launch · Launch team"); boards in the calendar panel too.
- [x] Where new things go: the event form offers every calendar and board you
  may change (not what's shared with you to view only), each named with its
  space; the default calendar is your candle's unless you pick another.
- [x] Actions found files only in the open space and knew calendars only by
  a leading `calendars/`: `fileAt` and `isCalendarPath` (store/workspace.js)
  reach other spaces' files from the candle, and a card from another space
  opens in the card dialog.
- [x] Checked in the browser: a workspace task due today in the candle's
  Today, labelled, ticked from there into the workspace's board; the team
  calendar's event in the schedule strip and the week; grouped calendars;
  hiding a space; the event form's places.

### Phase 4 progress

- [x] Chat per place (`chat.js`): each workspace keeps its channels in its own
  space (`chat/channels.json` and the month files), and "everyone" means
  everyone in that workspace; you must be in it to read or post. Direct
  messages live in a place of their own, `dm`, outside any space (no one's
  tree mounts it, so only the chat API reaches it), for the two people only.
- [x] Every chat call and socket message carries its place; read markers are
  per place (`<space>/<channel>`), since channel ids repeat between
  workspaces. A workspace's owner and admins can delete its channels and
  messages (server admins no longer can, in workspaces they aren't running).
- [x] Today's chat: channels stay with the home workspace; direct messages
  and read markers move once (`separateDirectMessages`, safe on every start).
- [x] The chat view: in a workspace its channels and your direct messages, in
  your candle your direct messages only; nothing in what others shared.
- [x] Plugins per person: done in phases 1 and 2 (installed in each candle,
  read and written there wherever you are).
- [x] Tests: channels kept per workspace, outsiders refused, DMs apart and
  private, the migration moving DMs. Checked in the browser: a message in a
  workspace's #general, a DM started from the workspace, the candle showing
  only direct messages.

### Phase 5 progress

- [x] The browser's copy keeps the whole tree (phase 2 made the store's
  copy the tree), so every space opens offline; without the server the space
  list is worked out from the copy (`spacesFromTree`).
- [x] The desktop signed in to a server keeps the account's tree as it is
  (workspaces/…, shared/… are plain files of its one candle) and takes the
  account's spaces from the server at every round (`cloud.spaces`), so the
  space menu, the views across spaces and view-only sharing work there too.
  Making workspaces and joining stay on the server (the menu offers them only
  there); chat needs the server, as before.
- [x] The desktop's own file lookups treat everything as its candle; the
  server judges what may change. An edit the server refuses in someone else's
  space (shared to view, a workspace's settings) gets the server's version
  back here and is listed under Settings → Account; other refusals stay here,
  listed, as before. A 404 (access gone) no longer stops the round.
- [x] GitHub: each repository holds one space. The form picks which (your
  candle, or a workspace you own or administer; the open one if you may), a
  connection says which it holds, and restoring goes back into it.
- [x] Tests: the desktop gets the spaces and their files, sends a workspace
  edit up, gets Bob's view-only board back; the offline space list. Checked
  in the browser: the GitHub form's spaces.

### Phase 6 progress

- [x] `server/multi.e2e.test.js`: three people, each running the app's own
  store, server backend and socket in a process of their own
  (`server/testPerson.js`, with fetch and the socket pointed at a test
  server), against one server.
- [x] All at once: each adds five cards to a workspace board, three to a
  board shared from Ada's candle (Ada at `lists/…`, the others at
  `shared/ada/…`), ticks a card on each, and types three lines into a
  workspace doc, without waiting for anyone. Every edit lands exactly once,
  and every app ends up showing exactly what the server has, with no
  problems reported. Stable over repeated runs.
- [x] Losing access mid-edit: lowered to view (refused, "You can view this,
  not change it.", the owner's version back); a share taken back while an
  edit is queued, and being removed from a workspace while an edit is queued
  (the edit goes nowhere, "You no longer have access to this, so your change
  wasn't saved.", and the files go from the app). No retries in any case.

All six phases are done.
