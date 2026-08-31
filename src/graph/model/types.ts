/**
 * Core graph data model.
 *
 * This module is deliberately free of any React or Cytoscape imports. The
 * renderer is a *view* of this data, never its source of truth.
 */

export type VertexId = string
export type EdgeId = string

export interface Vertex {
  id: VertexId
  /** Human facing name, e.g. "A". Purely metadata — never affects mathematics. */
  label: string
  x: number
  y: number
}

export interface Edge {
  id: EdgeId
  source: VertexId
  target: VertexId
  /** Only meaningful when the document is in weighted mode. Defaults to 1. */
  weight?: number
}

export interface GraphDocument {
  vertices: Vertex[]
  edges: Edge[]
  directed: boolean
  weighted: boolean
}

/** One end of an incidence, oriented away from the vertex being queried. */
export interface Incidence {
  /** The vertex on the far end (equal to the queried vertex for a self-loop). */
  to: VertexId
  edgeId: EdgeId
  weight: number
  /** True when traversing this incidence follows the edge's stored direction. */
  forward: boolean
}

/* ------------------------------------------------------------------ */
/* Property results                                                    */
/* ------------------------------------------------------------------ */

/**
 * How much we actually know about a computed value. Graphualize never
 * presents a heuristic as a proof, so every result that can be inexact
 * carries one of these.
 */
export type Exactness =
  | 'exact'
  | 'heuristic'
  | 'upper-bound'
  | 'lower-bound'
  | 'bounded'
  | 'not-computed'
  | 'not-applicable'

export type PropertyStatus = 'success' | 'warning' | 'neutral' | 'danger'

export interface PropertyResult<T> {
  value: T
  /** Short formatted value shown on the right of an inspector row. */
  display: string
  status?: PropertyStatus
  /** One or two sentences of mathematical justification. */
  explanation?: string
  /** Longer text revealed when the row is expanded. */
  detail?: string
  witness?: GraphWitness
  exactness?: Exactness
}

export type GraphWitness =
  | { type: 'vertices'; vertexIds: VertexId[]; caption?: string }
  | { type: 'edges'; edgeIds: EdgeId[]; caption?: string }
  | { type: 'path'; vertexIds: VertexId[]; edgeIds: EdgeId[]; caption?: string }
  | { type: 'cycle'; vertexIds: VertexId[]; edgeIds: EdgeId[]; caption?: string }
  | { type: 'trail'; vertexIds: VertexId[]; edgeIds: EdgeId[]; caption?: string }
  | { type: 'matching'; edgeIds: EdgeId[]; caption?: string }
  | { type: 'partition'; groups: VertexId[][]; captions?: string[] }
  | { type: 'coloring'; colors: Record<VertexId, number>; count: number }
  | { type: 'tree'; edgeIds: EdgeId[]; caption?: string }

/** Semantic highlight channels the canvas knows how to render. */
export type HighlightMode =
  | 'witness'
  | 'path'
  | 'cycle'
  | 'matching'
  | 'tree'
  | 'partition'
  | 'coloring'
  | 'algorithmCurrent'
  | 'algorithmVisited'
  | 'algorithmFrontier'
  | 'algorithmAccepted'
  | 'algorithmRejected'

export interface HighlightRequest {
  vertices?: Record<VertexId, HighlightMode>
  edges?: Record<EdgeId, HighlightMode>
  /** Vertex -> palette index, used by coloring and partition witnesses. */
  colors?: Record<VertexId, number>
  /** Vertex -> small badge string (distances, indegrees, orders...). */
  badges?: Record<VertexId, string>
  /** Vertices/edges that should be visually de-emphasised. */
  dimOthers?: boolean
  caption?: string
}
