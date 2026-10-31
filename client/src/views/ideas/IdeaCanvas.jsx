// An idea board: cards of text and links on an open surface, grouped in frames
// and joined by arrows. Drag empty space to select, hold Space (or the middle
// button) to pan, scroll to move, Ctrl + scroll to zoom. Saved as JSON Canvas a
// moment after each change; Ctrl+Z steps back.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { BoxSelect, CircleSlash, Copy, ExternalLink, Globe, Link2, ListPlus, Maximize, Minus, MousePointer2, Pencil, Plus, Redo2, StickyNote, Trash2, Undo2 } from 'lucide-react'
import { MenuPopup, Tooltip } from '../../components/ui/index.js'
import { useWorkspace } from '../../store/workspace.js'
import { useUI } from '../../store/ui.js'
import { usePrefs } from '../../store/prefs.js'
import { useConfig, useLists, inboxPath } from '../../store/hooks.js'
import { addCard } from '../../lib/boardActions.js'
import { newId } from '../../../../shared/items.js'
import { anchor, bounds, colorCode, colorName, edgeMid, edgePath, facingSide, insideGroup, overlaps, parseCanvas, serializeCanvas } from '../../../../shared/canvas.js'
import { renderMarkdown } from '../docs/markdown.js'

const COLORS = ['red', 'orange', 'amber', 'green', 'teal', 'violet']
const SIDES = ['top', 'right', 'bottom', 'left']
const GRID = 12
const clampZoom = (z) => Math.max(0.2, Math.min(2.5, z))
const snap = (v, on) => (on ? Math.round(v / GRID) * GRID : Math.round(v))
const URL_RE = /^https?:\/\/\S+$/i
const host = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

function NodeView({ node, selected, editing, fresh, onPointerDown, onDoubleClick, onContextMenu, onResize, onConnect, onEditDone }) {
  const color = colorName(node.color)
  const style = { left: node.x, top: node.y, width: node.width, height: node.height }
  if (color) Object.assign(style, { '--nc': `var(--c-${color})`, '--nc-bg': `var(--c-${color}-bg)` })
  const handles = SIDES.map((side) => <span key={side} className={`idea-handle is-${side}`} onPointerDown={(e) => onConnect?.(e, side)} aria-hidden="true" title="Drag to connect" />)
  const common = { 'data-node': node.id, onPointerDown, onDoubleClick, onContextMenu }
  const finish = {
    onPointerDown: (e) => e.stopPropagation(),
    onBlur: (e) => onEditDone(e.target.value),
  }
  if (node.type === 'group')
    return (
      <div className={`idea-group${selected ? ' is-selected' : ''}${color ? ' has-color' : ''}`} style={style} {...common}>
        {editing ? (
          <input
            className="idea-group-label-edit"
            defaultValue={node.label || ''}
            autoFocus
            aria-label="Group name"
            onFocus={(e) => e.target.select()}
            {...finish}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur()
              e.stopPropagation()
            }}
          />
        ) : (
          <span className="idea-group-label">{node.label || 'Group'}</span>
        )}
        {selected && <span className="idea-resize" onPointerDown={onResize} aria-hidden="true" />}
      </div>
    )
  if (node.type === 'link')
    return (
      <div className={`idea idea-link${selected ? ' is-selected' : ''}${color ? ' has-color' : ''}${fresh ? ' is-fresh' : ''}`} style={style} tabIndex={-1} role="group" aria-label={`Link to ${node.url}`} {...common}>
        {editing ? (
          <input
            className="idea-link-edit"
            defaultValue={node.url || ''}
            autoFocus
            placeholder="https://…"
            aria-label="Link"
            {...finish}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur()
              e.stopPropagation()
            }}
          />
        ) : (
          <div className="idea-link-body">
            <span className="idea-link-icon">
              <Globe size={16} />
            </span>
            <span className="idea-link-text">
              <b>{node.url ? host(node.url) : 'A link'}</b>
              <small>{node.url || 'Double-click to add a link'}</small>
            </span>
          </div>
        )}
        {handles}
        {selected && !editing && <span className="idea-resize" onPointerDown={onResize} aria-hidden="true" />}
      </div>
    )
  return (
    <div className={`idea${selected ? ' is-selected' : ''}${color ? ' has-color' : ''}${editing ? ' is-editing' : ''}${fresh ? ' is-fresh' : ''}`} style={style} tabIndex={-1} role="group" aria-label={(node.text || 'Empty idea').slice(0, 80)} {...common}>
      {editing ? (
        <textarea
          className="idea-edit"
          defaultValue={node.text || ''}
          autoFocus
          aria-label="Idea"
          placeholder="Write an idea…"
          {...finish}
          onKeyDown={(e) => {
            if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) e.currentTarget.blur()
            e.stopPropagation()
          }}
        />
      ) : node.text ? (
        <div className="idea-body md" dangerouslySetInnerHTML={{ __html: renderMarkdown(node.text) }} />
      ) : (
        <div className="idea-body idea-placeholder">Double-click to write</div>
      )}
      {!editing && handles}
      {selected && !editing && <span className="idea-resize" onPointerDown={onResize} aria-hidden="true" />}
    </div>
  )
}

export function IdeaCanvas({ path }) {
  const file = useWorkspace((s) => s.files[path])
  const toast = useUI((s) => s.toast)
  const prefs = usePrefs()
  const lists = useLists()
  const config = useConfig()
  const [model, setModel] = useState(() => parseCanvas(file?.text))
  const [view, setView] = useState({ x: 80, y: 80, z: 1 })
  const [selected, setSelected] = useState(() => new Set())
  const [edge, setEdge] = useState(null)
  const [editing, setEditing] = useState(null) // a node's id, or { edge: id }
  const [linking, setLinking] = useState(null) // { from, side, x, y }
  const [box, setBox] = useState(null) // the selection rectangle, in world units
  const [menu, setMenu] = useState(null)
  const [panning, setPanning] = useState(false)
  const [spaceDown, setSpaceDown] = useState(false)
  const [fresh, setFresh] = useState(null) // a card just added (it pops in)
  const surface = useRef(null)
  const drag = useRef(null)
  const saved = useRef(file?.text)
  const timer = useRef(null)
  const fitted = useRef(!parseCanvas(file?.text).nodes.length) // an empty board starts at 100%
  const modelRef = useRef(model)
  modelRef.current = model
  const history = useRef({ past: [], future: [] })
  const pointer = useRef(null) // the last place the pointer was, in world units
  const clip = useRef(null)

  // take changes made elsewhere, unless we're in the middle of something
  useEffect(() => {
    if (!file || file.text === saved.current || drag.current || editing) return
    saved.current = file.text
    setModel(parseCanvas(file.text))
  }, [file?.text]) // eslint-disable-line react-hooks/exhaustive-deps

  const save = useCallback(
    (next) => {
      clearTimeout(timer.current)
      timer.current = setTimeout(() => {
        const text = serializeCanvas(next)
        saved.current = text
        useWorkspace.getState().setText(path, text)
      }, 350)
    },
    [path],
  )
  useEffect(() => () => clearTimeout(timer.current), [])

  // every change goes through here, so it can be undone
  const commit = useCallback(
    (next, prev = modelRef.current) => {
      const h = history.current
      h.past.push(prev)
      if (h.past.length > 100) h.past.shift()
      h.future = []
      modelRef.current = next
      setModel(next)
      save(next)
    },
    [save],
  )
  const step = (from, to) => {
    const h = history.current
    if (!h[from].length) return
    h[to].push(modelRef.current)
    const next = h[from].pop()
    modelRef.current = next
    setModel(next)
    save(next)
    setSelected(new Set())
    setEdge(null)
  }
  const undo = () => step('past', 'future')
  const redo = () => step('future', 'past')

  const toWorld = useCallback(
    (clientX, clientY) => {
      const r = surface.current.getBoundingClientRect()
      return { x: (clientX - r.left - view.x) / view.z, y: (clientY - r.top - view.y) / view.z }
    },
    [view],
  )
  const center = () => {
    const el = surface.current
    const r = el.getBoundingClientRect()
    return toWorld(r.left + el.clientWidth / 2, r.top + el.clientHeight / 2)
  }

  const fit = useCallback((nodes) => {
    const b = bounds(nodes || modelRef.current.nodes)
    const el = surface.current
    if (!b || !el) return setView({ x: 80, y: 80, z: 1 })
    const z = clampZoom(Math.min((el.clientWidth - 120) / b.width, (el.clientHeight - 120) / b.height, 1.2))
    setView({ z, x: (el.clientWidth - b.width * z) / 2 - b.x * z, y: (el.clientHeight - b.height * z) / 2 - b.y * z })
  }, [])
  useLayoutEffect(() => {
    if (!fitted.current && model.nodes.length) {
      fitted.current = true
      fit()
    }
  }, [model.nodes.length, fit])

  // ---- making and changing things ----
  const addNode = (node, edit = true) => {
    commit({ ...modelRef.current, nodes: [...modelRef.current.nodes, node] })
    setSelected(new Set([node.id]))
    setFresh(node.id)
    if (edit) setEditing(node.id)
  }
  const at = (p) => p || pointer.current || center()
  const newIdea = (p, text = '') => {
    const c = at(p)
    addNode({ id: newId(16), type: 'text', text, x: snap(c.x - 120, true), y: snap(c.y - 60, true), width: 240, height: 120 }, !text)
  }
  const newLink = (p, url = '') => {
    const c = at(p)
    addNode({ id: newId(16), type: 'link', url, x: snap(c.x - 140, true), y: snap(c.y - 36, true), width: 280, height: 72 }, !url)
  }
  const newGroup = (p) => {
    const ids = [...selected].filter((id) => model.nodes.find((n) => n.id === id)?.type !== 'group')
    let node
    if (ids.length > 1 || (ids.length && !p)) {
      // frame the selection
      const b = bounds(model.nodes.filter((n) => ids.includes(n.id)))
      node = { id: newId(16), type: 'group', label: 'Group', x: b.x - 36, y: b.y - 48, width: b.width + 72, height: b.height + 84 }
    } else {
      const c = at(p)
      node = { id: newId(16), type: 'group', label: 'Group', x: snap(c.x - 260, true), y: snap(c.y - 170, true), width: 520, height: 340 }
    }
    commit({ ...model, nodes: [node, ...model.nodes] })
    setSelected(new Set([node.id]))
    setEditing(node.id)
  }
  const remove = (ids) => {
    const gone = new Set(ids)
    commit({ ...model, nodes: model.nodes.filter((n) => !gone.has(n.id)), edges: model.edges.filter((e) => !gone.has(e.fromNode) && !gone.has(e.toNode)) })
    setSelected(new Set())
  }
  // copies of some nodes (and the arrows between them), moved by `offset`
  const copiesOf = (nodes, edges, offset) => {
    const ids = new Map(nodes.map((n) => [n.id, newId(16)]))
    return {
      nodes: nodes.map((n) => ({ ...n, id: ids.get(n.id), x: n.x + offset, y: n.y + offset })),
      edges: edges.filter((e) => ids.has(e.fromNode) && ids.has(e.toNode)).map((e) => ({ ...e, id: newId(16), fromNode: ids.get(e.fromNode), toNode: ids.get(e.toNode) })),
    }
  }
  const duplicate = (ids) => {
    const c = copiesOf(
      model.nodes.filter((n) => ids.includes(n.id)),
      model.edges,
      24,
    )
    commit({ ...model, nodes: [...model.nodes, ...c.nodes], edges: [...model.edges, ...c.edges] })
    setSelected(new Set(c.nodes.map((n) => n.id)))
  }
  const setColor = (ids, color) => commit({ ...model, nodes: model.nodes.map((n) => (ids.includes(n.id) ? { ...n, color: colorCode(color) } : n)) })
  const toFront = (ids, front) => {
    const moving = model.nodes.filter((n) => ids.includes(n.id))
    const rest = model.nodes.filter((n) => !ids.includes(n.id))
    commit({ ...model, nodes: front ? [...rest, ...moving] : [...moving, ...rest] })
  }
  const setEdgeEnds = (id, ends) => commit({ ...model, edges: model.edges.map((e) => (e.id === id ? { ...e, ...ends } : e)) })
  const makeTask = (node) => {
    const [first, ...rest] = String(node.text || node.url || '').trim().split('\n')
    const title = first.replace(/^#+\s*/, '').trim()
    if (!title) return
    const target = prefs.tasks.defaultList && lists.some((l) => l.path === prefs.tasks.defaultList) ? prefs.tasks.defaultList : inboxPath(config)
    const list = lists.find((l) => l.path === target)
    addCard(target, list?.sections[0]?.name ?? null, { title, notes: (node.type === 'link' ? node.url : rest.join('\n').trim()) || undefined })
    toast(`Added to ${list?.name || 'your inbox'}`, { tone: 'success' })
  }

  // ---- pointer: select, pan, move, resize, link ----
  const startPan = (e) => {
    e.preventDefault()
    drag.current = { kind: 'pan', sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y }
    setPanning(true)
    surface.current.setPointerCapture(e.pointerId)
  }
  const onSurfaceDown = (e) => {
    if (e.target !== surface.current && !e.target.classList.contains('idea-world')) return
    setMenu(null)
    if (e.button === 1 || (e.button === 0 && (spaceDown || e.pointerType === 'touch'))) return startPan(e)
    if (e.button !== 0) return
    setEdge(null)
    setEditing(null)
    const p = toWorld(e.clientX, e.clientY)
    drag.current = { kind: 'box', x0: p.x, y0: p.y, base: e.shiftKey ? new Set(selected) : new Set() }
    if (!e.shiftKey) setSelected(new Set())
    surface.current.setPointerCapture(e.pointerId)
  }
  const onNodeDown = (node) => (e) => {
    if (e.button === 1 || (e.button === 0 && spaceDown)) {
      e.stopPropagation()
      return startPan(e)
    }
    if (e.button !== 0) return
    e.stopPropagation()
    setEdge(null)
    setMenu(null)
    let sel = selected
    if (e.shiftKey) {
      sel = new Set(selected)
      sel.has(node.id) ? sel.delete(node.id) : sel.add(node.id)
    } else if (!selected.has(node.id)) sel = new Set([node.id])
    setSelected(sel)
    if (editing === node.id) return
    // a group carries the cards inside it
    const moving = new Set(sel)
    for (const id of sel) {
      const n = model.nodes.find((x) => x.id === id)
      if (n?.type === 'group') for (const inner of insideGroup(n, model.nodes)) moving.add(inner.id)
    }
    drag.current = { kind: 'move', lead: node, start: toWorld(e.clientX, e.clientY), moved: false, before: model, origin: new Map(model.nodes.filter((n) => moving.has(n.id)).map((n) => [n.id, { x: n.x, y: n.y }])) }
    surface.current.setPointerCapture(e.pointerId)
  }
  const onResize = (node) => (e) => {
    e.stopPropagation()
    drag.current = { kind: 'resize', id: node.id, start: toWorld(e.clientX, e.clientY), w: node.width, h: node.height, before: model }
    surface.current.setPointerCapture(e.pointerId)
  }
  const onConnect = (node) => (e, side) => {
    e.stopPropagation()
    const p = toWorld(e.clientX, e.clientY)
    drag.current = { kind: 'link', from: node.id, side }
    setLinking({ from: node.id, side, ...p })
    surface.current.setPointerCapture(e.pointerId)
  }
  const onMove = (e) => {
    if (surface.current) pointer.current = toWorld(e.clientX, e.clientY)
    const d = drag.current
    if (!d) return
    if (d.kind === 'pan') return setView((v) => ({ ...v, x: d.vx + e.clientX - d.sx, y: d.vy + e.clientY - d.sy }))
    const p = toWorld(e.clientX, e.clientY)
    if (d.kind === 'link') return setLinking((l) => ({ ...l, x: p.x, y: p.y }))
    if (d.kind === 'box') {
      const r = { x: Math.min(d.x0, p.x), y: Math.min(d.y0, p.y), width: Math.abs(p.x - d.x0), height: Math.abs(p.y - d.y0) }
      setBox(r)
      // cards it touches; groups only when it takes in the whole frame
      const hit = modelRef.current.nodes.filter((n) => (n.type === 'group' ? r.x <= n.x && r.y <= n.y && r.x + r.width >= n.x + n.width && r.y + r.height >= n.y + n.height : overlaps(r, n)))
      setSelected(new Set([...d.base, ...hit.map((n) => n.id)]))
      return
    }
    const grid = !e.altKey
    if (d.kind === 'resize') {
      const w = Math.max(120, snap(d.w + p.x - d.start.x, grid))
      const h = Math.max(60, snap(d.h + p.y - d.start.y, grid))
      return setModel((m) => ({ ...m, nodes: m.nodes.map((n) => (n.id === d.id ? { ...n, width: w, height: h } : n)) }))
    }
    // move: the card under the pointer lands on the grid, the rest keep their places relative to it
    const lead = d.origin.get(d.lead.id) || [...d.origin.values()][0]
    const dx = snap(lead.x + p.x - d.start.x, grid) - lead.x
    const dy = snap(lead.y + p.y - d.start.y, grid) - lead.y
    if (Math.abs(dx) + Math.abs(dy) > 2) d.moved = true
    setModel((m) => ({ ...m, nodes: m.nodes.map((n) => (d.origin.has(n.id) ? { ...n, x: d.origin.get(n.id).x + dx, y: d.origin.get(n.id).y + dy } : n)) }))
  }
  const onUp = (e) => {
    const d = drag.current
    drag.current = null
    setPanning(false)
    if (!d) return
    if (d.kind === 'box') return setBox(null)
    if (d.kind === 'link') {
      setLinking(null)
      const target = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-node]')?.dataset.node
      const a = model.nodes.find((n) => n.id === d.from)
      if (!a || target === d.from) return
      if (!target) {
        // let go on empty space: a new card there, already joined
        const p = toWorld(e.clientX, e.clientY)
        const node = { id: newId(16), type: 'text', text: '', x: snap(p.x - 120, true), y: snap(p.y - 60, true), width: 240, height: 120 }
        commit({ ...model, nodes: [...model.nodes, node], edges: [...model.edges, { id: newId(16), fromNode: a.id, fromSide: d.side, toNode: node.id, toSide: facingSide(node, a), toEnd: 'arrow' }] })
        setSelected(new Set([node.id]))
        setFresh(node.id)
        setEditing(node.id)
        return
      }
      const b = model.nodes.find((n) => n.id === target)
      if (!b || model.edges.some((x) => x.fromNode === a.id && x.toNode === b.id)) return
      commit({ ...model, edges: [...model.edges, { id: newId(16), fromNode: a.id, fromSide: d.side, toNode: b.id, toSide: facingSide(b, a), toEnd: 'arrow' }] })
      return
    }
    if (d.kind === 'move' && !d.moved) return
    if (d.kind !== 'pan') commit(modelRef.current, d.before)
  }
  // a wheel listener that may stop the browser's own zoom
  useEffect(() => {
    const el = surface.current
    const fn = (e) => {
      e.preventDefault()
      const r = el.getBoundingClientRect()
      if (e.ctrlKey || e.metaKey) {
        const px = e.clientX - r.left
        const py = e.clientY - r.top
        setView((v) => {
          const z = clampZoom(v.z * Math.exp(-e.deltaY * 0.0022))
          return { z, x: px - ((px - v.x) / v.z) * z, y: py - ((py - v.y) / v.z) * z }
        })
      } else setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }))
    }
    el.addEventListener('wheel', fn, { passive: false })
    return () => el.removeEventListener('wheel', fn)
  }, [])
  const zoomBy = (f) => {
    const el = surface.current
    const px = el.clientWidth / 2
    const py = el.clientHeight / 2
    setView((v) => {
      const z = clampZoom(v.z * f)
      return { z, x: px - ((px - v.x) / v.z) * z, y: py - ((py - v.y) / v.z) * z }
    })
  }

  // ---- keys: hold Space to pan, and the shortcuts ----
  useEffect(() => {
    const typing = (e) => editing || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable
    const down = (e) => {
      if (e.key === ' ' && !e.repeat && !typing(e) && surface.current?.contains(document.activeElement)) {
        e.preventDefault()
        setSpaceDown(true)
      }
    }
    const up = (e) => e.key === ' ' && setSpaceDown(false)
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [editing])

  const onKey = (e) => {
    if (editing || e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
    const ids = [...selected]
    const mod = e.ctrlKey || e.metaKey
    const key = e.key.toLowerCase()
    if (mod && key === 'z') {
      e.preventDefault()
      e.stopPropagation()
      e.shiftKey ? redo() : undo()
    } else if (mod && key === 'y') {
      e.preventDefault()
      e.stopPropagation()
      redo()
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && (ids.length || edge)) {
      e.preventDefault()
      if (edge) {
        commit({ ...model, edges: model.edges.filter((x) => x.id !== edge) })
        setEdge(null)
      } else remove(ids)
    } else if (e.key.startsWith('Arrow') && ids.length) {
      e.preventDefault()
      const s = e.shiftKey ? 48 : GRID
      const [dx, dy] = { ArrowUp: [0, -s], ArrowDown: [0, s], ArrowLeft: [-s, 0], ArrowRight: [s, 0] }[e.key]
      commit({ ...model, nodes: model.nodes.map((n) => (selected.has(n.id) ? { ...n, x: n.x + dx, y: n.y + dy } : n)) })
    } else if (mod && key === 'd' && ids.length) {
      e.preventDefault()
      duplicate(ids)
    } else if (mod && key === 'a') {
      e.preventDefault()
      setSelected(new Set(model.nodes.map((n) => n.id)))
    } else if (mod && key === 'g') {
      e.preventDefault()
      newGroup()
    } else if (e.key === 'Enter' && ids.length === 1) {
      e.preventDefault()
      setEditing(ids[0])
    } else if (e.key === 'Escape') {
      setSelected(new Set())
      setEdge(null)
      setMenu(null)
    } else if (!mod && key === 'n') {
      e.preventDefault()
      newIdea(center())
    } else if (!mod && key === 'l') {
      e.preventDefault()
      newLink(center())
    } else if (!mod && key === 'f') fit(ids.length ? model.nodes.filter((n) => selected.has(n.id)) : undefined)
    else if (e.key === 'Tab' && model.nodes.length) {
      // walk the cards in reading order
      e.preventDefault()
      const order = [...model.nodes].filter((n) => n.type !== 'group').sort((a, b) => a.y - b.y || a.x - b.x)
      const i = order.findIndex((n) => selected.has(n.id))
      const next = order[(i + (e.shiftKey ? -1 : 1) + order.length) % order.length]
      if (next) setSelected(new Set([next.id]))
    }
  }

  // ---- the clipboard: cards copy as themselves (and as text for elsewhere) ----
  const onCopy = (e, cut) => {
    if (editing || e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || !selected.size) return
    const nodes = model.nodes.filter((n) => selected.has(n.id))
    const text = nodes.map((n) => n.text || n.url || n.label || '').filter(Boolean).join('\n\n') || ' '
    clip.current = { text, nodes, edges: model.edges }
    e.clipboardData.setData('text/plain', text)
    e.preventDefault()
    if (cut) remove([...selected])
  }
  const onPaste = (e) => {
    if (editing || e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
    const text = e.clipboardData.getData('text/plain')
    e.preventDefault()
    if (clip.current && text === clip.current.text) {
      const c = copiesOf(clip.current.nodes, clip.current.edges, 32)
      commit({ ...model, nodes: [...model.nodes, ...c.nodes], edges: [...model.edges, ...c.edges] })
      setSelected(new Set(c.nodes.map((n) => n.id)))
      clip.current = { ...clip.current, nodes: c.nodes, edges: c.edges }
    } else if (URL_RE.test(text.trim())) newLink(null, text.trim())
    else if (text.trim()) newIdea(null, text.trim())
  }

  // ---- right-click menus ----
  const nodeMenu = (node) => (e) => {
    e.preventDefault()
    e.stopPropagation()
    const ids = selected.has(node.id) ? [...selected] : [node.id]
    if (!selected.has(node.id)) setSelected(new Set([node.id]))
    setMenu({
      anchor: { x: e.clientX, y: e.clientY },
      items: [
        { label: node.type === 'group' ? 'Rename' : node.type === 'link' ? 'Edit link' : 'Edit', icon: Pencil, shortcut: 'Enter', onSelect: () => setEditing(node.id) },
        ...(node.type === 'link' && node.url ? [{ label: 'Open link', icon: ExternalLink, onSelect: () => window.open(node.url, '_blank', 'noopener') }] : []),
        ...(node.type !== 'group' ? [{ label: 'Make it a task', icon: ListPlus, onSelect: () => makeTask(node) }] : []),
        { section: 'Colour' },
        ...COLORS.map((c) => ({ label: c[0].toUpperCase() + c.slice(1), checked: colorName(node.color) === c, onSelect: () => setColor(ids, c) })),
        { label: 'No colour', checked: !node.color, onSelect: () => setColor(ids, null) },
        'separator',
        ...(ids.length > 1 ? [{ label: 'Group these', icon: BoxSelect, shortcut: 'Ctrl G', onSelect: () => newGroup() }] : []),
        { label: 'Bring to front', onSelect: () => toFront(ids, true) },
        { label: 'Send to back', onSelect: () => toFront(ids, false) },
        { label: 'Duplicate', icon: Copy, shortcut: 'Ctrl D', onSelect: () => duplicate(ids) },
        { label: 'Delete', icon: Trash2, danger: true, shortcut: 'Del', onSelect: () => remove(ids) },
      ],
    })
  }
  const edgeMenu = (ed) => (e) => {
    e.preventDefault()
    e.stopPropagation()
    setEdge(ed.id)
    setSelected(new Set())
    const both = ed.fromEnd === 'arrow'
    const none = ed.toEnd === 'none' && !both
    setMenu({
      anchor: { x: e.clientX, y: e.clientY },
      items: [
        { label: ed.label ? 'Edit label' : 'Add a label', icon: Pencil, onSelect: () => setEditing({ edge: ed.id }) },
        { section: 'Arrows' },
        { label: 'At the end', checked: !both && !none, onSelect: () => setEdgeEnds(ed.id, { toEnd: 'arrow', fromEnd: undefined }) },
        { label: 'At both ends', checked: both, onSelect: () => setEdgeEnds(ed.id, { toEnd: 'arrow', fromEnd: 'arrow' }) },
        { label: 'None', checked: none, onSelect: () => setEdgeEnds(ed.id, { toEnd: 'none', fromEnd: undefined }) },
        'separator',
        { label: 'Delete arrow', icon: Trash2, danger: true, onSelect: () => (commit({ ...model, edges: model.edges.filter((x) => x.id !== ed.id) }), setEdge(null)) },
      ],
    })
  }
  const surfaceMenu = (e) => {
    if (e.target !== surface.current && !e.target.classList.contains('idea-world')) return
    e.preventDefault()
    const p = toWorld(e.clientX, e.clientY)
    setMenu({
      anchor: { x: e.clientX, y: e.clientY },
      items: [
        { label: 'Add an idea here', icon: StickyNote, shortcut: 'N', onSelect: () => newIdea(p) },
        { label: 'Add a link here', icon: Link2, shortcut: 'L', onSelect: () => newLink(p) },
        { label: 'Add a group here', icon: BoxSelect, onSelect: () => newGroup(p) },
        'separator',
        { label: 'Select everything', shortcut: 'Ctrl A', onSelect: () => setSelected(new Set(model.nodes.map((n) => n.id))) },
        { label: 'Fit everything in view', icon: Maximize, shortcut: 'F', onSelect: () => fit() },
      ],
    })
  }

  const groups = model.nodes.filter((n) => n.type === 'group')
  const cards = model.nodes.filter((n) => n.type !== 'group')
  const byId = useMemo(() => new Map(model.nodes.map((n) => [n.id, n])), [model.nodes])
  const chosen = model.nodes.filter((n) => selected.has(n.id))
  const one = chosen.length === 1 ? chosen[0] : null
  const sel = chosen.length ? bounds(chosen) : null
  // (above a group's name, when a group is at the top of the selection)
  const lift = chosen.some((n) => n.type === 'group' && n.y === sel?.y) ? 30 : 0
  const bar = sel && !editing && !box && !panning ? { left: sel.x * view.z + view.x, top: sel.y * view.z + view.y - 46 - lift } : null
  const linkFrom = linking && byId.get(linking.from)
  const editingEdge = editing && typeof editing === 'object' ? model.edges.find((x) => x.id === editing.edge) : null
  const ids = chosen.map((n) => n.id)

  const finishText = (n, value) => {
    setEditing(null)
    const m = modelRef.current
    const key = n.type === 'group' ? 'label' : n.type === 'link' ? 'url' : 'text'
    let v = n.type === 'group' ? value.trim() || 'Group' : value
    if (n.type === 'link' && v.trim() && !/^[a-z]+:/i.test(v.trim())) v = `https://${v.trim()}`
    if ((m.nodes.find((x) => x.id === n.id) || {})[key] === v) return
    commit({ ...m, nodes: m.nodes.map((x) => (x.id === n.id ? { ...x, [key]: v } : x)) })
  }
  const geometry = (ed) => {
    const a = byId.get(ed.fromNode)
    const b = byId.get(ed.toNode)
    if (!a || !b) return null
    const fs = ed.fromSide || facingSide(a, b)
    const ts = ed.toSide || facingSide(b, a)
    return { from: anchor(a, fs), fs, to: anchor(b, ts), ts }
  }

  return (
    <div className="idea-canvas">
      <div
        ref={surface}
        className={`idea-surface${spaceDown ? ' is-space' : ''}${panning ? ' is-panning' : ''}`}
        tabIndex={0}
        aria-label="Idea board. Double-click or press N to add an idea, L for a link; drag empty space to select; arrows move the selection; Delete removes it; F fits everything in view."
        style={{ backgroundPosition: `${view.x}px ${view.y}px`, backgroundSize: `${24 * view.z}px ${24 * view.z}px` }}
        onPointerDown={onSurfaceDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={() => {
          drag.current = null
          setBox(null)
          setPanning(false)
        }}
        onKeyDown={onKey}
        onCopy={(e) => onCopy(e, false)}
        onCut={(e) => onCopy(e, true)}
        onPaste={onPaste}
        onContextMenu={surfaceMenu}
        onDoubleClick={(e) => {
          if (e.target !== surface.current && !e.target.classList.contains('idea-world')) return
          newIdea(toWorld(e.clientX, e.clientY))
        }}
      >
        <div className="idea-world" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.z})` }}>
          {groups.map((n) => (
            <NodeView
              key={n.id}
              node={n}
              selected={selected.has(n.id)}
              editing={editing === n.id}
              onPointerDown={onNodeDown(n)}
              onContextMenu={nodeMenu(n)}
              onDoubleClick={(e) => {
                e.stopPropagation()
                if (e.target.closest('.idea-group-label') || e.target === e.currentTarget) setEditing(n.id)
              }}
              onResize={onResize(n)}
              onEditDone={(v) => finishText(n, v)}
            />
          ))}
          <svg className="idea-edges" aria-hidden="true">
            <defs>
              <marker id="idea-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
              </marker>
            </defs>
            {model.edges.map((ed) => {
              const g = geometry(ed)
              if (!g) return null
              const d = edgePath(g.from, g.fs, g.to, g.ts)
              return (
                <g key={ed.id} className={`idea-edge${edge === ed.id ? ' is-selected' : ''}`}>
                  <path
                    d={d}
                    className="idea-edge-hit"
                    onPointerDown={(e) => {
                      e.stopPropagation()
                      setEdge(ed.id)
                      setSelected(new Set())
                      setMenu(null)
                    }}
                    onDoubleClick={(e) => {
                      e.stopPropagation()
                      setEditing({ edge: ed.id })
                    }}
                    onContextMenu={edgeMenu(ed)}
                  />
                  <path d={d} className="idea-edge-line" markerEnd={ed.toEnd === 'none' ? undefined : 'url(#idea-arrow)'} markerStart={ed.fromEnd === 'arrow' ? 'url(#idea-arrow)' : undefined} />
                </g>
              )
            })}
            {linking && linkFrom && <path className="idea-edge-line is-draft" d={edgePath(anchor(linkFrom, linking.side), linking.side, { x: linking.x, y: linking.y }, 'left')} markerEnd="url(#idea-arrow)" />}
          </svg>
          {model.edges.map((ed) => {
            const g = (ed.label || editingEdge?.id === ed.id) && geometry(ed)
            if (!g) return null
            const m = edgeMid(g.from, g.fs, g.to, g.ts)
            return editingEdge?.id === ed.id ? (
              <input
                key={ed.id}
                className="idea-edge-label is-editing"
                style={{ left: m.x, top: m.y }}
                defaultValue={ed.label || ''}
                autoFocus
                placeholder="Label"
                aria-label="Arrow label"
                onPointerDown={(e) => e.stopPropagation()}
                onBlur={(e) => {
                  setEditing(null)
                  const v = e.target.value.trim()
                  if (v !== (ed.label || '')) commit({ ...modelRef.current, edges: modelRef.current.edges.map((x) => (x.id === ed.id ? { ...x, label: v || undefined } : x)) })
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur()
                  e.stopPropagation()
                }}
              />
            ) : (
              <span key={ed.id} className={`idea-edge-label${edge === ed.id ? ' is-selected' : ''}`} style={{ left: m.x, top: m.y }} onDoubleClick={() => setEditing({ edge: ed.id })} onContextMenu={edgeMenu(ed)}>
                {ed.label}
              </span>
            )
          })}
          {cards.map((n) => (
            <NodeView
              key={n.id}
              node={n}
              selected={selected.has(n.id)}
              editing={editing === n.id}
              fresh={fresh === n.id}
              onPointerDown={onNodeDown(n)}
              onContextMenu={nodeMenu(n)}
              onDoubleClick={(e) => {
                e.stopPropagation()
                setEditing(n.id)
              }}
              onResize={onResize(n)}
              onConnect={onConnect(n)}
              onEditDone={(v) => finishText(n, v)}
            />
          ))}
          {box && <div className="idea-box" style={{ left: box.x, top: box.y, width: box.width, height: box.height }} />}
        </div>

        {bar && (
          <div className="idea-bar" style={{ left: Math.max(8, bar.left), top: Math.max(8, bar.top) }} onPointerDown={(e) => e.stopPropagation()}>
            {chosen.length > 1 && <span className="idea-bar-count">{chosen.length}</span>}
            {COLORS.map((c) => (
              <button key={c} type="button" className="idea-swatch" style={{ '--sw': `var(--c-${c})` }} aria-label={`Colour ${c}`} aria-pressed={!!one && colorName(one.color) === c} onClick={() => setColor(ids, c)} />
            ))}
            <Tooltip label="No colour">
              <button type="button" className="idea-bar-btn" aria-label="No colour" onClick={() => setColor(ids, null)}>
                <CircleSlash size={14} />
              </button>
            </Tooltip>
            <span className="idea-bar-sep" />
            {one?.type === 'link' && one.url && (
              <Tooltip label="Open link">
                <button type="button" className="idea-bar-btn" aria-label="Open link" onClick={() => window.open(one.url, '_blank', 'noopener')}>
                  <ExternalLink size={14} />
                </button>
              </Tooltip>
            )}
            {one && one.type !== 'group' && (
              <Tooltip label="Make it a task">
                <button type="button" className="idea-bar-btn" aria-label="Make it a task" onClick={() => makeTask(one)}>
                  <ListPlus size={15} />
                </button>
              </Tooltip>
            )}
            {chosen.length > 1 && (
              <Tooltip label="Group these (Ctrl G)">
                <button type="button" className="idea-bar-btn" aria-label="Group these" onClick={() => newGroup()}>
                  <BoxSelect size={14} />
                </button>
              </Tooltip>
            )}
            <Tooltip label="Duplicate (Ctrl D)">
              <button type="button" className="idea-bar-btn" aria-label="Duplicate" onClick={() => duplicate(ids)}>
                <Copy size={14} />
              </button>
            </Tooltip>
            <Tooltip label="Delete">
              <button type="button" className="idea-bar-btn is-danger" aria-label="Delete" onClick={() => remove(ids)}>
                <Trash2 size={14} />
              </button>
            </Tooltip>
          </div>
        )}

        {!model.nodes.length && (
          <div className="idea-empty">
            <StickyNote size={22} />
            <p>Double-click anywhere to add an idea.</p>
            <p className="faint">Drag from a card’s edge to connect it, or let go on empty space for a new card there. Paste a link to make a link card.</p>
          </div>
        )}
      </div>

      <div className="idea-tools" role="toolbar" aria-label="Board tools">
        <Tooltip label="Drag empty space to select. Hold Space to pan">
          <span className={`idea-tool idea-mode${spaceDown ? '' : ' is-on'}`} aria-hidden="true">
            <MousePointer2 size={15} />
          </span>
        </Tooltip>
        <span className="idea-bar-sep" />
        <Tooltip label="Add an idea (N)">
          <button type="button" className="idea-tool is-primary" onClick={() => newIdea(center())}>
            <StickyNote size={15} /> Idea
          </button>
        </Tooltip>
        <Tooltip label="Add a link (L)">
          <button type="button" className="idea-tool" onClick={() => newLink(center())}>
            <Link2 size={15} /> Link
          </button>
        </Tooltip>
        <Tooltip label={selected.size > 1 ? 'Group the selection (Ctrl G)' : 'Add a group'}>
          <button type="button" className="idea-tool" onClick={() => newGroup(selected.size > 1 ? undefined : center())}>
            <BoxSelect size={15} /> Group
          </button>
        </Tooltip>
        <span className="idea-bar-sep" />
        <Tooltip label="Undo (Ctrl Z)">
          <button type="button" className="idea-tool" aria-label="Undo" disabled={!history.current.past.length} onClick={undo}>
            <Undo2 size={15} />
          </button>
        </Tooltip>
        <Tooltip label="Redo (Ctrl Shift Z)">
          <button type="button" className="idea-tool" aria-label="Redo" disabled={!history.current.future.length} onClick={redo}>
            <Redo2 size={15} />
          </button>
        </Tooltip>
      </div>
      <div className="idea-zoom" role="toolbar" aria-label="Zoom">
        <button type="button" className="idea-tool" aria-label="Zoom out" onClick={() => zoomBy(1 / 1.2)}>
          <Minus size={14} />
        </button>
        <button type="button" className="idea-tool idea-zoom-level" aria-label="Reset zoom" onClick={() => setView((v) => ({ ...v, z: 1 }))}>
          {Math.round(view.z * 100)}%
        </button>
        <button type="button" className="idea-tool" aria-label="Zoom in" onClick={() => zoomBy(1.2)}>
          <Plus size={14} />
        </button>
        <Tooltip label="Fit everything (F)">
          <button type="button" className="idea-tool" aria-label="Fit everything" onClick={() => fit()}>
            <Maximize size={14} />
          </button>
        </Tooltip>
      </div>
      {menu && <MenuPopup anchor={menu.anchor} items={menu.items} onClose={() => setMenu(null)} />}
    </div>
  )
}
