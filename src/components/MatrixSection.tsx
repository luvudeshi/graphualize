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
    return <p className="gz-wb-note">No vertices yet.</p>
  }
  if (!active) {
    return (
      <p className="gz-wb-note">
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
    <div className="gz-wb-matrices">
      <div className="gz-wb-tabs">
        {matrices.map((m) => (
          <button
            key={m.kind}
            type="button"
            onClick={() => setActiveKind(m.kind)}
            aria-pressed={m.kind === active.kind}
            className="gz-wb-tab"
          >
            {TAB_LABELS[m.kind]}
          </button>
        ))}
      </div>

      <p className="gz-wb-matrix-title">{active.title}</p>
      <p className="gz-wb-matrix-convention">{active.convention}</p>

      {tooBig ? (
        <p className="gz-wb-note">
          <span className="gz-wb-num">
            {active.values.length} × {active.values.length}
          </span>{' '}
          is too large to display here. Copy it
          instead.
        </p>
      ) : (
        <div className="gz-scroll gz-wb-matrix-scroll">
          <table className="gz-wb-matrix">
            <thead>
              <tr>
                <th />
                {active.colLabels.map((label, i) => (
                  <th key={`${label}-${i}`} scope="col">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {active.values.map((rowValues, r) => (
                <tr key={active.rowLabels[r] ?? r}>
                  <th
                    scope="row"
                    onClick={() => {
                      const id = graph.vertexIds[r]
                      if (id) select([id], [])
                    }}
                    title="Select this vertex"
                  >
                    {active.rowLabels[r]}
                  </th>
                  {rowValues.map((value, c) => (
                    <td key={c} data-zero={value === 0 || undefined}>
                      {formatCell(value)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="gz-wb-copy">
        <span className="gz-wb-copy-label">Copy as</span>
        {(['text', 'csv', 'latex'] as const).map((kind) => (
          <button
            key={kind}
            type="button"
            onClick={() => void copy(kind)}
            className="gz-wb-btn"
          >
            <CopyIcon width={12} height={12} aria-hidden="true" />
            {kind === 'latex' ? 'LaTeX' : kind.toUpperCase()}
          </button>
        ))}
      </div>
    </div>
  )
}
