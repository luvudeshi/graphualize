import { useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { openEditor } from '../app/router'
import { generate, generatorById } from '../graph/generators'
import { parseGraphCommand } from '../graph/generators/commands'
import type { GraphDocument } from '../graph/model/types'
import { Frontispiece } from './Frontispiece'
import { FRONTISPIECE_EULER } from './euclid47'
import { GraphThumbnail } from './GraphThumbnail'

/**
 * The commands the quick-start opens, each lettered the way a mathematician
 * would write it. The key is named by the command itself, so what is read out
 * is what the workbench receives.
 */
const QUICK_START: { command: string; label: ReactNode; name: string }[] = [
  { command: 'K5', label: <>K<sub>5</sub></>, name: 'complete graph' },
  { command: 'C8', label: <>C<sub>8</sub></>, name: 'cycle' },
  { command: 'Petersen', label: 'Petersen', name: 'petersen graph' },
  { command: 'K3,3', label: <>K<sub>3,3</sub></>, name: 'complete bipartite' },
  { command: 'Q4', label: <>Q<sub>4</sub></>, name: 'hypercube' },
  { command: 'G(20,0.2)', label: 'G(20, 0.2)', name: 'random graph' },
]

/** One seed, so the random graph on the display is the same on every visit. */
const DISPLAY_SEED = 20

/** The dial has a detent for the idle figure and one for each key. */
const DETENT_START = -150
const DETENT_STEP = 50
const detent = (position: number) => DETENT_START + position * DETENT_STEP

/**
 * A random graph has no drawing of its own, and a force layout of one is a
 * tangle at this size, so the display sets its vertices round a circle, the
 * way G(n, p) is usually drawn.
 */
const onCircle = (doc: GraphDocument): GraphDocument => ({
  ...doc,
  vertices: doc.vertices.map((vertex, i) => {
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / doc.vertices.length
    return { ...vertex, x: 100 * Math.cos(angle), y: 100 * Math.sin(angle) }
  }),
})

/** What each key would open, drawn for the display. A command that fails to build shows nothing. */
const buildPreviews = (): (GraphDocument | null)[] =>
  QUICK_START.map(({ command }) => {
    const parsed = parseGraphCommand(command)
    if (!parsed) return null
    try {
      const doc = generate(parsed.generatorId, parsed.params, { seed: DISPLAY_SEED })
      return generatorById(parsed.generatorId)?.category === 'random' ? onCircle(doc) : doc
    } catch {
      return null
    }
  })

const { vertices, edges, faces } = FRONTISPIECE_EULER

/**
 * The quick start, built as a small unit of the instrument: a display, a
 * dial and a row of keys. Each key opens its graph in the workbench; resting
 * on one (or turning the dial, which is how a touch screen previews) draws
 * that graph on the display first. Left alone, the display shows Euclid I.47
 * as a plane graph, with Euler's formula for it as the reading.
 *
 * The display is decoration and hidden from assistive technology: the keys
 * carry their own names, and nothing is shown there that is not said by them.
 */
export const QuickUnit = () => {
  const previews = useMemo(() => buildPreviews(), [])
  /** The key under the pointer or holding focus. */
  const [resting, setResting] = useState<number | null>(null)
  /** Where the dial was last turned to; null is the idle figure. */
  const [dialled, setDialled] = useState<number | null>(null)

  const shown = resting ?? dialled
  const doc = shown === null ? null : previews[shown]
  const position = shown === null ? 0 : shown + 1

  const turn = () => {
    setResting(null)
    setDialled((at) => (at === null ? 0 : at === QUICK_START.length - 1 ? null : at + 1))
  }

  return (
    <div className="gz-unit" onPointerLeave={() => setResting(null)}>
      <div className="gz-unit-lcd" aria-hidden="true">
        {/* Keyed by what is shown, so each figure is drawn in afresh. */}
        <div key={shown ?? 'idle'} className="gz-unit-lcd-stage">
          {doc ? (
            <GraphThumbnail doc={doc} width={320} height={190} padding={22} radius={5} />
          ) : (
            <Frontispiece />
          )}
        </div>
        <div className="gz-unit-lcd-read">
          <span>{shown === null ? 'euclid I.47, as a plane graph' : QUICK_START[shown]!.name}</span>
          <span>
            {doc
              ? `${doc.vertices.length} v  ${doc.edges.length} e`
              : `${vertices} − ${edges} + ${faces} = ${vertices - edges + faces}`}
          </span>
        </div>
      </div>

      <div className="gz-unit-deck">
        <button
          type="button"
          className="gz-unit-dial"
          onClick={turn}
          aria-label="Preview the next graph"
        >
          <svg viewBox="0 0 72 72" className="gz-unit-dial-ticks" aria-hidden="true">
            {Array.from({ length: QUICK_START.length + 1 }, (_, i) => (
              <line
                key={i}
                x1="36"
                y1="3"
                x2="36"
                y2="7.5"
                transform={`rotate(${detent(i)} 36 36)`}
                data-on={i === position || undefined}
              />
            ))}
          </svg>
          <span className="gz-unit-dial-cap">
            <span
              className="gz-unit-dial-mark"
              style={{ '--gz-turn': `${detent(position)}deg` } as CSSProperties}
            />
          </span>
        </button>

        <div className="gz-unit-keys">
          <span className="gz-unit-legend text-[var(--gz-muted)]">or open</span>
          {QUICK_START.map(({ command, label }, index) => (
            <button
              key={command}
              type="button"
              aria-label={command}
              onClick={() => openEditor(command)}
              onPointerEnter={(event) => {
                // A touch has no resting state: it would stick after the tap.
                if (event.pointerType === 'mouse') setResting(index)
              }}
              onFocus={() => setResting(index)}
              onBlur={() => setResting(null)}
              className="gz-unit-key"
            >
              <span className="gz-led" data-on={shown === index} aria-hidden="true" />
              <span>{label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
