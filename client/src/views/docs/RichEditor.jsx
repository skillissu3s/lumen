// A doc as you'd write it in Notion: formatted as you type, never showing its
// markdown, with "/" for blocks and a small bar over selected text. What it
// keeps is still plain markdown (Tiptap's markdown extension reads and writes it).
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { EditorContent, useEditor } from '@tiptap/react'
import { BubbleMenu } from '@tiptap/react/menus'
import StarterKit from '@tiptap/starter-kit'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { Placeholder } from '@tiptap/extensions'
import { Markdown } from '@tiptap/markdown'
import { Bold, Code, CodeSquare, Heading1, Heading2, Heading3, Italic, Link2, List, ListChecks, ListOrdered, Minus, Pilcrow, Quote, Strikethrough } from 'lucide-react'

// the blocks "/" offers
const BLOCKS = [
  { id: 'text', label: 'Text', hint: 'Plain writing', icon: Pilcrow, keys: 'paragraph text', run: (c) => c.setParagraph() },
  { id: 'h1', label: 'Heading 1', hint: 'Big section heading', icon: Heading1, keys: 'h1 title heading', run: (c) => c.setHeading({ level: 1 }) },
  { id: 'h2', label: 'Heading 2', hint: 'Medium section heading', icon: Heading2, keys: 'h2 heading subtitle', run: (c) => c.setHeading({ level: 2 }) },
  { id: 'h3', label: 'Heading 3', hint: 'Small section heading', icon: Heading3, keys: 'h3 heading', run: (c) => c.setHeading({ level: 3 }) },
  { id: 'todo', label: 'To-do list', hint: 'Track tasks with checkboxes', icon: ListChecks, keys: 'todo task checkbox check', run: (c) => c.toggleTaskList() },
  { id: 'bullet', label: 'Bulleted list', hint: 'A simple list', icon: List, keys: 'bullet list unordered ul', run: (c) => c.toggleBulletList() },
  { id: 'number', label: 'Numbered list', hint: 'A list with numbers', icon: ListOrdered, keys: 'number ordered list ol', run: (c) => c.toggleOrderedList() },
  { id: 'quote', label: 'Quote', hint: 'Set a passage apart', icon: Quote, keys: 'quote blockquote', run: (c) => c.toggleBlockquote() },
  { id: 'code', label: 'Code', hint: 'A block of code', icon: CodeSquare, keys: 'code block pre', run: (c) => c.toggleCodeBlock() },
  { id: 'divider', label: 'Divider', hint: 'A line between sections', icon: Minus, keys: 'divider rule line hr', run: (c) => c.setHorizontalRule() },
]

// The "/" menu: open while the text just before the cursor is "/" plus a word,
// at the start of a block or after a space.
function useSlash(editor) {
  const [slash, setSlash] = useState(null) // { from, to, q, x, y }
  useEffect(() => {
    if (!editor) return
    const check = () => {
      const { state, view } = editor
      const { $from, empty } = state.selection
      if (!empty || $from.parent.type.name === 'codeBlock') return setSlash(null)
      const before = $from.parent.textBetween(0, $from.parentOffset, '\n', '\0')
      const m = /(^|\s)\/([\w-]{0,20})$/.exec(before)
      if (!m) return setSlash(null)
      const from = $from.pos - m[2].length - 1
      const at = view.coordsAtPos(from)
      setSlash({ from, to: $from.pos, q: m[2].toLowerCase(), x: at.left, y: at.bottom })
    }
    const close = () => setSlash(null)
    editor.on('transaction', check)
    editor.on('blur', close)
    return () => {
      editor.off('transaction', check)
      editor.off('blur', close)
    }
  }, [editor])
  return [slash, setSlash]
}

function SlashMenu({ editor, slash, onClose }) {
  const [active, setActive] = useState(0)
  const items = useMemo(() => BLOCKS.filter((b) => !slash.q || b.label.toLowerCase().includes(slash.q) || b.keys.includes(slash.q)), [slash.q])
  const list = useRef(null)
  useEffect(() => setActive(0), [slash.q])
  const pick = (b) => {
    b.run(editor.chain().focus().deleteRange({ from: slash.from, to: slash.to })).run()
    onClose()
  }
  // the keys that move through the menu, before the editor sees them
  useEffect(() => {
    const onKey = (e) => {
      if (!items.length) return
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        e.stopPropagation()
        setActive((a) => (a + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length)
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        e.stopPropagation()
        pick(items[active])
      } else if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })
  useLayoutEffect(() => {
    list.current?.querySelector('.is-active')?.scrollIntoView({ block: 'nearest' })
  }, [active])
  if (!items.length) return null
  const below = slash.y + 330 < window.innerHeight
  return createPortal(
    <div className="slash-menu" ref={list} role="listbox" aria-label="Blocks" style={{ left: Math.min(slash.x, window.innerWidth - 300), top: below ? slash.y + 6 : undefined, bottom: below ? undefined : window.innerHeight - slash.y + 28 }}>
      <div className="slash-head">Blocks</div>
      {items.map((b, i) => (
        <button key={b.id} type="button" role="option" aria-selected={i === active} className={`slash-item${i === active ? ' is-active' : ''}`} onMouseDown={(e) => e.preventDefault()} onMouseEnter={() => setActive(i)} onClick={() => pick(b)}>
          <span className="slash-icon">
            <b.icon size={16} />
          </span>
          <span className="slash-text">
            <b>{b.label}</b>
            <small>{b.hint}</small>
          </span>
        </button>
      ))}
    </div>,
    document.body,
  )
}

function LinkField({ editor, onDone }) {
  const [href, setHref] = useState(editor.getAttributes('link').href || '')
  const apply = () => {
    const url = href.trim()
    if (!url) editor.chain().focus().extendMarkRange('link').unsetLink().run()
    else editor.chain().focus().extendMarkRange('link').setLink({ href: /^[a-z]+:|^#|^\//i.test(url) ? url : `https://${url}` }).run()
    onDone()
  }
  return (
    <input
      className="bubble-link"
      autoFocus
      value={href}
      placeholder="Paste a link…"
      aria-label="Link"
      onChange={(e) => setHref(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          apply()
        } else if (e.key === 'Escape') {
          e.preventDefault()
          onDone()
        }
      }}
      onBlur={apply}
    />
  )
}

/**
 * `markdown`: the doc's body (a newer one from elsewhere is taken in while the
 * doc isn't being typed in). `onChange(markdown)` runs as it is edited.
 */
export function RichEditor({ markdown, onChange, onBlur, editorRef }) {
  const [linking, setLinking] = useState(false)
  const latest = useRef(markdown)
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] }, link: { openOnClick: false, autolink: true } }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({ placeholder: ({ node }) => (node.type.name === 'heading' ? 'Heading' : 'Write something, or press / for blocks…') }),
      Markdown,
    ],
    content: markdown,
    contentType: 'markdown',
    editorProps: { attributes: { class: 'doc-prose', 'aria-label': 'Document', spellcheck: 'true' } },
    onUpdate: ({ editor: e }) => {
      const md = e.getMarkdown()
      latest.current = md
      onChange(md)
    },
    onBlur: () => onBlur?.(),
  })
  useEffect(() => {
    if (editorRef) editorRef.current = editor
  }, [editor, editorRef])

  // a change from elsewhere: taken in while the doc isn't being typed in
  useEffect(() => {
    if (!editor || editor.isFocused || markdown === latest.current) return
    latest.current = markdown
    editor.commands.setContent(markdown, { contentType: 'markdown', emitUpdate: false })
  }, [editor, markdown])

  const [slash, setSlash] = useSlash(editor)
  if (!editor) return null
  const mark = (name, run, Icon, label) => (
    <button type="button" className={`bubble-btn${editor.isActive(name) ? ' is-on' : ''}`} aria-label={label} title={label} onMouseDown={(e) => e.preventDefault()} onClick={run}>
      <Icon size={15} />
    </button>
  )
  return (
    <>
      <BubbleMenu editor={editor} className="bubble" shouldShow={({ editor: e, state }) => !state.selection.empty && !e.isActive('codeBlock')}>
        {linking ? (
          <LinkField editor={editor} onDone={() => setLinking(false)} />
        ) : (
          <>
            <select
              className="bubble-type"
              aria-label="Turn into"
              value={editor.isActive('heading', { level: 1 }) ? 'h1' : editor.isActive('heading', { level: 2 }) ? 'h2' : editor.isActive('heading', { level: 3 }) ? 'h3' : 'text'}
              onChange={(e) => BLOCKS.find((b) => b.id === e.target.value)?.run(editor.chain().focus()).run()}
            >
              <option value="text">Text</option>
              <option value="h1">Heading 1</option>
              <option value="h2">Heading 2</option>
              <option value="h3">Heading 3</option>
            </select>
            <span className="bubble-sep" />
            {mark('bold', () => editor.chain().focus().toggleBold().run(), Bold, 'Bold (Ctrl B)')}
            {mark('italic', () => editor.chain().focus().toggleItalic().run(), Italic, 'Italic (Ctrl I)')}
            {mark('strike', () => editor.chain().focus().toggleStrike().run(), Strikethrough, 'Strikethrough')}
            {mark('code', () => editor.chain().focus().toggleCode().run(), Code, 'Inline code')}
            {mark('link', () => setLinking(true), Link2, 'Link (Ctrl K)')}
          </>
        )}
      </BubbleMenu>
      <EditorContent
        editor={editor}
        className="doc-editor"
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k' && !editor.state.selection.empty) {
            e.preventDefault()
            e.stopPropagation()
            setLinking(true)
          }
        }}
      />
      {slash && <SlashMenu editor={editor} slash={slash} onClose={() => setSlash(null)} />}
    </>
  )
}
