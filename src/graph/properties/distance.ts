import type { Graph } from '../model/graph'
import type { EdgeId, VertexId } from '../model/types'
import { MinHeap, bfs, connectedComponents, walkFromParents } from './traversal'

export const DISTANCE_VERTEX_LIMIT = 400

export interface DistanceMetrics {
  ids: VertexId[]
  /** dist[i][j], Infinity when j is unreachable from i. */
  dist: number[][]
  eccentricity: Map<VertexId, number>
  diameter: number
  radius: number
  center: VertexId[]
  periphery: VertexId[]
  /** True when every ordered pair is mutually reachable. */
  stronglyReachable: boolean
  weighted: boolean
  negativeWeights: boolean
  negativeCycle: boolean
  /** A pair realising the diameter, when the diameter is finite. */
  diameterPair: [VertexId, VertexId] | null
  /** Diameter of the largest component, useful when the graph is disconnected. */
  largestComponentDiameter: number | null
  computed: boolean
}

export interface Walk {
  vertexIds: VertexId[]
  edgeIds: EdgeId[]
  length: number
}

/** Dijkstra from one source; requires non-negative weights. */
export const weightedShortestPaths = (
  graph: Graph,
  source: VertexId,
): { dist: Map<VertexId, number>; parent: Map<VertexId, VertexId>; parentEdge: Map<VertexId, EdgeId> } => {
  const dist = new Map<VertexId, number>([[source, 0]])
  const parent = new Map<VertexId, VertexId>()
  const parentEdge = new Map<VertexId, EdgeId>()
  const settled = new Set<VertexId>()
  const heap = new MinHeap<VertexId>()
  heap.push(0, source)
  while (heap.size) {
    const top = heap.pop()!
    if (settled.has(top.value)) continue
    settled.add(top.value)
    for (const n of graph.successors(top.value)) {
      const w = graph.weight(n.edgeId)
      const next = top.key + w
      if (next < (dist.get(n.to) ?? Infinity)) {
        dist.set(n.to, next)
        parent.set(n.to, top.value)
        parentEdge.set(n.to, n.edgeId)
        heap.push(next, n.to)
      }
    }
  }
  return { dist, parent, parentEdge }
}

export const hasNegativeWeights = (graph: Graph): boolean =>
  graph.weighted && graph.edges.some((e) => (e.weight ?? 1) < 0)

/** A shortest walk between two vertices under the current distance semantics. */
export const shortestWalkBetween = (
  graph: Graph,
  a: VertexId,
  b: VertexId,
  useWeights = graph.weighted,
): Walk | null => {
  if (!graph.hasVertex(a) || !graph.hasVertex(b)) return null
  if (useWeights && !hasNegativeWeights(graph)) {
    const { dist, parent, parentEdge } = weightedShortestPaths(graph, a)
    if (!dist.has(b)) return null
    const walk = walkFromParents(b, parent, parentEdge)
    return { ...walk, length: dist.get(b)! }
  }
  const { dist, parent, parentEdge } = bfs(graph, a)
  if (!dist.has(b)) return null
  const walk = walkFromParents(b, parent, parentEdge)
  return { ...walk, length: dist.get(b)! }
}

const emptyMetrics = (weighted: boolean, computed: boolean): DistanceMetrics => ({
  ids: [],
  dist: [],
  eccentricity: new Map(),
  diameter: Infinity,
  radius: Infinity,
  center: [],
  periphery: [],
  stronglyReachable: false,
  weighted,
  negativeWeights: false,
  negativeCycle: false,
  diameterPair: null,
  largestComponentDiameter: null,
  computed,
})

/**
 * All-pairs distances plus the derived metrics.
 *
 * Unweighted graphs use repeated BFS, O(V(V+E)). Weighted graphs use
 * Floyd-Warshall so negative weights still produce correct answers, and a
 * negative cycle is reported rather than silently returning nonsense.
 */
export const analyzeDistances = (
  graph: Graph,
  options: { useWeights?: boolean } = {},
): DistanceMetrics => {
  const useWeights = options.useWeights ?? graph.weighted
  if (graph.order === 0) return emptyMetrics(useWeights, true)
  if (graph.order > DISTANCE_VERTEX_LIMIT) return emptyMetrics(useWeights, false)

  const ids = graph.vertexIds
  const n = ids.length
  const index = new Map(ids.map((id, i) => [id, i] as const))
  const dist = ids.map(() => new Array<number>(n).fill(Infinity))
  const negativeWeights = hasNegativeWeights(graph)
  let negativeCycle = false

  if (!useWeights) {
    ids.forEach((id, i) => {
      const result = bfs(graph, id)
      for (const [to, d] of result.dist) dist[i]![index.get(to)!] = d
    })
  } else {
    for (let i = 0; i < n; i++) dist[i]![i] = 0
    for (const e of graph.edges) {
      const a = index.get(e.source)!
      const b = index.get(e.target)!
      const w = graph.weight(e.id)
      if (w < dist[a]![b]!) dist[a]![b] = w
      if (!graph.directed && w < dist[b]![a]!) dist[b]![a] = w
      if (a === b && w < 0) negativeCycle = true
    }
    for (let k = 0; k < n; k++) {
      for (let i = 0; i < n; i++) {
        const dik = dist[i]![k]!
        if (dik === Infinity) continue
        for (let j = 0; j < n; j++) {
          const dkj = dist[k]![j]!
          if (dkj === Infinity) continue
          if (dik + dkj < dist[i]![j]!) dist[i]![j] = dik + dkj
        }
      }
    }
    for (let i = 0; i < n; i++) if (dist[i]![i]! < 0) negativeCycle = true
    if (!graph.directed && negativeWeights) negativeCycle = true
  }

  const eccentricity = new Map<VertexId, number>()
  let diameter = 0
  let radius = Infinity
  let diameterPair: [VertexId, VertexId] | null = null
  let stronglyReachable = true

  ids.forEach((id, i) => {
    let ecc = 0
    for (let j = 0; j < n; j++) {
      const d = dist[i]![j]!
      if (d === Infinity) {
        stronglyReachable = false
        ecc = Infinity
        continue
      }
      if (d > ecc) ecc = d
    }
    eccentricity.set(id, ecc)
    if (ecc < radius) radius = ecc
    if (ecc > diameter) diameter = ecc
  })

  if (Number.isFinite(diameter)) {
    outer: for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (dist[i]![j] === diameter) {
          diameterPair = [ids[i]!, ids[j]!]
          break outer
        }
      }
    }
  }

  const center = ids.filter((id) => eccentricity.get(id) === radius)
  const periphery = ids.filter((id) => eccentricity.get(id) === diameter)

  let largestComponentDiameter: number | null = null
  if (!stronglyReachable) {
    const components = connectedComponents(graph)
    const largest = components.slice().sort((a, b) => b.length - a.length)[0]
    if (largest && largest.length > 1) {
      let best = 0
      let finite = true
      for (const a of largest) {
        for (const b of largest) {
          const d = dist[index.get(a)!]![index.get(b)!]!
          if (d === Infinity) {
            finite = false
            continue
          }
          if (d > best) best = d
        }
      }
      largestComponentDiameter = finite ? best : null
    }
  }

  return {
    ids,
    dist,
    eccentricity,
    diameter,
    radius,
    center,
    periphery,
    stronglyReachable,
    weighted: useWeights,
    negativeWeights,
    negativeCycle,
    diameterPair,
    largestComponentDiameter,
    computed: true,
  }
}
