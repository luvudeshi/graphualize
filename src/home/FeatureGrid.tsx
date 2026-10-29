import type { ReactNode } from 'react'
import { EDGE_INKS, edgeInks } from './byrne'

/**
 * What the workbench does beyond the demo above it, set as a short list of
 * numbered definitions, each with a small figure in the page's four inks.
 * The figures are inline SVG coloured from the --gz-home-* properties, so they
 * follow the theme and cost no request, and they are hidden from assistive
 * technology: the heading and line beside each carry the meaning.
 */

/* A word joiner after the en dash keeps 'Bellman–Ford' from breaking at it. */
const ALGORITHMS = 'BFS, DFS, Dijkstra, Bellman–⁠Ford, Prim, Kruskal, topological sort, colouring.'

const Figure = ({ children, name }: { children: ReactNode; name?: string }) => (
  <svg viewBox="0 0 120 80" className="gz-home-def-svg" data-fig={name} aria-hidden="true" focusable="false">
    {children}
  </svg>
)

/* Breadth-first search, frozen part-way: the tree found so far in blue, the
   edge being followed in red, the queue in yellow. */
const BFS_AT: Record<string, [number, number]> = {
  a: [12, 40],
  b: [44, 16],
  c: [44, 64],
  d: [80, 8],
  e: [80, 40],
  f: [80, 72],
  g: [110, 24],
}

const BFS_EDGES: [string, string, 'tree' | 'active' | 'idle'][] = [
  ['b', 'c', 'idle'],
  ['c', 'e', 'idle'],
  ['d', 'g', 'idle'],
  ['e', 'g', 'idle'],
  ['a', 'b', 'tree'],
  ['a', 'c', 'tree'],
  ['b', 'd', 'tree'],
  ['b', 'e', 'tree'],
  ['c', 'f', 'active'],
]

const BfsFigure = () => (
  <Figure>
    {BFS_EDGES.map(([p, q, state]) => {
      const [x1, y1] = BFS_AT[p]!
      const [x2, y2] = BFS_AT[q]!
      return (
        <line key={p + q} x1={x1} y1={y1} x2={x2} y2={y2} className="gz-algo-edge" data-state={state} />
      )
    })}
    {Object.entries(BFS_AT).map(([id, [x, y]]) => {
      const state = id === 'c' ? 'current' : 'def'.includes(id) ? 'frontier' : id === 'g' ? 'idle' : 'visited'
      const r = state === 'current' ? 6.5 : state === 'frontier' ? 5.5 : 4
      return <circle key={id} cx={x} cy={y} r={r} className="gz-algo-node" data-state={state} />
    })}
  </Figure>
)

/* A chromatic number pinned between bounds rather than guessed. */
const BoundsFigure = () => (
  <Figure>
    <line x1="4" y1="44" x2="116" y2="44" className="gz-home-ink-line" />
    {[1, 2, 3, 4, 5, 6, 7].map((n) => {
      const x = 10 + (n - 1) * 16.6
      return (
        <g key={n}>
          <line x1={x} y1="39" x2={x} y2="49" className="gz-home-ink-line" />
          <text x={x} y="66" textAnchor="middle" className="gz-home-def-text">
            {n}
          </text>
        </g>
      )
    })}
    <rect x={10 + 2 * 16.6} y="39.5" width={2 * 16.6} height="9" className="gz-home-fill" data-ink="red" />
    <text x={10 + 3 * 16.6} y="28" textAnchor="middle" className="gz-home-def-text" data-italic>
      χ
    </text>
  </Figure>
)

/* The 5-cycle and its adjacency matrix, each entry in the colour of its edge.
   The edges are coloured by the same proper edge colouring as the plate of
   figures, so an odd cycle takes three inks, as it must. */
const C5 = Array.from({ length: 5 }, (_, i) => {
  const angle = -Math.PI / 2 + (i * 2 * Math.PI) / 5
  return { x: 24 + 19 * Math.cos(angle), y: 41 + 19 * Math.sin(angle) }
})
const C5_EDGES = C5.map((_, i) => ({ id: String(i), source: String(i), target: String((i + 1) % 5) }))
const C5_INKS = edgeInks({ edges: C5_EDGES })
const C5_INK = C5_EDGES.map((edge) => EDGE_INKS[C5_INKS.get(edge.id) ?? 0])
const c5Ink = (i: number, j: number): string | null => {
  if ((i + 1) % 5 === j) return C5_INK[i]!
  if ((j + 1) % 5 === i) return C5_INK[j]!
  return null
}

const MatrixFigure = () => (
  <Figure name="matrix">
    {C5.map((p, i) => {
      const q = C5[(i + 1) % 5]!
      return (
        <line key={i} x1={p.x} y1={p.y} x2={q.x} y2={q.y} className="gz-home-stroke" data-ink={C5_INK[i]} />
      )
    })}
    {C5.map((p, i) => (
      <circle key={i} cx={p.x} cy={p.y} r="2.6" className="gz-home-fill" data-ink="ink" />
    ))}
    <path d="M58 13h-3v56h3M114 13h3v56h-3" className="gz-home-ink-line" fill="none" />
    {C5.map((_, i) =>
      C5.map((__, j) => {
        const ink = c5Ink(i, j)
        return ink ? (
          <rect key={`${i}${j}`} x={59 + j * 11} y={15 + i * 11} width="9" height="9" className="gz-home-fill" data-ink={ink} />
        ) : (
          <rect key={`${i}${j}`} x={61.5 + j * 11} y={17.5 + i * 11} width="4" height="4" className="gz-home-fill" data-ink="faint" />
        )
      }),
    )}
  </Figure>
)

/* K5 with crop marks round it: ready to print, at any size. */
const K5 = Array.from({ length: 5 }, (_, i) => {
  const angle = -Math.PI / 2 + (i * 2 * Math.PI) / 5
  return { x: 60 + 27 * Math.cos(angle), y: 43 + 27 * Math.sin(angle) }
})

const ExportFigure = () => (
  <Figure>
    <polygon points={K5.map((p) => `${p.x},${p.y}`).join(' ')} className="gz-home-fill" data-ink="yellow" />
    {K5.flatMap((p, i) =>
      K5.slice(i + 1).map((q, j) => (
        <line key={`${i}-${j}`} x1={p.x} y1={p.y} x2={q.x} y2={q.y} className="gz-home-ink-line" />
      )),
    )}
    {K5.map((p, i) => (
      <circle key={i} cx={p.x} cy={p.y} r="3" className="gz-home-fill" data-ink="ink" />
    ))}
    <path
      d="M22 4v10M12 14h10M98 4v10M98 14h10M22 76v-10M12 66h10M98 76v-10M98 66h10"
      className="gz-home-ink-line"
      data-thin
    />
  </Figure>
)

/* A page in a browser window, with a figure drawn inside it. */
const LocalFigure = () => (
  <Figure>
    <rect x="20" y="6" width="80" height="68" className="gz-home-ink-line" fill="none" />
    <line x1="20" y1="18" x2="100" y2="18" className="gz-home-ink-line" />
    <circle cx="27" cy="12" r="2" className="gz-home-fill" data-ink="red" />
    <circle cx="34" cy="12" r="2" className="gz-home-fill" data-ink="yellow" />
    <circle cx="41" cy="12" r="2" className="gz-home-fill" data-ink="blue" />
    <polygon points="60,28 80,62 40,62" className="gz-home-fill" data-ink="red" />
    <line x1="40" y1="62" x2="80" y2="62" className="gz-home-stroke" data-ink="blue" />
    <circle cx="60" cy="28" r="3" className="gz-home-fill" data-ink="ink" />
    <circle cx="80" cy="62" r="3" className="gz-home-fill" data-ink="ink" />
    <circle cx="40" cy="62" r="3" className="gz-home-fill" data-ink="ink" />
  </Figure>
)

/* EB Garamond italic has no a–T kerning pair, so the word reads 'La TeX'
   unless the T is pulled in by hand. */
const LATEX = (
  <span className="gz-latex">
    La<span className="gz-latex-t">T</span>eX
  </span>
)

const DEFINITIONS: { numeral: string; title: string; line: ReactNode; figure: ReactNode }[] = [
  { numeral: 'I', title: 'Step through algorithms', line: ALGORITHMS, figure: <BfsFigure /> },
  {
    numeral: 'II',
    title: 'Honest about hard problems',
    line: 'Exact within stated limits. Bounds, never guesses.',
    figure: <BoundsFigure />,
  },
  {
    numeral: 'III',
    title: 'Matrices and spectra',
    line: <>Adjacency to Laplacian, copied as {LATEX}.</>,
    figure: <MatrixFigure />,
  },
  {
    numeral: 'IV',
    title: 'Export that stays sharp',
    line: 'SVG, PNG, DOT, GraphML, CSV and JSON.',
    figure: <ExportFigure />,
  },
  {
    numeral: 'V',
    title: 'Runs in your browser',
    line: 'Nothing to install. No account needed.',
    figure: <LocalFigure />,
  },
]

export const FeatureGrid = () => (
  <ol className="gz-home-defs">
    {DEFINITIONS.map(({ numeral, title, line, figure }) => (
      <li key={numeral} className="gz-home-def">
        <span className="gz-home-def-fig">{figure}</span>
        <div className="gz-home-def-body">
          <h3 className="gz-home-def-title">
            <span className="gz-home-def-no" aria-hidden="true">
              {numeral}.
            </span>
            {title}
          </h3>
          <p className="gz-home-def-line">{line}</p>
        </div>
      </li>
    ))}
  </ol>
)
