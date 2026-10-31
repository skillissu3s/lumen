# Working in the Lumen repo (for coding agents)

Read `docs/ARCHITECTURE.md` and `docs/STORAGE.md` first. Plugin work: also `docs/PLUGINS.md`.

## Hard rules
- **No git commands that change anything** (no commit, add, checkout, reset, stash). Reviewers commit.
- **Do not edit `package.json` / `package-lock.json` or install packages.** If you truly need a dependency, say so in your final message. Available: react 19, react-dom, zustand 5, lucide-react, markdown-it, dompurify, diff-match-patch, express 5, ws, vite 8, electron 44. Node 24 (built-in `node:sqlite`, `node:test`, global `fetch`, `crypto.subtle`).
- **Only touch the files your brief names.** `shared/` is the tested core — never change it unless the brief says so; import from it instead.
- ES modules everywhere (`import`/`export`), except `desktop/preload.cjs`.
- No TypeScript, no new build tools, no CSS frameworks. Plain CSS with the variables in `client/src/styles/tokens.css`.
- Finish by running `npm test` (must stay green) and, for client code, `npx vite build` (must succeed). Report what you did, what you could not do, and anything you are unsure about.

## Style
- 2-space indent, single quotes, no semicolons, trailing commas in multi-line literals.
- Short comments explaining *why*, matching the existing files. No banner comments.
- Small focused modules. No dead code, no commented-out code, no TODO stubs left as "done".
- User-facing text: plain, short, sentence case. No emoji in UI chrome (emoji are user content).

## Using the shared core
- `shared/items.js` — parse and edit list/calendar files. Edits are pure `text → text` functions that name items by id: `updateItem`, `addItem`, `removeItem`, `moveItem`, `skipOccurrence`, `endSeriesBefore`, `parseItems`, `flatItems`.
- `shared/quickadd.js` — `parseQuickAdd(text, { today })` → `{ title, date, time, duration, priority, recurrence, found }`.
- `shared/calendar.js` — `expand(items, from, to, opts)`, `onDay`, `layoutDay`, `freeGaps`.
- `shared/dates.js`, `shared/recurrence.js`, `shared/frontmatter.js`, `shared/ics.js`, `shared/merge.js`.
