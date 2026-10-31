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
Everything here is plain text in your workspace folder (or GitHub repository):

- **Tasks** live in \`lists/*.md\`, one markdown line each — \`- [ ] Call the bank 📅 2026-11-02 ⏰ 10:30\`.
- **Events** live in \`calendars/*.md\` — the same line, without the checkbox.
- **Docs** like this one live in \`docs/\`.
- **Plugins** live in \`plugins/\`; their data in \`data/plugins/\`.

You can edit any of these files with another editor (Obsidian works well) and Lumen picks the changes up.
`

/** { path: text } for a new workspace */
export function seedFiles({ handle, name = '', chat = false, now = new Date() }) {
  const json = (v) => `${JSON.stringify(v, null, 2)}\n`
  const files = {
    'lumen.json': json({ version: 1, name: name ? `${name}'s workspace` : 'My workspace', inbox: 'inbox', plugins: {} }),
    '.gitattributes': GITATTRIBUTES,
    'lists/inbox.md': `---\nname: Inbox\nicon: 📥\nowner: ${handle}\n---\n- [ ] Try Lumen: type "Plan the week tomorrow 9am for 30m" in the box above 🆔 ${newId()}\n`,
    'calendars/personal.md': `---\nname: Personal\ncolor: blue\nowner: ${handle}\ndefault: true\n---\n`,
    'docs/welcome.md': WELCOME().replace('{{handle}}', handle),
  }
  if (chat) files['chat/channels.json'] = json([{ id: 'general', name: 'general', members: 'everyone', created: now.toISOString(), by: handle }])
  return files
}
