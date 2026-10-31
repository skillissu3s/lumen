# Brief 04c — Docs

Read `AGENTS.md`, `docs/STORAGE.md` (docs: `docs/**/*.md` with front matter `title`, `owner`, `share`), and the client code you use — real exports only: `client/src/store/{workspace,derived,ui}.js`, `client/src/lib/{actions,router}.js`, `client/src/components/ui/`, `shared/frontmatter.js`. Create ONLY `client/src/views/docs/**` (+ `docs.css`) and replace the stub `client/src/views/DocsView.jsx` (default export, props `{ route }`; routes `/docs` and `/docs/<path under docs/>`). Libraries available: `markdown-it`, `dompurify`.

Docs are simple markdown documents beside your tasks — not a full notes app (that's obi's job). Keep it focused.

- **Left column** (240 px, collapsible; hidden under 760 px with a "Docs" back button): search box (filters titles; Enter on a result opens it), "New doc" button, folder tree from `selectDocs` (folders collapsible, alphabetic, docs show title), right-click a doc: Rename, Move to folder…, Share… (server mode: Private / Everyone / specific people via `GET /api/users` → front matter `share`), Delete (confirm). "New folder" creates a folder by creating a doc inside it.
- **Editor** (`ensure(path)` loads the text): a title input (front matter `title`; renaming the title doesn't rename the file) and the body. Modes: **Write** (a `textarea` with markdown, monospace optional pref, auto-grow, tab inserts 2 spaces, `Ctrl B / I / K` wrap bold/italic/link, Enter continues lists and checkboxes), **Preview** (markdown-it with `linkify`, `typographer`; checkboxes rendered and clickable → toggles the source line; sanitized with DOMPurify; external links open in a new tab with `rel="noopener noreferrer"`), and **Split** on wide screens. Remember the mode in localStorage.
- Autosave: `saveDoc(path, text)` debounced 600 ms (the workspace store handles conflicts and offline); show "Saved" / "Saving…" next to the title. Never lose typing: keep the textarea controlled from local state, and when a remote change arrives while not focused, take it; while focused, let the store's rebase handle it and update the textarea only if the text actually differs (keep the caret where it was, relative to the text before it).
- Front matter is hidden from the editor body (edit title/share through the UI) but preserved exactly.
- Doc header shows owner and share state (server mode), last saved time, a "…" menu: Copy link (`#/docs/<path>`), Download .md, Delete.
- Toolbar (small, ghost icons): Heading, Bold, Italic, Link, Bulleted list, Checklist, Code, Quote, Table (inserts a 2×2 table) — each acts on the textarea selection.
- Empty state when no docs: "No docs yet" + New doc. `/docs` with docs → open the last opened (localStorage) or show a simple list of recent docs.
- Palette commands via `registerCommands('docs', …)`: "Docs: new doc", "Docs: toggle preview".
- Accessible: labelled controls, the tree is a `role="tree"` with arrow-key navigation (or a simple list of links if you keep it flat-with-indent), preview has proper headings.

Done when `npx vite build` and `npm test` pass. Report what you built and how you checked it.
