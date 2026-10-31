# Brief 03b — UI kit (React components + base CSS)

Read `AGENTS.md` and `client/src/styles/tokens.css` (the design tokens — use only these variables; never hard-code colours). Create ONLY:
- `client/src/styles/base.css` — reset, `html/body` (font `var(--font)`, `var(--fs)`, `var(--lh)`, `var(--text)` on `var(--bg)`), headings, links, `code`/`kbd` (`var(--mono)`), thin themed scrollbars, `::selection` with `--accent-soft`, `:focus-visible { box-shadow: var(--focus-ring); outline: none }`, `.sr-only`, `button` reset.
- `client/src/styles/ui.css` — styles for the components below (class prefix `ui-`).
- `client/src/components/ui/*.jsx` and `client/src/components/ui/index.js` re-exporting all.

Look and feel: professional, quiet, dense-but-breathing (Linear / Things / Notion). 1px `--border` lines, `--radius` corners, `--shadow` only on floating things (menus, popovers, dialogs), hover = `--bg-hover`, no gradients, transitions `var(--dur) var(--ease)`. Icons: `lucide-react` at 16px, `strokeWidth={1.75}`.

## Components (named exports, props as listed; all forward `className` and spread other props onto the root element)
- `Button` `{ variant: 'primary'|'secondary'|'ghost'|'danger' = 'secondary', size: 'sm'|'md' = 'md', icon (lucide component), iconRight, loading, full }` — height 30 (sm 26), loading shows a spinner and disables.
- `IconButton` `{ icon, label (required → aria-label + title), size, active, variant: 'ghost'|'secondary' }`.
- `Input` (forwardRef) `{ size, icon, invalid }`, `Textarea` (autosize option `autoSize`), `Field` `{ label, hint, error, children }` (wires `id`/`aria-describedby`), `Select` (native `<select>` styled) `{ options: [{ value, label }] }`, `Checkbox` `{ checked, onChange, label }`, `Switch` `{ checked, onChange, label }` (role="switch").
- `TaskCheckbox` `{ status: ' '|'/'|'x'|'-', color (item colour name), onToggle, label }` — round 16px circle; done = filled accent/colour with a check; in-progress = half-filled; cancelled = strike dash. Big hit area (24px), Space/Enter toggles. This is used on every task row, make it nice.
- `Segmented` `{ value, onChange, options: [{ value, label, icon? }], label }` — radiogroup with arrow-key navigation.
- `Tabs` `{ value, onChange, tabs: [{ value, label }] }` — role tablist, arrow keys.
- `Menu` — `Menu { trigger (element), items: [{ label, icon?, shortcut?, onSelect, danger?, disabled?, checked? } | 'separator' | { section: 'Title' }], align: 'start'|'end' }`: button opens a popup `role="menu"`, arrow keys/Home/End/typeahead, Enter selects, Esc closes and returns focus, click outside closes. Also export `ContextMenu { items, children }` that opens the same menu at the pointer on right-click (and on Shift+F10 / ContextMenu key when the child has focus).
- `Popover` `{ open, onOpenChange, anchor (element ref) | trigger, placement: 'bottom-start'|'bottom-end'|'right-start'|..., children }` — positioned in a portal (`document.body`), flips to stay on-screen, Esc + outside-click close, focus moves inside on open and back on close. Export `usePopoverPosition` helper if useful.
- `Dialog` `{ open, onClose, title, description?, children, footer?, size: 'sm'|'md'|'lg' }` — portal, overlay `--overlay`, focus trap, Esc closes, `role="dialog" aria-modal="true" aria-labelledby`.
- `Tooltip` `{ label, children, side }` — on hover (400 ms) and focus; `role="tooltip"`.
- `Toaster` — renders toasts given `{ toasts: [{ id, message, action?: { label, run }, tone: 'default'|'success'|'danger' }], onDismiss }` bottom-center, `aria-live="polite"`.
- `Kbd` `{ keys: ['Ctrl', 'K'] }` — shows ⌘ instead of Ctrl on mac (`navigator.platform`).
- `EmptyState` `{ icon, title, children, action }`.
- `Avatar` `{ name, size }` — initials on a colour chosen deterministically from the name (use `--c-*-bg`/`--c-*-fg`).
- `Badge` `{ tone: 'default'|'accent'|'danger', children }`, `Chip` `{ color (item colour name), icon, onRemove, children }` (used for date/time/tag chips; `onRemove` shows a small ×).
- `ColorDot` `{ color, size }`, `ColorPicker` `{ value, onChange }` — the 10 item colours (gray red orange amber green teal blue indigo violet pink) as a radiogroup of dots.
- `EmojiPicker` `{ value, onChange }` — a compact grid (~120 common emoji grouped: activities, work, people, food, travel, objects, symbols) with a search input that filters by name (keep a small name map) and a "None" option; keyboard navigable.
- `MiniMonth` `{ value (iso date), onChange, weekStart (0|1), marks: Set of iso dates (dot under day), today (iso) }` — month grid with prev/next, `role="grid"`, arrow keys move focus by day/week, PageUp/PageDown month, Home/End week, Enter selects. Use helpers from `shared/dates.js` (import with a relative path, e.g. `../../../../shared/dates.js`).
- `DateField` `{ value (iso|null), onChange, placeholder, clearable }` — a button showing a friendly date (`relativeDay` from shared/dates.js) that opens a Popover with quick picks (Today, Tomorrow, Next week, No date) + `MiniMonth`; also accepts typing in natural words via `parseQuickAdd` from `shared/quickadd.js` (take its `date`).
- `TimeField` `{ value ('HH:MM'|null), onChange, h12 (bool), step (minutes, 15) }` — an input accepting `9`, `930`, `9:30`, `9.30pm`, `21:30` (normalize on blur/Enter), with a dropdown list of times every `step` minutes.
- `DurationField` `{ value (minutes|null), onChange }` — presets 15m 30m 45m 1h 1h30m 2h 3h + free typing (`parseDuration` from shared/dates.js).
- `Spinner`, `Separator`, `ScrollArea` (just a styled div).

## Demo page
Create `client/src/components/ui/Gallery.jsx` exporting `Gallery` — renders every component with a few states (light/dark toggle button that flips `document.documentElement.dataset.theme`). It is used for review only.

Accessibility is a requirement, not a bonus: every interactive element reachable and operable by keyboard, visible focus, correct roles/labels, `prefers-reduced-motion` respected.

Done when: `npx vite build` succeeds (temporarily you may render `<Gallery />` from nowhere — do not edit `App.jsx`/`main.jsx`; just make sure the files compile by importing `Gallery` in a scratch file you delete before finishing, or rely on `vite build` of an entry that doesn't exist yet — at minimum run `node --check` style syntax checks are not enough: use `npx esbuild client/src/components/ui/index.js --bundle --outfile=/dev/null --loader:.jsx=jsx --jsx=automatic --external:react --external:lucide-react` style check if vite can't see the files yet). Report what you built and anything you skipped.
