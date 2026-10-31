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
| `PATCH /api/me` | `{ name? }` | `{ user }` |
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

## Files

Paths are workspace-relative with forward slashes. Every response only ever
includes files the user may read (see access rules in ARCHITECTURE.md).

| | | |
|---|---|---|
| `GET /api/files` | — | `{ files: [{ path, sha, size }] }` |
| `POST /api/files/read` | `{ paths: [..] }` (≤ 500) | `{ files: { [path]: { text, sha } \| null } }` |
| `PUT /api/files` | `{ path, text, sha }` | `sha`: the version the edit is based on, `null` = create. → `{ sha }`. **409** `{ error, current: { text, sha } \| null }` if the file moved on. 403 with a reason if not allowed |
| `DELETE /api/files` | `{ path, sha }` | `{ ok }` (409 as above) |

## Chat (server mode only; 404 on the desktop)

| | | |
|---|---|---|
| `GET /api/chat/channels` | — | `{ channels: [{ id, name, dm, members, unread, lastAt }] }` |
| `POST /api/chat/channels` | `{ name, members: "everyone" \| [handles] }` or `{ dm: handle }` | `{ channel }` (a DM that exists is returned as is) |
| `GET /api/chat/messages?channel=&before=` | — | up to 100 messages before the ISO time `before` (default now), oldest first, edits and deletes applied: `{ messages: [{ id, at, from, text, reply?, edited?, deleted? }], more }` |
| `POST /api/chat/messages` | `{ channel, text, reply? }` | `{ message }` |
| `PATCH /api/chat/messages` | `{ channel, id, text }` | own messages only → `{ message }` |
| `DELETE /api/chat/messages` | `{ channel, id }` | own (or admin) → `{ ok }` |
| `POST /api/chat/read` | `{ channel, at }` | marks read up to `at` |

## Desktop only

| | | |
|---|---|---|
| `GET /api/desktop/workspace` | — | `{ dir }` |
| `PUT /api/desktop/workspace` | `{ dir }` | opens (and seeds if empty) that folder → `{ dir }` |
| `GET /api/desktop/sync`, `PUT`, `POST /now` | as the admin sync endpoints | git sync of the local folder |

## WebSocket `/ws`

Authenticated by the session cookie. Server → client (JSON per frame):

- `{ type: "files", changes: [{ path, sha, deleted }] }` — only paths the user may read
- `{ type: "chat", channel, message }` — new, edited (`edited: true`) or deleted (`deleted: true`)
- `{ type: "channels" }` — the channel list changed; refetch
- `{ type: "typing", channel, handle }`
- `{ type: "presence", online: [handles] }`
- `{ type: "sync", status }` — admins only

Client → server: `{ type: "typing", channel }`, `{ type: "ping" }` (answered with `{ type: "pong" }`).
