// Markdown → safe HTML for the preview, with clickable checklists.
import MarkdownIt from 'markdown-it'
import DOMPurify from 'dompurify'

const md = new MarkdownIt({ html: false, linkify: true, typographer: true, breaks: false })

// external links open in a new tab
const defaultLink = md.renderer.rules.link_open || ((tokens, i, opts, env, self) => self.renderToken(tokens, i, opts))
md.renderer.rules.link_open = (tokens, i, opts, env, self) => {
  const href = tokens[i].attrGet('href') || ''
  if (/^https?:/i.test(href)) {
    tokens[i].attrSet('target', '_blank')
    tokens[i].attrSet('rel', 'noopener noreferrer')
  }
  return defaultLink(tokens, i, opts, env, self)
}

const TASK = /^(\s*(?:[-*+]|\d+[.)])\s+)\[([ xX])\]/

/** Line numbers (in `body`) of checklist items, in order, skipping code fences */
export function taskLines(body) {
  const out = []
  let fence = false
  body.split('\n').forEach((line, n) => {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence
    else if (!fence && TASK.test(line)) out.push(n)
  })
  return out
}

/** HTML for `body`; checklist items become checkboxes carrying their index */
export function renderMarkdown(body) {
  let html = md.render(body)
  let i = 0
  html = html.replace(/<li>(\s*<p>)?\[([ xX])\]\s*/g, (_, p, mark) => `<li class="task-item">${p || ''}<input type="checkbox" data-task="${i++}"${mark.trim() ? ' checked' : ''} aria-label="Toggle item"> `)
  return DOMPurify.sanitize(html, { ADD_ATTR: ['target', 'data-task'] })
}

/** The body with checklist item `index` ticked or unticked */
export function toggleTaskInBody(body, index) {
  const lines = body.split('\n')
  const n = taskLines(body)[index]
  if (n == null) return body
  lines[n] = lines[n].replace(TASK, (m, lead, mark) => `${lead}[${mark.trim() ? ' ' : 'x'}]`)
  return lines.join('\n')
}
