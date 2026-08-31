/**
 * Cliques and independent sets.
 *
 * Both invariants are NP-hard, so this module is careful about what it claims:
 *
 *  - Enumeration is Bron-Kerbosch with pivoting over `Uint32Array` bitsets.
 *  - The maximum clique itself comes from a Tomita-style branch and bound with
 *    a greedy-colouring bound, which prunes far harder than enumerating every
 *    maximal clique and then taking the largest.
 *  - Every search carries a step budget. A search that runs out of budget still
 *    holds a real clique, so its answer is returned as a `lower-bound` — never
 *    as a maximum.
 *  - Above {@link CLIQUE_EXACT_VERTEX_LIMIT} vertices no exhaustive search is
 *    attempted at all: a greedy clique is returned, again as a `lower-bound`.
 *
 * The maximum independent set is the maximum clique of the complement. The
 * complement's bitsets are built directly, so no second document is ever
 * constructed.
 *
 * Convention: a clique and an independent set are properties of the underlying
 * *simple undirected* graph. Direction is ignored, parallel edges count once,
 * and self-loops are ignored — a vertex with a self-loop is still a valid member
 * of a clique or of an independent set.
 */

import type { Graph } from '../model/graph'
import type { PropertyResult, VertexId } from '../model/types'
import { MinHeap } from './traversal'

/**
 * Above this order Graphualize does not attempt an exact clique search.
 *
 * Measured on this implementation (2-word bitsets at this size, colouring bound
 * on): the slowest random graph at 46 vertices was a dense G(46, 0.9) at 7ms,
 * and sparse graphs finish in well under a millisecond. The branch and bound
 * would in fact scale further — random graphs only became slow around 120
 * vertices, where a dense case took 1.1s — but the worst case is not random.
 * A Moon-Moser graph on 45 vertices has 3^15 ≈ 14 million maximal cliques, and
 * enumeration over it exhausts the step budget rather than finishing. 46 keeps
 * a wide margin on every family tested; past it the budget, not the clock, is
 * what protects the app, and the answer is downgraded to a lower bound.
 */
export const CLIQUE_EXACT_VERTEX_LIMIT = 46

/** Search nodes a maximum-clique branch and bound may visit before giving up. */
export const CLIQUE_STEP_BUDGET = 400_000

/** Recursive calls Bron-Kerbosch may make before it reports `complete: false`. */
export const MAXIMAL_CLIQUE_STEP_BUDGET = 200_000

/**
 * Bitsets cost n^2/8 bytes, so enumeration declines outright on huge graphs
 * rather than allocating hundreds of megabytes. This only guards the raw
 * enumerator; the reported invariants stop far earlier, at the limit above.
 */
const BITSET_VERTEX_LIMIT = 2048

/** How many vertex labels an explanation lists before it just gives a count. */
const MAX_NAMED = 8

/* ------------------------------------------------------------------ */
/* Bitsets                                                             */
/* ------------------------------------------------------------------ */

interface Bitsets {
  n: number
  /** 32-bit words per row. */
  words: number
  /** Row-major adjacency: bit j of row i is set when i and j are adjacent. */
  rows: Uint32Array
  ids: VertexId[]
}

const popcount32 = (value: number): number => {
  let x = value | 0
  x = x - ((x >>> 1) & 0x55555555)
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333)
  x = (x + (x >>> 4)) & 0x0f0f0f0f
  return Math.imul(x, 0x01010101) >>> 24
}

/** Index of the single set bit of a power of two. */
const bitIndex = (bit: number): number => 31 - Math.clz32(bit)

/**
 * Adjacency (or complement adjacency) as bitsets. Self-loops are dropped and
 * parallel edges collapse, which is exactly the clique convention.
 */
const buildBitsets = (g: Graph, complement: boolean): Bitsets => {
  const ids = g.vertexIds
  const n = ids.length
  const words = Math.max(1, (n + 31) >> 5)
  const rows = new Uint32Array(n * words)
  const index = new Map<VertexId, number>()
  ids.forEach((id, i) => index.set(id, i))

  for (const e of g.edges) {
    const a = index.get(e.source)
    const b = index.get(e.target)
    if (a === undefined || b === undefined || a === b) continue
    rows[a * words + (b >> 5)] |= 1 << (b & 31)
    rows[b * words + (a >> 5)] |= 1 << (a & 31)
  }

  if (complement) {
    const tail = n % 32 === 0 ? 0xffffffff : (1 << (n % 32)) - 1
    for (let i = 0; i < n; i++) {
      const base = i * words
      for (let w = 0; w < words; w++) rows[base + w] = ~rows[base + w]
      rows[base + words - 1] &= tail
      rows[base + (i >> 5)] &= ~(1 << (i & 31))
    }
  }

  return { n, words, rows, ids }
}

/* ------------------------------------------------------------------ */
/* Bron-Kerbosch with pivoting                                         */
/* ------------------------------------------------------------------ */

export interface MaximalCliqueResult {
  cliques: VertexId[][]
  /** False when the step budget ran out, i.e. the list is not exhaustive. */
  complete: boolean
}

/**
 * Every maximal clique, by Bron-Kerbosch with a pivot chosen to maximise
 * |P ∩ N(u)|. Vertices inside a clique come back in document order.
 *
 * Returns `complete: false` — with whatever was found so far — when the step
 * budget runs out, and `{ cliques: [], complete: false }` for a graph too large
 * to bitset at all.
 */
export const maximalCliques = (
  g: Graph,
  budget = MAXIMAL_CLIQUE_STEP_BUDGET,
): MaximalCliqueResult => {
  const n = g.order
  const cliques: VertexId[][] = []
  if (n === 0) return { cliques, complete: true }
  if (n > BITSET_VERTEX_LIMIT) return { cliques, complete: false }

  const bs = buildBitsets(g, false)
  const { words, rows, ids } = bs
  let steps = 0
  let complete = true
  const chosen: number[] = []
  const levelP: Uint32Array[] = []
  const levelX: Uint32Array[] = []
  for (let d = 0; d <= n; d++) {
    levelP.push(new Uint32Array(words))
    levelX.push(new Uint32Array(words))
  }

  const expand = (p: Uint32Array, x: Uint32Array, depth: number): void => {
    if (!complete) return
    if (++steps > budget) {
      complete = false
      return
    }

    let pEmpty = true
    let xEmpty = true
    for (let w = 0; w < words; w++) {
      if (p[w] !== 0) pEmpty = false
      if (x[w] !== 0) xEmpty = false
    }
    if (pEmpty) {
      if (xEmpty) cliques.push(chosen.slice().sort((a, b) => a - b).map((i) => ids[i]))
      return
    }

    // Pivot: the vertex of P ∪ X with the most neighbours inside P.
    let pivot = -1
    let pivotCount = -1
    for (let w = 0; w < words; w++) {
      let bits = (p[w] | x[w]) >>> 0
      while (bits !== 0) {
        const low = bits & -bits
        const v = (w << 5) + bitIndex(low >>> 0)
        bits = (bits ^ low) >>> 0
        let count = 0
        const base = v * words
        for (let k = 0; k < words; k++) count += popcount32(p[k] & rows[base + k])
        if (count > pivotCount) {
          pivotCount = count
          pivot = v
        }
      }
    }

    // Candidates: P minus the pivot's neighbourhood, in ascending index order.
    const pivotBase = pivot * words
    const candidates: number[] = []
    for (let w = 0; w < words; w++) {
      let bits = (p[w] & ~rows[pivotBase + w]) >>> 0
      while (bits !== 0) {
        const low = bits & -bits
        candidates.push((w << 5) + bitIndex(low >>> 0))
        bits = (bits ^ low) >>> 0
      }
    }

    const nextP = levelP[depth]
    const nextX = levelX[depth]
    for (const v of candidates) {
      const base = v * words
      for (let w = 0; w < words; w++) {
        nextP[w] = p[w] & rows[base + w]
        nextX[w] = x[w] & rows[base + w]
      }
      chosen.push(v)
      expand(nextP, nextX, depth + 1)
      chosen.pop()
      if (!complete) return
      p[v >> 5] &= ~(1 << (v & 31))
      x[v >> 5] |= 1 << (v & 31)
    }
  }

  const startP = new Uint32Array(words)
  const startX = new Uint32Array(words)
  for (let i = 0; i < n; i++) startP[i >> 5] |= 1 << (i & 31)
  expand(startP, startX, 0)
  return { cliques, complete }
}

/* ------------------------------------------------------------------ */
/* Maximum clique: branch and bound with a colouring bound             */
/* ------------------------------------------------------------------ */

interface CliqueSearch {
  /** Vertex indices of the best clique found. Always a genuine clique. */
  clique: number[]
  /** True when the search finished, i.e. the clique is provably maximum. */
  complete: boolean
}

/**
 * Tomita's MCQ. At every node the candidate set is greedily coloured; a
 * candidate whose colour number cannot lift the current clique above the
 * incumbent prunes the rest of the branch, because a k-coloured set contains no
 * clique larger than k.
 */
const searchMaximumClique = (bs: Bitsets, budget: number): CliqueSearch => {
  const { n, words, rows } = bs
  let best: number[] = []
  let complete = true
  let steps = 0
  const chosen: number[] = []
  const colourStore: Uint32Array[] = []

  const expand = (candidates: number[], depth: number): void => {
    if (!complete) return
    if (++steps > budget) {
      complete = false
      return
    }

    let store = colourStore[depth]
    if (store === undefined) {
      store = new Uint32Array(n * words)
      colourStore[depth] = store
    } else {
      store.fill(0)
    }

    // Greedy colouring of the candidates, keeping the incoming order.
    const buckets: number[][] = []
    for (const v of candidates) {
      const base = v * words
      let c = 0
      for (; c < buckets.length; c++) {
        let clash = 0
        const cb = c * words
        for (let w = 0; w < words; w++) clash |= store[cb + w] & rows[base + w]
        if (clash === 0) break
      }
      if (c === buckets.length) buckets.push([])
      store[c * words + (v >> 5)] |= 1 << (v & 31)
      buckets[c].push(v)
    }

    const order: number[] = []
    const colours: number[] = []
    for (let c = 0; c < buckets.length; c++) {
      for (const v of buckets[c]) {
        order.push(v)
        colours.push(c + 1)
      }
    }

    for (let i = order.length - 1; i >= 0; i--) {
      if (!complete) return
      if (chosen.length + colours[i] <= best.length) return
      const v = order[i]
      const base = v * words
      const next: number[] = []
      for (let j = 0; j < i; j++) {
        const u = order[j]
        if (((rows[base + (u >> 5)] >>> (u & 31)) & 1) === 1) next.push(u)
      }
      chosen.push(v)
      if (next.length === 0) {
        if (chosen.length > best.length) best = chosen.slice()
      } else {
        expand(next, depth + 1)
      }
      chosen.pop()
    }
  }

  const degree = new Array<number>(n).fill(0)
  for (let v = 0; v < n; v++) {
    const base = v * words
    let d = 0
    for (let w = 0; w < words; w++) d += popcount32(rows[base + w])
    degree[v] = d
  }
  const start = Array.from({ length: n }, (_, i) => i).sort(
    (a, b) => degree[b] - degree[a] || a - b,
  )
  if (n > 0) expand(start, 0)
  return { clique: best.slice().sort((a, b) => a - b), complete }
}

/* ------------------------------------------------------------------ */
/* Greedy fallbacks                                                    */
/* ------------------------------------------------------------------ */

/** Distinct neighbours in document order, self-loops dropped. */
const simpleAdjacency = (g: Graph): Map<VertexId, VertexId[]> => {
  const adj = new Map<VertexId, VertexId[]>()
  for (const id of g.vertexIds) {
    const set = new Set<VertexId>()
    for (const inc of g.neighbors(id)) if (inc.to !== id) set.add(inc.to)
    adj.set(id, [...set].sort((a, b) => g.index(a) - g.index(b)))
  }
  return adj
}

/**
 * A clique found by always extending with the highest-degree vertex still
 * adjacent to everything chosen. Deterministic, O(V + E), and always a genuine
 * clique — so its size is always a valid lower bound on the clique number.
 */
export const greedyClique = (g: Graph): VertexId[] => {
  const adj = simpleAdjacency(g)
  if (g.order === 0) return []
  const degree = (id: VertexId): number => (adj.get(id) ?? []).length
  const byDegree = (a: VertexId, b: VertexId): number =>
    degree(b) - degree(a) || g.index(a) - g.index(b)

  const first = g.vertexIds.slice().sort(byDegree)[0]
  const clique: VertexId[] = [first]
  let candidates = new Set(adj.get(first) ?? [])

  while (candidates.size > 0) {
    const next = [...candidates].sort(byDegree)[0]
    clique.push(next)
    const shared = new Set<VertexId>()
    for (const u of adj.get(next) ?? []) if (candidates.has(u)) shared.add(u)
    candidates = shared
  }
  return clique.sort((a, b) => g.index(a) - g.index(b))
}

/**
 * An independent set found by repeatedly taking a vertex of least remaining
 * degree and deleting its neighbours. Deterministic — ties go to the lowest
 * document index — and always a genuine independent set.
 *
 * Selection runs off a lazy-deletion min-heap keyed by `degree * n + index`, so
 * the whole thing is O((V + E) log V) rather than the O(V^2) that rescanning the
 * remaining vertices would cost on a large graph.
 */
export const greedyIndependentSet = (g: Graph): VertexId[] => {
  const adj = simpleAdjacency(g)
  const ids = g.vertexIds
  const n = ids.length
  const live = new Set<VertexId>(ids)
  const liveDegree = new Map<VertexId, number>()
  for (const id of ids) liveDegree.set(id, (adj.get(id) ?? []).length)
  const keyOf = (id: VertexId): number => liveDegree.get(id)! * n + g.index(id)

  const heap = new MinHeap<VertexId>()
  for (const id of ids) heap.push(keyOf(id), id)

  const drop = (id: VertexId): void => {
    if (!live.delete(id)) return
    for (const u of adj.get(id) ?? []) {
      if (!live.has(u)) continue
      liveDegree.set(u, liveDegree.get(u)! - 1)
      heap.push(keyOf(u), u)
    }
  }

  const chosen: VertexId[] = []
  while (live.size > 0) {
    const top = heap.pop()
    if (top === undefined) break
    const v = top.value
    if (!live.has(v) || top.key !== keyOf(v)) continue
    chosen.push(v)
    const neighbours = (adj.get(v) ?? []).filter((u) => live.has(u))
    drop(v)
    for (const u of neighbours) drop(u)
  }
  return chosen.sort((a, b) => g.index(a) - g.index(b))
}

/* ------------------------------------------------------------------ */
/* Reported invariants                                                 */
/* ------------------------------------------------------------------ */

const CONVENTION =
  'Cliques and independent sets are read off the underlying simple undirected graph: edge directions are ignored, parallel edges count once, and self-loops are ignored — a vertex with a self-loop can still belong to a clique or an independent set.'

const nameList = (g: Graph, ids: readonly VertexId[]): string =>
  ids.length <= MAX_NAMED
    ? g.labels(ids).join(', ')
    : `${g.labels(ids.slice(0, MAX_NAMED)).join(', ')}, … (${ids.length} in total)`

const overLimitNote = (g: Graph, what: string): string =>
  `This graph has ${g.order} vertices, and Graphualize runs the exact ${what} search only up to ${CLIQUE_EXACT_VERTEX_LIMIT}, because the search is exponential in the worst case.`

const BUDGET_NOTE =
  'The exhaustive search hit its step budget before it could finish, so this is the best set found, not a proven maximum.'

/**
 * The clique number, with a witness. Exact below the vertex limit and inside
 * the step budget; a `lower-bound` otherwise, never a claimed maximum.
 */
/**
 * One-entry memo. `chromaticNumber` uses the clique number as its lower bound,
 * so rendering the hard section would otherwise run this branch and bound twice
 * for the same graph.
 */
let cliqueMemo: { key: string; value: PropertyResult<VertexId[] | null> } | null = null

export const maximumClique = (g: Graph): PropertyResult<VertexId[] | null> => {
  const key = g.structureKey()
  if (cliqueMemo?.key === key) return cliqueMemo.value
  const value = computeMaximumClique(g)
  cliqueMemo = { key, value }
  return value
}

const computeMaximumClique = (g: Graph): PropertyResult<VertexId[] | null> => {
  const n = g.order
  if (n === 0) {
    return {
      value: [],
      display: '0',
      status: 'neutral',
      exactness: 'exact',
      explanation: 'An empty graph has no vertices, so its largest clique is empty.',
    }
  }

  if (n > CLIQUE_EXACT_VERTEX_LIMIT) {
    const clique = greedyClique(g)
    return {
      value: clique,
      display: `≥ ${clique.length}`,
      status: 'warning',
      exactness: 'lower-bound',
      explanation: `${overLimitNote(g, 'maximum clique')} The greedy clique shown has ${clique.length} ${clique.length === 1 ? 'vertex' : 'vertices'}, so the clique number is at least ${clique.length} — it may well be larger.`,
      detail: `Greedy clique: ${nameList(g, clique)}. ${CONVENTION}`,
      witness: {
        type: 'vertices',
        vertexIds: clique,
        caption: `Clique on ${clique.length} ${clique.length === 1 ? 'vertex' : 'vertices'} (lower bound)`,
      },
    }
  }

  const bs = buildBitsets(g, false)
  const { clique, complete } = searchMaximumClique(bs, CLIQUE_STEP_BUDGET)
  const vertexIds = clique.map((i) => bs.ids[i])
  const size = vertexIds.length

  if (!complete) {
    return {
      value: vertexIds,
      display: `≥ ${size}`,
      status: 'warning',
      exactness: 'lower-bound',
      explanation: `${BUDGET_NOTE} The clique shown has ${size} vertices, so the clique number is at least ${size}.`,
      detail: `Clique: ${nameList(g, vertexIds)}. ${CONVENTION}`,
      witness: {
        type: 'vertices',
        vertexIds,
        caption: `Clique on ${size} vertices (lower bound)`,
      },
    }
  }

  return {
    value: vertexIds,
    display: String(size),
    status: 'neutral',
    exactness: 'exact',
    explanation: `The largest set of pairwise adjacent vertices has ${size} ${size === 1 ? 'member' : 'members'}: ${nameList(g, vertexIds)}. A branch-and-bound search checked the whole graph, so no larger clique exists.`,
    detail: CONVENTION,
    witness: {
      type: 'vertices',
      vertexIds,
      caption: `Maximum clique on ${size} ${size === 1 ? 'vertex' : 'vertices'}`,
    },
  }
}

/**
 * The independence number, with a witness. Computed as a maximum clique of the
 * complement — the complement's bitsets are built directly, so no second
 * document is ever created.
 */
export const maximumIndependentSet = (g: Graph): PropertyResult<VertexId[] | null> => {
  const n = g.order
  if (n === 0) {
    return {
      value: [],
      display: '0',
      status: 'neutral',
      exactness: 'exact',
      explanation: 'An empty graph has no vertices, so its largest independent set is empty.',
    }
  }

  if (n > CLIQUE_EXACT_VERTEX_LIMIT) {
    const set = greedyIndependentSet(g)
    return {
      value: set,
      display: `≥ ${set.length}`,
      status: 'warning',
      exactness: 'lower-bound',
      explanation: `${overLimitNote(g, 'maximum independent set')} The greedy independent set shown has ${set.length} ${set.length === 1 ? 'vertex' : 'vertices'}, so the independence number is at least ${set.length} — it may well be larger.`,
      detail: `Greedy independent set: ${nameList(g, set)}. ${CONVENTION}`,
      witness: {
        type: 'vertices',
        vertexIds: set,
        caption: `Independent set of ${set.length} (lower bound)`,
      },
    }
  }

  const bs = buildBitsets(g, true)
  const { clique, complete } = searchMaximumClique(bs, CLIQUE_STEP_BUDGET)
  const vertexIds = clique.map((i) => bs.ids[i])
  const size = vertexIds.length
  const detail = `An independent set of G is a clique of the complement of G, so this is a maximum clique search run on the complement. ${CONVENTION}`

  if (!complete) {
    return {
      value: vertexIds,
      display: `≥ ${size}`,
      status: 'warning',
      exactness: 'lower-bound',
      explanation: `${BUDGET_NOTE} The set shown has ${size} vertices, no two adjacent, so the independence number is at least ${size}.`,
      detail: `Independent set: ${nameList(g, vertexIds)}. ${detail}`,
      witness: {
        type: 'vertices',
        vertexIds,
        caption: `Independent set of ${size} (lower bound)`,
      },
    }
  }

  return {
    value: vertexIds,
    display: String(size),
    status: 'neutral',
    exactness: 'exact',
    explanation: `The largest set of vertices with no edge between any two has ${size} ${size === 1 ? 'member' : 'members'}: ${nameList(g, vertexIds)}. A branch-and-bound search checked the whole complement, so no larger independent set exists.`,
    detail,
    witness: {
      type: 'vertices',
      vertexIds,
      caption: `Maximum independent set of ${size}`,
    },
  }
}
