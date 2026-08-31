import type { Graph } from '../model/graph'
import type { EdgeId, VertexId } from '../model/types'

/**
 * A single frame of an algorithm run.
 *
 * Every step is a *complete snapshot*, not a delta. That makes stepping
 * backwards a pure re-render and keeps the player free of algorithm state.
 * Algorithms never touch the DOM or Cytoscape; they only emit these.
 */
export interface AlgorithmStep {
  /** Machine-readable step kind, e.g. `visit`, `relax`, `reject`. */
  type: string
  /** One short line, present tense: "Visit A", "Relax A to C". */
  description: string
  /** Optional second line with the arithmetic or the reason. */
  detail?: string
  /** The vertex (or vertices) the algorithm is looking at right now. */
  activeVertices?: VertexId[]
  /** Everything finished/settled so far. */
  visitedVertices?: VertexId[]
  /** Discovered but not yet processed (queue, stack, priority queue). */
  frontierVertices?: VertexId[]
  /** The edge currently under consideration. */
  activeEdges?: EdgeId[]
  /** Edges accepted into the tree / shortest path forest. */
  treeEdges?: EdgeId[]
  /** Edges examined and discarded (cycle-forming, non-improving). */
  rejectedEdges?: EdgeId[]
  /** Named state panels rendered beside the canvas, e.g. `{ Queue: '[B, C]' }`. */
  state?: Record<string, string>
  /** Per-vertex badge text such as a tentative distance or indegree. */
  badges?: Record<VertexId, string>
  /** Per-vertex palette index, used by the colouring visualiser. */
  colors?: Record<VertexId, number>
}

export interface AlgorithmOptions {
  source?: VertexId
  target?: VertexId
  /** Greedy colouring vertex order. */
  ordering?: 'document' | 'largest-first' | 'smallest-last' | 'dsatur'
}

export interface AlgorithmRun {
  algorithmId: string
  title: string
  steps: AlgorithmStep[]
  /** Summary rows shown when playback reaches the end. */
  result?: { label: string; value: string }[]
  /** Set when the algorithm refused to run; `steps` is then empty. */
  error?: string
}

export type AlgorithmCategory =
  | 'traversal'
  | 'shortest-path'
  | 'spanning'
  | 'ordering'
  | 'coloring'

export interface AlgorithmDefinition {
  id: string
  name: string
  category: AlgorithmCategory
  /** One sentence, shown in the algorithm list. */
  description: string
  /** True when the user must pick a start vertex first. */
  needsSource: boolean
  needsTarget?: boolean
  /** Requires the document to be in weighted mode to be meaningful. */
  prefersWeighted?: boolean
  /**
   * Returns `null` when the algorithm can run, or a plain-language sentence
   * explaining why it cannot (and what to use instead).
   */
  precondition?: (graph: Graph, options: AlgorithmOptions) => string | null
  run: (graph: Graph, options: AlgorithmOptions) => AlgorithmRun
}

export const emptyRun = (
  algorithmId: string,
  title: string,
  error: string,
): AlgorithmRun => ({ algorithmId, title, steps: [], error })

/** Formats a list of vertex labels the way the state panels expect. */
export const formatList = (graph: Graph, ids: readonly VertexId[]): string =>
  ids.length ? `[${ids.map((id) => graph.label(id)).join(', ')}]` : '[ ]'

export const formatNumber = (value: number): string => {
  if (!Number.isFinite(value)) return '∞'
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 1000) / 1000)
}
