import { useMemo } from 'react'
import { useEditor } from '../state/store'
import { useInterval } from '../hooks/useDeferred'
import { useTheme } from '../hooks/useTheme'
import { canvasTheme } from '../canvas/theme'
import { algorithmById } from '../graph/algorithms'
import type { AlgorithmOptions, AlgorithmStep, VertexOrdering } from '../graph/algorithms/types'
import {
  CloseIcon,
  PauseIcon,
  PlayIcon,
  RestartIcon,
  StepBackIcon,
  StepForwardIcon,
} from './Icons'

const SPEEDS = [0.6, 1.2, 2.4, 5]

/**
 * A legend, because the states on the canvas are otherwise told apart by
 * colour alone. Only the states present in the current frame are listed, so it
 * stays short and matches what is actually on screen.
 */
const Legend = ({ dark, step }: { dark: boolean; step?: AlgorithmStep }) => {
  const theme = canvasTheme(dark)
  const entries: { label: string; color: string; edge?: boolean; dashed?: boolean }[] = []
  if (step?.activeVertices?.length) entries.push({ label: 'current', color: theme.current })
  if (step?.visitedVertices?.length) entries.push({ label: 'visited', color: theme.visited })
  if (step?.frontierVertices?.length) entries.push({ label: 'frontier', color: theme.frontier })
  if (step?.treeEdges?.length) entries.push({ label: 'accepted edge', color: theme.accepted, edge: true })
  if (step?.rejectedEdges?.length) {
    entries.push({ label: 'rejected edge', color: theme.rejected, edge: true, dashed: true })
  }
  if (!entries.length) return null

  return (
    <ul className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {entries.map((entry) => (
        <li key={entry.label} className="flex items-center gap-1.5 text-[0.6875rem] text-[var(--gz-muted)]">
          {entry.edge ? (
            <span
              aria-hidden
              className="h-0 w-4"
              style={{
                borderTop: `2px ${entry.dashed ? 'dashed' : 'solid'} ${entry.color}`,
              }}
            />
          ) : (
            <span
              aria-hidden
              className="h-2.5 w-2.5 rounded-full"
              style={{ border: `2px solid ${entry.color}` }}
            />
          )}
          {entry.label}
        </li>
      ))}
    </ul>
  )
}

const OPTION_LABEL = 'flex shrink-0 items-center gap-1 text-[0.75rem] text-[var(--gz-muted)]'
const OPTION_SELECT = 'gz-input w-auto max-w-[8rem] py-0.5 text-[0.75rem]'

/**
 * The run's own choices, beside its title: where it starts, where it is
 * heading and, for colouring, the vertex order. Only the choices the algorithm
 * understands appear. Changing one restarts the run from its first step; runs
 * are deterministic, so that is exactly the run those options produce.
 */
const RunOptions = ({
  algorithmId,
  options,
}: {
  algorithmId: string
  options: AlgorithmOptions
}) => {
  const graph = useEditor((s) => s.graph)
  const setOptions = useEditor((s) => s.setAlgorithmOptions)
  const vertices = useMemo(
    () => graph.vertexIds.map((id) => ({ id, label: graph.label(id) })),
    [graph],
  )
  const def = algorithmById(algorithmId)
  if (!def) return null

  const vertexOptions = vertices.map((v) => (
    <option key={v.id} value={v.id}>
      {v.label}
    </option>
  ))

  return (
    <>
      {def.needsSource && (
        <label className={OPTION_LABEL} title="Start vertex">
          From
          <select
            aria-label="From vertex"
            value={options.source ?? ''}
            onChange={(event) => setOptions({ source: event.target.value })}
            className={OPTION_SELECT}
          >
            {vertexOptions}
          </select>
        </label>
      )}
      {def.acceptsTarget && (
        <label className={OPTION_LABEL} title="Target vertex (optional)">
          To
          <select
            aria-label="To vertex"
            value={options.target ?? ''}
            onChange={(event) => setOptions({ target: event.target.value || undefined })}
            className={OPTION_SELECT}
          >
            <option value="" aria-label="None">
              —
            </option>
            {vertexOptions}
          </select>
        </label>
      )}
      {def.orderings && (
        <label className={OPTION_LABEL} title="The order the vertices are coloured in">
          Order
          <select
            aria-label="Order of vertices"
            value={options.ordering ?? def.defaultOrdering ?? def.orderings[0]?.id}
            onChange={(event) => setOptions({ ordering: event.target.value as VertexOrdering })}
            className={OPTION_SELECT}
          >
            {def.orderings.map((ordering) => (
              <option key={ordering.id} value={ordering.id}>
                {ordering.label}
              </option>
            ))}
          </select>
        </label>
      )}
    </>
  )
}

export const AlgorithmPanel = () => {
  const session = useEditor((s) => s.algorithm)
  const stop = useEditor((s) => s.stopAlgorithm)
  const stepForward = useEditor((s) => s.stepForward)
  const stepBackward = useEditor((s) => s.stepBackward)
  const goToStep = useEditor((s) => s.goToStep)
  const setPlaying = useEditor((s) => s.setPlaying)
  const speed = useEditor((s) => s.playbackSpeed)
  const setSpeed = useEditor((s) => s.setPlaybackSpeed)
  const { dark } = useTheme()

  const playing = session?.playing ?? false
  useInterval(
    () => {
      const state = useEditor.getState()
      const current = state.algorithm
      if (!current) return
      if (current.index >= current.steps.length - 1) {
        state.setPlaying(false)
        return
      }
      state.stepForward()
    },
    playing,
    speed,
  )

  if (!session) return null

  const step = session.steps[session.index]
  const atEnd = session.index >= session.steps.length - 1
  const stateEntries = Object.entries(step?.state ?? {})

  return (
    <section
      aria-label="Algorithm playback"
      className="gz-anim-in shrink-0 border-t bg-[var(--gz-panel)]"
    >
      <div className="flex flex-wrap items-center gap-2 px-3 py-2">
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            className="gz-btn px-1.5"
            onClick={() => goToStep(0)}
            aria-label="Restart"
            title="Restart"
          >
            <RestartIcon />
          </button>
          <button
            type="button"
            className="gz-btn px-1.5"
            onClick={stepBackward}
            disabled={session.index === 0}
            aria-label="Step backward"
            title="Step backward"
          >
            <StepBackIcon />
          </button>
          <button
            type="button"
            className="gz-btn gz-btn-primary px-2"
            onClick={() => setPlaying(!playing)}
            aria-label={playing ? 'Pause' : 'Play'}
            title={playing ? 'Pause' : 'Play'}
          >
            {playing ? <PauseIcon /> : <PlayIcon />}
          </button>
          <button
            type="button"
            className="gz-btn px-1.5"
            onClick={stepForward}
            disabled={atEnd}
            aria-label="Step forward"
            title="Step forward"
          >
            <StepForwardIcon />
          </button>
        </div>

        <div className="min-w-0 flex-1">
          {/* Wraps on a narrow screen, so the description drops to its own line
              instead of truncating to nothing beside the choices. */}
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="shrink-0 text-[0.8125rem] font-semibold">{session.title}</span>
            <RunOptions algorithmId={session.algorithmId} options={session.options} />
            <span className="gz-num shrink-0 text-[0.6875rem] text-[var(--gz-faint)]">
              {session.index + 1}/{session.steps.length}
            </span>
            <span className="min-w-0 flex-[1_1_8rem] truncate text-[0.8125rem] text-[var(--gz-text)]">
              {step?.description}
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={Math.max(0, session.steps.length - 1)}
            value={session.index}
            onChange={(event) => goToStep(Number(event.target.value))}
            aria-label="Algorithm step"
            className="mt-1 h-1 w-full cursor-pointer appearance-none rounded-full bg-[var(--gz-border)] accent-[var(--gz-accent)]"
          />
        </div>

        <label className="flex shrink-0 items-center gap-1 text-[0.75rem] text-[var(--gz-muted)]">
          <span className="sr-only">Playback speed</span>
          <select
            value={speed}
            onChange={(event) => setSpeed(Number(event.target.value))}
            className="gz-input w-auto py-1 text-[0.75rem]"
          >
            {SPEEDS.map((value) => (
              <option key={value} value={value}>
                {value}x
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          className="gz-btn shrink-0 px-1.5"
          onClick={stop}
          aria-label="Exit visualisation"
          title="Exit visualisation"
        >
          <CloseIcon />
        </button>
      </div>

      {step && (
        <div className="flex flex-wrap items-start gap-x-5 gap-y-1.5 border-t px-3 py-2">
          {step?.detail && (
            <p className="gz-num w-full text-[0.75rem] text-[var(--gz-muted)]">{step.detail}</p>
          )}
          <Legend dark={dark} step={step} />
          {stateEntries.map(([label, value]) => (
            <div key={label} className="min-w-0">
              <span className="gz-label">{label}</span>
              <p className="gz-num truncate text-[0.8125rem]">{value}</p>
            </div>
          ))}
          {atEnd &&
            session.result?.map((entry) => (
              <div key={entry.label} className="min-w-0">
                <span className="gz-label text-[var(--gz-accent)]">{entry.label}</span>
                <p className="gz-num truncate text-[0.8125rem]">{entry.value}</p>
              </div>
            ))}
        </div>
      )}
    </section>
  )
}
