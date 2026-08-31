import { useState } from 'react'
import { useEditor } from '../state/store'
import {
  allMatrices,
  matrixToCsv,
  matrixToLatex,
  matrixToText,
  type LabeledMatrix,
} from '../graph/properties/matrices'
import { copyToClipboard } from '../state/actions'
import { memoByStructure } from '../graph/cache'
import { CopyIcon } from './Icons'

const MATRIX_LIMIT = 40

/** Short tab labels; the full title and its convention sit below the tabs. */
const TAB_LABELS: Record<LabeledMatrix['kind'], string> = {
  adjacency: 'Adjacency',
  degree: 'Degree',
  laplacian: 'Laplacian',
  'signless-laplacian': 'Signless',
  incidence: 'Incidence',
  distance: 'Distance',
}

const formatCell = (value: number): string => {
  if (!Number.isFinite(value)) return value > 0 ? '∞' : '-∞'
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 1000) / 1000)
}

export const MatrixSection = () => {
  const graph = useEditor((s) => s.graph)
  const notify = useEditor((s) => s.notify)
  const select = useEditor((s) => s.select)
  // Labels appear in the row and column headers, so they belong in the key.
  const matrices = memoByStructure('matrices', graph.displayKey(), () =>
    graph.order <= 400 ? allMatrices(graph) : [],
  )
  const [activeKind, setActiveKind] = useState<LabeledMatrix['kind']>('adjacency')
  const active = matrices.find((m) => m.kind === activeKind) ?? matrices[0]

  if (!graph.order) {
    return <p className="px-2.5 py-2 text-[0.8125rem] text-[var(--gz-muted)]">No vertices yet.</p>
  }
  if (!active) {
    return (
      <p className="px-2.5 py-2 text-[0.8125rem] text-[var(--gz-muted)]">
        Matrices are not built above 400 vertices.
      </p>
    )
  }

  const tooBig = active.values.length > MATRIX_LIMIT

  const copy = async (kind: 'text' | 'csv' | 'latex') => {
    const payload =
      kind === 'text'
        ? matrixToText(active)
        : kind === 'csv'
          ? matrixToCsv(active)
          : matrixToLatex(active)
    const ok = await copyToClipboard(payload)
    notify(ok ? `Copied ${active.title} as ${kind}.` : 'Clipboard is not available.', ok ? 'success' : 'error')
  }

  return (
    <div className="px-2 pb-2">
      <div className="mb-2 flex flex-wrap gap-1">
        {matrices.map((m) => (
          <button
            key={m.kind}
            type="button"
            onClick={() => setActiveKind(m.kind)}
            className={`rounded-md px-2 py-[3px] text-[0.75rem] transition-colors ${
              m.kind === active.kind
                ? 'bg-[var(--gz-accent-soft)] text-[var(--gz-accent)]'
                : 'text-[var(--gz-muted)] hover:bg-[color-mix(in_oklab,var(--gz-border)_50%,transparent)]'
            }`}
          >
            {TAB_LABELS[m.kind]}
          </button>
        ))}
      </div>

      <p className="mb-1 px-0.5 text-[0.8125rem] font-medium">{active.title}</p>
      <p className="mb-2 px-0.5 text-[0.7188rem] leading-relaxed text-[var(--gz-muted)]">
        {active.convention}
      </p>

      {tooBig ? (
        <p className="px-0.5 text-[0.8125rem] text-[var(--gz-muted)]">
          {active.values.length} x {active.values.length} is too large to display here. Copy it
          instead.
        </p>
      ) : (
        <div className="gz-scroll max-h-72 overflow-x-auto rounded-md border">
          <table className="gz-num border-collapse">
            <thead>
              <tr>
                <th className="sticky left-0 top-0 z-20 bg-[var(--gz-panel)] px-1.5 py-1" />
                {active.colLabels.map((label, i) => (
                  <th
                    key={`${label}-${i}`}
                    scope="col"
                    className="sticky top-0 z-10 bg-[var(--gz-panel)] px-1.5 py-1 text-[0.6875rem] font-semibold text-[var(--gz-muted)]"
                  >
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {active.values.map((rowValues, r) => (
                <tr key={active.rowLabels[r] ?? r} className="hover:bg-[var(--gz-accent-soft)]">
                  <th
                    scope="row"
                    className="sticky left-0 z-10 cursor-pointer bg-[var(--gz-panel)] px-1.5 py-0.5 text-[0.6875rem] font-semibold text-[var(--gz-muted)]"
                    onClick={() => {
                      const id = graph.vertexIds[r]
                      if (id) select([id], [])
                    }}
                    title="Select this vertex"
                  >
                    {active.rowLabels[r]}
                  </th>
                  {rowValues.map((value, c) => (
                    <td
                      key={c}
                      className={`px-1.5 py-0.5 text-center text-[0.75rem] ${
                        value === 0 ? 'text-[var(--gz-faint)]' : 'text-[var(--gz-text)]'
                      }`}
                    >
                      {formatCell(value)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-2 flex gap-1">
        {(['text', 'csv', 'latex'] as const).map((kind) => (
          <button
            key={kind}
            type="button"
            onClick={() => void copy(kind)}
            className="gz-btn border px-2 py-1 text-[0.75rem]"
          >
            <CopyIcon width={13} height={13} />
            {kind === 'latex' ? 'LaTeX' : kind.toUpperCase()}
          </button>
        ))}
      </div>
    </div>
  )
}
