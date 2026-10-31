// An idea board: cards of text on an open surface, grouped in frames and joined
// by arrows. Pan by dragging the background (or scrolling), zoom with Ctrl +
// scroll. Saved as JSON Canvas a moment after each change.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { BoxSelect, CircleSlash, Copy, ListPlus, Maximize, Minus, Plus, StickyNote, Trash2 } from 'lucide-react'
import { Tooltip } from '../../components/ui/index.js'
import { useWorkspace } from '../../store/workspace.js'
import { useUI } from '../../store/ui.js'
import { usePrefs } from '../../store/prefs.js'
import { useConfig, useLists, inboxPath } from '../../store/hooks.js'
import { addCard } from '../../lib/boardActions.js'
import { newId } from '../../../../shared/items.js'
import { anchor, bounds, colorCode, colorName, edgePath, facingSide, insideGroup, parseCanvas, serializeCanvas } from '../../../../shared/canvas.js'
import { renderMarkdown } from '../docs/markdown.js'

const COLORS = ['red', 'orange', 'amber', 'green', 'teal', 'violet']
const SIDES = ['top', 'right', 'bottom', 'left']
const clampZoom = (z) => Math.max(0.25, Math.min(2, z))

function NodeView({ node, selected, editing, onPointerDown, onDoubleClick, onResize, onConnect, onEditDone, onText }) {
  const color = colorName(node.color)
  const style = { left: node.x, top: node.y, width: node.width, height: node.height }
  if (color) Object.assign(style, { '--nc': `var(--c-${color})`, '--nc-bg': `var(--c-${color}-bg)` })
  if (node.type === 'group')
    return (
      <div className={`idea-group${selected ? ' is-selected' : ''}${color ? ' has-color' : ''}`} style={style} data-node={node.id} onPointerDown={onPointerDown} onDoubleClick={onDoubleClick}>
        {editing ? (
          <input
            className="idea-group-label-edit"
            defaultValue={node.label || ''}
            autoFocus
            aria-label="Group name"
            onPointerDown={(e) => e.stopPropagation()}
            onBlur={(e) => onEditDone(e.target.value)}
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
  return (
    <div
      className={`idea${selected ? ' is-selected' : ''}${color ? ' has-color' : ''}${editing ? ' is-editing' : ''}`}
      style={style}
      data-node={node.id}
      tabIndex={-1}
      role="group"
      aria-label={(node.text || 'Empty idea').slice(0, 80)}
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
    >
      {editing ? (
        <textarea
          className="idea-edit"
          defaultValue={node.text || ''}
          autoFocus
          aria-label="Idea"
          placeholder="Write an idea…"
          onPointerDown={(e) => e.stopPropagation()}
          onChange={(e) => onText(e.target.value)}
          onBlur={(e) => onEditDone(e.target.value)}
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
      {SIDES.map((side) => (
        <span key={side} className={`idea-handle is-${side}`} onPointerDown={(e) => onConnect(e, side)} aria-hidden="true" title="Drag to connect" />
      ))}
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
  const [editing, setEditing] = useState(null)
  const [linking, setLinking] = useState(null) // { from, side, x, y }
  const surface = useRef(null)
  const drag = useRef(null)
  const saved = useRef(file?.text)
  const timer = useRef(null)
  const fitted = useRef(!parseCanvas(file?.text).nodes.length) // an empty board starts at 100%
  const modelRef = useRef(model)
  modelRef.current = model

  // take changes made elsewhere, unless we're in the middle of something
  useEffect(() => {
    if (!file || file.text === saved.current || drag.current || editing) return
    saved.current = file.text
    setModel(parseCanvas(file.text))
  }, [file?.text]) // eslint-disable-line react-hooks/exhaustive-deps

  const commit = useCallback(
    (next) => {
      setModel(next)
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

  const toWorld = useCallback(
    (clientX, clientY) => {
      const r = surface.current.getBoundingClientRect()
      return { x: (clientX - r.left - view.x) / view.z, y: (clientY - r.top - view.y) / view.z }
    },
    [view],
  )

  const fit = useCallback(() => {
    const b = bounds(modelRef.current.nodes)
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

  const addNode = (node) => {
    commit({ ...model, nodes: [...model.nodes, node] })
    setSelected(new Set([node.id]))
    if (node.type === 'text') setEditing(node.id)
  }
  const newIdea = (x, y) => addNode({ id: newId(16), type: 'text', text: '', x: Math.round(x - 120), y: Math.round(y - 60), width: 240, height: 120 })
  const center = () => {
    const el = surface.current
    return toWorld(el.getBoundingClientRect().left + el.clientWidth / 2, el.getBoundingClientRect().top + el.clientHeight / 2)
  }
  const newGroup = () => {
    const c = center()
    const node = { id: newId(16), type: 'group', label: 'Group', x: Math.round(c.x - 260), y: Math.round(c.y - 170), width: 520, height: 340 }
    commit({ ...model, nodes: [node, ...model.nodes] })
    setSelected(new Set([node.id]))
  }
  const remove = (ids) => {
    const gone = new Set(ids)
    commit({ ...model, nodes: model.nodes.filter((n) => !gone.has(n.id)), edges: model.edges.filter((e) => !gone.has(e.fromNode) && !gone.has(e.toNode)) })
    setSelected(new Set())
  }
  const duplicate = (ids) => {
    const copies = model.nodes.filter((n) => ids.includes(n.id)).map((n) => ({ ...n, id: newId(16), x: n.x + 24, y: n.y + 24 }))
    commit({ ...model, nodes: [...model.nodes, ...copies] })
    setSelected(new Set(copies.map((c) => c.id)))
  }
  const setColor = (ids, color) => commit({ ...model, nodes: model.nodes.map((n) => (ids.includes(n.id) ? { ...n, color: colorCode(color) } : n)) })
  const makeTask = (node) => {
    const [first, ...rest] = String(node.text || '').trim().split('\n')
    const title = first.replace(/^#+\s*/, '').trim()
    if (!title) return
    const target = prefs.tasks.defaultList && lists.some((l) => l.path === prefs.tasks.defaultList) ? prefs.tasks.defaultList : inboxPath(config)
    const list = lists.find((l) => l.path === target)
    addCard(target, list?.sections[0]?.name ?? null, { title, notes: rest.join('\n').trim() || undefined })
    toast(`Added to ${list?.name || 'your inbox'}`)
  }

  // ---- pointer: pan, move, resize, link ----
  const onSurfaceDown = (e) => {
    if (e.button !== 0 && e.button !== 1) return
    if (e.target !== surface.current && !e.target.classList.contains('idea-world')) return
    setSelected(new Set())
    setEdge(null)
    setEditing(null)
    drag.current = { kind: 'pan', sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y }
    surface.current.setPointerCapture(e.pointerId)
  }
  const onNodeDown = (node) => (e) => {
    if (e.button !== 0) return
    e.stopPropagation()
    setEdge(null)
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
    const start = toWorld(e.clientX, e.clientY)
    drag.current = { kind: 'move', start, moved: false, origin: new Map(model.nodes.filter((n) => moving.has(n.id)).map((n) => [n.id, { x: n.x, y: n.y }])) }
    surface.current.setPointerCapture(e.pointerId)
  }
  const onResize = (node) => (e) => {
    e.stopPropagation()
    drag.current = { kind: 'resize', id: node.id, start: toWorld(e.clientX, e.clientY), w: node.width, h: node.height }
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
    const d = drag.current
    if (!d) return
    if (d.kind === 'pan') return setView((v) => ({ ...v, x: d.vx + e.clientX - d.sx, y: d.vy + e.clientY - d.sy }))
    const p = toWorld(e.clientX, e.clientY)
    if (d.kind === 'link') return setLinking((l) => ({ ...l, x: p.x, y: p.y }))
    if (d.kind === 'resize') {
      const w = Math.max(120, Math.round(d.w + p.x - d.start.x))
      const h = Math.max(60, Math.round(d.h + p.y - d.start.y))
      return setModel((m) => ({ ...m, nodes: m.nodes.map((n) => (n.id === d.id ? { ...n, width: w, height: h } : n)) }))
    }
    const dx = Math.round(p.x - d.start.x)
    const dy = Math.round(p.y - d.start.y)
    if (Math.abs(dx) + Math.abs(dy) > 2) d.moved = true
    setModel((m) => ({ ...m, nodes: m.nodes.map((n) => (d.origin.has(n.id) ? { ...n, x: d.origin.get(n.id).x + dx, y: d.origin.get(n.id).y + dy } : n)) }))
  }
  const onUp = (e) => {
    const d = drag.current
    drag.current = null
    if (!d) return
    if (d.kind === 'link') {
      setLinking(null)
      const target = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-node]')?.dataset.node
      if (!target || target === d.from) return
      const a = model.nodes.find((n) => n.id === d.from)
      const b = model.nodes.find((n) => n.id === target)
      if (!a || !b || model.edges.some((x) => x.fromNode === a.id && x.toNode === b.id)) return
      commit({ ...model, edges: [...model.edges, { id: newId(16), fromNode: a.id, fromSide: d.side, toNode: b.id, toSide: facingSide(b, a), toEnd: 'arrow' }] })
      return
    }
    if (d.kind === 'move' && !d.moved) return
    if (d.kind !== 'pan') commit(modelRef.current)
  }
  const onWheel = (e) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault()
      const r = surface.current.getBoundingClientRect()
      const px = e.clientX - r.left
      const py = e.clientY - r.top
      setView((v) => {
        const z = clampZoom(v.z * (e.deltaY < 0 ? 1.1 : 1 / 1.1))
        return { z, x: px - ((px - v.x) / v.z) * z, y: py - ((py - v.y) / v.z) * z }
      })
    } else setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }))
  }
  // a wheel listener that may prevent the browser's own zoom
  useEffect(() => {
    const el = surface.current
    const fn = (e) => (e.ctrlKey || e.metaKey) && e.preventDefault()
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

  const onKey = (e) => {
    if (editing || e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
    const ids = [...selected]
    const mod = e.ctrlKey || e.metaKey
    if ((e.key === 'Delete' || e.key === 'Backspace') && (ids.length || edge)) {
      e.preventDefault()
      if (edge) {
        commit({ ...model, edges: model.edges.filter((x) => x.id !== edge) })
        setEdge(null)
      } else remove(ids)
    } else if (e.key.startsWith('Arrow') && ids.length) {
      e.preventDefault()
      const step = e.shiftKey ? 40 : 10
      const [dx, dy] = { ArrowUp: [0, -step], ArrowDown: [0, step], ArrowLeft: [-step, 0], ArrowRight: [step, 0] }[e.key]
      commit({ ...model, nodes: model.nodes.map((n) => (selected.has(n.id) ? { ...n, x: n.x + dx, y: n.y + dy } : n)) })
    } else if (mod && e.key.toLowerCase() === 'd' && ids.length) {
      e.preventDefault()
      duplicate(ids)
    } else if (mod && e.key.toLowerCase() === 'a') {
      e.preventDefault()
      setSelected(new Set(model.nodes.map((n) => n.id)))
    } else if (e.key === 'Enter' && ids.length === 1) {
      e.preventDefault()
      setEditing(ids[0])
    } else if (e.key === 'Escape') {
      setSelected(new Set())
      setEdge(null)
    } else if (e.key.toLowerCase() === 'n' && !mod) {
      e.preventDefault()
      const c = center()
      newIdea(c.x, c.y)
    } else if (e.key.toLowerCase() === 'f' && !mod) fit()
    else if (e.key === 'Tab' && model.nodes.length) {
      // walk the cards in reading order
      e.preventDefault()
      const order = [...model.nodes].filter((n) => n.type !== 'group').sort((a, b) => a.y - b.y || a.x - b.x)
      const at = order.findIndex((n) => selected.has(n.id))
      const next = order[(at + (e.shiftKey ? -1 : 1) + order.length) % order.length]
      if (next) setSelected(new Set([next.id]))
    }
  }

  const groups = model.nodes.filter((n) => n.type === 'group')
  const cards = model.nodes.filter((n) => n.type !== 'group')
  const byId = useMemo(() => new Map(model.nodes.map((n) => [n.id, n])), [model.nodes])
  const one = selected.size === 1 ? byId.get([...selected][0]) : null
  const bar = one && !editing ? { left: one.x * view.z + view.x, top: one.y * view.z + view.y - 44 } : null
  const linkFrom = linking && byId.get(linking.from)

  return (
    <div className="idea-canvas">
      <div
        ref={surface}
        className="idea-surface"
        tabIndex={0}
        aria-label="Idea board. Double-click or press N to add an idea; arrows move the selection; Delete removes it; F fits everything in view."
        style={{ backgroundPosition: `${view.x}px ${view.y}px`, backgroundSize: `${24 * view.z}px ${24 * view.z}px` }}
        onPointerDown={onSurfaceDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={() => (drag.current = null)}
        onWheel={onWheel}
        onKeyDown={onKey}
        onDoubleClick={(e) => {
          if (e.target !== surface.current && !e.target.classList.contains('idea-world')) return
          const p = toWorld(e.clientX, e.clientY)
          newIdea(p.x, p.y)
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
              onDoubleClick={(e) => {
                e.stopPropagation()
                if (e.target.closest('.idea-group-label') || e.target === e.currentTarget) setEditing(n.id)
              }}
              onResize={onResize(n)}
              onConnect={() => {}}
              onText={() => {}}
              onEditDone={(label) => {
                setEditing(null)
                commit({ ...modelRef.current, nodes: modelRef.current.nodes.map((x) => (x.id === n.id ? { ...x, label: label.trim() || 'Group' } : x)) })
              }}
            />
          ))}
          <svg className="idea-edges" aria-hidden="true">
            <defs>
              <marker id="idea-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
              </marker>
            </defs>
            {model.edges.map((ed) => {
              const a = byId.get(ed.fromNode)
              const b = byId.get(ed.toNode)
              if (!a || !b) return null
              const fs = ed.fromSide || facingSide(a, b)
              const ts = ed.toSide || facingSide(b, a)
              const d = edgePath(anchor(a, fs), fs, anchor(b, ts), ts)
              return (
                <g key={ed.id} className={`idea-edge${edge === ed.id ? ' is-selected' : ''}`}>
                  <path d={d} className="idea-edge-hit" onPointerDown={(e) => (e.stopPropagation(), setEdge(ed.id), setSelected(new Set()))} />
                  <path d={d} className="idea-edge-line" markerEnd={ed.toEnd === 'none' ? undefined : 'url(#idea-arrow)'} />
                </g>
              )
            })}
            {linking && linkFrom && <path className="idea-edge-line is-draft" d={edgePath(anchor(linkFrom, linking.side), linking.side, { x: linking.x, y: linking.y }, 'left')} markerEnd="url(#idea-arrow)" />}
          </svg>
          {cards.map((n) => (
            <NodeView
              key={n.id}
              node={n}
              selected={selected.has(n.id)}
              editing={editing === n.id}
              onPointerDown={onNodeDown(n)}
              onDoubleClick={(e) => {
                e.stopPropagation()
                setEditing(n.id)
              }}
              onResize={onResize(n)}
              onConnect={onConnect(n)}
              onText={() => {}}
              onEditDone={(text) => {
                setEditing(null)
                commit({ ...modelRef.current, nodes: modelRef.current.nodes.map((x) => (x.id === n.id ? { ...x, text } : x)) })
              }}
            />
          ))}
        </div>

        {bar && (
          <div className="idea-bar" style={{ left: bar.left, top: Math.max(8, bar.top) }} onPointerDown={(e) => e.stopPropagation()}>
            {COLORS.map((c) => (
              <button key={c} type="button" className="idea-swatch" style={{ '--sw': `var(--c-${c})` }} aria-label={`Colour ${c}`} aria-pressed={colorName(one.color) === c} onClick={() => setColor([one.id], c)} />
            ))}
            <Tooltip label="No colour">
              <button type="button" className="idea-bar-btn" aria-label="No colour" onClick={() => setColor([one.id], null)}>
                <CircleSlash size={14} />
              </button>
            </Tooltip>
            <span className="idea-bar-sep" />
            {one.type === 'text' && (
              <Tooltip label="Make it a task">
                <button type="button" className="idea-bar-btn" aria-label="Make it a task" onClick={() => makeTask(one)}>
                  <ListPlus size={15} />
                </button>
              </Tooltip>
            )}
            <Tooltip label="Duplicate (Ctrl D)">
              <button type="button" className="idea-bar-btn" aria-label="Duplicate" onClick={() => duplicate([one.id])}>
                <Copy size={14} />
              </button>
            </Tooltip>
            <Tooltip label="Delete">
              <button type="button" className="idea-bar-btn is-danger" aria-label="Delete" onClick={() => remove([one.id])}>
                <Trash2 size={14} />
              </button>
            </Tooltip>
          </div>
        )}

        {!model.nodes.length && (
          <div className="idea-empty">
            <StickyNote size={22} />
            <p>Double-click anywhere to add an idea.</p>
            <p className="faint">Drag from a card’s edge to connect it to another. Group related ideas in a frame.</p>
          </div>
        )}
      </div>

      <div className="idea-tools" role="toolbar" aria-label="Board tools">
        <Tooltip label="Add an idea (N)">
          <button
            type="button"
            className="idea-tool is-primary"
            onClick={() => {
              const c = center()
              newIdea(c.x, c.y)
            }}
          >
            <StickyNote size={15} /> Idea
          </button>
        </Tooltip>
        <Tooltip label="Add a group">
          <button type="button" className="idea-tool" onClick={newGroup}>
            <BoxSelect size={15} /> Group
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
          <button type="button" className="idea-tool" aria-label="Fit everything" onClick={fit}>
            <Maximize size={14} />
          </button>
        </Tooltip>
      </div>
    </div>
  )
}
