/**
 * Graph transformations.
 *
 * Every transformation is a pure function from a {@link Graph} (plus whatever
 * the user has selected) to a brand-new {@link GraphDocument}. Nothing here
 * mutates its input, touches React, or uses `Math.random`: two runs on the
 * same graph and selection always produce the same picture.
 *
 * Identity policy — undo, redo and the selection all key off ids, so:
 *   * an element that genuinely survives keeps its id (transposing an arc,
 *     re-pointing an edge through a contraction, an edge kept by squaring);
 *   * anything newly created gets a fresh id.
 */

import { labelForIndex, nextEdgeId, nextVertexId } from '../model/ids'
import type { Graph } from '../model/graph'
import type { Edge, EdgeId, GraphDocument, Vertex, VertexId } from '../model/types'

/* ------------------------------------------------------------------ */
/* Public types                                                        */
/* ------------------------------------------------------------------ */

export interface TransformContext {
  /** Vertices the user currently has selected, in document order. */
  selectedVertices?: VertexId[]
  selectedEdges?: EdgeId[]
}

export interface TransformResult {
  document: GraphDocument
  /** One short sentence for the undo entry and the status bar. */
  summary: string
  /** True when positions were regenerated and the canvas should fit to them. */
  relayout: boolean
}

/** Raised when `apply` is called on a graph its precondition rejects. */
export class TransformError extends Error {}

export interface TransformDefinition {
  id: string
  name: string
  description: string
  /** null when runnable, otherwise a plain sentence explaining why not. */
  precondition?: (graph: Graph, ctx: TransformContext) => string | null
  apply: (graph: Graph, ctx: TransformContext) => TransformResult
}

/* ------------------------------------------------------------------ */
/* Shared helpers                                                      */
/* ------------------------------------------------------------------ */

interface Point {
  x: number
  y: number
}

/** Canonical key for an endpoint pair: ordered when directed, sorted when not. */
const pairKey = (directed: boolean, a: VertexId, b: VertexId): string =>
  directed || a <= b ? `${a}|${b}` : `${b}|${a}`

const copyVertex = (v: Vertex): Vertex => ({ ...v })

const copyEdge = (e: Edge): Edge => ({ ...e })

const newEdge = (source: VertexId, target: VertexId, weight?: number): Edge => {
  const edge: Edge = { id: nextEdgeId(), source, target }
  if (weight !== undefined) edge.weight = weight
  return edge
}

/** `countOf(1, 'vertex', 'vertices')` -> "1 vertex". */
const countOf = (n: number, one: string, many = `${one}s`): string =>
  `${n} ${n === 1 ? one : many}`

const midpoint = (a: Point, b: Point): Point => ({
  x: (a.x + b.x) / 2,
  y: (a.y + b.y) / 2,
})

const MIN_GAP = 26
const GOLDEN_ANGLE = 2.399963229728653

/**
 * Returns `p`, or the nearest free spot on a deterministic golden-angle spiral
 * around it when something is already sitting there. This is what stops the
 * two diagonals of a square-drawn K4 from stacking their midpoints in L(G).
 * The chosen point is pushed onto `taken`.
 */
const placeDistinct = (taken: Point[], p: Point): Point => {
  let candidate = p
  for (let k = 0; k < 64; k++) {
    const clear = taken.every(
      (q) => Math.hypot(q.x - candidate.x, q.y - candidate.y) >= MIN_GAP,
    )
    if (clear) break
    const angle = (k + 1) * GOLDEN_ANGLE
    const radius = MIN_GAP * Math.sqrt(k + 1)
    candidate = {
      x: p.x + radius * Math.cos(angle),
      y: p.y + radius * Math.sin(angle),
    }
  }
  taken.push(candidate)
  return candidate
}

/** The first canonical label (A, B, C, ... AA) not already in use. */
const firstFreeLabel = (taken: ReadonlySet<string>): string => {
  for (let i = 0; i <= taken.size; i++) {
    const candidate = labelForIndex(i)
    if (!taken.has(candidate)) return candidate
  }
  return labelForIndex(taken.size)
}

/** Hands out successive free canonical labels, remembering what it gave out. */
const labelAllocator = (used: Iterable<string>): (() => string) => {
  const taken = new Set(used)
  return () => {
    const label = firstFreeLabel(taken)
    taken.add(label)
    return label
  }
}

/** `preferred`, or `preferred2`, `preferred3`... if that name is spoken for. */
const uniqueLabel = (taken: Set<string>, preferred: string): string => {
  let label = preferred
  let n = 2
  while (taken.has(label)) label = `${preferred}${n++}`
  taken.add(label)
  return label
}

const selectedVertexIds = (graph: Graph, ctx: TransformContext): VertexId[] => {
  const seen = new Set<VertexId>()
  const out: VertexId[] = []
  for (const id of ctx.selectedVertices ?? []) {
    if (seen.has(id) || !graph.hasVertex(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out.sort((a, b) => graph.index(a) - graph.index(b))
}

const selectedEdgeIds = (graph: Graph, ctx: TransformContext): EdgeId[] => {
  const seen = new Set<EdgeId>()
  const out: EdgeId[] = []
  for (const id of ctx.selectedEdges ?? []) {
    if (seen.has(id) || !graph.edge(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

/** Joins sentence fragments, skipping the empty ones. */
const sentences = (parts: readonly (string | null)[]): string =>
  parts.filter((p): p is string => Boolean(p)).join(' ')

/* ------------------------------------------------------------------ */
/* 1. Complement                                                       */
/* ------------------------------------------------------------------ */

const complementApply = (graph: Graph): TransformResult => {
  const present = new Set<string>()
  let loops = 0
  for (const e of graph.edges) {
    if (e.source === e.target) {
      loops += 1
      continue
    }
    present.add(pairKey(graph.directed, e.source, e.target))
  }

  const ids = graph.vertexIds
  const edges: Edge[] = []
  for (let i = 0; i < ids.length; i++) {
    for (let j = graph.directed ? 0 : i + 1; j < ids.length; j++) {
      if (i === j) continue
      const a = ids[i]!
      const b = ids[j]!
      if (present.has(pairKey(graph.directed, a, b))) continue
      edges.push(newEdge(a, b, graph.weighted ? 1 : undefined))
    }
  }

  return {
    document: {
      vertices: graph.vertices.map(copyVertex),
      edges,
      directed: graph.directed,
      weighted: graph.weighted,
    },
    summary: sentences([
      `Complement: ${countOf(graph.size, 'edge')} became ${edges.length}.`,
      loops ? `Dropped ${countOf(loops, 'self-loop')}.` : null,
      graph.order === 0
        ? 'The graph has no vertices, so the result is empty.'
        : edges.length === 0
          ? 'The result has no edges: the graph was already complete.'
          : null,
    ]),
    relayout: false,
  }
}

/* ------------------------------------------------------------------ */
/* 2. Transpose                                                        */
/* ------------------------------------------------------------------ */

const transposePrecondition = (graph: Graph): string | null =>
  graph.directed
    ? null
    : 'Transpose needs a directed graph — an undirected edge has no direction to reverse.'

const transposeApply = (graph: Graph): TransformResult => {
  const problem = transposePrecondition(graph)
  if (problem) throw new TransformError(problem)
  return {
    document: {
      vertices: graph.vertices.map(copyVertex),
      edges: graph.edges.map((e) => ({ ...e, source: e.target, target: e.source })),
      directed: true,
      weighted: graph.weighted,
    },
    summary:
      graph.size === 0
        ? 'Transpose: the graph has no arcs, so nothing changed.'
        : `Transposed ${countOf(graph.size, 'arc')}.`,
    relayout: false,
  }
}

/* ------------------------------------------------------------------ */
/* 3. Induced subgraph                                                 */
/* ------------------------------------------------------------------ */

const inducedPrecondition = (graph: Graph, ctx: TransformContext): string | null =>
  selectedVertexIds(graph, ctx).length === 0
    ? 'Select at least one vertex to induce a subgraph on.'
    : null

const inducedApply = (graph: Graph, ctx: TransformContext): TransformResult => {
  const problem = inducedPrecondition(graph, ctx)
  if (problem) throw new TransformError(problem)

  const keep = new Set(selectedVertexIds(graph, ctx))
  const vertices = graph.vertices.filter((v) => keep.has(v.id)).map(copyVertex)
  const edges = graph.edges
    .filter((e) => keep.has(e.source) && keep.has(e.target))
    .map(copyEdge)

  return {
    document: { vertices, edges, directed: graph.directed, weighted: graph.weighted },
    summary: sentences([
      `Induced subgraph on ${countOf(vertices.length, 'vertex', 'vertices')}:` +
        ` kept ${edges.length} of ${graph.size} edges.`,
      vertices.length === graph.order
        ? 'Every vertex was selected, so the graph is unchanged.'
        : null,
    ]),
    relayout: false,
  }
}

/* ------------------------------------------------------------------ */
/* 4. Deletions                                                        */
/* ------------------------------------------------------------------ */

const deleteVerticesPrecondition = (
  graph: Graph,
  ctx: TransformContext,
): string | null =>
  selectedVertexIds(graph, ctx).length === 0 ? 'Select at least one vertex to delete.' : null

const deleteVerticesApply = (graph: Graph, ctx: TransformContext): TransformResult => {
  const problem = deleteVerticesPrecondition(graph, ctx)
  if (problem) throw new TransformError(problem)

  const doomed = new Set(selectedVertexIds(graph, ctx))
  const vertices = graph.vertices.filter((v) => !doomed.has(v.id)).map(copyVertex)
  const edges = graph.edges
    .filter((e) => !doomed.has(e.source) && !doomed.has(e.target))
    .map(copyEdge)
  const lostEdges = graph.size - edges.length

  return {
    document: { vertices, edges, directed: graph.directed, weighted: graph.weighted },
    summary: sentences([
      `Deleted ${countOf(doomed.size, 'vertex', 'vertices')} and` +
        ` ${countOf(lostEdges, 'incident edge')}.`,
      vertices.length === 0 ? 'The graph is now empty.' : null,
    ]),
    relayout: false,
  }
}

const deleteEdgesPrecondition = (graph: Graph, ctx: TransformContext): string | null =>
  selectedEdgeIds(graph, ctx).length === 0 ? 'Select at least one edge to delete.' : null

const deleteEdgesApply = (graph: Graph, ctx: TransformContext): TransformResult => {
  const problem = deleteEdgesPrecondition(graph, ctx)
  if (problem) throw new TransformError(problem)

  const doomed = new Set(selectedEdgeIds(graph, ctx))
  const edges = graph.edges.filter((e) => !doomed.has(e.id)).map(copyEdge)

  return {
    document: {
      vertices: graph.vertices.map(copyVertex),
      edges,
      directed: graph.directed,
      weighted: graph.weighted,
    },
    summary: sentences([
      `Deleted ${countOf(doomed.size, 'edge')}.`,
      edges.length === 0 && graph.order > 0
        ? 'No edges remain: the vertices are all isolated.'
        : null,
    ]),
    relayout: false,
  }
}

/* ------------------------------------------------------------------ */
/* 5. Contract edge                                                    */
/* ------------------------------------------------------------------ */

const contractPrecondition = (graph: Graph, ctx: TransformContext): string | null => {
  const selected = selectedEdgeIds(graph, ctx)
  if (selected.length !== 1) return 'Select exactly one edge to contract.'
  const e = graph.edge(selected[0]!)!
  if (e.source === e.target)
    return 'That edge is a self-loop; contracting it would only delete it. Pick an edge joining two different vertices.'
  return null
}

const contractApply = (graph: Graph, ctx: TransformContext): TransformResult => {
  const problem = contractPrecondition(graph, ctx)
  if (problem) throw new TransformError(problem)

  const edgeId = selectedEdgeIds(graph, ctx)[0]!
  const contracted = graph.edge(edgeId)!
  const u = graph.vertex(contracted.source)!
  const v = graph.vertex(contracted.target)!

  const survivingLabels = new Set(
    graph.vertices.filter((x) => x.id !== u.id && x.id !== v.id).map((x) => x.label),
  )
  const joined = `${u.label}${v.label}`
  const label =
    joined.length <= 4 && !survivingLabels.has(joined)
      ? joined
      : firstFreeLabel(survivingLabels)

  const merged: Vertex = {
    id: nextVertexId(),
    label,
    ...midpoint(u, v),
  }

  const vertices: Vertex[] = []
  let placed = false
  for (const x of graph.vertices) {
    if (x.id === u.id || x.id === v.id) {
      if (!placed) {
        vertices.push(merged)
        placed = true
      }
      continue
    }
    vertices.push(copyVertex(x))
  }

  const remap = (id: VertexId): VertexId =>
    id === u.id || id === v.id ? merged.id : id

  const edges: Edge[] = []
  const atMerged = new Map<string, Edge>()
  let loops = 0
  let parallels = 0
  for (const e of graph.edges) {
    if (e.id === edgeId) continue
    const source = remap(e.source)
    const target = remap(e.target)
    // Only loops *at the merge* are the contraction's doing; a self-loop
    // somewhere else in the graph is none of our business.
    if (source === target && source === merged.id) {
      loops += 1
      continue
    }
    const next: Edge = { ...e, source, target }
    if (source === merged.id || target === merged.id) {
      const key = pairKey(graph.directed, source, target)
      const prior = atMerged.get(key)
      if (prior) {
        parallels += 1
        if (graph.weighted) prior.weight = Math.min(prior.weight ?? 1, next.weight ?? 1)
        continue
      }
      atMerged.set(key, next)
    }
    edges.push(next)
  }

  const extras: string[] = []
  if (parallels) extras.push(`removing ${countOf(parallels, 'parallel edge')}`)
  if (loops) extras.push(`dropping ${countOf(loops, 'self-loop')}`)
  const head = `Contracted ${u.label}-${v.label} into ${label}`

  return {
    document: { vertices, edges, directed: graph.directed, weighted: graph.weighted },
    summary: extras.length ? `${head}, ${extras.join(' and ')}.` : `${head}.`,
    relayout: false,
  }
}

/* ------------------------------------------------------------------ */
/* 6. Subdivide edge                                                   */
/* ------------------------------------------------------------------ */

const subdividePrecondition = (graph: Graph, ctx: TransformContext): string | null =>
  selectedEdgeIds(graph, ctx).length === 0 ? 'Select at least one edge to subdivide.' : null

const subdivideApply = (graph: Graph, ctx: TransformContext): TransformResult => {
  const problem = subdividePrecondition(graph, ctx)
  if (problem) throw new TransformError(problem)

  const chosen = new Set(selectedEdgeIds(graph, ctx))
  const nextLabel = labelAllocator(graph.vertices.map((v) => v.label))
  const vertices = graph.vertices.map(copyVertex)
  const occupied: Point[] = vertices.map((v) => ({ x: v.x, y: v.y }))

  const edges: Edge[] = []
  let added = 0
  for (const e of graph.edges) {
    if (!chosen.has(e.id)) {
      edges.push(copyEdge(e))
      continue
    }
    const a = graph.vertex(e.source)!
    const b = graph.vertex(e.target)!
    // A self-loop has no midpoint worth the name, so park the new vertex just
    // off its own endpoint instead.
    const wanted = a.id === b.id ? { x: a.x + 45, y: a.y - 45 } : midpoint(a, b)
    const spot = placeDistinct(occupied, wanted)
    const w: Vertex = { id: nextVertexId(), label: nextLabel(), x: spot.x, y: spot.y }
    vertices.push(w)
    const half = graph.weighted ? graph.weight(e.id) / 2 : undefined
    edges.push(newEdge(e.source, w.id, half), newEdge(w.id, e.target, half))
    added += 1
  }

  return {
    document: { vertices, edges, directed: graph.directed, weighted: graph.weighted },
    summary: sentences([
      `Subdivided ${countOf(added, 'edge')}, adding` +
        ` ${countOf(added, 'vertex', 'vertices')}.`,
      graph.weighted ? 'Each weight was split evenly across the two halves.' : null,
    ]),
    relayout: false,
  }
}

/* ------------------------------------------------------------------ */
/* 7. Line graph                                                       */
/* ------------------------------------------------------------------ */

const lineGraphPrecondition = (graph: Graph): string | null => {
  if (graph.directed)
    return 'The line graph is built here for undirected graphs. Take the underlying undirected graph first.'
  const loops = graph.selfLoops().length
  const parallel = graph.parallelEdgeGroups().length
  if (loops || parallel) {
    const bits: string[] = []
    if (loops) bits.push(countOf(loops, 'self-loop'))
    if (parallel) bits.push(`${countOf(parallel, 'group')} of parallel edges`)
    return `L(G) needs a simple graph, and this one has ${bits.join(' and ')}.`
  }
  return null
}

const lineGraphApply = (graph: Graph): TransformResult => {
  const problem = lineGraphPrecondition(graph)
  if (problem) throw new TransformError(problem)

  const takenLabels = new Set<string>()
  const occupied: Point[] = []
  const vertices: Vertex[] = graph.edges.map((e) => {
    const a = graph.vertex(e.source)!
    const b = graph.vertex(e.target)!
    const [first, second] = graph.index(a.id) <= graph.index(b.id) ? [a, b] : [b, a]
    const spot = placeDistinct(occupied, midpoint(a, b))
    return {
      id: nextVertexId(),
      label: uniqueLabel(takenLabels, `${first.label}${second.label}`),
      x: spot.x,
      y: spot.y,
    }
  })

  const edges: Edge[] = []
  for (let i = 0; i < graph.edges.length; i++) {
    const a = graph.edges[i]!
    for (let j = i + 1; j < graph.edges.length; j++) {
      const b = graph.edges[j]!
      const shares =
        a.source === b.source ||
        a.source === b.target ||
        a.target === b.source ||
        a.target === b.target
      if (shares) edges.push(newEdge(vertices[i]!.id, vertices[j]!.id))
    }
  }

  return {
    document: { vertices, edges, directed: false, weighted: false },
    summary:
      graph.size === 0
        ? 'Line graph: the graph has no edges, so L(G) is empty.'
        : `Line graph: ${countOf(graph.size, 'edge')} became` +
          ` ${countOf(vertices.length, 'vertex', 'vertices')} joined by` +
          ` ${countOf(edges.length, 'edge')}.`,
    relayout: true,
  }
}

/* ------------------------------------------------------------------ */
/* 8. Square                                                           */
/* ------------------------------------------------------------------ */

const squarePrecondition = (graph: Graph): string | null =>
  graph.directed
    ? 'Squaring is defined here for undirected graphs. Take the underlying undirected graph first.'
    : null

const squareApply = (graph: Graph): TransformResult => {
  const problem = squarePrecondition(graph)
  if (problem) throw new TransformError(problem)

  const edges: Edge[] = []
  let added = 0
  let kept = 0
  for (const a of graph.vertexIds) {
    const within2 = new Set<VertexId>()
    for (const one of graph.neighbors(a)) {
      if (one.to === a) continue
      within2.add(one.to)
      for (const two of graph.neighbors(one.to)) {
        if (two.to !== a) within2.add(two.to)
      }
    }
    for (const b of within2) {
      // Emit each unordered pair exactly once, from its lower-indexed end.
      if (graph.index(b) <= graph.index(a)) continue
      const existing = graph.edgesBetween(a, b)[0]
      if (existing) {
        edges.push(copyEdge(graph.edge(existing)!))
        kept += 1
      } else {
        edges.push(newEdge(a, b, graph.weighted ? 1 : undefined))
        added += 1
      }
    }
  }
  const collapsed = graph.size - kept

  return {
    document: {
      vertices: graph.vertices.map(copyVertex),
      edges,
      directed: false,
      weighted: graph.weighted,
    },
    summary: sentences([
      graph.size === 0
        ? 'Square: the graph has no edges, so nothing changed.'
        : added === 0
          ? 'Square: every pair at distance 2 was already adjacent, so the graph is unchanged.'
          : `Square: ${countOf(graph.size, 'edge')} became ${edges.length}.` +
            ` Joined ${countOf(added, 'pair')} at distance 2.`,
      collapsed > 0
        ? `Dropped ${collapsed} duplicate or looping ${collapsed === 1 ? 'edge' : 'edges'}.`
        : null,
    ]),
    relayout: false,
  }
}

/* ------------------------------------------------------------------ */
/* 9. Underlying undirected graph                                      */
/* ------------------------------------------------------------------ */

const toUndirectedPrecondition = (graph: Graph): string | null =>
  graph.directed ? null : 'The graph is already undirected.'

const toUndirectedApply = (graph: Graph): TransformResult => {
  const problem = toUndirectedPrecondition(graph)
  if (problem) throw new TransformError(problem)

  const seen = new Map<string, Edge>()
  const edges: Edge[] = []
  let merged = 0
  for (const e of graph.edges) {
    const key = pairKey(false, e.source, e.target)
    const prior = seen.get(key)
    if (prior) {
      merged += 1
      if (graph.weighted) prior.weight = Math.min(prior.weight ?? 1, e.weight ?? 1)
      continue
    }
    const copy = copyEdge(e)
    seen.set(key, copy)
    edges.push(copy)
  }

  return {
    document: {
      vertices: graph.vertices.map(copyVertex),
      edges,
      directed: false,
      weighted: graph.weighted,
    },
    summary: sentences([
      `Underlying undirected graph: ${countOf(graph.size, 'arc')} became` +
        ` ${countOf(edges.length, 'edge')}.`,
      merged ? `Merged ${countOf(merged, 'antiparallel or duplicate arc')}.` : null,
    ]),
    relayout: false,
  }
}

/* ------------------------------------------------------------------ */
/* Registry                                                            */
/* ------------------------------------------------------------------ */

export const TRANSFORMS: TransformDefinition[] = [
  {
    id: 'complement',
    name: 'Complement',
    description:
      'Keeps the vertices and swaps adjacency: two vertices are joined in the result exactly when they were not joined before. The complement is always simple — self-loops are dropped and parallel edges collapse to one non-edge — and for a directed graph it complements ordered pairs, so u→v appears when the original had no u→v arc. Positions and labels are untouched; in weighted mode the new edges get weight 1.',
    apply: (graph) => complementApply(graph),
  },
  {
    id: 'transpose',
    name: 'Transpose',
    description:
      'Reverses every arc, giving the graph whose adjacency matrix is the transpose of this one. Vertices, edge ids and weights are all preserved, so transposing twice returns the original.',
    precondition: (graph) => transposePrecondition(graph),
    apply: (graph) => transposeApply(graph),
  },
  {
    id: 'induced-subgraph',
    name: 'Induced subgraph',
    description:
      'Keeps the selected vertices together with every edge whose two endpoints are both selected, and discards everything else. Surviving vertices and edges keep their ids and positions.',
    precondition: (graph, ctx) => inducedPrecondition(graph, ctx),
    apply: (graph, ctx) => inducedApply(graph, ctx),
  },
  {
    id: 'delete-vertices',
    name: 'Delete selected vertices',
    description:
      'Removes the selected vertices along with every edge incident to them. The complement of the induced subgraph on what is left.',
    precondition: (graph, ctx) => deleteVerticesPrecondition(graph, ctx),
    apply: (graph, ctx) => deleteVerticesApply(graph, ctx),
  },
  {
    id: 'delete-edges',
    name: 'Delete selected edges',
    description:
      'Removes the selected edges and leaves every vertex in place, so vertices may end up isolated.',
    precondition: (graph, ctx) => deleteEdgesPrecondition(graph, ctx),
    apply: (graph, ctx) => deleteEdgesApply(graph, ctx),
  },
  {
    id: 'contract-edge',
    name: 'Contract edge',
    description:
      'Merges the two endpoints of the selected edge into a single new vertex at their midpoint. Every other incident edge is re-pointed at the merge (keeping its id and weight); the contracted edge goes, any edge that became a self-loop at the merge goes, and edges that became parallel there collapse to one — in weighted mode the survivor keeps the smallest weight of its group. The merged vertex is labelled by joining the two labels with no separator (A + B → AB) when that is at most four characters, otherwise it takes the next free label.',
    precondition: (graph, ctx) => contractPrecondition(graph, ctx),
    apply: (graph, ctx) => contractApply(graph, ctx),
  },
  {
    id: 'subdivide-edge',
    name: 'Subdivide edge',
    description:
      'Replaces each selected edge u-v by a path u-w-v through a fresh vertex w at the midpoint, taking the next free label. Subdivision preserves planarity and turns a cycle of length k into one of length k+1. In weighted mode each half gets half the original weight, so path lengths are unchanged.',
    precondition: (graph, ctx) => subdividePrecondition(graph, ctx),
    apply: (graph, ctx) => subdivideApply(graph, ctx),
  },
  {
    id: 'line-graph',
    name: 'Line graph',
    description:
      'Builds L(G): one vertex per edge of G, with two of them joined when the edges they came from share an endpoint. Each new vertex is labelled by its edge (AB) and drawn at that edge’s midpoint, so the result sits on top of the original picture. Defined here for simple undirected graphs; weights do not carry over, so L(G) is unweighted.',
    precondition: (graph) => lineGraphPrecondition(graph),
    apply: (graph) => lineGraphApply(graph),
  },
  {
    id: 'square',
    name: 'Square',
    description:
      'Builds G², joining every pair of distinct vertices within distance 2 of each other. Distance is counted in hops, never in weights. Edges already present survive with their ids and weights; new ones get weight 1 in weighted mode. The result is simple, so any self-loop or parallel edge in the original disappears.',
    precondition: (graph) => squarePrecondition(graph),
    apply: (graph) => squareApply(graph),
  },
  {
    id: 'to-undirected',
    name: 'Underlying undirected graph',
    description:
      'Forgets orientation: the mode flips to undirected and each pair of endpoints keeps a single edge, so antiparallel arcs (u→v with v→u) and duplicate arcs merge into one. The surviving edge keeps the first arc’s id, and in weighted mode the smallest weight of the pair.',
    precondition: (graph) => toUndirectedPrecondition(graph),
    apply: (graph) => toUndirectedApply(graph),
  },
]

const BY_ID = new Map(TRANSFORMS.map((t) => [t.id, t] as const))

export const transformById = (id: string): TransformDefinition | undefined => BY_ID.get(id)

/**
 * Convenience wrapper: checks the precondition and throws {@link TransformError}
 * with the human message when it fails.
 */
export const applyTransform = (
  id: string,
  graph: Graph,
  ctx: TransformContext = {},
): TransformResult => {
  const def = transformById(id)
  if (!def) throw new TransformError(`Unknown transformation "${id}".`)
  const problem = def.precondition?.(graph, ctx) ?? null
  if (problem) throw new TransformError(problem)
  return def.apply(graph, ctx)
}
