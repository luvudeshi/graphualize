import type { ReactNode } from 'react'
import { useEditor } from '../state/store'
import { runGraphCommand } from '../state/actions'
import { modKey } from '../utils/platform'
import '../styles/canvas.css'

/**
 * The quick commands, each a key lettered the way a mathematician would
 * write it. The button is named by the command itself, so what is read out
 * is what the canvas runs.
 */
const QUICK: { command: string; label: ReactNode }[] = [
  { command: 'K5', label: <><i>K</i><sub>5</sub></> },
  { command: 'C8', label: <><i>C</i><sub>8</sub></> },
  { command: 'Petersen', label: 'Petersen' },
  { command: 'K3,3', label: <><i>K</i><sub>3,3</sub></> },
  { command: 'Q3', label: <><i>Q</i><sub>3</sub></> },
  { command: 'G(12,0.25)', label: <><i>G</i>(12, 0.25)</> },
]

/** The smallest figure worth drawing: three points joined in the three inks. */
const Figure = () => (
  <svg className="gz-wb-empty-figure" viewBox="0 0 72 60" aria-hidden="true">
    <line x1="10" y1="50" x2="36" y2="8" data-ink="red" />
    <line x1="36" y1="8" x2="62" y2="50" data-ink="blue" />
    <line x1="62" y1="50" x2="10" y2="50" data-ink="yellow" />
    <circle cx="10" cy="50" r="4.5" />
    <circle cx="36" cy="8" r="4.5" />
    <circle cx="62" cy="50" r="4.5" />
  </svg>
)

export const CanvasEmptyState = () => {
  const setTool = useEditor((s) => s.setTool)
  const tool = useEditor((s) => s.tool)

  return (
    <div className="gz-wb-empty-wrap pointer-events-none absolute inset-0 flex items-center justify-center">
      {/* Clicks pass through to the canvas ("click anywhere"); only the controls take them. */}
      <div className="gz-anim-in gz-wb-empty pointer-events-none">
        <Figure />
        <p className="gz-wb-empty-prompt">
          {tool === 'vertex' ? (
            <>Click anywhere to place a vertex.</>
          ) : (
            <>
              Pick the{' '}
              <button type="button" className="gz-wb-empty-tool" onClick={() => setTool('vertex')}>
                vertex tool
              </button>{' '}
              and click to start drawing.
            </>
          )}
        </p>
        <div className="gz-wb-quick">
          <p className="gz-wb-quick-intro">or generate one</p>
          {QUICK.map(({ command, label }) => (
            <button
              key={command}
              type="button"
              aria-label={command}
              onClick={() => runGraphCommand(command)}
              className="gz-wb-cmd"
            >
              {label}
            </button>
          ))}
        </div>
        <p className="gz-wb-empty-hint">
          Press <kbd className="gz-wb-kbd">{modKey()} K</kbd> for the command palette.
        </p>
      </div>
    </div>
  )
}
