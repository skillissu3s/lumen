# Lumen server HTTP API

Used by the web client in server mode and by the desktop app (whose window talks
to the embedded server the same way). All bodies are JSON. Errors come back as
`{ "error": "message" }` with a 4xx/5xx status.

**CSRF:** every request that isn't GET/HEAD must send the header `X-Lumen: 1`;
otherwise the server answers 403. Sessions are the httpOnly cookie
`lumen_session` (SameSite=Lax).

## Info and auth

| | | |
|---|---|---|
| `GET /api/info` | — | `{ app: "lumen", name, version, mode: "server"\|"desktop", needsSetup, mail: boolean, user \| null }` |
| `POST /api/setup` | `{ email, name, password }` | only while there are no users: makes the first admin and signs in → `{ user }` |
| `POST /api/login` | `{ email, password }` | members → `{ user }` + cookie. Admins (when `mail` is on) → `{ needsCode: true, challenge, email }` with no cookie; finish with `/api/login/verify`. Admins with `mail` off sign in like members |
| `POST /api/login/verify` | `{ challenge, code }` | verifies the admin code for that challenge → `{ user }` + cookie |
| `POST /api/login/code` | `{ email }` | passwordless sign-in for members: `{ sent: true }` (always; 404 only if `mail` is off) |
| `POST /api/login/code/verify` | `{ email, code }` | verifies the login code → `{ user }` + cookie (members only) |
| `POST /api/password/forgot` | `{ email }` | issues a reset code: `{ sent: true }` (always) |
| `POST /api/password/reset` | `{ email, code, password }` | verifies the reset code, sets the password, ends that user's sessions. Members → `{ user }`; admins → `{ ok: true }` |
| `POST /api/logout` | — | `{ ok: true }` |
| `GET /api/me` | — | `{ user }` (401 if signed out) |
| `PATCH /api/me` | `{ name?, handle?, color?, avatar? }` | `{ user }`. A new handle (username: 2–24 lowercase letters, digits or dashes) is 409 if taken; sharing lists, channel members and message authors follow it, and files named after it move. `color` is an item colour name or `null`; `avatar` a `data:image/(png\|jpeg\|webp);base64,…` URL of at most 200 kB, or `null` to remove it. Everything is checked before anything is saved |
| `GET /api/me/sessions` | — | `{ sessions: [{ id, createdAt, agent, current }] }`, newest first |
| `DELETE /api/me/sessions` | — | ends every session but this one → `{ ended }` |
| `POST /api/me/password` | `{ current, next }` | `{ ok: true }` |
| `GET /api/invites/:token` | — | `{ email \| null, role }` or 410 |
| `POST /api/invites/:token/accept` | `{ name, password, email? }` | makes the account, signs in → `{ user }` |
| `GET /api/users` | — | every member: `{ users: [{ handle, name, role }] }` (any signed-in user; for @mentions and sharing) |

`user` is `{ id, email, handle, name, role: "admin"|"member" }`.

## Admin (role admin only)

| | | |
|---|---|---|
| `GET /api/admin/users` | — | `{ users: [user + disabled, createdAt] }` |
| `PATCH /api/admin/users/:id` | `{ role?, disabled?, name? }` | `{ user }` — can't demote or disable the last admin, or yourself |
| `DELETE /api/admin/users/:id` | — | `{ ok }` — not yourself; their files stay |
| `GET /api/admin/invites` | — | `{ invites: [{ id, email, role, note, createdAt, expiresAt, usedAt, expired }] }` |
| `POST /api/admin/invites` | `{ email?, role?, note? }` | `{ invite, url, emailed }` — `url` is `<origin>/app.html#/invite/<token>`; shown once. When `mail` is on and the invite has an email, the invite link is also emailed (`emailed: true`), or `emailed: false` + `emailError` if the send failed |
| `DELETE /api/admin/invites/:id` | — | `{ ok }` |
| `GET /api/admin/sync` | — | `{ config: { remote, branch, authorName, authorEmail, interval, hasToken, enabled }, status }` |
| `PUT /api/admin/sync` | `{ remote, branch, token?, authorName?, authorEmail?, interval?, enabled }` | tests the remote, then saves → `{ config, status }` |
| `POST /api/admin/sync/now` | — | `{ status }` |

`status` is `{ state: "off"|"idle"|"syncing"|"error", lastSync, lastError, ahead, pending }`.

## GitHub mirror (server only)

Each person's own connections, each a repository and a fine-grained token that
can write to it (kept encrypted, never sent back); restore is for admins. See
DATABASE.md, phase 4.

| | | |
|---|---|---|
| `GET /api/github` | — | `{ connections: [..] }` |
| `POST /api/github/connections` | `{ repo: 'owner/name', token, space?, branch?, prefix?, mode, schedule?, allowPublic?, adopt? }` (`space`: your candle, the default, or a workspace you own or administer) | checks the token can see and write to the repository (and that it's private, unless `allowPublic`), then starts the first run (a full pass) → `{ connection }` |
| `PATCH /api/github/connections/:id` | `{ mode?, schedule?, branch?, prefix?, allowPublic?, resume?, adopt?, token? }` | a new branch or folder starts the mirror afresh there; a new token must open the same repository → `{ connection }` |
| `DELETE /api/github/connections/:id` | — | `{ ok }`; the repository keeps what was written |
| `POST /api/github/connections/:id/run` | `{ full? }` | runs now and waits → `{ connection }` |
| `POST /api/github/restore` | `{ connectionId } \| { repo, token?, branch?, prefix? }`, `repoWins?`, `confirm?` | admin. A token given here only needs to read and isn't kept. Without `confirm` only reports `{ found, take, same, kept, skipped, legacy, writtenAt }`; with it also `taken` |

A connection: `{ id, repo, url, branch, prefix, scope: 'owner'|'workspace', mode:
'manual'|'after-changes'|'interval'|'daily'|'weekly', schedule, allowPublic,
lastRunAt, lastCommit, commitUrl, nextRunAt, lastError, paused, running,
waiting, drift: [path], runs: [{ at, written, removed, commit, error, full }] }`.

## Spaces (docs/CANDLES.md)

| | | |
|---|---|---|
| `GET /api/spaces` | — | `{ spaces: [{ id, kind: 'candle'\|'workspace', name, slug, role, prefix, home }], shared: [{ prefix, path, owner, ownerName, can }] }`: your candle first; `home` is the workspace everyone shared before spaces |
| `POST /api/spaces` | `{ name }` | a new workspace, owned by you, with starter files → `{ space }` |
| `PATCH /api/spaces/:id` | `{ name?, slug? }` | owner and admins; a new slug moves everyone's paths → `{ space }` |
| `DELETE /api/spaces/:id` | — | the owner deletes a workspace → `{ ok }` |
| `GET /api/spaces/:id/members` | — | members → `{ members: [{ id, handle, name, role, joinedAt }] }` |
| `PATCH /api/spaces/:id/members/:userId` | `{ role: 'admin'\|'member'\|'owner' }` | owner and admins; only the owner hands over ownership |
| `DELETE /api/spaces/:id/members/:userId` | — | remove someone, or with your own id, leave (not the owner) |
| `GET/POST /api/spaces/:id/invites`, `DELETE …/invites/:id` | `{ role?, days? }` | owner and admins; POST → `{ token, url, role, expiresAt }` (`url` is `/app.html#/join/<token>`) |
| `GET /api/join/:token` | — | `{ space: { name, role }, signedIn, member }` (410 if expired or revoked) |
| `POST /api/join/:token` | — | signed in: join → `{ space }` |
| `POST /api/join/:token/signup` | `{ name, email, password }` | no account yet: make one (with its candle), join, sign in → `{ user, space }` |

## Files

Paths are in the person's own tree: their candle at the top
(`lists/inbox.md`), each workspace under `workspaces/<slug>/`, each thing
shared with them under `shared/<owner>/`. Every response only ever includes
files the user may read (see access rules in ARCHITECTURE.md); a path that
leads nowhere they may go is 404.

| | | |
|---|---|---|
| `GET /api/files` | — | `{ files: [{ path, sha, size }] }` |
| `POST /api/files/read` | `{ paths: [..] }` (≤ 500) | `{ files: { [path]: { text, sha } \| null } }` |
| `PUT /api/files` | `{ path, text, sha }` | `sha`: the version the edit is based on, `null` = create. → `{ sha }`. **409** `{ error, current: { text, sha } \| null }` if the file moved on. 403 with a reason if not allowed |
| `DELETE /api/files` | `{ path, sha }` | `{ ok }` (409 as above) |
| `POST /api/files/move` | `{ from, to }` | a board, calendar, doc or idea board to another space you can edit; keeps its id, drops its sharing, takes a free path if `to` is taken → `{ path }` |

## Chat (server mode only; 404 on the desktop)

| | | |
|---|---|---|
Every chat call names its place, `space`: a workspace's id (its channels, for
its members) or `dm` (direct messages between two people, outside any space,
the default). 404 when you aren't in that workspace or that conversation.

| | | |
|---|---|---|
| `GET /api/chat/channels?space=` | — | the workspace's channels you're in (if `space` is one) and your direct messages: `{ channels: [{ id, space, name, dm, members, unread, lastAt }] }` |
| `POST /api/chat/channels` | `{ space, name, members: "everyone" \| [handles] }` or `{ dm: handle }` | `{ channel }` ("everyone" is everyone in the workspace; a DM that exists is returned as is) |
| `DELETE /api/chat/channels/:id?space=` | — | whoever made the channel, or the workspace's owner or admins; removes it and its messages → `{ ok }`. A DM can't be deleted (400) |
| `GET /api/chat/messages?space=&channel=&before=` | — | up to 100 messages before the ISO time `before` (default now), oldest first, edits and deletes applied: `{ messages: [{ id, at, from, text, reply?, edited?, deleted? }], more }` |
| `POST /api/chat/messages` | `{ space, channel, text, reply? }` | `{ message }` |
| `PATCH /api/chat/messages` | `{ space, channel, id, text }` | own messages only → `{ message }` |
| `DELETE /api/chat/messages` | `{ space, channel, id }` | own (or the workspace's owner and admins) → `{ ok }` |
| `POST /api/chat/read` | `{ space, channel, at }` | marks read up to `at` |

## Desktop only

| | | |
|---|---|---|
| `GET /api/desktop/workspace` | — | `{ dir }` |
| `PUT /api/desktop/workspace` | `{ dir }` | opens (and seeds if empty) that folder → `{ dir }` |
| `GET /api/desktop/sync`, `PUT`, `POST /now` | as the admin sync endpoints | git sync of the local folder |

## WebSocket `/ws`

Authenticated by the session cookie. Server → client (JSON per frame):

- `{ type: "files", changes: [{ path, sha, deleted }] }` — only paths the user may read
- `{ type: "chat", space, channel, message }` — new, edited (`edited: true`) or deleted (`deleted: true`)
- `{ type: "channels" }` — the channel list changed; refetch
- `{ type: "typing", channel, handle }`
- `{ type: "presence", online: [handles] }`
- `{ type: "sync", status }` — admins only

Client → server: `{ type: "typing", channel }`, `{ type: "ping" }` (answered with `{ type: "pong" }`).
