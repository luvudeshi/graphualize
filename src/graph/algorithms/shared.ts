/**
 * Shared plumbing for the step-emitting algorithms.
 *
 * Two rules hold everywhere in this folder:
 *
 * 1. **Every step is a complete snapshot.** {@link StepRecorder} owns the
 *    mutable run state and copies all of it on every `emit`, so no two steps
 *    ever share an array or object. The player can jump to any index.
 * 2. **Determinism.** No `Math.random`, ever. Ties break on `graph.index()`
 *    for vertices and on document position for edges.
 *
 * Convention used by every algorithm here: `activeVertices[0]` is the vertex
 * the step is *about*; anything after it is context (the vertex we are looking
 * from, the other end of the active edge, ...).
 */

import type { Graph } from '../model/graph'
import type { EdgeId, VertexId } from '../model/types'
import type { AlgorithmOptions, AlgorithmStep } from './types'
import { formatNumber } from './types'

/* ------------------------------------------------------------------ */
/* Step recording                                                      */
/* ------------------------------------------------------------------ */

/** The per-step parts an algorithm supplies; everything else is snapshotted. */
export interface StepInput {
  type: string
  description: string
  detail?: string
  activeVertices?: readonly VertexId[]
  activeEdges?: readonly EdgeId[]
  state?: Record<string, string>
}

/**
 * Accumulates run state and turns it into immutable frames.
 *
 * Mutate the public fields freely between emits — `emit` copies every one of
 * them, so a later mutation can never reach back into an earlier step.
 */
export class StepRecorder {
  readonly steps: AlgorithmStep[] = []
  /** Finished / settled vertices. */
  visited: VertexId[] = []
  /** Discovered but still pending: queue, stack, priority queue. */
  frontier: VertexId[] = []
  treeEdges: EdgeId[] = []
  rejectedEdges: EdgeId[] = []
  badges: Record<VertexId, string> = {}
  colors: Record<VertexId, number> = {}

  emit(step: StepInput): void {
    const frame: AlgorithmStep = {
      type: step.type,
      description: step.description,
      activeVertices: [...(step.activeVertices ?? [])],
      visitedVertices: [...this.visited],
      frontierVertices: [...this.frontier],
      activeEdges: [...(step.activeEdges ?? [])],
      treeEdges: [...this.treeEdges],
      rejectedEdges: [...this.rejectedEdges],
      state: { ...(step.state ?? {}) },
      badges: { ...this.badges },
      colors: { ...this.colors },
    }
    if (step.detail !== undefined) frame.detail = step.detail
    this.steps.push(frame)
  }
}

/* ------------------------------------------------------------------ */
/* Source resolution                                                   */
/* ------------------------------------------------------------------ */

export type SourceResult =
  | { ok: true; source: VertexId }
  | { ok: false; error: string }

/**
 * Resolves the start vertex.
 *
 * An empty graph and a source that is not in the graph both produce a
 * plain-language error instead of a throw. A *missing* source falls back to
 * the first vertex in document order, so a run is always possible.
 */
export const resolveSource = (
  graph: Graph,
  options: AlgorithmOptions,
  name: string,
): SourceResult => {
  if (graph.order === 0) {
    return { ok: false, error: `${name} needs at least one vertex, and this graph is empty.` }
  }
  const requested = options.source
  if (requested === undefined) return { ok: true, source: graph.vertices[0].id }
  if (!graph.hasVertex(requested)) {
    return {
      ok: false,
      error: `${name} can't start there: that vertex is no longer in the graph. Pick a start vertex on the canvas.`,
    }
  }
  return { ok: true, source: requested }
}

/* ------------------------------------------------------------------ */
/* Formatting                                                          */
/* ------------------------------------------------------------------ */

/** `A-B` on an undirected document, `A→B` on a directed one. */
export const edgeLabel = (graph: Graph, edgeId: EdgeId): string => {
  const e = graph.edge(edgeId)
  if (!e) return '?'
  const sep = graph.directed ? '→' : '-'
  return `${graph.label(e.source)}${sep}${graph.label(e.target)}`
}

/** The same, but oriented away from `from` (used while traversing). */
export const edgeLabelFrom = (graph: Graph, edgeId: EdgeId, from: VertexId): string => {
  const e = graph.edge(edgeId)
  if (!e) return '?'
  const other = e.source === from ? e.target : e.source
  const sep = graph.directed ? '→' : '-'
  return `${graph.label(from)}${sep}${graph.label(other)}`
}

/** Always `A-B`: for Prim and Kruskal, which read the graph as undirected. */
export const undirectedEdgeLabel = (graph: Graph, edgeId: EdgeId): string => {
  const e = graph.edge(edgeId)
  if (!e) return '?'
  return `${graph.label(e.source)}-${graph.label(e.target)}`
}

/** `A-B (3)` — an edge with its weight, for candidate and sorted lists. */
export const weightedEdgeLabel = (graph: Graph, edgeId: EdgeId): string =>
  `${undirectedEdgeLabel(graph, edgeId)} (${formatNumber(graph.weight(edgeId))})`

export const formatPath = (graph: Graph, ids: readonly VertexId[]): string =>
  ids.map((id) => graph.label(id)).join(' → ')

/** `3` stays `3`, but `-1` becomes `(-1)`, so `0 + (-1)` reads like arithmetic. */
export const formatAddend = (value: number): string =>
  value < 0 ? `(${formatNumber(value)})` : formatNumber(value)

/** `A=0, B=3, C=∞` — the distance summary row. */
export const formatDistances = (
  graph: Graph,
  dist: ReadonlyMap<VertexId, number>,
): string =>
  graph.vertexIds
    .map((id) => `${graph.label(id)}=${formatNumber(dist.get(id) ?? Infinity)}`)
    .join(', ')

/** Vertex labels in document order, joined for a summary row. */
export const labelsInOrder = (graph: Graph, ids: Iterable<VertexId>): string[] => {
  const wanted = new Set(ids)
  return graph.vertexIds.filter((id) => wanted.has(id)).map((id) => graph.label(id))
}

export const plural = (n: number, one: string, many = `${one}s`): string =>
  `${n} ${n === 1 ? one : many}`

/* ------------------------------------------------------------------ */
/* Ordering helpers                                                    */
/* ------------------------------------------------------------------ */

/** Document position of every edge, for reproducible tie-breaking. */
export const edgeOrderIndex = (graph: Graph): Map<EdgeId, number> => {
  const index = new Map<EdgeId, number>()
  graph.edges.forEach((e, i) => index.set(e.id, i))
  return index
}

/** Edge ids of a set, re-ordered to match the document. */
export const edgesInDocumentOrder = (
  graph: Graph,
  ids: ReadonlySet<EdgeId>,
): EdgeId[] => graph.edgeIds.filter((id) => ids.has(id))

export const sortVerticesByIndex = (graph: Graph, ids: Iterable<VertexId>): VertexId[] =>
  [...ids].sort((a, b) => graph.index(a) - graph.index(b))
