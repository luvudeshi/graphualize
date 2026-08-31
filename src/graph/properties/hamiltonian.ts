/**
 * Hamiltonicity.
 *
 * Deciding whether a graph has a Hamiltonian cycle is NP-complete, so this
 * module has exactly two honest answers and one honest non-answer:
 *
 *  - **Yes**, with the tour itself as a witness.
 *  - **No**, but *only* when the answer is proved: either a Held-Karp dynamic
 *    program has examined every ordering, or a cheap certificate rules it out
 *    (a disconnected graph, or a vertex with fewer than two neighbours, cannot
 *    have a Hamiltonian cycle — no search needed).
 *  - **Not computed**, above the vertex limit. This is never rendered as "No".
 *    A graph too big to search is a question left open, not a negative answer.
 *
 * Convention: a Hamiltonian cycle needs at least three vertices. Direction is
 * honoured on a digraph, where the tour must follow the arrows.
 */

import type { Graph } from '../model/graph'
import type { EdgeId, PropertyResult, PropertyStatus, VertexId } from '../model/types'
import { connectedComponents } from './traversal'

export interface HamiltonianResult {
  /** Vertices of a Hamiltonian cycle in tour order; the start is not repeated. */
  cycle: VertexId[] | null
  /** Vertices of a Hamiltonian path in order. Set whenever a cycle exists too. */
  path: VertexId[] | null
  /** True when the answer is final: either searched exhaustively or proved. */
  searched: boolean
}

/**
 * Above this order the exhaustive search is skipped.
 *
 * The search is the Held-Karp bitmask dynamic program: 2^n masks, each visiting
 * its live endpoints, so a dense graph is the worst case. Measured on complete
 * graphs, which are as dense as it gets: K18 18ms, K20 63ms, K22 298ms, K24
 * 1.4s — and the same shape for graphs with no tour at all, where both dynamic
 * programs run to the end (K11,13 on 24 vertices: 857ms). Memory follows the
 * same curve: a 4 MB Int32Array at 20 vertices, 64 MB at 24. 20 keeps the worst
 * case under about a tenth of a second, so that is where the exhaustive claim
 * stops.
 */
export const HAMILTONIAN_EXACT_VERTEX_LIMIT = 20

/** How many vertices a tour names in prose before it is just described. */
const MAX_NAMED = 12

/* ------------------------------------------------------------------ */
/* Adjacency                                                           */
/* ------------------------------------------------------------------ */

interface IndexedGraph {
  ids: VertexId[]
  /** Bit u of `out[v]` is set when a tour may step from v to u. Small n only. */
  out: Int32Array
  /** Distinct out-neighbours, self-loops excluded (both ends when undirected). */
  outDegree: number[]
  inDegree: number[]
  /** Distinct neighbours ignoring direction, self-loops excluded. */
  degree: number[]
}

/**
 * Bitmasks are only built when they fit in an int32 to spare. Tied to the search
 * limit so that raising the limit can never leave the search reading empty masks.
 */
const MASK_VERTEX_LIMIT = Math.max(30, HAMILTONIAN_EXACT_VERTEX_LIMIT)

const indexGraph = (g: Graph): IndexedGraph => {
  const ids = g.vertexIds
  const n = ids.length
  const index = new Map<VertexId, number>()
  ids.forEach((id, i) => index.set(id, i))

  const out = new Int32Array(n <= MASK_VERTEX_LIMIT ? n : 0)
  const outDegree = new Array<number>(n).fill(0)
  const inDegree = new Array<number>(n).fill(0)
  const degree = new Array<number>(n).fill(0)
  const seenArc = new Set<string>()
  const seenPair = new Set<string>()
  const small = n <= MASK_VERTEX_LIMIT

  for (const e of g.edges) {
    const a = index.get(e.source)
    const b = index.get(e.target)
    if (a === undefined || b === undefined || a === b) continue

    const arcs: number[][] = g.directed
      ? [[a, b]]
      : [
          [a, b],
          [b, a],
        ]
    for (const arc of arcs) {
      const from = arc[0]
      const to = arc[1]
      const key = `${from}>${to}`
      if (seenArc.has(key)) continue
      seenArc.add(key)
      outDegree[from]++
      inDegree[to]++
      if (small) out[from] |= 1 << to
    }

    const pair = a < b ? `${a}:${b}` : `${b}:${a}`
    if (!seenPair.has(pair)) {
      seenPair.add(pair)
      degree[a]++
      degree[b]++
    }
  }

  return { ids, out, outDegree, inDegree, degree }
}

/* ------------------------------------------------------------------ */
/* Held-Karp                                                           */
/* ------------------------------------------------------------------ */

/**
 * Walks a finished table backwards from `last` until the visited set is down to
 * `stopMask`, giving the tour in order.
 */
const reconstruct = (
  dp: Int32Array,
  out: Int32Array,
  full: number,
  last: number,
  stopMask: number,
): number[] | null => {
  const order = [last]
  let mask = full
  let cur = last
  while (mask !== stopMask) {
    const prev = mask ^ (1 << cur)
    let candidates = dp[prev]
    let chosen = -1
    while (candidates !== 0) {
      const bit = candidates & -candidates
      const u = 31 - Math.clz32(bit)
      candidates ^= bit
      if ((out[u] & (1 << cur)) !== 0) {
        chosen = u
        break
      }
    }
    if (chosen === -1) return null
    order.push(chosen)
    mask = prev
    cur = chosen
  }
  order.reverse()
  return order
}

/**
 * A Hamiltonian cycle through vertex 0, or null when none exists. Every tour
 * passes through vertex 0, so fixing the start loses nothing and halves the
 * table.
 */
const findHamiltonianCycle = (n: number, out: Int32Array): number[] | null => {
  const full = (1 << n) - 1
  const dp = new Int32Array(1 << n)
  dp[1] = 1
  for (let mask = 1; mask <= full; mask += 2) {
    let ends = dp[mask]
    while (ends !== 0) {
      const bit = ends & -ends
      const v = 31 - Math.clz32(bit)
      ends ^= bit
      let candidates = out[v] & ~mask
      while (candidates !== 0) {
        const nb = candidates & -candidates
        candidates ^= nb
        dp[mask | nb] |= nb
      }
    }
  }
  let ends = dp[full]
  while (ends !== 0) {
    const bit = ends & -ends
    const v = 31 - Math.clz32(bit)
    ends ^= bit
    if ((out[v] & 1) !== 0) return reconstruct(dp, out, full, v, 1)
  }
  return null
}

/** A Hamiltonian path, or null when none exists. Any start, any end. */
const findHamiltonianPath = (n: number, out: Int32Array): number[] | null => {
  const full = (1 << n) - 1
  const dp = new Int32Array(1 << n)
  for (let v = 0; v < n; v++) dp[1 << v] = 1 << v
  for (let mask = 1; mask <= full; mask++) {
    let ends = dp[mask]
    while (ends !== 0) {
      const bit = ends & -ends
      const v = 31 - Math.clz32(bit)
      ends ^= bit
      let candidates = out[v] & ~mask
      while (candidates !== 0) {
        const nb = candidates & -candidates
        candidates ^= nb
        dp[mask | nb] |= nb
      }
    }
  }
  const ends = dp[full]
  if (ends === 0) return null
  const last = 31 - Math.clz32(ends & -ends)

  // The walk back ends at whichever singleton mask started the path.
  const order = [last]
  let mask = full
  let cur = last
  while (order.length < n) {
    const prev = mask ^ (1 << cur)
    let candidates = dp[prev]
    let chosen = -1
    while (candidates !== 0) {
      const bit = candidates & -candidates
      const u = 31 - Math.clz32(bit)
      candidates ^= bit
      if ((out[u] & (1 << cur)) !== 0) {
        chosen = u
        break
      }
    }
    if (chosen === -1) return null
    order.push(chosen)
    mask = prev
    cur = chosen
  }
  order.reverse()
  return order
}

/* ------------------------------------------------------------------ */
/* The reported invariant                                              */
/* ------------------------------------------------------------------ */

const tourText = (g: Graph, ids: readonly VertexId[], close: boolean): string => {
  if (ids.length > MAX_NAMED) return ''
  const labels = g.labels(ids)
  const parts = close ? [...labels, labels[0]] : labels
  return parts.join(' → ')
}

const tourEdges = (g: Graph, ids: readonly VertexId[], close: boolean): EdgeId[] => {
  const edges: EdgeId[] = []
  for (let i = 0; i + 1 < ids.length; i++) {
    const id = g.findEdge(ids[i], ids[i + 1])
    if (id !== undefined) edges.push(id)
  }
  if (close && ids.length > 1) {
    const id = g.findEdge(ids[ids.length - 1], ids[0])
    if (id !== undefined) edges.push(id)
  }
  return edges
}

const answer = (
  value: HamiltonianResult,
  display: string,
  status: PropertyStatus,
  explanation: string,
  detail: string | undefined,
  exactness: PropertyResult<HamiltonianResult>['exactness'],
  witness?: PropertyResult<HamiltonianResult>['witness'],
): PropertyResult<HamiltonianResult> => ({
  value,
  display,
  status,
  explanation,
  detail,
  exactness,
  witness,
})

const CYCLE_NEEDS_THREE =
  'Graphualize follows the usual convention that a Hamiltonian cycle needs at least three vertices, so no cycle is defined here.'

const names = (g: Graph, ids: readonly VertexId[]): string =>
  ids.length <= MAX_NAMED
    ? g.labels(ids).join(', ')
    : `${g.labels(ids.slice(0, MAX_NAMED)).join(', ')} and ${ids.length - MAX_NAMED} more`

export const hamiltonian = (g: Graph): PropertyResult<HamiltonianResult> => {
  const n = g.order
  const settled: HamiltonianResult = { cycle: null, path: null, searched: true }

  if (n === 0) {
    return answer(
      settled,
      'Not applicable',
      'neutral',
      'An empty graph has no vertices, so there is nothing for a tour to visit.',
      undefined,
      'not-applicable',
    )
  }

  const { ids, out, outDegree, inDegree, degree } = indexGraph(g)

  if (n === 1) {
    const path = [ids[0]]
    return answer(
      { cycle: null, path, searched: true },
      'Path only',
      'neutral',
      `A single vertex is a Hamiltonian path all by itself. ${CYCLE_NEEDS_THREE}`,
      undefined,
      'exact',
      { type: 'path', vertexIds: path, edgeIds: [], caption: 'Trivial Hamiltonian path' },
    )
  }

  /* Cheap certificates. Each of these is a proof, not a failed search. */

  const components = connectedComponents(g)
  if (components.length > 1) {
    return answer(
      settled,
      'No',
      'neutral',
      `The graph has ${components.length} components. A tour would have to walk from any vertex to any other, so a disconnected graph has neither a Hamiltonian path nor a Hamiltonian cycle. That is a proof, not a failed search.`,
      undefined,
      'exact',
    )
  }

  let noCycleReason: string | null = null
  let noPathReason: string | null = null

  if (n < 3) noCycleReason = CYCLE_NEEDS_THREE

  if (!g.directed) {
    // Undirected, "degree below 2" and "degree at most 1" are the same set, so
    // one count answers both questions: such a vertex cannot sit inside a
    // cycle, and only two of them can sit on a path, one at each end.
    const thin = ids.filter((_, i) => degree[i] < 2)
    if (thin.length > 0 && n >= 3) {
      noCycleReason = `${names(g, thin)} ${thin.length === 1 ? 'has' : 'have'} at most one neighbour, and every vertex on a Hamiltonian cycle needs two — one to arrive by, one to leave by — so there is no Hamiltonian cycle.`
      if (thin.length >= 3) {
        noPathReason =
          'A vertex with one neighbour has to be an end of the path, and a path has only two ends, so there is no Hamiltonian path either.'
      }
    }
  } else {
    const stuck = ids.filter((_, i) => outDegree[i] === 0 || inDegree[i] === 0)
    if (stuck.length > 0 && n >= 3) {
      noCycleReason = `${names(g, stuck)} ${stuck.length === 1 ? 'has' : 'have'} no outgoing arc or no incoming arc, and a directed Hamiltonian cycle enters and leaves every vertex exactly once, so there is no Hamiltonian cycle.`
    }
    const sinks = ids.filter((_, i) => outDegree[i] === 0)
    const sources = ids.filter((_, i) => inDegree[i] === 0)
    if (sinks.length >= 2) {
      noPathReason = `${names(g, sinks)} have no outgoing arcs, and a directed Hamiltonian path can end at only one vertex, so there is no Hamiltonian path either.`
    } else if (sources.length >= 2) {
      noPathReason = `${names(g, sources)} have no incoming arcs, and a directed Hamiltonian path can start at only one vertex, so there is no Hamiltonian path either.`
    }
  }

  if (noCycleReason && noPathReason) {
    return answer(
      settled,
      'No',
      'neutral',
      `${noCycleReason} ${noPathReason}`,
      'Both halves come from counting degrees, so they hold however large the graph is — no search was needed.',
      'exact',
    )
  }

  /* Above the limit we stop here, and say so. */

  if (n > HAMILTONIAN_EXACT_VERTEX_LIMIT) {
    const open: HamiltonianResult = { cycle: null, path: null, searched: false }
    const limitNote = `Graphualize searches for Hamiltonian tours only up to ${HAMILTONIAN_EXACT_VERTEX_LIMIT} vertices, and this graph has ${n}. The search is a Held-Karp dynamic program over all 2^n subsets of vertices, which doubles in time and memory with every extra vertex.`
    if (noCycleReason) {
      return answer(
        open,
        'No cycle; path not computed',
        'warning',
        `${noCycleReason} Whether a Hamiltonian path exists was not computed. ${limitNote}`,
        'The "no cycle" half is a proof from degrees. The path question is genuinely open — it has not been answered no.',
        'not-computed',
      )
    }
    return answer(
      open,
      `Not computed (> ${HAMILTONIAN_EXACT_VERTEX_LIMIT} vertices)`,
      'warning',
      `${limitNote} No cheap certificate settles this graph either, so the question is left open. "Not computed" is not the same as "no" — this graph may well be Hamiltonian.`,
      'A disconnected graph, or one with a vertex of degree below 2, would have been ruled out here without any search. Neither applies to this graph.',
      'not-computed',
    )
  }

  /* Exhaustive search. */

  const cycleIndices = noCycleReason ? null : findHamiltonianCycle(n, out)
  if (cycleIndices) {
    const cycle = cycleIndices.map((i) => ids[i])
    const text = tourText(g, cycle, true)
    return answer(
      { cycle, path: cycle, searched: true },
      'Cycle',
      'success',
      `There is a Hamiltonian cycle: a tour visiting all ${n} vertices exactly once and returning to its start${text ? `, ${text}` : ''}. A graph with a Hamiltonian cycle has a Hamiltonian path too — drop the closing edge.`,
      'Found by an exhaustive Held-Karp search over all subsets of vertices.',
      'exact',
      {
        type: 'cycle',
        vertexIds: cycle,
        edgeIds: tourEdges(g, cycle, true),
        caption: `Hamiltonian cycle on ${n} vertices`,
      },
    )
  }

  const noCycleFound = noCycleReason ?? 'An exhaustive search found no way to close a tour, so there is no Hamiltonian cycle.'

  const pathIndices = noPathReason ? null : findHamiltonianPath(n, out)
  if (pathIndices) {
    const path = pathIndices.map((i) => ids[i])
    const text = tourText(g, path, false)
    return answer(
      { cycle: null, path, searched: true },
      'Path only',
      'neutral',
      `There is a Hamiltonian path visiting all ${n} vertices exactly once${text ? `, ${text}` : ''}. ${noCycleFound}`,
      'The search was exhaustive: the Held-Karp dynamic program covers every ordering of the vertices.',
      'exact',
      {
        type: 'path',
        vertexIds: path,
        edgeIds: tourEdges(g, path, false),
        caption: `Hamiltonian path on ${n} vertices`,
      },
    )
  }

  const noPathFound =
    noPathReason ?? 'An exhaustive search found no Hamiltonian path either.'
  return answer(
    settled,
    'No',
    'neutral',
    `${noCycleFound} ${noPathFound}`,
    `The Held-Karp dynamic program covers every ordering of the ${n} vertices, so this "no" is proved, not merely unfound.`,
    'exact',
  )
}
