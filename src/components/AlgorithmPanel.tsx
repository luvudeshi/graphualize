import { useMemo, type CSSProperties } from 'react'
import { useEditor } from '../state/store'
import { useInterval } from '../hooks/useDeferred'
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
import '../styles/algorithm.css'

const SPEEDS = [0.6, 1.2, 2.4, 5]

/**
 * A legend, because the states on the canvas are otherwise told apart by
 * colour alone. Only the states present in the current frame are listed, so it
 * stays short and matches what is actually on screen. Each state is one of
 * the figure glyphs in the screen's own inks: a disc in the signal for the
 * current vertex, slate for visited, the pale tint ringed in ink for the
 * frontier, a signal bar for the edge being examined, a slate bar for an
 * accepted edge and a dotted ink line for a rejected one. An edge the step is examining is drawn as the
 * current edge even when it is also accepted or rejected, so those two are
 * listed only when some edge actually shows them.
 */
const Legend = ({ step }: { step?: AlgorithmStep }) => {
  const entries: { label: string; glyph: string; ink?: 'red' | 'blue' | 'yellow' }[] = []
  if (step?.activeVertices?.length) entries.push({ label: 'current', glyph: 'gz-glyph-disc', ink: 'red' })
  if (step?.visitedVertices?.length) entries.push({ label: 'visited', glyph: 'gz-glyph-disc', ink: 'blue' })
  if (step?.frontierVertices?.length) {
    entries.push({ label: 'frontier', glyph: 'gz-glyph-disc', ink: 'yellow' })
  }
  const active = new Set(step?.activeEdges ?? [])
  const shown = (ids?: readonly string[]) => Boolean(ids?.some((id) => !active.has(id)))
  if (active.size) entries.push({ label: 'current edge', glyph: 'gz-glyph-bar', ink: 'red' })
  if (shown(step?.treeEdges)) entries.push({ label: 'accepted edge', glyph: 'gz-glyph-bar', ink: 'blue' })
  if (shown(step?.rejectedEdges)) entries.push({ label: 'rejected edge', glyph: 'gz-wb-glyph-rejected' })
  if (!entries.length) return null

  return (
    <ul className="gz-wb-algo-legend">
      {entries.map((entry) => (
        <li key={entry.label}>
          <span aria-hidden className={entry.glyph} data-ink={entry.ink} />
          {entry.label}
        </li>
      ))}
    </ul>
  )
}

const OPTION_LABEL = 'gz-label gz-wb-algo-option'
const OPTION_SELECT = 'gz-input gz-wb-algo-select'

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
  // On the last step the result says the same things in the signal colour, so
  // the running state would only repeat it (order twice, colours beside
  // colours used).
  const shownState = atEnd && session.result?.length ? [] : stateEntries
  const last = Math.max(0, session.steps.length - 1)
  // How far along the run is, 0 to 1, for the lit part of the scrubber's slot.
  const progress = { '--gz-wb-progress': last ? session.index / last : 0 } as CSSProperties

  return (
    <section aria-label="Algorithm playback" className="gz-anim-in gz-wb-algo">
      <div className="gz-wb-algo-bar">
        <div className="gz-wb-algo-transport">
          <button
            type="button"
            className="gz-btn gz-wb-algo-key"
            onClick={() => goToStep(0)}
            aria-label="Restart"
            title="Restart"
          >
            <RestartIcon />
          </button>
          <button
            type="button"
            className="gz-btn gz-wb-algo-key"
            onClick={stepBackward}
            disabled={session.index === 0}
            aria-label="Step backward"
            title="Step backward"
          >
            <StepBackIcon />
          </button>
          <button
            type="button"
            className="gz-btn gz-btn-primary gz-wb-algo-key gz-wb-algo-play"
            onClick={() => setPlaying(!playing)}
            aria-label={playing ? 'Pause' : 'Play'}
            title={playing ? 'Pause' : 'Play'}
          >
            {playing ? <PauseIcon /> : <PlayIcon />}
            <span aria-hidden className="gz-wb-algo-play-word">
              {playing ? 'Pause' : 'Play'}
            </span>
          </button>
          <button
            type="button"
            className="gz-btn gz-wb-algo-key"
            onClick={stepForward}
            disabled={atEnd}
            aria-label="Step forward"
            title="Step forward"
          >
            <StepForwardIcon />
          </button>
        </div>

        <div className="gz-wb-algo-main">
          {/* Wraps when there is no room, so the readout drops to a line of
              its own instead of truncating to nothing beside the choices. */}
          <div className="gz-wb-algo-head">
            {/* The deck's lamp: lit while the run is playing. */}
            <span aria-hidden className="gz-led gz-wb-algo-lamp" data-on={playing} />
            <span aria-hidden className="gz-marker gz-wb-algo-marker">
              Algorithm
            </span>
            <span className="gz-wb-algo-name">{session.title}</span>
            <RunOptions algorithmId={session.algorithmId} options={session.options} />
            <div className="gz-wb-algo-readout">
              <span className="gz-wb-algo-count">
                <span aria-hidden className="gz-label gz-wb-algo-count-label">
                  Step
                </span>
                <span className="gz-num gz-wb-algo-count-figs">
                  {session.index + 1}
                  <span className="gz-wb-algo-count-of">/</span>
                  {session.steps.length}
                </span>
              </span>
              <span className="gz-wb-algo-desc" title={step?.description}>
                {step?.description}
              </span>
            </div>
          </div>
          <input
            type="range"
            min={0}
            max={last}
            value={session.index}
            onChange={(event) => goToStep(Number(event.target.value))}
            aria-label="Algorithm step"
            className="gz-wb-algo-scrub"
            style={progress}
          />
        </div>

        <div className="gz-wb-algo-tail">
          <label className="gz-wb-algo-speed">
            <span className="sr-only">Playback speed</span>
            <select
              value={speed}
              onChange={(event) => setSpeed(Number(event.target.value))}
              className="gz-input gz-wb-algo-select"
            >
              {SPEEDS.map((value) => (
                <option key={value} value={value}>
                  {value}×
                </option>
              ))}
            </select>
          </label>

          <button
            type="button"
            className="gz-btn gz-btn-ghost gz-wb-algo-close"
            onClick={stop}
            aria-label="Exit visualisation"
            title="Exit visualisation"
          >
            <CloseIcon />
          </button>
        </div>
      </div>

      {step && (
        <div className="gz-wb-algo-body">
          {step?.detail && <p className="gz-wb-algo-detail">{step.detail}</p>}
          <Legend step={step} />
          {shownState.map(([label, value]) => (
            <div key={label} className="gz-wb-algo-field">
              <span className="gz-label gz-wb-algo-field-label">{label}</span>
              <p className="gz-num gz-wb-algo-field-value">{value}</p>
            </div>
          ))}
          {atEnd &&
            session.result?.map((entry) => (
              <div key={entry.label} className="gz-wb-algo-field gz-wb-algo-result">
                <span className="gz-marker gz-wb-algo-field-label">{entry.label}</span>
                <p className="gz-num gz-wb-algo-field-value">{entry.value}</p>
              </div>
            ))}
        </div>
      )}
    </section>
  )
}
