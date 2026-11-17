import type { CSSProperties } from 'react'
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

/**
 * `seat` is the row's place in its section (0, 1, 2 …): given one, the row
 * seats into the list that many beats after the first when it first mounts.
 */
export const PropertyRow = ({ row, seat }: { row: InspectorRow; seat?: number }) => {
  const activeWitness = useEditor((s) => s.activeWitness)
  const setWitness = useEditor((s) => s.setWitness)
  const active = activeWitness?.rowId === row.id
  const clickable = Boolean(row.witness)
  const hasDetail = Boolean(row.explanation || row.detail)
  const chip = row.exactness && NEEDS_CHIP.has(row.exactness) ? EXACTNESS_LABEL[row.exactness] : null

  // A long value (a chromatic polynomial, a list of labels) reads far better on
  // its own line than squeezed into the right-hand column.
  const stacked = row.value.length > 18

  // Yes and No are set apart by weight of ink, whatever the row's status.
  const answer = row.value === 'Yes' ? 'yes' : row.value === 'No' ? 'no' : undefined

  const rowClass = seat === undefined ? 'gz-wb-row' : 'gz-wb-row gz-anim-seat'
  const rowStyle = seat === undefined ? undefined : ({ '--gz-i': seat } as CSSProperties)

  const content = (
    <>
      <div className="gz-wb-line" data-stacked={stacked || undefined}>
        {/* The lamp of a row that can be shown on the screen: lit while it is. */}
        <span
          className={clickable ? 'gz-led gz-wb-mark' : 'gz-wb-mark'}
          data-on={clickable ? active : undefined}
          aria-hidden="true"
        />
        <span className="gz-wb-row-name">{row.label}</span>
        <span className="gz-wb-value-wrap">
          {chip && <span className="gz-wb-caveat">{chip}</span>}
          <span
            className="gz-wb-value gz-wb-num"
            data-status={row.status || undefined}
            data-answer={answer}
          >
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
      <div className={rowClass} style={rowStyle} title={row.explanation}>
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
      className={rowClass}
      style={rowStyle}
    >
      <span className="sr-only">
        {active ? 'Hide the visual explanation' : 'Show the visual explanation'}
      </span>
      {content}
    </button>
  )
}
