/**
 * Vertex colouring: four greedy orderings, and an exact chromatic number on
 * graphs small enough to search.
 *
 * The honesty rules that matter here:
 *
 *  - A greedy colouring is an *upper* bound on the chromatic number and is
 *    never presented as the answer on its own.
 *  - The lower bound is always backed by a reason a reader can check: a clique
 *    that has to get distinct colours, an odd cycle that cannot be 2-coloured,
 *    or simply an edge.
 *  - When the exact search is skipped or runs out of budget, the result is
 *    reported as an interval like `3-5` with `exactness: 'bounded'`, and the
 *    explanation names why the search did not run.
 *  - A graph with a self-loop has *no* proper colouring at all. That is said
 *    plainly rather than silently ignored.
 *
 * `colors[v]` is a 0-based palette index, matching the renderer; user-facing
 * prose counts colours from 1.
 */

import type { Graph } from '../model/graph'
import type { PropertyResult, PropertyStatus, VertexId } from '../model/types'
import { maximumClique } from './cliques'
import { MinHeap } from './traversal'

export type ColoringOrdering = 'document' | 'largest-first' | 'smallest-last' | 'dsatur'

export interface Coloring {
  /** Vertex -> 0-based colour index. */
  colors: Record<VertexId, number>
  /** Number of distinct colours used. */
  count: number
  ordering: ColoringOrdering
}

export interface ChromaticResult {
  lower: number
  upper: number
  /** True only when `lower === upper` was *proved*, not guessed. */
  exact: boolean
  /** The best colouring found, using `upper` colours. Null when none exists. */
  coloring: Coloring | null
  /** Why the lower bound holds, e.g. 'the graph contains a triangle'. */
  lowerReason: string
}

/**
 * Above this order the exact chromatic search is skipped entirely.
 *
 * Measured on this implementation (DSATUR branch and bound, seeded with a
 * maximum clique, colour-permutation symmetry broken): at 24 vertices the whole
 * pipeline — four greedy orderings, the clique bound and the search — stayed
 * under 8ms on every family tried, random and planted-colouring alike. The cost
 * is still exponential, and the graphs that show it are the triangle-free ones,
 * where the clique bound says nothing: the Mycielskian of the Grötzsch graph
 * (23 vertices, chromatic number 5) takes about 5ms, and one more Mycielski step
 * (47 vertices, chromatic number 6) takes about 200ms and millions of search
 * nodes. 24 is the conservative line where the search is reliably instant; past
 * it the answer is an interval instead.
 */
export const CHROMATIC_EXACT_VERTEX_LIMIT = 24

/**
 * Total search nodes across all k-colourability tests for one graph. Budget
 * exhaustion is not a failure: it downgrades the answer to an interval.
 */
export const CHROMATIC_STEP_BUDGET = 400_000

const ORDERING_NAMES: Record<ColoringOrdering, string> = {
  document: 'document order',
  'largest-first': 'largest first',
  'smallest-last': 'smallest last',
  dsatur: 'DSATUR',
}

/** Tried in this order, so ties in colour count prefer the stronger ordering. */
const ORDERINGS: ColoringOrdering[] = ['dsatur', 'smallest-last', 'largest-first', 'document']

/* ------------------------------------------------------------------ */
/* Adjacency                                                           */
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

/* ------------------------------------------------------------------ */
/* Orderings                                                           */
/* ------------------------------------------------------------------ */

/**
 * Degeneracy order: strip a vertex of least remaining degree over and over,
 * then colour in the reverse of the removal order. Ties by document index, so
 * the order is deterministic.
 *
 * The selection runs off a lazy-deletion min-heap keyed by
 * `degree * n + index`, which encodes "least degree, then least index" in one
 * number and keeps the whole ordering at O((V + E) log V) instead of the O(V^2)
 * a rescan of the remaining vertices would cost.
 */
const smallestLastOrder = (g: Graph, adj: Map<VertexId, VertexId[]>): VertexId[] => {
  const ids = g.vertexIds
  const n = ids.length
  const degree = new Map<VertexId, number>()
  for (const id of ids) degree.set(id, (adj.get(id) ?? []).length)
  const keyOf = (id: VertexId): number => degree.get(id)! * n + g.index(id)

  const heap = new MinHeap<VertexId>()
  for (const id of ids) heap.push(keyOf(id), id)

  const removed = new Set<VertexId>()
  const removal: VertexId[] = []
  while (removal.length < n) {
    const top = heap.pop()
    if (top === undefined) break
    const v = top.value
    // Skip vertices already taken, and entries left behind by a degree drop.
    if (removed.has(v) || top.key !== keyOf(v)) continue
    removed.add(v)
    removal.push(v)
    for (const u of adj.get(v) ?? []) {
      if (removed.has(u)) continue
      degree.set(u, degree.get(u)! - 1)
      heap.push(keyOf(u), u)
    }
  }
  return removal.reverse()
}

const largestFirstOrder = (g: Graph, adj: Map<VertexId, VertexId[]>): VertexId[] =>
  g.vertexIds
    .slice()
    .sort(
      (a, b) =>
        (adj.get(b) ?? []).length - (adj.get(a) ?? []).length || g.index(a) - g.index(b),
    )

/** Smallest colour index not used by an already-coloured neighbour. */
const smallestFreeColor = (
  neighbors: readonly VertexId[],
  colors: Record<VertexId, number>,
): number => {
  const used = new Set<number>()
  for (const u of neighbors) {
    const c = colors[u]
    if (c !== undefined) used.add(c)
  }
  let c = 0
  while (used.has(c)) c++
  return c
}

const colorInOrder = (
  order: readonly VertexId[],
  adj: Map<VertexId, VertexId[]>,
  ordering: ColoringOrdering,
): Coloring => {
  const colors: Record<VertexId, number> = {}
  let count = 0
  for (const v of order) {
    const c = smallestFreeColor(adj.get(v) ?? [], colors)
    colors[v] = c
    if (c + 1 > count) count = c + 1
  }
  return { colors, count, ordering }
}

/**
 * DSATUR: always colour the uncoloured vertex whose neighbours already show the
 * most distinct colours, breaking ties by degree and then by document index.
 * The order is discovered as the colouring proceeds, so it cannot be produced
 * up front like the other three.
 */
const dsaturColoring = (g: Graph, adj: Map<VertexId, VertexId[]>): Coloring => {
  const ids = g.vertexIds
  const n = ids.length
  const colors: Record<VertexId, number> = {}
  if (n === 0) return { colors, count: 0, ordering: 'dsatur' }

  const saturation = new Map<VertexId, Set<number>>()
  const degree = new Map<VertexId, number>()
  for (const id of ids) {
    saturation.set(id, new Set())
    degree.set(id, (adj.get(id) ?? []).length)
  }

  /**
   * One number encoding "most saturated, then highest degree, then lowest
   * index", so the choice is a heap pop rather than a scan of every uncoloured
   * vertex. Exact in a double for any graph this side of 200,000 vertices, and
   * a graph past that would only lose the tie-break, never properness.
   */
  const keyOf = (id: VertexId): number =>
    (n - saturation.get(id)!.size) * n * n + (n - degree.get(id)!) * n + g.index(id)

  const heap = new MinHeap<VertexId>()
  for (const id of ids) heap.push(keyOf(id), id)

  let count = 0
  let colored = 0
  while (colored < n) {
    const top = heap.pop()
    if (top === undefined) break
    const v = top.value
    // Skip vertices already coloured, and entries left behind by a saturation rise.
    if (colors[v] !== undefined || top.key !== keyOf(v)) continue

    const used = saturation.get(v)!
    let c = 0
    while (used.has(c)) c++
    colors[v] = c
    colored++
    if (c + 1 > count) count = c + 1

    for (const u of adj.get(v) ?? []) {
      if (colors[u] !== undefined) continue
      const sat = saturation.get(u)!
      if (sat.has(c)) continue
      sat.add(c)
      heap.push(keyOf(u), u)
    }
  }
  return { colors, count, ordering: 'dsatur' }
}

/**
 * Greedy colouring in one of four orderings. The rule never changes — take the
 * smallest colour no coloured neighbour uses — so the ordering is the whole
 * story. Deterministic for a given document.
 *
 * Self-loops are skipped, which means a graph with a self-loop gets a colouring
 * back that is *not* proper; {@link chromaticNumber} handles that case up front.
 */
export const greedyColoring = (g: Graph, ordering: ColoringOrdering = 'dsatur'): Coloring => {
  const adj = simpleAdjacency(g)
  if (ordering === 'dsatur') return dsaturColoring(g, adj)
  if (ordering === 'largest-first') {
    return colorInOrder(largestFirstOrder(g, adj), adj, ordering)
  }
  if (ordering === 'smallest-last') {
    return colorInOrder(smallestLastOrder(g, adj), adj, ordering)
  }
  return colorInOrder(g.vertexIds, adj, ordering)
}

/**
 * Whether `colors` really is a proper colouring: every vertex coloured, and no
 * edge joining two vertices of the same colour. A self-loop always fails, which
 * is the right answer — a loop makes a graph uncolourable.
 */
export const isProperColoring = (g: Graph, colors: Record<VertexId, number>): boolean => {
  for (const id of g.vertexIds) {
    const c = colors[id]
    if (typeof c !== 'number' || !Number.isFinite(c)) return false
  }
  for (const e of g.edges) {
    if (colors[e.source] === colors[e.target]) return false
  }
  return true
}

/* ------------------------------------------------------------------ */
/* Exact search                                                        */
/* ------------------------------------------------------------------ */

interface KColorAttempt {
  /** Colour per vertex index, or null when no k-colouring exists. */
  colors: Int32Array | null
  /** True when the budget ran out, i.e. the "no" is not proved. */
  exhausted: boolean
  steps: number
}

/**
 * DSATUR-style branch and bound for "can this graph be coloured with k
 * colours?".
 *
 * Two things make it fast enough to be worth running:
 *  - Colour permutation symmetry is broken by only ever allowing a vertex the
 *    colours already in use plus one new one.
 *  - A known clique is pre-coloured with distinct colours, which fixes a large
 *    part of the search up front for free.
 */
const tryKColoring = (
  adj: readonly number[][],
  degree: readonly number[],
  n: number,
  k: number,
  seed: readonly number[],
  budget: number,
): KColorAttempt => {
  if (k <= 0) return { colors: n === 0 ? new Int32Array(0) : null, exhausted: false, steps: 0 }
  if (seed.length > k) return { colors: null, exhausted: false, steps: 0 }

  const colors = new Int32Array(n).fill(-1)
  const counts = new Int32Array(n * k)
  const saturation = new Int32Array(n)
  let steps = 0
  let exhausted = false

  const assign = (v: number, c: number): void => {
    colors[v] = c
    for (const u of adj[v]) {
      if (counts[u * k + c]++ === 0) saturation[u]++
    }
  }
  const unassign = (v: number, c: number): void => {
    colors[v] = -1
    for (const u of adj[v]) {
      if (--counts[u * k + c] === 0) saturation[u]--
    }
  }

  const search = (colored: number, maxUsed: number): boolean => {
    if (colored === n) return true
    if (++steps > budget) {
      exhausted = true
      return false
    }

    let v = -1
    for (let i = 0; i < n; i++) {
      if (colors[i] !== -1) continue
      if (
        v === -1 ||
        saturation[i] > saturation[v] ||
        (saturation[i] === saturation[v] && degree[i] > degree[v])
      ) {
        v = i
      }
    }
    if (v === -1) return true

    const limit = Math.min(k - 1, maxUsed + 1)
    for (let c = 0; c <= limit; c++) {
      if (counts[v * k + c] > 0) continue
      assign(v, c)
      if (search(colored + 1, c > maxUsed ? c : maxUsed)) return true
      unassign(v, c)
      if (exhausted) return false
    }
    return false
  }

  for (let i = 0; i < seed.length; i++) assign(seed[i], i)
  const ok = search(seed.length, seed.length - 1)
  return { colors: ok ? colors : null, exhausted, steps }
}

/* ------------------------------------------------------------------ */
/* Chromatic polynomial (small graphs only)                            */
/* ------------------------------------------------------------------ */

export interface ChromaticPolynomial {
  /** `coefficients[i]` multiplies k^i, so index 0 is the constant term. */
  coefficients: bigint[]
  degree: number
  /** Readable form, e.g. 'k^3 - 3k^2 + 2k'. */
  text: string
}

/**
 * Above this order the chromatic polynomial is not computed.
 *
 * The method is a subset dynamic program over independent sets, which walks
 * every (subset, sub-subset) pair: 3^n work, plus a 2^n table per part count.
 * Measured on the worst case — an edgeless graph, where every subset counts —
 * 12 vertices takes 4ms and 11 takes under 2ms. Each extra vertex roughly
 * triples that, so 16 vertices would already be near a second.
 */
export const CHROMATIC_POLYNOMIAL_VERTEX_LIMIT = 12

/**
 * Partitions of the vertex set into exactly j non-empty independent sets, for
 * every j. Counting each partition once (rather than j! times) comes from
 * insisting that the part being chosen contains the lowest-numbered vertex left.
 */
const independentPartitionCounts = (n: number, adjMask: Int32Array): number[] => {
  const size = 1 << n
  const full = size - 1
  const independent = new Uint8Array(size)
  independent[0] = 1
  for (let s = 1; s < size; s++) {
    const low = s & -s
    const v = 31 - Math.clz32(low)
    const rest = s ^ low
    independent[s] = independent[rest] === 1 && (adjMask[v] & rest) === 0 ? 1 : 0
  }

  let previous = new Float64Array(size)
  previous[0] = 1
  const counts = new Array<number>(n + 1).fill(0)
  counts[0] = n === 0 ? 1 : 0

  for (let j = 1; j <= n; j++) {
    const current = new Float64Array(size)
    for (let s = 1; s < size; s++) {
      const low = s & -s
      const rest = s ^ low
      let total = 0
      let sub = rest
      for (;;) {
        const part = low | sub
        if (independent[part] === 1) total += previous[s ^ part]
        if (sub === 0) break
        sub = (sub - 1) & rest
      }
      current[s] = total
    }
    counts[j] = current[full]
    previous = current
  }
  return counts
}

/** Multiplies a polynomial by (k + c). */
const timesLinear = (poly: readonly bigint[], c: bigint): bigint[] => {
  const out = new Array<bigint>(poly.length + 1).fill(0n)
  for (let i = 0; i < poly.length; i++) {
    out[i + 1] += poly[i]
    out[i] += c * poly[i]
  }
  return out
}

const polynomialText = (coefficients: readonly bigint[]): string => {
  const parts: string[] = []
  for (let i = coefficients.length - 1; i >= 0; i--) {
    const c = coefficients[i]
    if (c === 0n) continue
    const magnitude = c < 0n ? -c : c
    const sign = c < 0n ? '-' : '+'
    const number = magnitude === 1n && i > 0 ? '' : magnitude.toString()
    const power = i === 0 ? '' : i === 1 ? 'k' : `k^${i}`
    const term = `${number}${power}`
    parts.push(parts.length === 0 ? (c < 0n ? `-${term}` : term) : ` ${sign} ${term}`)
  }
  return parts.length > 0 ? parts.join('') : '0'
}

/**
 * The chromatic polynomial P(G, k): the number of proper colourings of G with k
 * colours, as an exact integer polynomial in k.
 *
 * Returns null above {@link CHROMATIC_POLYNOMIAL_VERTEX_LIMIT} vertices rather
 * than an approximation — there is no such thing as an approximate polynomial
 * here, and a wrong one would be worse than none.
 *
 * A graph with a self-loop has no proper colouring for any k, so its chromatic
 * polynomial is identically zero. That is not a failure, it is the answer.
 */
export const chromaticPolynomialSmall = (g: Graph): ChromaticPolynomial | null => {
  const n = g.order
  if (n > CHROMATIC_POLYNOMIAL_VERTEX_LIMIT) return null
  if (g.selfLoops().length > 0) return { coefficients: [0n], degree: 0, text: '0' }
  if (n === 0) return { coefficients: [1n], degree: 0, text: '1' }

  const ids = g.vertexIds
  const index = new Map(ids.map((id, i) => [id, i] as const))
  const adjMask = new Int32Array(n)
  for (const e of g.edges) {
    const a = index.get(e.source)
    const b = index.get(e.target)
    if (a === undefined || b === undefined || a === b) continue
    adjMask[a] |= 1 << b
    adjMask[b] |= 1 << a
  }

  // P(G, k) = sum over j of (partitions into j independent sets) * k falling j.
  const counts = independentPartitionCounts(n, adjMask)
  const coefficients = new Array<bigint>(n + 1).fill(0n)
  let falling: bigint[] = [1n]
  for (let j = 0; j <= n; j++) {
    if (j > 0) falling = timesLinear(falling, BigInt(-(j - 1)))
    if (counts[j] === 0) continue
    const multiplier = BigInt(counts[j])
    for (let i = 0; i < falling.length; i++) coefficients[i] += multiplier * falling[i]
  }

  let degree = coefficients.length - 1
  while (degree > 0 && coefficients[degree] === 0n) degree--
  const trimmed = coefficients.slice(0, degree + 1)
  return { coefficients: trimmed, degree, text: polynomialText(trimmed) }
}

/** P(G, k) at a specific k, exactly. */
export const evaluateChromaticPolynomial = (
  polynomial: ChromaticPolynomial,
  k: number,
): bigint => {
  const x = BigInt(k)
  let total = 0n
  for (let i = polynomial.coefficients.length - 1; i >= 0; i--) {
    total = total * x + polynomial.coefficients[i]
  }
  return total
}

/* ------------------------------------------------------------------ */
/* Bipartiteness (the odd cycle certificate)                           */
/* ------------------------------------------------------------------ */

/** True when the graph can be 2-coloured; false means an odd cycle exists. */
const isBipartite = (g: Graph, adj: Map<VertexId, VertexId[]>): boolean => {
  const side = new Map<VertexId, number>()
  for (const start of g.vertexIds) {
    if (side.has(start)) continue
    side.set(start, 0)
    const queue: VertexId[] = [start]
    let head = 0
    while (head < queue.length) {
      const v = queue[head++]
      const s = side.get(v)!
      for (const u of adj.get(v) ?? []) {
        const existing = side.get(u)
        if (existing === undefined) {
          side.set(u, 1 - s)
          queue.push(u)
        } else if (existing === s) {
          return false
        }
      }
    }
  }
  return true
}

/* ------------------------------------------------------------------ */
/* The reported invariant                                              */
/* ------------------------------------------------------------------ */

const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many)

const buildResult = (
  value: ChromaticResult,
  display: string,
  status: PropertyStatus,
  explanation: string,
  detail: string,
  exact: boolean,
): PropertyResult<ChromaticResult> => ({
  value,
  display,
  status,
  explanation,
  detail,
  exactness: exact ? 'exact' : 'bounded',
  witness: value.coloring
    ? { type: 'coloring', colors: value.coloring.colors, count: value.coloring.count }
    : undefined,
})

/**
 * The chromatic number: exact when the graph is small enough to prove it,
 * an honest interval otherwise.
 */
export const chromaticNumber = (g: Graph): PropertyResult<ChromaticResult> => {
  const n = g.order
  const loops = g.selfLoops()

  if (loops.length > 0) {
    const looped = [...new Set(g.edges.filter((e) => e.source === e.target).map((e) => e.source))]
    return {
      value: { lower: Infinity, upper: Infinity, exact: true, coloring: null, lowerReason: 'a self-loop cannot be coloured' },
      display: 'Undefined (self-loop)',
      status: 'danger',
      exactness: 'not-applicable',
      explanation: `${g.labels(looped).join(', ')} ${plural(looped.length, 'has a self-loop', 'have self-loops')}. A self-loop joins a vertex to itself, so that vertex would need a colour different from its own — no proper colouring exists, and the chromatic number is undefined.`,
      detail:
        'Delete the self-loop to colour the graph. Every other invariant on this panel that treats the graph as simple ignores self-loops instead; colouring cannot, because the loop is exactly what makes the graph uncolourable.',
    }
  }

  if (n === 0) {
    const coloring: Coloring = { colors: {}, count: 0, ordering: 'document' }
    return buildResult(
      { lower: 0, upper: 0, exact: true, coloring, lowerReason: 'there are no vertices to colour' },
      '0',
      'neutral',
      'An empty graph has no vertices to colour, so its chromatic number is 0.',
      '',
      true,
    )
  }

  const adj = simpleAdjacency(g)

  // Upper bound: the best of the four greedy orderings.
  const attempts = ORDERINGS.map((ordering) => greedyColoring(g, ordering))
  let best = attempts[0]
  for (const attempt of attempts) if (attempt.count < best.count) best = attempt
  const upper = best.count
  const greedyDetail = `Greedy colour counts — ${ORDERINGS.map(
    (o, i) => `${ORDERING_NAMES[o]}: ${attempts[i].count}`,
  ).join(', ')}.`

  if (g.size === 0) {
    return buildResult(
      { lower: 1, upper: 1, exact: true, coloring: best, lowerReason: 'the graph has at least one vertex' },
      '1',
      'neutral',
      `This graph has no edges, so one colour is enough for all ${n} ${plural(n, 'vertex', 'vertices')}, and one colour is needed because there is at least one vertex.`,
      greedyDetail,
      true,
    )
  }

  // Lower bound: the strongest reason we can actually certify. There is at
  // least one edge here (self-loops returned above), so 2 is the floor.
  let lower = 2
  let lowerReason = 'the graph has an edge, whose two ends need different colours'

  if (!isBipartite(g, adj)) {
    lower = 3
    lowerReason = 'the graph contains an odd cycle, which cannot be 2-coloured'
  }

  const cliqueResult = maximumClique(g)
  const clique = cliqueResult.value ?? []
  if (clique.length >= 3 && clique.length >= lower) {
    lower = clique.length
    lowerReason =
      clique.length === 3
        ? 'the graph contains a triangle'
        : `the graph contains a clique on ${clique.length} vertices`
  }

  // An edge is a 2-clique and says nothing beyond "there is an edge", so only a
  // triangle or bigger is worth naming.
  const cliqueNote =
    clique.length >= 3
      ? ` The largest clique found has ${clique.length} vertices: ${g.labels(clique).join(', ')}.`
      : ''

  if (lower === upper) {
    return buildResult(
      { lower, upper, exact: true, coloring: best, lowerReason },
      String(upper),
      'neutral',
      `Greedy found a ${upper}-colouring, and ${lowerReason}, so ${upper} colours are both enough and necessary.`,
      `${greedyDetail}${cliqueNote}`,
      true,
    )
  }

  if (n > CHROMATIC_EXACT_VERTEX_LIMIT) {
    return buildResult(
      { lower, upper, exact: false, coloring: best, lowerReason },
      `${lower}-${upper}`,
      'warning',
      `Exact computation is disabled above ${CHROMATIC_EXACT_VERTEX_LIMIT} vertices. Greedy found a ${upper}-colouring, and ${lowerReason}, so the chromatic number is between ${lower} and ${upper}.`,
      `${greedyDetail}${cliqueNote} Deciding the chromatic number exactly is NP-hard; this graph has ${n} vertices, which is past the point where the search finishes quickly enough to run on every edit.`,
      false,
    )
  }

  // Exact search, from the lower bound upwards.
  const ids = g.vertexIds
  const index = new Map(ids.map((id, i) => [id, i] as const))
  const adjIdx: number[][] = ids.map((id) => (adj.get(id) ?? []).map((u) => index.get(u)!))
  const degree = adjIdx.map((row) => row.length)
  const seed = clique.map((id) => index.get(id)!)

  let budget = CHROMATIC_STEP_BUDGET
  let proved = lower
  const outOfBudget = (): PropertyResult<ChromaticResult> =>
    buildResult(
      { lower: proved, upper, exact: false, coloring: best, lowerReason },
      `${proved}-${upper}`,
      'warning',
      `The exact search ran out of its step budget of ${CHROMATIC_STEP_BUDGET} steps. Greedy found a ${upper}-colouring, and ${lowerReason}, so the chromatic number is between ${proved} and ${upper}.`,
      `${greedyDetail}${cliqueNote} Deciding the chromatic number exactly is NP-hard, and this graph is one of the cases where the search does not finish inside the budget.`,
      false,
    )

  for (let k = lower; k < upper; k++) {
    const attempt = tryKColoring(adjIdx, degree, n, k, seed, budget)
    budget -= attempt.steps

    if (attempt.colors) {
      const colors: Record<VertexId, number> = {}
      for (let i = 0; i < n; i++) colors[ids[i]] = attempt.colors[i]
      const count = new Set(Object.values(colors)).size
      const exactColoring: Coloring = { colors, count, ordering: 'dsatur' }
      const why =
        k === lower
          ? `and ${lowerReason}, so it cannot be done with fewer`
          : `and the search proved that ${k - 1} colours are not enough`
      return buildResult(
        { lower: k, upper: k, exact: true, coloring: exactColoring, lowerReason },
        String(k),
        'neutral',
        `An exhaustive search found a ${k}-colouring, ${why}. The chromatic number is exactly ${k}.`,
        `${greedyDetail}${cliqueNote}`,
        true,
      )
    }

    if (attempt.exhausted) return outOfBudget()

    // The search proved k colours are not enough, which lifts the lower bound.
    proved = k + 1
    lowerReason = `an exhaustive search showed the graph cannot be coloured with ${k} colours`
    if (budget <= 0) return outOfBudget()
  }

  return buildResult(
    { lower: upper, upper, exact: true, coloring: best, lowerReason },
    String(upper),
    'neutral',
    `An exhaustive search ruled out every colouring with fewer than ${upper} colours, and greedy found a ${upper}-colouring, so the chromatic number is exactly ${upper}.`,
    `${greedyDetail}${cliqueNote}`,
    true,
  )
}
