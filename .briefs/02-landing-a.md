# Brief 02 — landing page (variant a)

Read `AGENTS.md` first. Create ONLY `client/landing-a/index.html` and `client/landing-a/landing.css`. Nothing else.

Lumen is a personal productivity app: tasks, a calendar (time-blocking like the Structured app), docs, team chat for people you invite, and plugins (e.g. a Forest-style focus timer, a computer-usage monitor). Data is plain markdown/JSON in your own GitHub repository; it runs as a web app (with or without a server) and as a desktop app.

## Requirements
- Static HTML + CSS only. No JavaScript at all. No external requests (no web fonts from CDNs, no images from the internet). Use `font-family: 'Inter Variable', Inter, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif`.
- Copy the colour variables you need from `client/src/styles/tokens.css` into `landing.css` (light theme values at `:root`, dark ones under `@media (prefers-color-scheme: dark)`). Use the indigo accent.
- **Professional and calm**, like Linear/Vercel/Things marketing pages but plainer: lots of whitespace, one accent colour, no gradients-everywhere, no glassmorphism, no animations beyond a subtle hover. Max content width ~1080px.
- Sections:
  1. Header: wordmark "Lumen" (a small simple inline SVG mark + text), right side: "Download" (link) and a **Sign in** button.
  2. Hero: headline (≤ 8 words) about planning your day in plain text you own; one-sentence subhead; buttons **Sign in** (primary) → `app.html#/signin`, **Use with GitHub** (secondary) → `app.html#/github`, and a text link "Get the desktop app" → `https://github.com/skillissu3s/lumen/releases/latest`.
  3. A product visual built in HTML/CSS (not an image): a mock app window showing a sidebar (Today, Inbox, Calendar, Docs, Chat, Focus) and a day timeline with 4–5 colour-tinted time blocks with emoji icons (e.g. 09:30 🧍 Standup, 10:00 ✍️ Write report 1h30m, 12:30 🥗 Lunch, 14:00 📞 Call the bank) and a small task list. Must look good at desktop and collapse sensibly on mobile.
  4. Features grid (6 cards, short): Tasks, Calendar, Docs, Chat, Plugins, Your data in Git. Each: a simple inline SVG icon (stroke icons, 20px, `currentColor`), title, one or two sentences.
  5. "Three ways to run it": GitHub mode (no server, just you), Self-hosted (invite people; only the admin can invite), Desktop app (offline, works with a folder). A compact 3-column comparison.
  6. A short "It's just text" block showing a code sample of a list file (use a `<pre>` with this content):
     ```
     ---
     name: Errands
     ---
     - [ ] 📞 Call the bank ⏫ 📅 2026-11-02 ⏰ 10:30 ⏱ 15m
     - [ ] Water plants 🔁 every week 📅 2026-11-03
     - [x] Renew passport ✅ 2026-10-28
     ```
  7. Footer: "Lumen" + links (GitHub repo `https://github.com/skillissu3s/lumen`, Docs → `https://github.com/skillissu3s/lumen/tree/main/docs`) + "Sign in".
- Accessible: semantic landmarks (`header`, `main`, `section` with headings, `footer`), one `h1`, visible focus styles (`:focus-visible` ring with the accent), sufficient contrast, `prefers-reduced-motion` respected, the mock window `aria-hidden="true"` with a short visually-hidden description.
- Responsive: works from 360px to 1440px; no horizontal scroll at 360px.
- `<title>Lumen — your day, in plain text</title>`, meta description, `<meta name="color-scheme" content="light dark">`, favicon `<link rel="icon" href="favicon.svg">`.

Variant direction: Editorial and typographic: large confident headline, generous whitespace, the product mock is the hero, features in a clean 3x2 grid with thin borders.

Done when both files exist, the page is valid HTML, and it looks polished in light and dark. Describe your design in 3 lines in your final message.
