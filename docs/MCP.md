# AI agents (MCP)

Lumen is a [Model Context Protocol](https://modelcontextprotocol.io) server, so
an AI agent such as Claude can use it for you: look through your tasks and
calendar, add and change tasks, events, boards and docs, post in chat and, if
you allow it, delete. An agent reaches exactly what you can reach, through the
same access rules as the app, and its changes show up in everyone's app at
once, like anyone else's.

## Connect by signing in (Claude on the web, desktop and phone)

Apps that connect with just an address, like Claude's custom connectors, sign
in to Lumen instead of taking a token:

1. In claude.ai, open **Settings → Connectors → Add custom connector**. Name
   it Lumen, enter your server's address with `/mcp` (for example
   `https://lumen.example.com/mcp`) and leave the advanced fields empty.
2. Press **Connect**. Lumen opens: sign in if you need to, choose what Claude
   may do (everywhere, or space by space) and press **Allow**.
3. It works in Claude on the web, the desktop app and your phone. It shows in
   Lumen under **Settings → AI agents**, where you can change its spaces or
   remove it, which disconnects it at once.

The server must be reachable over HTTPS from the internet (the app connects
from its own servers) and should have `PUBLIC_URL` set to its address.

How it works: `/mcp` without a token answers 401 with a
`WWW-Authenticate` header pointing to
`/.well-known/oauth-protected-resource/mcp`, which names Lumen as its
authorization server; `/.well-known/oauth-authorization-server` lists the
endpoints. The app registers itself (`POST /oauth/register`, RFC 7591), sends
the person to `/oauth/authorize` (OAuth 2.1, PKCE S256 required), which
opens `#/authorize` in the app for the approval, and swaps the one-time code
at `/oauth/token` for an access token (an hour) and a refresh token (two
months, spent on each use). Both belong to an agent like any other, with the
reach chosen on the approval page (`server/oauth.js`).

## Connect one with a token

1. In Lumen, open **Settings → AI agents**. Name the agent, choose what it may
   do and press **Create token**. Copy the token: it is shown once.
2. Add Lumen to your agent.

**Claude Code** (the command is on the settings page, ready to copy):

```bash
claude mcp add --transport http lumen https://lumen.example.com/mcp --header "X-Token: lumen_…"
```

Add `--scope user` to have it in every project. Then ask, for example, "what's
on my calendar this week?" or "add 'renew passport' to my inbox for Friday".

**Claude Desktop and other apps that start a local program** use the small
bridge in `server/mcp/stdio.js` (any server serves it at `/mcp/stdio.js`).
Save it, then in `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "lumen": {
      "command": "node",
      "args": ["C:\\path\\to\\stdio.js"],
      "env": { "LUMEN_URL": "https://lumen.example.com", "LUMEN_TOKEN": "lumen_…" }
    }
  }
}
```

It needs Node 18 or newer and nothing else.

**Anything else** that speaks MCP over HTTP: the address is your server with
`/mcp` (shown on the settings page), and the token goes in an
`X-Token` header. `X-API-Key` works too, for apps that only offer a few
header names, and `Authorization: Bearer lumen_…` for apps that let you set it
(many keep that header for their own sign-in).

On the desktop app the address is the app's own local server
(`http://127.0.0.1:7720/mcp` or the next free port) and works while the app is
open.

## What an agent may do

Each token has one of three levels; change it, or remove the agent, any time
in Settings → AI agents.

| Level | In the app | Tools |
|---|---|---|
| `read` | Look only | everything that only reads |
| `edit` | Look and change | also adding, changing, moving and chat |
| `full` | Change and delete | also deleting tasks, events and files |

**Per space.** Instead of one level everywhere, a token can be given chosen
spaces, each at its own level: look only in your candle, change and delete in
one workspace, nothing in another. "Shared with you" (what others share) and
"Direct messages" are chosen the same way. A space left out is out of sight:
the agent doesn't see its files, tasks or chat at all. A workspace you join
later isn't reached until you add it. Set this when making the token, or with
**Change** beside it.

A tool the token can't use is left out of the agent's tool list, and calling
it anyway says how to allow it. Tools are marked as reading, adding or
destructive, so an app like Claude asks you before running the destructive
ones.

Tokens open `/mcp` only, never the app's own API, and are kept as hashes.

## Tools

| Tool | Does |
|---|---|
| `list_spaces` | your candle, your workspaces, and what's shared with you |
| `list_files` | boards, calendars, docs and idea boards, with paths |
| `read_file` | a file's text and version |
| `list_tasks` | tasks, filtered by board, space, status, due date, tag or words |
| `get_agenda` | events (repeating ones expanded) and dated tasks between two days |
| `search` | text across everything you can see |
| `add_task` | a task on a board (your inbox by default); quick-add words work |
| `add_event` | an event on a calendar (your default one by default) |
| `update_item` | a task's or event's title, status, dates, time, priority, repeat, notes |
| `complete_task` | done, or open again |
| `move_item` | to another column, under another task, or to another board |
| `create_board`, `create_calendar`, `create_doc` | new ones, in any space you can change |
| `write_file` | a new file, or a whole file replaced (with the version read) |
| `edit_file` | exact text replaced in a file |
| `append_to_doc` | text added to the end of a doc |
| `list_channels`, `read_messages`, `send_message` | chat (server only) |
| `delete_item`, `delete_file` | with full access only |

Paths are the ones the app uses: `lists/…`, `calendars/…`, `docs/…` in your
candle, `workspaces/<slug>/…` in a workspace, `shared/<owner>/…` for what
others share with you. Tasks and events are changed by path and id, with the
shared core's text functions, so the files stay exactly as the app writes them.

## How it works

```
 You ──ask──▶ Claude (Claude Code, Claude Desktop, …)
                │  picks a tool, e.g. add_task { title: "Renew passport friday" }
                ▼
        MCP client inside Claude
                │  JSON-RPC 2.0: initialize → tools/list → tools/call
                │  (Claude Desktop: through stdio.js, which turns lines into POSTs)
                ▼
  POST https://your-server/mcp        X-Token: lumen_…
                │
                ▼
 server/mcp/routes.js ── the token → you + its level (server/agents.js)
                │        another site's page is refused (Origin check)
                ▼
 server/mcp/protocol.js ── which method; is this tool allowed at this level?
                │
                ▼
 server/mcp/tools.js ── reads the request, builds the change with shared/
                │        (parseQuickAdd, addItem, updateItem, expand, …)
                ▼
 server/mcp/tree.js ── your path → space and file (view.js), access rules
                │      (access.js), read → change → save only if unchanged
                ▼
 files.space(…).write ── SQLite (lumen.db), journal entry
                │
                ├──▶ WebSocket: every open app of everyone who can see it updates
                ├──▶ desktop apps pick it up on their next sync
                └──▶ the GitHub copy picks it up on its next run
                ▼
 the answer (the task as saved, with its id) ──▶ Claude ──▶ tells you
```

The server keeps nothing between requests: each POST carries its token, so
there is no session to open or lose. A change is read and written under the
file's lock and saved only if no one changed the file in between; if someone
did, it is read again and redone, so an agent never overwrites a person.

## For developers

- `server/mcp/protocol.js`: JSON-RPC (`initialize`, `ping`, `tools/list`,
  `tools/call`); tool failures come back as results with `isError`, so the
  agent can read them and fix its call.
- `server/mcp/tools.js`: each tool: `name`, `title`, `description`,
  `inputSchema`, `annotations`, `access` (`read` / `edit` / `full`) and `run`.
- `server/mcp/tree.js`: paths, access and safe read-change-save.
- `server/agents.js`, `server/agentsApi.js`: tokens and `/api/me/agents`.
- `server/mcp/mcp.test.js`: every tool against a real server.
