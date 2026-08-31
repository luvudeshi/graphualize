import type { Graph } from '../model/graph'
import type { VertexId } from '../model/types'
import { analyzeBipartite } from './structure'
import { biconnectivity } from './connectivity'

export const PLANARITY_VERTEX_LIMIT = 150

export interface PlanarityResult {
  /** `null` when Graphualize declined to decide. */
  planar: boolean | null
  /** Plain-language justification, always populated. */
  reason: string
  method: 'trivial' | 'euler-bound' | 'path-addition' | 'not-computed'
}

/** A simple undirected adjacency structure, the only input Demoucron needs. */
interface SimpleGraph {
  vertices: VertexId[]
  edges: [VertexId, VertexId][]
  adj: Map<VertexId, Set<VertexId>>
}

const simplify = (
  vertices: VertexId[],
  rawEdges: readonly [VertexId, VertexId][],
): SimpleGraph => {
  const adj = new Map<VertexId, Set<VertexId>>()
  for (const v of vertices) adj.set(v, new Set())
  const edges: [VertexId, VertexId][] = []
  for (const [a, b] of rawEdges) {
    if (a === b) continue
    if (adj.get(a)?.has(b)) continue
    adj.get(a)!.add(b)
    adj.get(b)!.add(a)
    edges.push([a, b])
  }
  return { vertices, edges, adj }
}

const edgeKey = (a: VertexId, b: VertexId) => (a < b ? `${a}|${b}` : `${b}|${a}`)

const findCycleIn = (g: SimpleGraph): VertexId[] | null => {
  const parent = new Map<VertexId, VertexId>()
  const seen = new Set<VertexId>()
  for (const root of g.vertices) {
    if (seen.has(root)) continue
    seen.add(root)
    const stack = [root]
    while (stack.length) {
      const v = stack.pop()!
      for (const u of g.adj.get(v)!) {
        if (u === parent.get(v)) continue
        if (seen.has(u)) {
          // Reconstruct the cycle through the shared ancestor.
          const ancestors = new Set<VertexId>()
          let cursor: VertexId | undefined = v
          while (cursor !== undefined) {
            ancestors.add(cursor)
            cursor = parent.get(cursor)
          }
          let other: VertexId | undefined = u
          const tail: VertexId[] = []
          while (other !== undefined && !ancestors.has(other)) {
            tail.push(other)
            other = parent.get(other)
          }
          if (other === undefined) continue
          const head: VertexId[] = []
          let walk: VertexId = v
          while (walk !== other) {
            head.push(walk)
            walk = parent.get(walk)!
          }
          head.push(other)
          const cycle = [...head, ...tail.reverse()]
          if (cycle.length >= 3) return cycle
          continue
        }
        seen.add(u)
        parent.set(u, v)
        stack.push(u)
      }
    }
  }
  return null
}

/**
 * Demoucron's path-addition planarity test for a biconnected simple graph.
 * Returns true when a planar embedding was constructed, false when some
 * fragment had no admissible face (which is a genuine proof of non-planarity).
 */
const demoucron = (g: SimpleGraph): boolean => {
  if (g.vertices.length <= 4) return true
  const start = findCycleIn(g)
  if (!start) return true // acyclic: a forest is planar

  const embeddedVertices = new Set<VertexId>(start)
  const embeddedEdges = new Set<string>()
  for (let i = 0; i < start.length; i++) {
    embeddedEdges.add(edgeKey(start[i]!, start[(i + 1) % start.length]!))
  }
  let faces: VertexId[][] = [start.slice(), start.slice().reverse()]

  const remaining = () => g.edges.filter(([a, b]) => !embeddedEdges.has(edgeKey(a, b)))

  for (;;) {
    const rest = remaining()
    if (rest.length === 0) return true

    // Fragments: connected pieces of the un-embedded part, where embedded
    // vertices act as terminals rather than as connectors.
    const groupOf = new Map<number, number>()
    const find = (x: number): number => {
      let r = x
      while (groupOf.get(r) !== r) r = groupOf.get(r)!
      let c = x
      while (groupOf.get(c) !== r) {
        const nxt = groupOf.get(c)!
        groupOf.set(c, r)
        c = nxt
      }
      return r
    }
    rest.forEach((_, i) => groupOf.set(i, i))
    const byInnerVertex = new Map<VertexId, number[]>()
    rest.forEach(([a, b], i) => {
      for (const v of [a, b]) {
        if (embeddedVertices.has(v)) continue
        const bucket = byInnerVertex.get(v)
        if (bucket) bucket.push(i)
        else byInnerVertex.set(v, [i])
      }
    })
    for (const bucket of byInnerVertex.values()) {
      for (let i = 1; i < bucket.length; i++) {
        const ra = find(bucket[0]!)
        const rb = find(bucket[i]!)
        if (ra !== rb) groupOf.set(rb, ra)
      }
    }

    const fragments = new Map<number, number[]>()
    rest.forEach((_, i) => {
      const root = find(i)
      const bucket = fragments.get(root)
      if (bucket) bucket.push(i)
      else fragments.set(root, [i])
    })

    let chosen: { edges: number[]; face: VertexId[]; faceIndex: number } | null = null
    let chosenCount = Infinity

    for (const edgeIdxs of fragments.values()) {
      const contacts = new Set<VertexId>()
      for (const i of edgeIdxs) {
        const [a, b] = rest[i]!
        if (embeddedVertices.has(a)) contacts.add(a)
        if (embeddedVertices.has(b)) contacts.add(b)
      }
      let count = 0
      let firstFace: VertexId[] | null = null
      let firstIndex = -1
      faces.forEach((face, fi) => {
        const faceSet = new Set(face)
        for (const c of contacts) if (!faceSet.has(c)) return
        count += 1
        if (!firstFace) {
          firstFace = face
          firstIndex = fi
        }
      })
      if (count === 0) return false
      if (count < chosenCount) {
        chosenCount = count
        chosen = { edges: edgeIdxs, face: firstFace!, faceIndex: firstIndex }
        if (count === 1) break
      }
    }
    if (!chosen) return true

    // Find a path across the chosen fragment between two contact vertices.
    const fragAdj = new Map<VertexId, VertexId[]>()
    const touch = (v: VertexId) => {
      if (!fragAdj.has(v)) fragAdj.set(v, [])
      return fragAdj.get(v)!
    }
    for (const i of chosen.edges) {
      const [a, b] = rest[i]!
      touch(a).push(b)
      touch(b).push(a)
    }
    const contacts = [...fragAdj.keys()].filter((v) => embeddedVertices.has(v))
    const source = contacts[0]!
    const parent = new Map<VertexId, VertexId>()
    const queue = [source]
    const seen = new Set<VertexId>([source])
    let target: VertexId | null = null
    let head = 0
    while (head < queue.length && target === null) {
      const v = queue[head++]!
      // Never route *through* an already embedded vertex.
      if (v !== source && embeddedVertices.has(v)) continue
      for (const u of fragAdj.get(v)!) {
        if (seen.has(u)) continue
        seen.add(u)
        parent.set(u, v)
        if (embeddedVertices.has(u)) {
          target = u
          break
        }
        queue.push(u)
      }
    }
    if (target === null) return true // degenerate; nothing left to embed usefully

    const path: VertexId[] = [target]
    let cursor = target
    while (parent.has(cursor)) {
      cursor = parent.get(cursor)!
      path.unshift(cursor)
    }

    // Embed the path and split the chosen face along it.
    for (let i = 0; i + 1 < path.length; i++) {
      embeddedEdges.add(edgeKey(path[i]!, path[i + 1]!))
      embeddedVertices.add(path[i]!)
      embeddedVertices.add(path[i + 1]!)
    }
    const face = chosen.face
    const u = path[0]!
    const w = path[path.length - 1]!
    const iu = face.indexOf(u)
    const iw = face.indexOf(w)
    if (iu === -1 || iw === -1) return true
    const arc = (from: number, to: number) => {
      const out: VertexId[] = []
      let i = from
      for (;;) {
        out.push(face[i]!)
        if (i === to) break
        i = (i + 1) % face.length
      }
      return out
    }
    const interior = path.slice(1, -1)
    const faceA = [...arc(iu, iw), ...interior.slice().reverse()]
    const faceB = [...arc(iw, iu), ...interior]
    faces = faces.filter((_, i) => i !== chosen!.faceIndex)
    faces.push(faceA, faceB)
  }
}

/**
 * Planarity with an honest answer. Cheap Euler-bound certificates settle most
 * dense cases outright; everything else is decided by running Demoucron's
 * path-addition algorithm on each biconnected block.
 */
export const analyzePlanarity = (graph: Graph): PlanarityResult => {
  const n = graph.order
  if (n === 0) return { planar: true, reason: 'The empty graph is planar.', method: 'trivial' }
  if (n > PLANARITY_VERTEX_LIMIT) {
    return {
      planar: null,
      reason: `Planarity testing is disabled above ${PLANARITY_VERTEX_LIMIT} vertices.`,
      method: 'not-computed',
    }
  }

  // Loops and parallel edges never affect planarity of the underlying graph.
  const simple = simplify(
    graph.vertexIds,
    graph.edges.map((e) => [e.source, e.target] as [VertexId, VertexId]),
  )
  const m = simple.edges.length

  if (n <= 4 || m <= 8) {
    return {
      planar: true,
      reason:
        n <= 4
          ? 'Every graph on four or fewer vertices can be drawn without crossings.'
          : 'Every graph with at most 8 edges is planar; the smallest obstructions K5 and K3,3 need 10 and 9.',
      method: 'trivial',
    }
  }

  if (n >= 3 && m > 3 * n - 6) {
    return {
      planar: false,
      reason: `A simple planar graph on ${n} vertices has at most 3n - 6 = ${3 * n - 6} edges, and this one has ${m}.`,
      method: 'euler-bound',
    }
  }
  const { isBipartite } = analyzeBipartite(graph)
  if (isBipartite && n >= 3 && m > 2 * n - 4) {
    return {
      planar: false,
      reason: `A simple bipartite planar graph on ${n} vertices has at most 2n - 4 = ${2 * n - 4} edges, and this one has ${m}.`,
      method: 'euler-bound',
    }
  }

  // A graph is planar exactly when all of its blocks are.
  const { blocks } = biconnectivity(graph)
  const blockGroups: [VertexId, VertexId][][] = blocks.map((edgeIds) =>
    edgeIds
      .map((id) => graph.edge(id))
      .filter((e): e is NonNullable<typeof e> => Boolean(e))
      .map((e) => [e.source, e.target] as [VertexId, VertexId]),
  )
  const groups = blockGroups.length ? blockGroups : [simple.edges]

  for (const group of groups) {
    const verts = [...new Set(group.flat())]
    if (verts.length <= 4) continue
    const block = simplify(verts, group)
    if (block.edges.length > 3 * verts.length - 6) {
      return {
        planar: false,
        reason: `One biconnected block has ${verts.length} vertices and ${block.edges.length} edges, more than the planar maximum 3n - 6.`,
        method: 'euler-bound',
      }
    }
    if (!demoucron(block)) {
      return {
        planar: false,
        reason:
          'Path addition reached a fragment with no face it could be drawn in, so no planar embedding exists.',
        method: 'path-addition',
      }
    }
  }

  return {
    planar: true,
    reason: 'A planar embedding was constructed by path addition.',
    method: 'path-addition',
  }
}
