import { useState } from 'react'
import {
  Calendar,
  Inbox,
  MoreHorizontal,
  Moon,
  Plus,
  Search,
  Sun,
  Trash2,
} from 'lucide-react'
import { addDays, todayIso } from '../../../../shared/dates.js'
import {
  Avatar,
  Badge,
  Button,
  Checkbox,
  Chip,
  ColorDot,
  ColorPicker,
  ContextMenu,
  DateField,
  Dialog,
  DurationField,
  EmojiPicker,
  EmptyState,
  Field,
  IconButton,
  Input,
  Kbd,
  Menu,
  MiniMonth,
  Popover,
  ScrollArea,
  Segmented,
  Select,
  Separator,
  Spinner,
  Switch,
  Tabs,
  TaskCheckbox,
  Textarea,
  TimeField,
  Toaster,
  Tooltip,
} from './index.js'
import '../../styles/tokens.css'
import '../../styles/base.css'
import '../../styles/ui.css'

const MENU_ITEMS = [
  { section: 'Task' },
  { label: 'Open', icon: Inbox, shortcut: ['Enter'], onSelect: () => {} },
  { label: 'Move to today', icon: Calendar, shortcut: ['Ctrl', 'T'], onSelect: () => {} },
  { label: 'Pinned', checked: true, onSelect: () => {} },
  'separator',
  { label: 'Delete', icon: Trash2, danger: true, shortcut: ['Del'], onSelect: () => {} },
  { label: 'Unavailable', disabled: true, onSelect: () => {} },
]

export function Gallery() {
  const today = todayIso()
  const [dark, setDark] = useState(document.documentElement.dataset.theme === 'dark')
  const [text, setText] = useState('')
  const [notes, setNotes] = useState('A short note.')
  const [select, setSelect] = useState('one')
  const [checked, setChecked] = useState(true)
  const [switched, setSwitched] = useState(false)
  const [tasks, setTasks] = useState({ gray: ' ', red: '/', green: 'x', blue: '-' })
  const [segment, setSegment] = useState('list')
  const [tab, setTab] = useState('today')
  const [popover, setPopover] = useState(false)
  const [dialog, setDialog] = useState(false)
  const [color, setColor] = useState('indigo')
  const [emoji, setEmoji] = useState('📚')
  const [day, setDay] = useState(today)
  const [date, setDate] = useState(today)
  const [time, setTime] = useState('09:30')
  const [duration, setDuration] = useState(30)
  const [toasts, setToasts] = useState([
    {
      id: 1,
      message: 'Task saved',
      tone: 'success',
      action: { label: 'Undo', run: () => {} },
    },
    { id: 2, message: 'Could not reach the server', tone: 'danger' },
  ])
  const [toastId, setToastId] = useState(3)

  const marks = new Set([today, addDays(today, 2), addDays(today, 5)])

  function toggleTheme() {
    const next = dark ? 'light' : 'dark'
    document.documentElement.dataset.theme = next
    setDark(!dark)
  }

  return (
    <div className="ui-gallery">
      <div className="ui-gallery-head">
        <h1>Lumen UI kit</h1>
        <Button icon={dark ? Sun : Moon} onClick={toggleTheme}>
          {dark ? 'Light theme' : 'Dark theme'}
        </Button>
      </div>

      <section className="ui-gallery-section">
        <h2>Buttons</h2>
        <div className="ui-gallery-grid">
          <Button variant="primary">Primary</Button>
          <Button>Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger">Danger</Button>
          <Button size="sm">Small</Button>
          <Button variant="primary" icon={Plus}>
            Add task
          </Button>
          <Button loading>Saving</Button>
          <Button disabled>Disabled</Button>
          <IconButton icon={Plus} label="Add" />
          <IconButton icon={MoreHorizontal} label="More" variant="secondary" />
          <IconButton icon={Search} label="Search" active />
        </div>
      </section>

      <section className="ui-gallery-section">
        <h2>Inputs</h2>
        <div className="ui-gallery-stack">
          <Field label="Title" hint="Shown on the task row">
            <Input icon={Search} placeholder="Search tasks" value={text} onChange={(e) => setText(e.target.value)} />
          </Field>
          <Field label="Invalid" error="A title is required">
            <Input invalid placeholder="Untitled" />
          </Field>
          <Field label="Notes">
            <Textarea autoSize value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
          <Field label="Project">
            <Select
              value={select}
              onChange={(e) => setSelect(e.target.value)}
              options={[
                { value: 'one', label: 'One' },
                { value: 'two', label: 'Two' },
                { value: 'three', label: 'Three' },
              ]}
            />
          </Field>
          <div className="ui-gallery-grid">
            <Checkbox checked={checked} onChange={(e) => setChecked(e.target.checked)} label="Checkbox" />
            <Switch checked={switched} onChange={setSwitched} label="Switch" />
          </div>
        </div>
      </section>

      <section className="ui-gallery-section">
        <h2>Task checkboxes</h2>
        <div className="ui-gallery-grid">
          {Object.entries(tasks).map(([taskColor, status]) => (
            <TaskCheckbox
              key={taskColor}
              color={taskColor}
              status={status}
              label={`${taskColor} task`}
              onToggle={(next) => setTasks((current) => ({ ...current, [taskColor]: next }))}
            />
          ))}
          <TaskCheckbox status="x" label="Default accent task" onToggle={() => {}} />
        </div>
      </section>

      <section className="ui-gallery-section">
        <h2>Navigation</h2>
        <div className="ui-gallery-stack">
          <Segmented
            label="View"
            value={segment}
            onChange={setSegment}
            options={[
              { value: 'list', label: 'List', icon: Inbox },
              { value: 'calendar', label: 'Calendar', icon: Calendar },
            ]}
          />
          <Tabs
            value={tab}
            onChange={setTab}
            tabs={[
              { value: 'today', label: 'Today' },
              { value: 'week', label: 'This week' },
              { value: 'all', label: 'All tasks' },
            ]}
          />
        </div>
      </section>

      <section className="ui-gallery-section">
        <h2>Menus, popover and dialog</h2>
        <div className="ui-gallery-grid">
          <Menu trigger={<Button icon={MoreHorizontal}>Menu</Button>} items={MENU_ITEMS} />
          <ContextMenu items={MENU_ITEMS}>
            <Button>Right-click me</Button>
          </ContextMenu>
          <Popover
            open={popover}
            onOpenChange={setPopover}
            trigger={<Button>Open popover</Button>}
            placement="bottom-start"
          >
            <div style={{ padding: 12, maxWidth: 220 }}>
              <strong>Popover</strong>
              <p style={{ color: 'var(--text-muted)', marginTop: 4 }}>
                Positioned in a portal and flipped to stay on screen.
              </p>
            </div>
          </Popover>
          <Button onClick={() => setDialog(true)}>Open dialog</Button>
          <Tooltip label="Keyboard shortcut">
            <Button variant="ghost">Hover or focus me</Button>
          </Tooltip>
        </div>
        <Dialog
          open={dialog}
          onClose={() => setDialog(false)}
          title="Delete this task?"
          description="This cannot be undone."
          footer={
            <>
              <Button onClick={() => setDialog(false)}>Cancel</Button>
              <Button variant="danger" onClick={() => setDialog(false)}>
                Delete
              </Button>
            </>
          }
        >
          <p>The task and its notes will be removed.</p>
        </Dialog>
      </section>

      <section className="ui-gallery-section">
        <h2>Small pieces</h2>
        <div className="ui-gallery-grid">
          <Badge>Default</Badge>
          <Badge tone="accent">Accent</Badge>
          <Badge tone="danger">Overdue</Badge>
          <Chip color="blue" icon={Calendar}>
            Tomorrow
          </Chip>
          <Chip color="violet" onRemove={() => {}}>
            #project
          </Chip>
          <Avatar name="Ada Lovelace" size={28} />
          <Avatar name="Sam" size={20} />
          <ColorDot color="red" size={10} />
          <Kbd keys={['Ctrl', 'K']} />
          <Spinner />
        </div>
        <div className="ui-gallery-grid" style={{ marginTop: 16 }}>
          <ColorPicker value={color} onChange={setColor} />
        </div>
      </section>

      <section className="ui-gallery-section">
        <h2>Date and time</h2>
        <div className="ui-gallery-stack">
          <DateField value={date} onChange={setDate} clearable />
          <TimeField value={time} onChange={setTime} />
          <DurationField value={duration} onChange={setDuration} />
          <MiniMonth value={day} onChange={setDay} marks={marks} today={today} />
        </div>
      </section>

      <section className="ui-gallery-section">
        <h2>Emoji</h2>
        <EmojiPicker value={emoji} onChange={setEmoji} />
      </section>

      <section className="ui-gallery-section">
        <h2>Empty state and scrolling</h2>
        <EmptyState
          icon={Inbox}
          title="No tasks yet"
          action={
            <Button variant="primary" icon={Plus}>
              Add a task
            </Button>
          }
        >
          Tasks you add will show up here.
        </EmptyState>
        <ScrollArea style={{ maxHeight: 90, border: '1px solid var(--border)', borderRadius: 6 }}>
          <div style={{ padding: 8 }}>
            {Array.from({ length: 12 }, (_, i) => (
              <div key={i}>Scrollable row {i + 1}</div>
            ))}
          </div>
        </ScrollArea>
        <Separator />
      </section>

      <section className="ui-gallery-section">
        <h2>Toasts</h2>
        <Button
          onClick={() => {
            setToasts((current) => [
              ...current,
              { id: toastId, message: `Saved item ${toastId}`, tone: 'default' },
            ])
            setToastId((id) => id + 1)
          }}
        >
          Show a toast
        </Button>
        <Toaster toasts={toasts} onDismiss={(id) => setToasts((current) => current.filter((t) => t.id !== id))} />
      </section>
    </div>
  )
}
