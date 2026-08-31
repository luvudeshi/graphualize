import { useEditor } from '../state/store'
import { runGraphCommand } from '../state/actions'
import { modKey } from '../utils/platform'

const QUICK = ['K5', 'C8', 'Petersen', 'K3,3', 'Q3', 'G(12,0.25)']

export const CanvasEmptyState = () => {
  const setTool = useEditor((s) => s.setTool)
  const tool = useEditor((s) => s.tool)

  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <div className="gz-anim-in pointer-events-auto max-w-md px-8 text-center">
        <p className="text-[0.9375rem] text-[var(--gz-muted)]">
          {tool === 'vertex' ? (
            <>Click anywhere to place a vertex.</>
          ) : (
            <>
              Pick the{' '}
              <button
                type="button"
                className="underline decoration-dotted underline-offset-4 hover:text-[var(--gz-text)]"
                onClick={() => setTool('vertex')}
              >
                vertex tool
              </button>{' '}
              and click to start drawing.
            </>
          )}
        </p>
        <p className="mt-6 gz-label">or generate one</p>
        <div className="mt-2 flex flex-wrap justify-center gap-1.5">
          {QUICK.map((command) => (
            <button
              key={command}
              type="button"
              onClick={() => runGraphCommand(command)}
              className="gz-num rounded-md border px-2.5 py-1 transition-colors hover:border-[var(--gz-accent)] hover:text-[var(--gz-accent)]"
            >
              {command}
            </button>
          ))}
        </div>
        <p className="mt-6 text-[0.75rem] text-[var(--gz-faint)]">
          Press{' '}
          <kbd className="gz-num rounded border px-1 py-0.5 text-[0.6875rem]">
            {modKey()} K
          </kbd>{' '}
          for the command palette.
        </p>
      </div>
    </div>
  )
}
