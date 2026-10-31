// Ideas: free-form boards for thinking before anything is a task. /ideas shows
// every idea board; /ideas/<id> opens one on its canvas.
import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, Lightbulb, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react'
import { Button, Dialog, EmptyState, IconBadge, Menu, Spinner } from '../../components/ui/index.js'
import { useIdeas } from '../../store/hooks.js'
import { useWorkspace } from '../../store/workspace.js'
import { navigate } from '../../lib/router.js'
import { createIdeaBoard, deleteIdeaBoard, updateIdeaMeta } from '../../lib/boardActions.js'
import { bounds, colorName } from '../../../../shared/canvas.js'
import { ListEditor } from '../../shell/ListEditor.jsx'
import { IdeaCanvas } from './IdeaCanvas.jsx'
import './ideas.css'

// a small drawing of the board's layout for its tile
function Preview({ board }) {
  const b = bounds(board.nodes)
  if (!b) return <div className="idea-tile-preview is-empty" />
  const pad = 40
  return (
    <svg className="idea-tile-preview" viewBox={`${b.x - pad} ${b.y - pad} ${b.width + pad * 2} ${b.height + pad * 2}`} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      {board.nodes.map((n) => {
        const c = colorName(n.color)
        return n.type === 'group' ? (
          <rect key={n.id} x={n.x} y={n.y} width={n.width} height={n.height} rx="16" className="pv-group" style={c ? { stroke: `var(--c-${c})` } : undefined} />
        ) : (
          <rect key={n.id} x={n.x} y={n.y} width={n.width} height={n.height} rx="12" className="pv-card" style={c ? { fill: `var(--c-${c}-bg)`, stroke: `var(--c-${c})` } : undefined} />
        )
      })}
    </svg>
  )
}

function Gallery({ boards }) {
  const [creating, setCreating] = useState(false)
  const ref = useRef(null)
  const count = (b) => b.nodes.filter((n) => n.type !== 'group').length
  return (
    <div className="view ideas-view">
      <header className="view-header">
        <h1 className="view-title">
          <IconBadge name="lightbulb" color="violet" size={26} />
          <span>Ideas</span>
        </h1>
        <div className="view-actions">
          <Button ref={ref} variant="primary" size="sm" icon={Plus} onClick={() => setCreating(true)}>
            New idea board
          </Button>
        </div>
      </header>
      <div className="view-body">
        {boards.length ? (
          <div className="idea-tiles">
            {boards.map((b) => (
              <a key={b.path} className="idea-tile" href={`#/ideas/${b.id}`} style={{ '--tc': `var(--c-${b.color})` }}>
                <Preview board={b} />
                <div className="idea-tile-meta">
                  <IconBadge name={b.icon} color={b.color} size={22} />
                  <span className="idea-tile-name">{b.name}</span>
                  <span className="idea-tile-count tabular">{count(b) === 1 ? '1 idea' : `${count(b)} ideas`}</span>
                </div>
              </a>
            ))}
            <button type="button" className="idea-tile is-new" onClick={() => setCreating(true)}>
              <Plus size={18} />
              <span>New idea board</span>
            </button>
          </div>
        ) : (
          <EmptyState
            icon={Lightbulb}
            title="Think it through first"
            action={
              <Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>
                New idea board
              </Button>
            }
          >
            An idea board is an open canvas for notes, groups and the links between them. When an idea is ready, turn it into a task.
          </EmptyState>
        )}
      </div>
      <ListEditor
        open={creating}
        onOpenChange={setCreating}
        anchor={ref}
        kind="ideas"
        initial={{ color: 'violet' }}
        onSave={(v) => {
          const path = createIdeaBoard(v)
          navigate(`/ideas/${path.slice(6, -7)}`)
        }}
      />
    </div>
  )
}

function Board({ board }) {
  const [editing, setEditing] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [ready, setReady] = useState(() => !!useWorkspace.getState().files[board.path])
  const titleRef = useRef(null)
  useEffect(() => {
    if (ready) return
    useWorkspace
      .getState()
      .ensure(board.path)
      .finally(() => setReady(true))
  }, [board.path, ready])
  return (
    <div className="view idea-board-view">
      <header className="view-header">
        <a className="idea-back" href="#/ideas" aria-label="All idea boards">
          <ChevronLeft size={16} />
        </a>
        <h1 className="view-title" ref={titleRef}>
          <IconBadge name={board.icon} color={board.color} size={26} />
          <span>{board.name}</span>
        </h1>
        <div className="view-actions">
          <span className="idea-hint">Double-click to add · drag an edge to connect</span>
          <Menu
            align="end"
            items={[
              { label: 'Edit idea board…', icon: Pencil, onSelect: () => setEditing(true) },
              { label: 'Delete idea board…', icon: Trash2, danger: true, onSelect: () => setConfirm(true) },
            ]}
            trigger={
              <button type="button" className="ui-icon-button" aria-label="Idea board options">
                <MoreHorizontal size={16} />
              </button>
            }
          />
        </div>
      </header>
      {ready ? <IdeaCanvas key={board.path} path={board.path} /> : <Spinner />}
      <ListEditor open={editing} onOpenChange={setEditing} anchor={titleRef} kind="ideas" initial={board} onSave={(v) => updateIdeaMeta(board.path, v)} />
      <Dialog
        open={confirm}
        onClose={() => setConfirm(false)}
        size="sm"
        title={`Delete “${board.name}”?`}
        description="The idea board and everything on it will be removed."
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                deleteIdeaBoard(board.path)
                setConfirm(false)
                navigate('/ideas')
              }}
            >
              Delete idea board
            </Button>
          </>
        }
      />
    </div>
  )
}

export default function IdeasView({ route }) {
  const boards = useIdeas()
  const id = route.parts[1]
  if (!id) return <Gallery boards={boards} />
  const board = boards.find((b) => b.id === id)
  if (!board)
    return (
      <div className="view">
        <EmptyState title="This idea board doesn’t exist" action={<Button onClick={() => navigate('/ideas')}>All idea boards</Button>}>
          It may have been deleted or renamed.
        </EmptyState>
      </div>
    )
  return <Board board={board} />
}
