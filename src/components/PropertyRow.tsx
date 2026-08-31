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

const statusClass = (status: InspectorRow['status']) => {
  switch (status) {
    case 'success':
      return 'text-[var(--gz-success)]'
    case 'warning':
      return 'text-[var(--gz-warning)]'
    case 'danger':
      return 'text-[var(--gz-danger)]'
    default:
      return 'text-[var(--gz-text)]'
  }
}

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
      <div
        className={
          stacked ? 'flex flex-col gap-0.5' : 'flex items-baseline justify-between gap-3'
        }
      >
        <span className="text-[0.8125rem] text-[var(--gz-muted)] group-hover:text-[var(--gz-text)]">
          {row.label}
        </span>
        <span className={`flex items-baseline gap-1.5 ${stacked ? '' : 'shrink-0'}`}>
          {chip && <span className="gz-chip">{chip}</span>}
          <span className={`gz-num font-medium break-words ${statusClass(row.status)}`}>
            {row.value}
          </span>
        </span>
      </div>
      {active && hasDetail && (
        <div className="gz-anim-in mt-1.5 rounded-md border-l-2 border-[var(--gz-accent)] bg-[color-mix(in_oklab,var(--gz-accent-soft)_70%,transparent)] px-2.5 py-1.5">
          {row.explanation && (
            <p className="text-[0.75rem] leading-relaxed text-[var(--gz-text)]">
              {row.explanation}
            </p>
          )}
          {row.detail && (
            <p className="mt-1 text-[0.7188rem] leading-relaxed text-[var(--gz-muted)]">
              {row.detail}
            </p>
          )}
        </div>
      )}
    </>
  )

  if (!clickable) {
    return (
      <div className="group relative rounded-md px-2.5 py-[5px]" title={row.explanation}>
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
      className={`group relative w-full rounded-md border-l-2 px-2.5 py-[5px] text-left transition-colors ${
        active
          ? 'border-[var(--gz-accent)] bg-[var(--gz-accent-soft)]'
          : 'border-transparent hover:border-[color-mix(in_oklab,var(--gz-accent)_45%,transparent)] hover:bg-[color-mix(in_oklab,var(--gz-border)_45%,transparent)]'
      }`}
    >
      <span className="sr-only">
        {active ? 'Hide the visual explanation' : 'Show the visual explanation'}
      </span>
      {content}
    </button>
  )
}
