import type { Graph } from '../model/graph'
import type { EdgeId, VertexId } from '../model/types'

export interface BfsResult {
  /** Distance in edges from the source; missing key means unreachable. */
  dist: Map<VertexId, number>
  parent: Map<VertexId, VertexId>
  parentEdge: Map<VertexId, EdgeId>
  /** Vertices in the order they were dequeued. */
  order: VertexId[]
}

export interface TraversalOptions {
  /** Follow edge direction. Defaults to the graph's own `directed` flag. */
  respectDirection?: boolean
  /** Restrict traversal to this vertex set. */
  allowed?: ReadonlySet<VertexId>
}

const neighborsOf = (graph: Graph, v: VertexId, options: TraversalOptions) => {
  const respect = options.respectDirection ?? graph.directed
  return respect ? graph.successors(v) : graph.neighbors(v)
}

export const bfs = (
  graph: Graph,
  source: VertexId,
  options: TraversalOptions = {},
): BfsResult => {
  const dist = new Map<VertexId, number>()
  const parent = new Map<VertexId, VertexId>()
  const parentEdge = new Map<VertexId, EdgeId>()
  const order: VertexId[] = []
  if (!graph.hasVertex(source)) return { dist, parent, parentEdge, order }
  if (options.allowed && !options.allowed.has(source)) {
    return { dist, parent, parentEdge, order }
  }

  dist.set(source, 0)
  const queue: VertexId[] = [source]
  let head = 0
  while (head < queue.length) {
    const v = queue[head++]!
    order.push(v)
    const d = dist.get(v)!
    for (const n of neighborsOf(graph, v, options)) {
      if (options.allowed && !options.allowed.has(n.to)) continue
      if (dist.has(n.to)) continue
      dist.set(n.to, d + 1)
      parent.set(n.to, v)
      parentEdge.set(n.to, n.edgeId)
      queue.push(n.to)
    }
  }
  return { dist, parent, parentEdge, order }
}

/** Iterative DFS preorder. Deterministic: neighbours in document order. */
export const dfsOrder = (
  graph: Graph,
  source: VertexId,
  options: TraversalOptions = {},
): VertexId[] => {
  const seen = new Set<VertexId>()
  const out: VertexId[] = []
  const stack: VertexId[] = [source]
  while (stack.length) {
    const v = stack.pop()!
    if (seen.has(v)) continue
    if (options.allowed && !options.allowed.has(v)) continue
    seen.add(v)
    out.push(v)
    const ns = neighborsOf(graph, v, options)
    for (let i = ns.length - 1; i >= 0; i--) {
      const to = ns[i]!.to
      if (!seen.has(to)) stack.push(to)
    }
  }
  return out
}

/**
 * Connected components ignoring direction (i.e. weakly connected components
 * for a digraph). Vertices keep document order inside each component, and
 * components are ordered by their first vertex.
 */
export const connectedComponents = (
  graph: Graph,
  allowed?: ReadonlySet<VertexId>,
): VertexId[][] => {
  const seen = new Set<VertexId>()
  const components: VertexId[][] = []
  for (const id of graph.vertexIds) {
    if (allowed && !allowed.has(id)) continue
    if (seen.has(id)) continue
    const component: VertexId[] = []
    const stack = [id]
    seen.add(id)
    while (stack.length) {
      const v = stack.pop()!
      component.push(v)
      for (const n of graph.neighbors(v)) {
        if (allowed && !allowed.has(n.to)) continue
        if (seen.has(n.to)) continue
        seen.add(n.to)
        stack.push(n.to)
      }
    }
    component.sort((a, b) => graph.index(a) - graph.index(b))
    components.push(component)
  }
  return components
}

export interface Walk {
  vertexIds: VertexId[]
  edgeIds: EdgeId[]
}

/** Reconstructs the walk that a BFS/Dijkstra parent map encodes. */
export const walkFromParents = (
  target: VertexId,
  parent: Map<VertexId, VertexId>,
  parentEdge: Map<VertexId, EdgeId>,
): Walk => {
  const vertexIds: VertexId[] = [target]
  const edgeIds: EdgeId[] = []
  let cursor = target
  const guard = new Set<VertexId>([target])
  while (parent.has(cursor)) {
    const edgeId = parentEdge.get(cursor)
    if (edgeId) edgeIds.push(edgeId)
    cursor = parent.get(cursor)!
    if (guard.has(cursor)) break
    guard.add(cursor)
    vertexIds.push(cursor)
  }
  vertexIds.reverse()
  edgeIds.reverse()
  return { vertexIds, edgeIds }
}

/** Union-find used by Kruskal, block detection and component merges. */
export class DisjointSet {
  private parent: Map<VertexId, VertexId> = new Map()
  private rank: Map<VertexId, number> = new Map()

  constructor(ids: Iterable<VertexId>) {
    for (const id of ids) {
      this.parent.set(id, id)
      this.rank.set(id, 0)
    }
  }

  find(id: VertexId): VertexId {
    let root = id
    while (this.parent.get(root) !== root) root = this.parent.get(root)!
    let cursor = id
    while (this.parent.get(cursor) !== root) {
      const next = this.parent.get(cursor)!
      this.parent.set(cursor, root)
      cursor = next
    }
    return root
  }

  union(a: VertexId, b: VertexId): boolean {
    const ra = this.find(a)
    const rb = this.find(b)
    if (ra === rb) return false
    const rankA = this.rank.get(ra)!
    const rankB = this.rank.get(rb)!
    if (rankA < rankB) this.parent.set(ra, rb)
    else if (rankA > rankB) this.parent.set(rb, ra)
    else {
      this.parent.set(rb, ra)
      this.rank.set(ra, rankA + 1)
    }
    return true
  }

  connected(a: VertexId, b: VertexId): boolean {
    return this.find(a) === this.find(b)
  }
}

/** Minimal binary heap keyed by number; used by Dijkstra and Prim. */
export class MinHeap<T> {
  private items: { key: number; value: T }[] = []

  get size(): number {
    return this.items.length
  }

  push(key: number, value: T): void {
    this.items.push({ key, value })
    let i = this.items.length - 1
    while (i > 0) {
      const p = (i - 1) >> 1
      if (this.items[p]!.key <= this.items[i]!.key) break
      const tmp = this.items[p]!
      this.items[p] = this.items[i]!
      this.items[i] = tmp
      i = p
    }
  }

  pop(): { key: number; value: T } | undefined {
    if (this.items.length === 0) return undefined
    const top = this.items[0]!
    const last = this.items.pop()!
    if (this.items.length) {
      this.items[0] = last
      let i = 0
      for (;;) {
        const l = 2 * i + 1
        const r = l + 1
        let m = i
        if (l < this.items.length && this.items[l]!.key < this.items[m]!.key) m = l
        if (r < this.items.length && this.items[r]!.key < this.items[m]!.key) m = r
        if (m === i) break
        const tmp = this.items[m]!
        this.items[m] = this.items[i]!
        this.items[i] = tmp
        i = m
      }
    }
    return top
  }
}
