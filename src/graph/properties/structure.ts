import type { Graph } from '../model/graph'
import type { EdgeId, VertexId } from '../model/types'
import { connectedComponents } from './traversal'

export interface CycleWitness {
  vertexIds: VertexId[]
  edgeIds: EdgeId[]
}

export interface BipartiteResult {
  isBipartite: boolean
  partition: [VertexId[], VertexId[]] | null
  oddCycle: CycleWitness | null
}

/**
 * Two-colours the graph by BFS. On failure it returns an actual odd cycle,
 * built from the two BFS tree paths to the conflicting edge, so the inspector
 * can show *why* the graph is not bipartite rather than just saying "no".
 */
export const analyzeBipartite = (graph: Graph): BipartiteResult => {
  const loop = graph.selfLoops()[0]
  if (loop) {
    const e = graph.edge(loop)!
    return {
      isBipartite: false,
      partition: null,
      oddCycle: { vertexIds: [e.source], edgeIds: [loop] },
    }
  }

  const color = new Map<VertexId, number>()
  const parent = new Map<VertexId, VertexId>()
  const parentEdge = new Map<VertexId, EdgeId>()
  const depth = new Map<VertexId, number>()

  for (const root of graph.vertexIds) {
    if (color.has(root)) continue
    color.set(root, 0)
    depth.set(root, 0)
    const queue = [root]
    let head = 0
    while (head < queue.length) {
      const v = queue[head++]!
      for (const n of graph.neighbors(v)) {
        if (!color.has(n.to)) {
          color.set(n.to, 1 - color.get(v)!)
          depth.set(n.to, depth.get(v)! + 1)
          parent.set(n.to, v)
          parentEdge.set(n.to, n.edgeId)
          queue.push(n.to)
          continue
        }
        if (color.get(n.to) !== color.get(v)) continue

        // Conflict: climb both BFS paths to their meeting point.
        let a = v
        let b = n.to
        const pathA: VertexId[] = [a]
        const pathB: VertexId[] = [b]
        const edgesA: EdgeId[] = []
        const edgesB: EdgeId[] = []
        while (depth.get(a)! > depth.get(b)!) {
          edgesA.push(parentEdge.get(a)!)
          a = parent.get(a)!
          pathA.push(a)
        }
        while (depth.get(b)! > depth.get(a)!) {
          edgesB.push(parentEdge.get(b)!)
          b = parent.get(b)!
          pathB.push(b)
        }
        while (a !== b) {
          edgesA.push(parentEdge.get(a)!)
          a = parent.get(a)!
          pathA.push(a)
          edgesB.push(parentEdge.get(b)!)
          b = parent.get(b)!
          pathB.push(b)
        }
        pathB.pop() // drop the shared meeting vertex, it is already in pathA
        const vertexIds = [...pathA, ...pathB.reverse()]
        const edgeIds = [...edgesA, ...edgesB.reverse(), n.edgeId]
        return { isBipartite: false, partition: null, oddCycle: { vertexIds, edgeIds } }
      }
    }
  }

  const left: VertexId[] = []
  const right: VertexId[] = []
  for (const id of graph.vertexIds) (color.get(id) === 0 ? left : right).push(id)
  return { isBipartite: true, partition: [left, right], oddCycle: null }
}

export interface CompleteBipartiteResult {
  isCompleteBipartite: boolean
  sizes: [number, number] | null
  partition: [VertexId[], VertexId[]] | null
}

/**
 * K(m,n) detection. Requires a connected simple bipartite graph in which every
 * cross pair is joined. A single vertex is K(1,0) and is reported as such.
 */
export const analyzeCompleteBipartite = (graph: Graph): CompleteBipartiteResult => {
  const negative: CompleteBipartiteResult = {
    isCompleteBipartite: false,
    sizes: null,
    partition: null,
  }
  // K(m,0) is technically complete bipartite but reporting it for a handful of
  // isolated vertices is noise, and it contradicts the connectivity section.
  if (graph.order === 0 || graph.size === 0 || !graph.isSimple() || graph.directed) return negative
  const { isBipartite, partition } = analyzeBipartite(graph)
  if (!isBipartite || !partition) return negative
  const [left, right] = partition
  if (graph.size !== left.length * right.length) return negative
  if (left.length && right.length && connectedComponents(graph).length > 1) return negative
  for (const a of left) {
    for (const b of right) if (!graph.hasEdge(a, b)) return negative
  }
  return {
    isCompleteBipartite: true,
    sizes: [left.length, right.length],
    partition: [left, right],
  }
}

export interface RegularityResult {
  regular: boolean
  degree: number | null
  min: number
  max: number
}

export const analyzeRegularity = (graph: Graph): RegularityResult => {
  if (graph.order === 0) return { regular: true, degree: 0, min: 0, max: 0 }
  const degrees = graph.vertices.map((v) => graph.degree(v.id))
  const min = Math.min(...degrees)
  const max = Math.max(...degrees)
  return { regular: min === max, degree: min === max ? min : null, min, max }
}

export interface CompletenessResult {
  isComplete: boolean
  missing: [VertexId, VertexId][]
}

export const analyzeCompleteness = (graph: Graph): CompletenessResult => {
  const missing: [VertexId, VertexId][] = []
  const ids = graph.vertexIds
  for (let i = 0; i < ids.length; i++) {
    for (let j = graph.directed ? 0 : i + 1; j < ids.length; j++) {
      if (i === j) continue
      if (!graph.hasEdge(ids[i]!, ids[j]!)) missing.push([ids[i]!, ids[j]!])
      if (missing.length > 400) return { isComplete: false, missing }
    }
  }
  return { isComplete: missing.length === 0 && graph.isSimple(), missing }
}

/** Finds one cycle in the undirected sense (self-loop and parallel edges count). */
export const findUndirectedCycle = (graph: Graph): CycleWitness | null => {
  const loop = graph.selfLoops()[0]
  if (loop) {
    const e = graph.edge(loop)!
    return { vertexIds: [e.source], edgeIds: [loop] }
  }
  const parallel = graph.parallelEdgeGroups()[0]
  if (parallel && parallel.length > 1) {
    const e = graph.edge(parallel[0]!)!
    return { vertexIds: [e.source, e.target], edgeIds: [parallel[0]!, parallel[1]!] }
  }

  const seen = new Set<VertexId>()
  const parent = new Map<VertexId, VertexId>()
  const parentEdge = new Map<VertexId, EdgeId>()

  for (const root of graph.vertexIds) {
    if (seen.has(root)) continue
    seen.add(root)
    const stack: { v: VertexId; inEdge: EdgeId | null }[] = [{ v: root, inEdge: null }]
    while (stack.length) {
      const { v, inEdge } = stack.pop()!
      for (const n of graph.neighbors(v)) {
        if (n.edgeId === inEdge) continue
        if (!seen.has(n.to)) {
          seen.add(n.to)
          parent.set(n.to, v)
          parentEdge.set(n.to, n.edgeId)
          stack.push({ v: n.to, inEdge: n.edgeId })
          continue
        }
        // Back edge: climb from both ends to the shared ancestor.
        const ancestors = new Map<VertexId, number>()
        let cursor: VertexId | undefined = v
        let depth = 0
        while (cursor !== undefined) {
          ancestors.set(cursor, depth++)
          cursor = parent.get(cursor)
        }
        let other: VertexId | undefined = n.to
        const tail: VertexId[] = []
        const tailEdges: EdgeId[] = []
        while (other !== undefined && !ancestors.has(other)) {
          tail.push(other)
          tailEdges.push(parentEdge.get(other)!)
          other = parent.get(other)
        }
        if (other === undefined) continue
        const head: VertexId[] = []
        const headEdges: EdgeId[] = []
        let walk: VertexId = v
        while (walk !== other) {
          head.push(walk)
          headEdges.push(parentEdge.get(walk)!)
          walk = parent.get(walk)!
        }
        head.push(other)
        const vertexIds = [...head, ...tail.reverse()]
        const edgeIds = [...headEdges, ...tailEdges.reverse(), n.edgeId]
        if (vertexIds.length >= 2) return { vertexIds, edgeIds }
      }
    }
  }
  return null
}

/** Finds one directed cycle, or null when the digraph is acyclic. */
export const findDirectedCycle = (graph: Graph): CycleWitness | null => {
  const WHITE = 0
  const GREY = 1
  const BLACK = 2
  const state = new Map<VertexId, number>()
  const parent = new Map<VertexId, VertexId>()
  const parentEdge = new Map<VertexId, EdgeId>()
  for (const id of graph.vertexIds) state.set(id, WHITE)

  for (const root of graph.vertexIds) {
    if (state.get(root) !== WHITE) continue
    const stack: { v: VertexId; i: number; ns: ReturnType<Graph['successors']> }[] = [
      { v: root, i: 0, ns: graph.successors(root) },
    ]
    state.set(root, GREY)
    while (stack.length) {
      const frame = stack[stack.length - 1]!
      if (frame.i < frame.ns.length) {
        const n = frame.ns[frame.i++]!
        const s = state.get(n.to)
        if (s === WHITE) {
          state.set(n.to, GREY)
          parent.set(n.to, frame.v)
          parentEdge.set(n.to, n.edgeId)
          stack.push({ v: n.to, i: 0, ns: graph.successors(n.to) })
        } else if (s === GREY) {
          // Walk the tree path back up to the grey ancestor, then rotate so
          // that edgeIds[i] runs from vertexIds[i] to vertexIds[i + 1].
          const pathVertices: VertexId[] = []
          const pathEdges: EdgeId[] = []
          let cursor = frame.v
          while (cursor !== n.to) {
            pathVertices.unshift(cursor)
            pathEdges.unshift(parentEdge.get(cursor)!)
            cursor = parent.get(cursor)!
          }
          return {
            vertexIds: [n.to, ...pathVertices],
            edgeIds: [...pathEdges, n.edgeId],
          }
        }
        continue
      }
      state.set(frame.v, BLACK)
      stack.pop()
    }
  }
  return null
}

export const findCycle = (graph: Graph): CycleWitness | null =>
  graph.directed ? findDirectedCycle(graph) : findUndirectedCycle(graph)

export interface TreeResult {
  isTree: boolean
  isForest: boolean
  componentCount: number
  cycle: CycleWitness | null
  reason: string
}

/**
 * Tree / forest classification with the reason attached. For a digraph the
 * question is asked of the underlying undirected graph, and the reason says so.
 */
export const analyzeTree = (graph: Graph): TreeResult => {
  const components = connectedComponents(graph)
  const cycle = findUndirectedCycle(graph)
  const isForest = cycle === null
  const isTree = isForest && components.length === 1 && graph.order > 0

  const scope = graph.directed ? ' in the underlying undirected graph' : ''
  let reason = ''
  if (graph.order === 0) reason = 'The graph is empty.'
  else if (cycle && components.length > 1) {
    reason = `The graph has ${components.length} components and contains a cycle${scope}.`
  } else if (cycle) reason = `The graph contains a cycle${scope}.`
  else if (components.length > 1) {
    reason = `The graph is acyclic${scope} but has ${components.length} components, so it is a forest, not a tree.`
  } else reason = `Connected and acyclic${scope}, with ${graph.order} vertices and ${graph.size} edges.`

  return { isTree, isForest, componentCount: components.length, cycle, reason }
}

export interface TopologicalResult {
  order: VertexId[] | null
  cycle: CycleWitness | null
}

/** Kahn's algorithm. Ties break on document order so the result is stable. */
export const topologicalOrder = (graph: Graph): TopologicalResult => {
  if (!graph.directed) return { order: null, cycle: null }
  const indeg = new Map<VertexId, number>()
  for (const id of graph.vertexIds) indeg.set(id, graph.inDegree(id))
  const ready = graph.vertexIds.filter((id) => indeg.get(id) === 0)
  const order: VertexId[] = []
  while (ready.length) {
    ready.sort((a, b) => graph.index(a) - graph.index(b))
    const v = ready.shift()!
    order.push(v)
    for (const n of graph.successors(v)) {
      indeg.set(n.to, indeg.get(n.to)! - 1)
      if (indeg.get(n.to) === 0) ready.push(n.to)
    }
  }
  if (order.length === graph.order) return { order, cycle: null }
  return { order: null, cycle: findDirectedCycle(graph) }
}

export const density = (graph: Graph): number => {
  const n = graph.order
  if (n < 2) return 0
  const max = graph.directed ? n * (n - 1) : (n * (n - 1)) / 2
  return graph.size / max
}
