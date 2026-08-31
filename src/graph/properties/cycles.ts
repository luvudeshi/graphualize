import type { Graph } from '../model/graph'
import type { EdgeId, VertexId } from '../model/types'
import { connectedComponents } from './traversal'
import type { CycleWitness } from './structure'

/**
 * Girth by BFS from every vertex. For a fixed root the value can overshoot,
 * but the minimum over all roots is exactly the girth of an unweighted graph.
 * O(V * (V + E)).
 */
export const girth = (graph: Graph): { value: number; cycle: CycleWitness | null } => {
  const loop = graph.selfLoops()[0]
  if (loop) {
    const e = graph.edge(loop)!
    return { value: 1, cycle: { vertexIds: [e.source], edgeIds: [loop] } }
  }
  if (!graph.directed) {
    const parallel = graph.parallelEdgeGroups()[0]
    if (parallel && parallel.length > 1) {
      const e = graph.edge(parallel[0]!)!
      return {
        value: 2,
        cycle: { vertexIds: [e.source, e.target], edgeIds: [parallel[0]!, parallel[1]!] },
      }
    }
  }

  let best = Infinity
  let bestCycle: CycleWitness | null = null

  for (const root of graph.vertexIds) {
    const dist = new Map<VertexId, number>([[root, 0]])
    const parent = new Map<VertexId, VertexId>()
    const parentEdge = new Map<VertexId, EdgeId>()
    const queue = [root]
    let head = 0
    while (head < queue.length) {
      const v = queue[head++]!
      const dv = dist.get(v)!
      // Nothing shorter can still be discovered from this root.
      if (graph.directed ? dv + 1 >= best : 2 * dv >= best) break
      for (const n of graph.successors(v)) {
        if (graph.directed) {
          if (n.to === root) {
            const length = dv + 1
            if (length < best) {
              const vertexIds: VertexId[] = [v]
              const edgeIds: EdgeId[] = [n.edgeId]
              let cursor = v
              while (parent.has(cursor)) {
                edgeIds.unshift(parentEdge.get(cursor)!)
                cursor = parent.get(cursor)!
                vertexIds.unshift(cursor)
              }
              best = length
              bestCycle = { vertexIds, edgeIds }
            }
            continue
          }
          if (dist.has(n.to)) continue
          dist.set(n.to, dv + 1)
          parent.set(n.to, v)
          parentEdge.set(n.to, n.edgeId)
          queue.push(n.to)
          continue
        }

        if (n.edgeId === parentEdge.get(v)) continue
        if (!dist.has(n.to)) {
          dist.set(n.to, dv + 1)
          parent.set(n.to, v)
          parentEdge.set(n.to, n.edgeId)
          queue.push(n.to)
          continue
        }
        // The level formula can overshoot when the two tree paths meet below
        // the root, so measure the cycle we actually reconstructed. That keeps
        // the reported girth and its witness in agreement.
        if (dv + dist.get(n.to)! + 1 >= best) continue
        const candidate = buildBfsCycle(v, n.to, n.edgeId, parent, parentEdge)
        const length = candidate.edgeIds.length
        if (length >= 3 && length < best) {
          best = length
          bestCycle = candidate
        }
      }
    }
  }
  return { value: best, cycle: bestCycle }
}

const buildBfsCycle = (
  a: VertexId,
  b: VertexId,
  linkEdge: EdgeId,
  parent: Map<VertexId, VertexId>,
  parentEdge: Map<VertexId, EdgeId>,
): CycleWitness => {
  const chain = (start: VertexId) => {
    const vs: VertexId[] = [start]
    const es: EdgeId[] = []
    let cursor = start
    while (parent.has(cursor)) {
      es.push(parentEdge.get(cursor)!)
      cursor = parent.get(cursor)!
      vs.push(cursor)
    }
    return { vs, es }
  }
  const ca = chain(a)
  const cb = chain(b)
  const setA = new Map(ca.vs.map((id, i) => [id, i] as const))
  let meetIndexB = 0
  while (meetIndexB < cb.vs.length && !setA.has(cb.vs[meetIndexB]!)) meetIndexB += 1
  const meet = cb.vs[meetIndexB]!
  const meetIndexA = setA.get(meet)!
  const vertexIds = [...ca.vs.slice(0, meetIndexA + 1), ...cb.vs.slice(0, meetIndexB).reverse()]
  const edgeIds = [
    ...ca.es.slice(0, meetIndexA),
    ...cb.es.slice(0, meetIndexB).reverse(),
    linkEdge,
  ]
  return { vertexIds, edgeIds }
}

export interface EulerianResult {
  hasCircuit: boolean
  hasTrail: boolean
  /** The circuit or trail as an ordered walk, when one exists. */
  walk: { vertexIds: VertexId[]; edgeIds: EdgeId[] } | null
  oddVertices: VertexId[]
  /** Directed graphs: vertices whose in-degree differs from their out-degree. */
  unbalanced: { id: VertexId; delta: number }[]
  reason: string
}

const nonIsolated = (graph: Graph): VertexId[] =>
  graph.vertexIds.filter((id) => graph.degree(id) > 0)

/** Hierholzer's algorithm over the vertices that actually carry edges. */
const hierholzer = (
  graph: Graph,
  start: VertexId,
): { vertexIds: VertexId[]; edgeIds: EdgeId[] } | null => {
  const used = new Set<EdgeId>()
  const pointer = new Map<VertexId, number>()
  const lists = new Map<VertexId, ReturnType<Graph['successors']>>()
  for (const id of graph.vertexIds) {
    lists.set(id, graph.successors(id))
    pointer.set(id, 0)
  }

  const stackV: VertexId[] = [start]
  const stackE: (EdgeId | null)[] = [null]
  const circuitV: VertexId[] = []
  const circuitE: EdgeId[] = []

  while (stackV.length) {
    const v = stackV[stackV.length - 1]!
    const list = lists.get(v)!
    let i = pointer.get(v)!
    while (i < list.length && used.has(list[i]!.edgeId)) i += 1
    pointer.set(v, i)
    if (i === list.length) {
      circuitV.push(v)
      const e = stackE.pop()!
      stackV.pop()
      if (e) circuitE.push(e)
      continue
    }
    const n = list[i]!
    used.add(n.edgeId)
    pointer.set(v, i + 1)
    stackV.push(n.to)
    stackE.push(n.edgeId)
  }

  if (used.size !== graph.size) return null
  circuitV.reverse()
  circuitE.reverse()
  return { vertexIds: circuitV, edgeIds: circuitE }
}

export const analyzeEulerian = (graph: Graph): EulerianResult => {
  const active = nonIsolated(graph)
  const empty: EulerianResult = {
    hasCircuit: false,
    hasTrail: false,
    walk: null,
    oddVertices: [],
    unbalanced: [],
    reason: 'The graph has no edges.',
  }
  if (graph.size === 0) {
    if (graph.order === 0) return empty
    return { ...empty, hasCircuit: true, hasTrail: true, reason: 'A graph with no edges has a trivial Eulerian circuit.' }
  }

  // Every edge must live in a single connected component.
  const components = connectedComponents(graph, new Set(active))
  if (components.length > 1) {
    return {
      hasCircuit: false,
      hasTrail: false,
      walk: null,
      oddVertices: [],
      unbalanced: [],
      reason: `The edges are spread over ${components.length} separate components, so no single walk can use them all.`,
    }
  }

  if (graph.directed) {
    const unbalanced = active
      .map((id) => ({ id, delta: graph.outDegree(id) - graph.inDegree(id) }))
      .filter((entry) => entry.delta !== 0)
    const positives = unbalanced.filter((entry) => entry.delta > 0)
    const negatives = unbalanced.filter((entry) => entry.delta < 0)
    const balanced = unbalanced.length === 0
    const trailShape =
      positives.length === 1 &&
      negatives.length === 1 &&
      positives[0]!.delta === 1 &&
      negatives[0]!.delta === -1

    if (balanced) {
      const walk = hierholzer(graph, active[0]!)
      return {
        hasCircuit: walk !== null,
        hasTrail: walk !== null,
        walk,
        oddVertices: [],
        unbalanced: [],
        reason: walk
          ? 'Every vertex has equal in-degree and out-degree, and the edges form one strongly connected block.'
          : 'In-degrees and out-degrees balance, but the arcs are not strongly connected.',
      }
    }
    if (trailShape) {
      const walk = hierholzer(graph, positives[0]!.id)
      return {
        hasCircuit: false,
        hasTrail: walk !== null,
        walk,
        oddVertices: [],
        unbalanced,
        reason: `${graph.label(positives[0]!.id)} has one more outgoing arc than incoming, and ${graph.label(negatives[0]!.id)} one more incoming than outgoing, so an Eulerian trail can start and end there.`,
      }
    }
    return {
      hasCircuit: false,
      hasTrail: false,
      walk: null,
      oddVertices: [],
      unbalanced,
      reason: `${unbalanced.length} vertices have unequal in-degree and out-degree. An Eulerian circuit needs every vertex balanced.`,
    }
  }

  const oddVertices = active.filter((id) => graph.degree(id) % 2 === 1)
  if (oddVertices.length === 0) {
    const walk = hierholzer(graph, active[0]!)
    return {
      hasCircuit: true,
      hasTrail: true,
      walk,
      oddVertices: [],
      unbalanced: [],
      reason: 'Every vertex has even degree and all edges lie in one component.',
    }
  }
  if (oddVertices.length === 2) {
    const walk = hierholzer(graph, oddVertices[0]!)
    return {
      hasCircuit: false,
      hasTrail: true,
      walk,
      oddVertices,
      unbalanced: [],
      reason: `Exactly two vertices have odd degree (${graph.labels(oddVertices).join(' and ')}), so a trail exists between them but no closed circuit.`,
    }
  }
  return {
    hasCircuit: false,
    hasTrail: false,
    walk: null,
    oddVertices,
    unbalanced: [],
    reason: `${oddVertices.length} vertices have odd degree. An Eulerian trail allows at most two.`,
  }
}
