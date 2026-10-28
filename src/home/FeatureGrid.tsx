import type { ReactNode } from 'react'
import { GraphMarkIcon, PlayIcon, StepBackIcon, StepForwardIcon } from '../components/Icons'

/**
 * What the workbench does beyond the demo above it, as a grid of tiles: a
 * small picture each and a line of text at most. The pictures are inline SVG
 * and HTML coloured from the --gz-* tokens, so they follow the theme and cost
 * no request. They are illustrations in the product's own visual language,
 * not screenshots, and they are hidden from assistive technology — the tile's
 * heading and line carry the meaning.
 */

const ALGORITHMS = [
  'BFS',
  'DFS',
  'Dijkstra',
  'Bellman–Ford',
  'Prim',
  'Kruskal',
  'Topological sort',
  'Colouring',
]

const Tile = ({
  title,
  line,
  visual,
  className = '',
  children,
}: {
  title: string
  line?: string
  visual: ReactNode
  className?: string
  children?: ReactNode
}) => (
  <article className={`gz-home-tile ${className}`}>
    <div className="gz-home-tile-visual" aria-hidden="true">
      {visual}
    </div>
    <div className="px-5 pb-5 pt-1">
      <h3 className="text-[0.9375rem] font-semibold tracking-[-0.015em]">{title}</h3>
      {line && <p className="mt-1 text-[0.8125rem] leading-relaxed text-[var(--gz-muted)]">{line}</p>}
      {children}
    </div>
  </article>
)

/* Breadth-first search, frozen part-way: `c` is being expanded, `d`, `e` and
   `f` wait in the queue, and the tree edges found so far are drawn solid. */
const BFS_NODES = [
  { id: 'a', x: 26, y: 80, state: 'visited' },
  { id: 'b', x: 92, y: 40, state: 'visited' },
  { id: 'c', x: 92, y: 120, state: 'current' },
  { id: 'd', x: 160, y: 22, state: 'frontier' },
  { id: 'e', x: 160, y: 80, state: 'frontier' },
  { id: 'f', x: 160, y: 138, state: 'frontier' },
  { id: 'g', x: 226, y: 52, state: 'idle' },
] as const

const BFS_EDGES = [
  ['a', 'b', 'tree'],
  ['a', 'c', 'tree'],
  ['b', 'c', 'idle'],
  ['b', 'd', 'tree'],
  ['b', 'e', 'tree'],
  ['c', 'e', 'idle'],
  ['c', 'f', 'active'],
  ['d', 'g', 'idle'],
  ['e', 'g', 'idle'],
] as const

const BfsPicture = () => {
  const at = new Map(BFS_NODES.map((node) => [node.id, node]))
  return (
    <svg viewBox="0 0 252 160" className="h-full max-h-[9.5rem] w-auto shrink-0">
      {BFS_EDGES.map(([a, b, state]) => {
        const p = at.get(a)!
        const q = at.get(b)!
        return (
          <line
            key={`${a}${b}`}
            x1={p.x}
            y1={p.y}
            x2={q.x}
            y2={q.y}
            className="gz-algo-edge"
            data-state={state}
          />
        )
      })}
      {BFS_NODES.map((node) => (
        <g key={node.id} className="gz-algo-node" data-state={node.state}>
          <circle cx={node.x} cy={node.y} r={11} />
          <text x={node.x} y={node.y} dy="0.35em" textAnchor="middle">
            {node.id}
          </text>
        </g>
      ))}
    </svg>
  )
}

const Player = () => (
  <div className="gz-home-mini hidden w-[13.5rem] shrink-0 p-3 sm:block">
    <div className="flex items-center justify-between gap-2">
      <span className="text-[0.75rem] font-medium">Breadth-first search</span>
      <span className="gz-num text-[0.6875rem] text-[var(--gz-faint)]">6/14</span>
    </div>
    <div className="mt-2.5 flex items-center gap-1.5">
      <span className="mr-0.5 text-[0.6875rem] text-[var(--gz-faint)]">Queue</span>
      {['d', 'e', 'f'].map((id) => (
        <span key={id} className="gz-algo-queued">
          {id}
        </span>
      ))}
    </div>
    <div className="gz-algo-track mt-3">
      <span style={{ width: '43%' }} />
    </div>
    <div className="mt-2.5 flex items-center justify-center gap-3 text-[var(--gz-muted)]">
      <StepBackIcon width={13} height={13} />
      <span className="gz-algo-play">
        <PlayIcon width={12} height={12} />
      </span>
      <StepForwardIcon width={13} height={13} />
    </div>
  </div>
)

const BoundsPicture = () => (
  <div className="gz-home-mini w-[15.5rem] px-3.5 py-3">
    <div className="flex items-center gap-2">
      <span className="flex-1 text-[0.75rem] text-[var(--gz-muted)]">Chromatic number</span>
      <span className="gz-chip">bounded</span>
      <span className="gz-num font-medium">3–5</span>
    </div>
    <div className="gz-range mt-3.5">
      <span className="gz-range-band" />
      {[1, 2, 3, 4, 5, 6, 7].map((n) => (
        <span key={n} className="gz-num" data-in={n >= 3 && n <= 5}>
          {n}
        </span>
      ))}
    </div>
  </div>
)

/* The 5-cycle and its adjacency matrix, side by side. */
const C5_MATRIX = [
  [0, 1, 0, 0, 1],
  [1, 0, 1, 0, 0],
  [0, 1, 0, 1, 0],
  [0, 0, 1, 0, 1],
  [1, 0, 0, 1, 0],
]

const C5_POINTS = Array.from({ length: 5 }, (_, i) => {
  const angle = -Math.PI / 2 + (i * 2 * Math.PI) / 5
  return { x: 40 + 30 * Math.cos(angle), y: 40 + 30 * Math.sin(angle) }
})

const MatrixPicture = () => (
  <div className="flex items-center gap-4">
    <svg viewBox="0 0 80 80" className="h-[4.5rem] w-[4.5rem] shrink-0">
      {C5_POINTS.map((p, i) => {
        const q = C5_POINTS[(i + 1) % 5]!
        return <line key={i} x1={p.x} y1={p.y} x2={q.x} y2={q.y} className="gz-thumb-edge" />
      })}
      {C5_POINTS.map((p, i) => (
        <g key={i} className="gz-algo-node" data-state="plain">
          <circle cx={p.x} cy={p.y} r={8} />
          <text x={p.x} y={p.y} dy="0.35em" textAnchor="middle">
            {i + 1}
          </text>
        </g>
      ))}
    </svg>
    <div className="gz-matrix">
      {C5_MATRIX.flat().map((value, i) => (
        <span key={i} className="gz-num" data-on={value === 1}>
          {value}
        </span>
      ))}
    </div>
  </div>
)

/* A drawing selected as an object, the way a vector editor shows it. */
const STAR = Array.from({ length: 5 }, (_, i) => {
  const angle = -Math.PI / 2 + (i * 2 * Math.PI) / 5
  return { x: 60 + 34 * Math.cos(angle), y: 52 + 34 * Math.sin(angle) }
})

const ExportPicture = () => (
  <div className="flex items-center gap-4">
    <svg viewBox="0 0 120 104" className="h-[6.5rem] w-auto shrink-0">
      {STAR.flatMap((p, i) =>
        STAR.slice(i + 1).map((q, j) => (
          <line key={`${i}-${j}`} x1={p.x} y1={p.y} x2={q.x} y2={q.y} className="gz-thumb-edge" />
        )),
      )}
      {STAR.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={5.5} className="gz-thumb-vertex" />
      ))}
      <rect x="18" y="10" width="84" height="80" className="gz-select-box" />
      {[
        [18, 10],
        [102, 10],
        [18, 90],
        [102, 90],
      ].map(([x, y]) => (
        <rect key={`${x}${y}`} x={x! - 3} y={y! - 3} width="6" height="6" className="gz-select-handle" />
      ))}
    </svg>
    <div className="flex flex-col gap-1.5">
      {['SVG', 'PNG', 'DOT'].map((format, i) => (
        <span key={format} className="gz-file" data-primary={i === 0}>
          {format}
        </span>
      ))}
    </div>
  </div>
)

const LocalPicture = () => (
  <div className="gz-home-mini w-[13rem] overflow-hidden">
    <div className="flex items-center gap-1.5 border-b px-2.5 py-2">
      <span className="gz-window-dot" />
      <span className="gz-window-dot" />
      <span className="gz-window-dot" />
      <span className="ml-1.5 flex h-4 flex-1 items-center gap-1 rounded-full bg-[color-mix(in_oklab,var(--gz-border)_50%,transparent)] px-2">
        <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="text-[var(--gz-faint)]">
          <rect x="5" y="11" width="14" height="10" rx="2" />
          <path d="M8 11V8a4 4 0 0 1 8 0v3" />
        </svg>
      </span>
    </div>
    <div className="flex items-center justify-center gap-2.5 py-5">
      <span className="gz-local-badge">
        <GraphMarkIcon width={18} height={18} />
      </span>
      <span className="text-left">
        <span className="block text-[0.75rem] font-medium">Computed locally</span>
        <span className="block text-[0.6875rem] text-[var(--gz-faint)]">in this tab</span>
      </span>
    </div>
  </div>
)

export const FeatureGrid = () => (
  <div className="mt-10 grid gap-4 sm:mt-12 sm:grid-cols-2 lg:grid-cols-3">
    <Tile
      className="sm:col-span-2"
      title="Step through algorithms"
      visual={
        <>
          <BfsPicture />
          <Player />
        </>
      }
    >
      <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Algorithms">
        {ALGORITHMS.map((name) => (
          <li key={name} className="gz-home-tag">
            {name}
          </li>
        ))}
      </ul>
    </Tile>
    <Tile
      title="Honest about hard problems"
      line="Exact within stated limits. Bounds, never guesses."
      visual={<BoundsPicture />}
    />
    <Tile
      title="Matrices and spectra"
      line="Adjacency to Laplacian, copied as LaTeX."
      visual={<MatrixPicture />}
    />
    <Tile
      title="Export that stays sharp"
      line="SVG, PNG, DOT, GraphML, CSV and JSON."
      visual={<ExportPicture />}
    />
    <Tile
      title="Runs in your browser"
      line="Nothing to install. No account needed."
      visual={<LocalPicture />}
    />
  </div>
)
