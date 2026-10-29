import { useId, type SyntheticEvent } from 'react'
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
import '../styles/tools.css'

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

/**
 * One square of the rail. Its tooltip is a paper tag drawn by the page rather
 * than the browser's own, so it is set in the book's face; the tag is hidden
 * from assistive technology and its words reach it as the button's name and
 * description instead.
 */
/**
 * The rail scrolls when the window is too short for it, so it clips what
 * overflows it; the tag is therefore pinned to the viewport (position: fixed)
 * and told where its button is each time it is about to show.
 */
const placeTip = (event: SyntheticEvent<HTMLButtonElement>) => {
  const button = event.currentTarget
  const rect = button.getBoundingClientRect()
  button.style.setProperty('--gz-tip-x', `${rect.right}px`)
  button.style.setProperty('--gz-tip-y', `${rect.top + rect.height / 2}px`)
}

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
}) => {
  const hintId = useId()
  return (
    <button
      type="button"
      onClick={onClick}
      onPointerEnter={placeTip}
      onFocus={placeTip}
      disabled={disabled}
      aria-pressed={active}
      aria-label={shortcut ? `${label} (${shortcut})` : label}
      aria-describedby={hint ? hintId : undefined}
      className="gz-wb-tool"
    >
      {children}
      <span className="gz-wb-tip" aria-hidden>
        <span className="gz-wb-tip-name">{label}</span>
        {hint && (
          <span id={hintId} className="gz-wb-tip-hint">
            {hint}
          </span>
        )}
        {shortcut && <span className="gz-wb-tip-key">{shortcut}</span>}
      </span>
    </button>
  )
}

export const Toolbar = () => {
  const tool = useEditor((s) => s.tool)
  const setTool = useEditor((s) => s.setTool)
  const undo = useEditor((s) => s.undo)
  const redo = useEditor((s) => s.redo)
  const past = useEditor((s) => s.past.length)
  const future = useEditor((s) => s.future.length)
  const requestView = useEditor((s) => s.requestView)

  return (
    <nav aria-label="Tools" className="gz-wb-rail">
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

      <div className="gz-wb-rail-rule" aria-hidden />

      <RailButton label="Undo" shortcut="Cmd Z" disabled={past === 0} onClick={undo}>
        <UndoIcon />
      </RailButton>
      <RailButton label="Redo" shortcut="Cmd Shift Z" disabled={future === 0} onClick={redo}>
        <RedoIcon />
      </RailButton>

      {/* The view group. A phone hides it: there the plate is pinched to
          zoom, and Fit to screen stays in the View menu. */}
      <div className="gz-wb-rail-view">
        <div className="gz-wb-rail-rule" aria-hidden />

        <RailButton label="Zoom in" onClick={() => requestView('zoomIn')}>
          <PlusIcon />
        </RailButton>
        <RailButton label="Zoom out" onClick={() => requestView('zoomOut')}>
          <MinusIcon />
        </RailButton>
        <RailButton label="Fit to screen" shortcut="F" onClick={() => requestView('fit')}>
          <FitIcon />
        </RailButton>
      </div>
    </nav>
  )
}
