// The files a new, empty workspace starts with — the same whether it is made by
// the server, the desktop app or GitHub mode in the browser.
import { newId } from './items.js'

export const GITATTRIBUTES = `lists/*.md      merge=union
calendars/*.md  merge=union
chat/**/*.jsonl merge=union
`

const WELCOME = () => `---
title: Welcome
owner: {{handle}}
---
# Welcome to Lumen

Lumen keeps your work on **boards**: columns of cards you move along as things progress. Your tasks, calendar, idea boards and docs sit side by side.

- **Boards** live in \`lists/*.md\`. Each \`## heading\` is a column and each \`- [ ]\` line under it is a card — the same format as the Obsidian Kanban plugin.
- **Calendars** live in \`calendars/*.md\`, one line per event.
- **Idea boards** live in \`ideas/*.canvas\` (JSON Canvas, which Obsidian also opens).
- **Docs** like this one live in \`docs/\`.
- **Plugins** live in \`plugins/\`, and their data in \`data/plugins/\`.

Everything is plain text, so you can edit it with another program and Lumen picks up the changes.
`

// the first board: the three usual columns and a few cards that show the ropes
const INBOX = (handle) =>
  [
    '---',
    'name: Inbox',
    'icon: inbox',
    'color: blue',
    `owner: ${handle}`,
    'kanban-plugin: board',
    '---',
    '',
    '## To do',
    '',
    `- [ ] Type "Plan the week tomorrow 9am for 30m" in Quick add 🆔 ${newId()}`,
    `- [ ] Drag a card to another column to move it along 🆔 ${newId()}`,
    '',
    '## Doing',
    '',
    `- [ ] Open a card to add notes, a checklist or a due date 🆔 ${newId()}`,
    '',
    '## Done',
    '',
    '',
    '%% kanban:settings',
    '```',
    JSON.stringify({ 'kanban-plugin': 'board', lumen: { done: 'Done', columns: { Doing: 'amber', Done: 'green' } } }),
    '```',
    '%%',
    '',
  ].join('\n')

/** { path: text } for a new workspace */
export function seedFiles({ handle, name = '', chat = false, now = new Date() }) {
  const json = (v) => `${JSON.stringify(v, null, 2)}\n`
  const files = {
    'lumen.json': json({ version: 1, name: name ? `${name}'s workspace` : 'My workspace', inbox: 'inbox', plugins: {} }),
    '.gitattributes': GITATTRIBUTES,
    'lists/inbox.md': `---\nname: Inbox\nicon: inbox\nowner: ${handle}\n---\n- [ ] Try Lumen: type "Plan the week tomorrow 9am for 30m" in the box above 🆔 ${newId()}\n`,
    'calendars/personal.md': `---\nname: Personal\ncolor: blue\nowner: ${handle}\ndefault: true\n---\n`,
    'docs/welcome.md': WELCOME().replace('{{handle}}', handle),
  }
  if (chat) files['chat/channels.json'] = json([{ id: 'general', name: 'general', members: 'everyone', created: now.toISOString(), by: handle }])
  return files
}
