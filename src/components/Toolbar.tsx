import { useEditor, type Tool } from '../state/store'
import {
  CursorIcon,
  EdgeIcon,
  EraseIcon,
  FitIcon,
  MinusIcon,
  PlusIcon,
  RedoIcon,
  UndoIcon,
  VertexIcon,
} from './Icons'

interface ToolSpec {
  id: Tool
  label: string
  hint: string
  shortcut: string
  Icon: typeof CursorIcon
}

const TOOLS: ToolSpec[] = [
  { id: 'select', label: 'Select', hint: 'Select and move', shortcut: 'V', Icon: CursorIcon },
  { id: 'vertex', label: 'Vertex', hint: 'Click empty space to add', shortcut: 'N', Icon: VertexIcon },
  { id: 'edge', label: 'Edge', hint: 'Click or drag between vertices', shortcut: 'E', Icon: EdgeIcon },
  { id: 'erase', label: 'Erase', hint: 'Click to delete', shortcut: 'X', Icon: EraseIcon },
]

const RailButton = ({
  active,
  label,
  hint,
  shortcut,
  disabled,
  onClick,
  children,
}: {
  active?: boolean
  label: string
  hint?: string
  shortcut?: string
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
}) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    aria-pressed={active}
    aria-label={shortcut ? `${label} (${shortcut})` : label}
    title={hint ? `${label} — ${hint}${shortcut ? ` (${shortcut})` : ''}` : label}
    className={`group relative flex h-9 w-9 items-center justify-center rounded-lg border transition-colors ${
      active
        ? 'border-[var(--gz-accent)] bg-[var(--gz-accent-soft)] text-[var(--gz-accent)]'
        : 'border-transparent text-[var(--gz-muted)] hover:border-[var(--gz-border)] hover:bg-[var(--gz-panel)] hover:text-[var(--gz-text)]'
    } ${disabled ? 'cursor-default opacity-35 hover:border-transparent hover:bg-transparent' : ''}`}
  >
    {children}
  </button>
)

export const Toolbar = () => {
  const tool = useEditor((s) => s.tool)
  const setTool = useEditor((s) => s.setTool)
  const undo = useEditor((s) => s.undo)
  const redo = useEditor((s) => s.redo)
  const past = useEditor((s) => s.past.length)
  const future = useEditor((s) => s.future.length)
  const requestView = useEditor((s) => s.requestView)

  return (
    <nav
      aria-label="Tools"
      className="flex w-12 shrink-0 flex-col items-center gap-1 border-r bg-[var(--gz-bg)] px-1.5 py-2"
    >
      {TOOLS.map(({ id, label, hint, shortcut, Icon }) => (
        <RailButton
          key={id}
          active={tool === id}
          label={label}
          hint={hint}
          shortcut={shortcut}
          onClick={() => setTool(id)}
        >
          <Icon />
        </RailButton>
      ))}

      <div className="my-1.5 h-px w-6 bg-[var(--gz-border)]" />

      <RailButton label="Undo" shortcut="Cmd Z" disabled={past === 0} onClick={undo}>
        <UndoIcon />
      </RailButton>
      <RailButton label="Redo" shortcut="Cmd Shift Z" disabled={future === 0} onClick={redo}>
        <RedoIcon />
      </RailButton>

      <div className="my-1.5 h-px w-6 bg-[var(--gz-border)]" />

      <RailButton label="Zoom in" onClick={() => requestView('zoomIn')}>
        <PlusIcon />
      </RailButton>
      <RailButton label="Zoom out" onClick={() => requestView('zoomOut')}>
        <MinusIcon />
      </RailButton>
      <RailButton label="Fit to screen" shortcut="F" onClick={() => requestView('fit')}>
        <FitIcon />
      </RailButton>
    </nav>
  )
}
