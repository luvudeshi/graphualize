import type { Graph } from '../model/graph'
import type { EdgeId, VertexId } from '../model/types'
import { addArc, createNetwork, globalMinCut, maxFlow } from './flow'
import { connectedComponents } from './traversal'

/** Above this order the O(V^3)-ish connectivity searches are skipped. */
export const CONNECTIVITY_VERTEX_LIMIT = 120

export interface BiconnectivityResult {
  bridges: EdgeId[]
  articulationPoints: VertexId[]
  /** Edge sets of the biconnected components (blocks). */
  blocks: EdgeId[][]
}

/**
 * Iterative Hopcroft-Tarjan. Tracks the *edge* used to enter a vertex rather
 * than the parent vertex, which is what makes parallel edges behave correctly:
 * a doubled edge is never a bridge.
 */
export const biconnectivity = (graph: Graph): BiconnectivityResult => {
  const disc = new Map<VertexId, number>()
  const low = new Map<VertexId, number>()
  const bridges: EdgeId[] = []
  const articulation = new Set<VertexId>()
  const blocks: EdgeId[][] = []
  const edgeStack: EdgeId[] = []
  let timer = 0

  for (const root of graph.vertexIds) {
    if (disc.has(root)) continue

    interface Frame {
      v: VertexId
      inEdge: EdgeId | null
      neighbors: ReturnType<Graph['neighbors']>
      i: number
      children: number
    }
    disc.set(root, timer)
    low.set(root, timer)
    timer += 1
    const stack: Frame[] = [
      { v: root, inEdge: null, neighbors: graph.neighbors(root), i: 0, children: 0 },
    ]

    while (stack.length) {
      const frame = stack[stack.length - 1]!
      if (frame.i < frame.neighbors.length) {
        const n = frame.neighbors[frame.i++]!
        if (n.edgeId === frame.inEdge) continue
        if (n.to === frame.v) continue // self-loop
        if (disc.has(n.to)) {
          if (disc.get(n.to)! < disc.get(frame.v)!) {
            edgeStack.push(n.edgeId)
            low.set(frame.v, Math.min(low.get(frame.v)!, disc.get(n.to)!))
          }
          continue
        }
        edgeStack.push(n.edgeId)
        frame.children += 1
        disc.set(n.to, timer)
        low.set(n.to, timer)
        timer += 1
        stack.push({
          v: n.to,
          inEdge: n.edgeId,
          neighbors: graph.neighbors(n.to),
          i: 0,
          children: 0,
        })
        continue
      }

      stack.pop()
      const parentFrame = stack[stack.length - 1]
      if (!parentFrame) break
      const parent = parentFrame.v
      const child = frame.v
      low.set(parent, Math.min(low.get(parent)!, low.get(child)!))

      if (low.get(child)! > disc.get(parent)!) bridges.push(frame.inEdge!)

      const isRoot = stack.length === 1 && parentFrame.v === root
      if (
        (isRoot && parentFrame.children > 1) ||
        (!isRoot && low.get(child)! >= disc.get(parent)!)
      ) {
        articulation.add(parent)
      }
      if (low.get(child)! >= disc.get(parent)!) {
        const block: EdgeId[] = []
        for (;;) {
          const top = edgeStack.pop()
          if (top === undefined) break
          block.push(top)
          if (top === frame.inEdge) break
        }
        if (block.length) blocks.push(block)
      }
    }
    if (edgeStack.length) {
      blocks.push(edgeStack.splice(0, edgeStack.length))
    }
  }

  const order = new Map(graph.edgeIds.map((id, i) => [id, i] as const))
  bridges.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0))
  return {
    bridges,
    articulationPoints: [...articulation].sort((a, b) => graph.index(a) - graph.index(b)),
    blocks,
  }
}

/** Tarjan's SCC, iterative. Components are returned in reverse topological order. */
export const stronglyConnectedComponents = (graph: Graph): VertexId[][] => {
  if (!graph.directed) return connectedComponents(graph)
  const index = new Map<VertexId, number>()
  const low = new Map<VertexId, number>()
  const onStack = new Set<VertexId>()
  const stack: VertexId[] = []
  const result: VertexId[][] = []
  let counter = 0

  for (const root of graph.vertexIds) {
    if (index.has(root)) continue
    interface Frame {
      v: VertexId
      neighbors: ReturnType<Graph['successors']>
      i: number
    }
    index.set(root, counter)
    low.set(root, counter)
    counter += 1
    stack.push(root)
    onStack.add(root)
    const frames: Frame[] = [{ v: root, neighbors: graph.successors(root), i: 0 }]

    while (frames.length) {
      const frame = frames[frames.length - 1]!
      if (frame.i < frame.neighbors.length) {
        const to = frame.neighbors[frame.i++]!.to
        if (!index.has(to)) {
          index.set(to, counter)
          low.set(to, counter)
          counter += 1
          stack.push(to)
          onStack.add(to)
          frames.push({ v: to, neighbors: graph.successors(to), i: 0 })
        } else if (onStack.has(to)) {
          low.set(frame.v, Math.min(low.get(frame.v)!, index.get(to)!))
        }
        continue
      }
      frames.pop()
      const parent = frames[frames.length - 1]
      if (low.get(frame.v)! === index.get(frame.v)!) {
        const component: VertexId[] = []
        for (;;) {
          const w = stack.pop()!
          onStack.delete(w)
          component.push(w)
          if (w === frame.v) break
        }
        component.sort((a, b) => graph.index(a) - graph.index(b))
        result.push(component)
      }
      if (parent) low.set(parent.v, Math.min(low.get(parent.v)!, low.get(frame.v)!))
    }
  }
  return result
}

export interface CutResult {
  value: number
  edgeIds?: EdgeId[]
  vertexIds?: VertexId[]
  exact: boolean
  reason?: string
}

/**
 * Edge connectivity. Undirected graphs use Stoer-Wagner (exact, O(V^3));
 * digraphs use |V| max-flow pairs against a fixed root.
 */
export const edgeConnectivity = (graph: Graph): CutResult | null => {
  const n = graph.order
  if (n < 2) return { value: 0, edgeIds: [], exact: true, reason: 'Fewer than two vertices.' }
  if (n > CONNECTIVITY_VERTEX_LIMIT) return null
  if (connectedComponents(graph).length > 1) {
    return { value: 0, edgeIds: [], exact: true, reason: 'The graph is disconnected.' }
  }

  const ids = graph.vertexIds
  const idx = new Map(ids.map((id, i) => [id, i] as const))

  if (!graph.directed) {
    const w = ids.map(() => new Array<number>(n).fill(0))
    for (const e of graph.edges) {
      if (e.source === e.target) continue
      const a = idx.get(e.source)!
      const b = idx.get(e.target)!
      w[a]![b] = w[a]![b]! + 1
      w[b]![a] = w[b]![a]! + 1
    }
    const cut = globalMinCut(w)
    const side = new Set(cut.side)
    const edgeIds = graph.edges
      .filter((e) => {
        if (e.source === e.target) return false
        const a = side.has(idx.get(e.source)!)
        const b = side.has(idx.get(e.target)!)
        return a !== b
      })
      .map((e) => e.id)
    return { value: cut.value, edgeIds, exact: true }
  }

  let best = Infinity
  let bestArcs: EdgeId[] = []
  const arcEdge: EdgeId[] = []
  const build = () => {
    const net = createNetwork(n)
    arcEdge.length = 0
    for (const e of graph.edges) {
      if (e.source === e.target) continue
      addArc(net, idx.get(e.source)!, idx.get(e.target)!, 1)
      arcEdge.push(e.id, e.id)
    }
    return net
  }
  for (let i = 1; i < n; i++) {
    for (const [s, t] of [
      [0, i],
      [i, 0],
    ] as const) {
      const net = build()
      const res = maxFlow(net, s, t)
      if (res.value < best) {
        best = res.value
        bestArcs = res.cutArcs.map((a) => arcEdge[a]!).filter(Boolean)
      }
    }
  }
  return { value: best === Infinity ? 0 : best, edgeIds: [...new Set(bestArcs)], exact: true }
}

/**
 * Vertex connectivity via max-flow on the split graph, minimised over all
 * non-adjacent pairs. Exact but O(V^2 * flow), so it is size-gated.
 */
export const vertexConnectivity = (graph: Graph): CutResult | null => {
  const n = graph.order
  if (n < 2) return { value: 0, vertexIds: [], exact: true, reason: 'Fewer than two vertices.' }
  if (n > 60) return null
  if (connectedComponents(graph).length > 1) {
    return { value: 0, vertexIds: [], exact: true, reason: 'The graph is disconnected.' }
  }

  const ids = graph.vertexIds
  const idx = new Map(ids.map((id, i) => [id, i] as const))
  const adjacent = (a: VertexId, b: VertexId) =>
    graph.hasEdge(a, b) || (!graph.directed && graph.hasEdge(b, a))

  // A complete graph has no non-adjacent pair; kappa is n - 1 by definition.
  let complete = true
  for (let i = 0; i < n && complete; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) continue
      if (!adjacent(ids[i]!, ids[j]!)) {
        complete = false
        break
      }
    }
  }
  if (complete) {
    return {
      value: n - 1,
      vertexIds: [],
      exact: true,
      reason: 'Complete graph: no cut set exists, so kappa is n - 1 by convention.',
    }
  }

  // Split network: vertex v becomes v_in = 2i, v_out = 2i + 1 with capacity 1.
  const build = () => {
    const net = createNetwork(2 * n)
    for (let i = 0; i < n; i++) addArc(net, 2 * i, 2 * i + 1, 1)
    for (const e of graph.edges) {
      if (e.source === e.target) continue
      const a = idx.get(e.source)!
      const b = idx.get(e.target)!
      addArc(net, 2 * a + 1, 2 * b, Infinity)
      if (!graph.directed) addArc(net, 2 * b + 1, 2 * a, Infinity)
    }
    return net
  }

  let best = Infinity
  let bestCut: VertexId[] = []
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) continue
      if (!graph.directed && j < i) continue
      if (adjacent(ids[i]!, ids[j]!)) continue
      const net = build()
      const res = maxFlow(net, 2 * i + 1, 2 * j)
      if (res.value < best) {
        best = res.value
        bestCut = ids.filter(
          (_, k) => res.sourceSide.has(2 * k) && !res.sourceSide.has(2 * k + 1),
        )
      }
    }
  }
  if (best === Infinity) return { value: n - 1, vertexIds: [], exact: true }
  return { value: best, vertexIds: bestCut, exact: true }
}
