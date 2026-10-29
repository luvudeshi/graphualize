import { useEditor } from '../state/store'
import type { InspectorRow } from '../graph/analysis'
import type { Exactness } from '../graph/model/types'

const EXACTNESS_LABEL: Partial<Record<Exactness, string>> = {
  exact: 'exact',
  heuristic: 'heuristic',
  'upper-bound': 'upper bound',
  'lower-bound': 'lower bound',
  bounded: 'bounded',
  'not-computed': 'not computed',
  'not-applicable': 'n/a',
}

/** Only labels that carry a caveat are worth the visual weight. */
const NEEDS_CHIP = new Set<Exactness>([
  'heuristic',
  'upper-bound',
  'lower-bound',
  'bounded',
  'not-computed',
  'not-applicable',
])

/** Sets each arrow of a cycle on its own, so it can be spaced evenly. */
const withArrows = (text: string) =>
  text.split('→').flatMap((part, i) =>
    i === 0
      ? [part]
      : [
          <span key={i} className="gz-wb-why-arrow">
            →
          </span>,
          part,
        ],
  )

export const PropertyRow = ({ row }: { row: InspectorRow }) => {
  const activeWitness = useEditor((s) => s.activeWitness)
  const setWitness = useEditor((s) => s.setWitness)
  const active = activeWitness?.rowId === row.id
  const clickable = Boolean(row.witness)
  const hasDetail = Boolean(row.explanation || row.detail)
  const chip = row.exactness && NEEDS_CHIP.has(row.exactness) ? EXACTNESS_LABEL[row.exactness] : null

  // A long value (a chromatic polynomial, a list of labels) reads far better on
  // its own line than squeezed into the right-hand column.
  const stacked = row.value.length > 22

  const content = (
    <>
      <div className="gz-wb-line" data-stacked={stacked || undefined}>
        <span className="gz-wb-mark" data-witness={clickable || undefined} aria-hidden="true" />
        <span className="gz-wb-row-name">{row.label}</span>
        {!stacked && <span className="gz-wb-leader" aria-hidden="true" />}
        <span className="gz-wb-value-wrap">
          {chip && <span className="gz-wb-caveat">{chip}</span>}
          <span className="gz-wb-value gz-wb-num" data-status={row.status || undefined}>
            {row.value}
          </span>
        </span>
      </div>
      {active && hasDetail && (
        <div className="gz-anim-in gz-wb-why">
          {row.explanation && <p className="gz-wb-why-text">{withArrows(row.explanation)}</p>}
          {row.detail && <p className="gz-wb-why-detail">{row.detail}</p>}
        </div>
      )}
    </>
  )

  if (!clickable) {
    return (
      <div className="gz-wb-row" title={row.explanation}>
        {content}
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={() => setWitness(row.id, row.witness)}
      aria-pressed={active}
      title="Click to highlight this on the graph"
      className="gz-wb-row"
    >
      <span className="sr-only">
        {active ? 'Hide the visual explanation' : 'Show the visual explanation'}
      </span>
      {content}
    </button>
  )
}
