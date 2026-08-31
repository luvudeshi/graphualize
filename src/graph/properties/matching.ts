/**
 * Matchings.
 *
 * `maximumMatching` runs Edmonds' blossom algorithm, so it is exact on *any*
 * graph, not just bipartite ones. That matters: a naive augmenting-path search
 * silently under-reports on graphs with odd cycles, which is the sort of quiet
 * wrong answer Graphualize must never produce. When a bipartition is supplied,
 * `bipartiteMaximumMatching` uses Hopcroft-Karp instead, which is faster and
 * equally exact.
 *
 * Conventions, all forced by what a matching is:
 *  - A self-loop can never be in a matching. It would use its vertex twice.
 *  - Parallel edges collapse: only one edge of a parallel bundle is usable, and
 *    the one reported is the first in document order.
 *  - Direction is ignored. A matching is a property of the underlying
 *    undirected graph.
 */

import type { Graph } from '../model/graph'
import type { EdgeId, PropertyResult, VertexId } from '../model/types'
import { analyzeBipartite } from './structure'

export interface MatchingResult {
  edgeIds: EdgeId[]
  size: number
  /** Every vertex of the graph is matched. */
  isPerfect: boolean
  /** True only when the algorithm *proved* maximality. Greedy never sets it. */
  isMaximum: boolean
  method: 'blossom' | 'hopcroft-karp' | 'greedy'
}

/**
 * Above this order the blossom search is skipped.
 *
 * This is the O(V^3) formulation, and it is comfortably fast at the limit:
 * measured here, a dense random graph on 400 vertices (39,677 edges) takes 21ms,
 * a sparse one 8ms, and a chain of 133 triangles — the shape that forces the
 * most blossom contractions — 4ms. 400 vertices is also far above any graph
 * being edited by hand. Past the limit we show a greedy matching and say plainly
 * that the maximum was not computed.
 */
export const MATCHING_VERTEX_LIMIT = 400

/** How many unmatched vertices an explanation names before it just counts. */
const MAX_NAMED = 6

/* ------------------------------------------------------------------ */
/* Simple undirected view                                              */
/* ------------------------------------------------------------------ */

interface SimpleView {
  ids: VertexId[]
  /** Distinct neighbours by index, self-loops removed. */
  adj: number[][]
  /** First edge id (document order) joining a pair of distinct vertices. */
  edgeFor: (a: number, b: number) => EdgeId | undefined
}

const pairKey = (a: number, b: number): string => (a < b ? `${a}:${b}` : `${b}:${a}`)

const simpleView = (g: Graph): SimpleView => {
  const ids = g.vertexIds
  const index = new Map<VertexId, number>()
  ids.forEach((id, i) => index.set(id, i))
  const adj: number[][] = ids.map(() => [])
  const seen = new Map<string, EdgeId>()

  for (const e of g.edges) {
    const a = index.get(e.source)
    const b = index.get(e.target)
    if (a === undefined || b === undefined || a === b) continue
    const key = pairKey(a, b)
    if (seen.has(key)) continue
    seen.set(key, e.id)
    adj[a].push(b)
    adj[b].push(a)
  }

  return { ids, adj, edgeFor: (a, b) => seen.get(pairKey(a, b)) }
}

const resultFrom = (
  view: SimpleView,
  match: Int32Array,
  order: number,
  method: MatchingResult['method'],
  isMaximum: boolean,
): MatchingResult => {
  const edgeIds: EdgeId[] = []
  for (let v = 0; v < match.length; v++) {
    const u = match[v]
    if (u === -1 || u < v) continue
    const id = view.edgeFor(v, u)
    if (id !== undefined) edgeIds.push(id)
  }
  const size = edgeIds.length
  return { edgeIds, size, isPerfect: order > 0 && size * 2 === order, isMaximum, method }
}

/* ------------------------------------------------------------------ */
/* Greedy (maximal, not maximum)                                       */
/* ------------------------------------------------------------------ */

/**
 * A maximal matching: take edges in document order whenever both ends are still
 * free. Maximal means no edge can be added — it does *not* mean maximum, and
 * the result never claims otherwise. It is always at least half the maximum.
 */
export const maximalMatching = (g: Graph): MatchingResult => {
  const taken = new Set<VertexId>()
  const edgeIds: EdgeId[] = []
  for (const e of g.edges) {
    if (e.source === e.target) continue
    if (taken.has(e.source) || taken.has(e.target)) continue
    taken.add(e.source)
    taken.add(e.target)
    edgeIds.push(e.id)
  }
  const size = edgeIds.length
  return {
    edgeIds,
    size,
    isPerfect: g.order > 0 && size * 2 === g.order,
    isMaximum: false,
    method: 'greedy',
  }
}

/* ------------------------------------------------------------------ */
/* Edmonds' blossom algorithm                                          */
/* ------------------------------------------------------------------ */

/**
 * Maximum matching in a general graph, O(V^3).
 *
 * The whole difficulty is the odd cycle. When the alternating-tree search finds
 * an edge between two even vertices it has found a blossom: an odd cycle that
 * an augmenting path may enter and leave at the same vertex. The blossom is
 * contracted to its base (all its vertices share one `base` entry) and the
 * search continues in the contracted graph, which is exactly Edmonds'
 * insight — without it, a triangle with a pendant edge on each vertex reports a
 * matching of 2 when the answer is 3.
 *
 * Returns `match[v]` = the partner of v, or -1 when v is unmatched.
 */
const blossomMatching = (n: number, adj: readonly number[][]): Int32Array => {
  const match = new Int32Array(n).fill(-1)
  const parent = new Int32Array(n).fill(-1)
  const base = new Int32Array(n)
  const used = new Uint8Array(n)
  const inBlossom = new Uint8Array(n)
  const lcaSeen = new Uint8Array(n)
  const queue = new Int32Array(n)

  // A greedy start is free and cuts the number of augmentations sharply.
  for (let v = 0; v < n; v++) {
    if (match[v] !== -1) continue
    for (const u of adj[v]) {
      if (match[u] === -1) {
        match[v] = u
        match[u] = v
        break
      }
    }
  }

  /** Base of the lowest common ancestor of a and b in the alternating tree. */
  const lca = (a: number, b: number): number => {
    lcaSeen.fill(0)
    let v = a
    for (;;) {
      v = base[v]
      lcaSeen[v] = 1
      if (match[v] === -1) break
      v = parent[match[v]]
    }
    v = b
    for (;;) {
      v = base[v]
      if (lcaSeen[v] === 1) return v
      v = parent[match[v]]
    }
  }

  /** Walks from v up to the blossom base, flagging bases and adding tree links. */
  const markPath = (from: number, blossomBase: number, child: number): void => {
    let v = from
    let c = child
    while (base[v] !== blossomBase) {
      inBlossom[base[v]] = 1
      inBlossom[base[match[v]]] = 1
      parent[v] = c
      c = match[v]
      v = parent[match[v]]
    }
  }

  /** Grows an alternating tree from `root`; returns the far end of an augmenting path. */
  const findAugmentingPath = (root: number): number => {
    used.fill(0)
    parent.fill(-1)
    for (let i = 0; i < n; i++) base[i] = i
    used[root] = 1
    let head = 0
    let tail = 0
    queue[tail++] = root

    while (head < tail) {
      const v = queue[head++]
      for (const to of adj[v]) {
        if (base[v] === base[to] || match[v] === to) continue
        if (to === root || (match[to] !== -1 && parent[match[to]] !== -1)) {
          // Edge between two even vertices: contract the blossom.
          const blossomBase = lca(v, to)
          inBlossom.fill(0)
          markPath(v, blossomBase, to)
          markPath(to, blossomBase, v)
          for (let i = 0; i < n; i++) {
            if (inBlossom[base[i]] === 1) {
              base[i] = blossomBase
              if (used[i] === 0) {
                used[i] = 1
                queue[tail++] = i
              }
            }
          }
        } else if (parent[to] === -1) {
          parent[to] = v
          if (match[to] === -1) return to
          used[match[to]] = 1
          queue[tail++] = match[to]
        }
      }
    }
    return -1
  }

  for (let v = 0; v < n; v++) {
    if (match[v] !== -1) continue
    let u = findAugmentingPath(v)
    while (u !== -1) {
      const pv = parent[u]
      const ppv = match[pv]
      match[u] = pv
      match[pv] = u
      u = ppv
    }
  }
  return match
}

/* ------------------------------------------------------------------ */
/* Hopcroft-Karp                                                       */
/* ------------------------------------------------------------------ */

/**
 * Maximum matching across a supplied bipartition, O(E sqrt(V)).
 *
 * Vertices missing from the partition, and edges with both ends in the same
 * part, are ignored — the caller is asserting a bipartition, and Hopcroft-Karp
 * has nothing sensible to do with an edge that contradicts it.
 */
export const bipartiteMaximumMatching = (
  g: Graph,
  partition: [VertexId[], VertexId[]],
): MatchingResult => {
  const view = simpleView(g)
  const index = new Map<VertexId, number>()
  view.ids.forEach((id, i) => index.set(id, i))

  const leftOf = new Map<VertexId, number>()
  const rightOf = new Map<VertexId, number>()
  partition[0].forEach((id) => {
    if (index.has(id) && !leftOf.has(id)) leftOf.set(id, leftOf.size)
  })
  partition[1].forEach((id) => {
    if (index.has(id) && !leftOf.has(id) && !rightOf.has(id)) rightOf.set(id, rightOf.size)
  })

  const nL = leftOf.size
  const nR = rightOf.size
  const adjL: number[][] = Array.from({ length: nL }, () => [])
  const leftVertex = new Array<number>(nL)
  const rightVertex = new Array<number>(nR)
  for (const [id, i] of leftOf) leftVertex[i] = index.get(id)!
  for (const [id, i] of rightOf) rightVertex[i] = index.get(id)!

  for (const [id, i] of leftOf) {
    const v = index.get(id)!
    for (const u of view.adj[v]) {
      const r = rightOf.get(view.ids[u])
      if (r !== undefined) adjL[i].push(r)
    }
  }

  const INF = Number.MAX_SAFE_INTEGER
  const pairL = new Int32Array(nL).fill(-1)
  const pairR = new Int32Array(nR).fill(-1)
  const dist = new Array<number>(nL).fill(INF)
  const queue = new Int32Array(nL)

  const bfs = (): boolean => {
    let head = 0
    let tail = 0
    for (let i = 0; i < nL; i++) {
      if (pairL[i] === -1) {
        dist[i] = 0
        queue[tail++] = i
      } else {
        dist[i] = INF
      }
    }
    let found = false
    while (head < tail) {
      const u = queue[head++]
      for (const v of adjL[u]) {
        const w = pairR[v]
        if (w === -1) found = true
        else if (dist[w] === INF) {
          dist[w] = dist[u] + 1
          queue[tail++] = w
        }
      }
    }
    return found
  }

  const dfs = (u: number): boolean => {
    for (const v of adjL[u]) {
      const w = pairR[v]
      if (w === -1 || (dist[w] === dist[u] + 1 && dfs(w))) {
        pairL[u] = v
        pairR[v] = u
        return true
      }
    }
    dist[u] = INF
    return false
  }

  while (bfs()) {
    for (let i = 0; i < nL; i++) if (pairL[i] === -1) dfs(i)
  }

  const match = new Int32Array(view.ids.length).fill(-1)
  for (let i = 0; i < nL; i++) {
    if (pairL[i] === -1) continue
    const a = leftVertex[i]
    const b = rightVertex[pairL[i]]
    match[a] = b
    match[b] = a
  }
  return resultFrom(view, match, g.order, 'hopcroft-karp', true)
}

/* ------------------------------------------------------------------ */
/* The reported invariant                                              */
/* ------------------------------------------------------------------ */

const unmatchedVertices = (g: Graph, edgeIds: readonly EdgeId[]): VertexId[] => {
  const matched = new Set<VertexId>()
  for (const id of edgeIds) {
    const e = g.edge(id)
    if (!e) continue
    matched.add(e.source)
    matched.add(e.target)
  }
  return g.vertexIds.filter((id) => !matched.has(id))
}

const describeCover = (g: Graph, result: MatchingResult): string => {
  const missing = unmatchedVertices(g, result.edgeIds)
  if (missing.length === 0) {
    return `It is a perfect matching: all ${g.order} vertices are matched.`
  }
  const names =
    missing.length <= MAX_NAMED
      ? `${missing.length === 1 ? 'vertex' : 'vertices'} ${g.labels(missing).join(', ')}`
      : `${missing.length} vertices`
  if (missing.length === 1 && g.order % 2 === 1) {
    return `The graph has an odd number of vertices, so no matching can be perfect; this one is near-perfect, leaving only ${names} unmatched.`
  }
  return `It leaves ${names} unmatched.`
}

/**
 * The maximum matching. Exact via Edmonds' blossom algorithm on any graph up to
 * {@link MATCHING_VERTEX_LIMIT} vertices; above that the search is not run at
 * all and the greedy maximal matching is shown as a floor, clearly labelled.
 */
export const maximumMatching = (g: Graph): PropertyResult<MatchingResult> => {
  const n = g.order
  const loops = g.selfLoops().length
  const loopNote =
    loops > 0
      ? ` ${loops === 1 ? 'One self-loop was' : `${loops} self-loops were`} ignored: a loop would use its vertex twice, so it can never be in a matching.`
      : ''
  const parallelNote =
    g.parallelEdgeGroups().length > 0
      ? ' Parallel edges collapse to one usable edge; the first in document order is the one reported.'
      : ''
  const directedNote = g.directed
    ? ' Edge directions are ignored — a matching is a property of the underlying undirected graph.'
    : ''

  if (n === 0) {
    return {
      value: { edgeIds: [], size: 0, isPerfect: false, isMaximum: true, method: 'blossom' },
      display: '0',
      status: 'neutral',
      exactness: 'exact',
      explanation: 'An empty graph has no edges, so its maximum matching is empty.',
    }
  }

  if (n > MATCHING_VERTEX_LIMIT) {
    const greedy = maximalMatching(g)
    return {
      value: greedy,
      display: `Not computed (> ${MATCHING_VERTEX_LIMIT} vertices)`,
      status: 'warning',
      exactness: 'not-computed',
      explanation: `Graphualize runs Edmonds' blossom algorithm only up to ${MATCHING_VERTEX_LIMIT} vertices, and this graph has ${n}. The maximum matching was not computed. The greedy maximal matching shown has ${greedy.size} ${greedy.size === 1 ? 'edge' : 'edges'}, which is a floor: a maximal matching is always at least half the maximum, so the maximum is between ${greedy.size} and ${2 * greedy.size}.`,
      detail: `Greedy maximal matching, ${greedy.size} ${greedy.size === 1 ? 'edge' : 'edges'}.${loopNote}${parallelNote}${directedNote}`,
      witness: {
        type: 'matching',
        edgeIds: greedy.edgeIds,
        caption: `Maximal matching, ${greedy.size} ${greedy.size === 1 ? 'edge' : 'edges'} (not proved maximum)`,
      },
    }
  }

  // Hopcroft-Karp is the faster exact algorithm when a bipartition exists;
  // blossom is what makes odd cycles come out right everywhere else.
  const bipartite = analyzeBipartite(g)
  let result: MatchingResult
  if (bipartite.isBipartite && bipartite.partition) {
    result = bipartiteMaximumMatching(g, bipartite.partition)
  } else {
    const view = simpleView(g)
    result = resultFrom(view, blossomMatching(view.ids.length, view.adj), n, 'blossom', true)
  }
  const cover = describeCover(g, result)
  const method =
    result.method === 'hopcroft-karp'
      ? 'Computed with Hopcroft-Karp, the faster exact algorithm for bipartite graphs.'
      : "Computed with Edmonds' blossom algorithm, which handles odd cycles correctly and is exact for every graph, not only bipartite ones."

  return {
    value: result,
    display: result.isPerfect ? `${result.size} (perfect)` : String(result.size),
    status: result.isPerfect ? 'success' : 'neutral',
    exactness: 'exact',
    explanation: `The largest set of edges with no two sharing a vertex has ${result.size} ${result.size === 1 ? 'edge' : 'edges'}. ${cover}`,
    detail: `${method}${loopNote}${parallelNote}${directedNote}`,
    witness: {
      type: 'matching',
      edgeIds: result.edgeIds,
      caption: result.isPerfect
        ? `Perfect matching, ${result.size} edges`
        : `Maximum matching, ${result.size} ${result.size === 1 ? 'edge' : 'edges'}`,
    },
  }
}
