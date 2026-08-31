import { describe, expect, it } from 'vitest'

import { Graph } from '../model/graph'
import { docFromEdges } from '../model/builder'
import type { BuildOptions } from '../model/builder'
import type { EdgeId, VertexId } from '../model/types'
import {
  CHROMATIC_EXACT_VERTEX_LIMIT,
  CHROMATIC_POLYNOMIAL_VERTEX_LIMIT,
  chromaticNumber,
  chromaticPolynomialSmall,
  evaluateChromaticPolynomial,
  greedyColoring,
  isProperColoring,
} from './coloring'
import type { ColoringOrdering } from './coloring'
import {
  CLIQUE_EXACT_VERTEX_LIMIT,
  greedyClique,
  greedyIndependentSet,
  maximalCliques,
  maximumClique,
  maximumIndependentSet,
} from './cliques'
import {
  MATCHING_VERTEX_LIMIT,
  bipartiteMaximumMatching,
  maximalMatching,
  maximumMatching,
} from './matching'
import { minimumSpanningForest, minimumSpanningTree } from './spanning'
import { HAMILTONIAN_EXACT_VERTEX_LIMIT, hamiltonian } from './hamiltonian'

/* ------------------------------------------------------------------ */
/* Fixtures — every graph is built by hand so this file never depends  */
/* on the generators module.                                           */
/* ------------------------------------------------------------------ */

const g = (spec: readonly string[], options: BuildOptions = {}): Graph =>
  new Graph(docFromEdges(spec, options))

/** Vertex labels A, B, C, ... then v26, v27, ... Never contains '-' or ':'. */
const name = (i: number): string => (i < 26 ? String.fromCharCode(65 + i) : `v${i}`)

const completeSpec = (n: number): string[] => {
  if (n === 1) return ['A']
  const spec: string[] = []
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) spec.push(`${name(i)}-${name(j)}`)
  return spec
}

const cycleSpec = (n: number): string[] =>
  Array.from({ length: n }, (_, i) => `${name(i)}-${name((i + 1) % n)}`)

const pathSpec = (n: number): string[] =>
  Array.from({ length: n - 1 }, (_, i) => `${name(i)}-${name(i + 1)}`)

const starSpec = (leaves: number): string[] =>
  Array.from({ length: leaves }, (_, i) => `A-${name(i + 1)}`)

const completeBipartiteSpec = (m: number, n: number): string[] => {
  const spec: string[] = []
  for (let i = 0; i < m; i++) for (let j = 0; j < n; j++) spec.push(`L${i}-R${j}`)
  return spec
}

/** Petersen: outer 5-cycle A..E, spokes to F..J, inner pentagram. */
const PETERSEN = [
  'A-B', 'B-C', 'C-D', 'D-E', 'E-A',
  'A-F', 'B-G', 'C-H', 'D-I', 'E-J',
  'F-H', 'H-J', 'J-G', 'G-I', 'I-F',
]

/** K4 with one edge removed: still contains a triangle, so 3-chromatic. */
const K4_MINUS_EDGE = ['A-B', 'A-C', 'A-D', 'B-C', 'B-D']

/** A triangle with a pendant edge on each corner. Blossom's canonical case. */
const TRIANGLE_WITH_PENDANTS = ['A-B', 'B-C', 'C-A', 'A-D', 'B-E', 'C-F']

/** Two triangles sharing one vertex. */
const BOWTIE = ['A-B', 'B-C', 'C-A', 'C-D', 'D-E', 'E-C']

/** A tree: root A with two children, each with two children. */
const TREE = ['A-B', 'A-C', 'B-D', 'B-E', 'C-F', 'C-G']

/**
 * Mycielski's construction: 2n+1 vertices, chromatic number one higher, and
 * triangle-free whenever the input is. Iterating it from C5 gives graphs whose
 * chromatic number no clique can certify.
 */
const mycielskian = (
  edges: readonly (readonly [number, number])[],
  n: number,
): { edges: [number, number][]; n: number } => {
  const out: [number, number][] = edges.map(([u, v]) => [u, v])
  for (const [u, v] of edges) {
    out.push([u, n + v])
    out.push([n + u, v])
  }
  for (let i = 0; i < n; i++) out.push([n + i, 2 * n])
  return { edges: out, n: 2 * n + 1 }
}

const specFromPairs = (edges: readonly (readonly [number, number])[], n: number): string[] => {
  const spec: string[] = []
  for (let i = 0; i < n; i++) spec.push(name(i))
  for (const [a, b] of edges) spec.push(`${name(a)}-${name(b)}`)
  return spec
}

/**
 * The Mycielski tower over C5. Step 1 is the Grötzsch graph (11 vertices,
 * chromatic number 4), step 2 has 23 vertices and chromatic number 5, step 3 has
 * 47 vertices and chromatic number 6. All are triangle-free, so no clique can
 * certify the answer — exactly the case where an honest bound matters.
 */
const mycielskiSpec = (steps: number): string[] => {
  let current: { edges: [number, number][]; n: number } = {
    edges: [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 4],
      [4, 0],
    ],
    n: 5,
  }
  for (let i = 0; i < steps; i++) current = mycielskian(current.edges, current.n)
  return specFromPairs(current.edges, current.n)
}

/** M^3(C5): 47 vertices, chromatic number 6, triangle-free. Over every limit. */
const bigMycielskiSpec = (): string[] => mycielskiSpec(3)

/* ------------------------------------------------------------------ */
/* Local deterministic PRNG — never Math.random                        */
/* ------------------------------------------------------------------ */

const mulberry32 = (seed: number): (() => number) => {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const randomSpec = (n: number, p: number, rnd: () => number): string[] => {
  const spec: string[] = []
  for (let i = 0; i < n; i++) spec.push(name(i))
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) if (rnd() < p) spec.push(`${name(i)}-${name(j)}`)
  }
  return spec
}

/* ------------------------------------------------------------------ */
/* Verifiers — a witness is only worth anything if it checks out       */
/* ------------------------------------------------------------------ */

const isClique = (graph: Graph, ids: readonly VertexId[]): boolean =>
  ids.every((a, i) => ids.slice(i + 1).every((b) => graph.hasEdge(a, b)))

const isIndependentSet = (graph: Graph, ids: readonly VertexId[]): boolean =>
  ids.every((a, i) => ids.slice(i + 1).every((b) => !graph.hasEdge(a, b)))

const isMatching = (graph: Graph, edgeIds: readonly EdgeId[]): boolean => {
  const used = new Set<VertexId>()
  for (const id of edgeIds) {
    const e = graph.edge(id)
    if (!e) return false
    if (e.source === e.target) return false
    if (used.has(e.source) || used.has(e.target)) return false
    used.add(e.source)
    used.add(e.target)
  }
  return true
}

/** Exhaustive maximum matching by branching on the lowest unmatched vertex. */
const bruteForceMatchingSize = (graph: Graph): number => {
  const ids = graph.vertexIds
  const n = ids.length
  const adj = ids.map((a) => ids.map((b) => a !== b && graph.hasEdge(a, b)))
  const used = new Array<boolean>(n).fill(false)

  const rec = (start: number): number => {
    let v = start
    while (v < n && used[v]) v++
    if (v >= n) return 0
    used[v] = true
    let best = rec(v + 1)
    for (let u = v + 1; u < n; u++) {
      if (used[u] || !adj[v][u]) continue
      used[u] = true
      const size = 1 + rec(v + 1)
      used[u] = false
      if (size > best) best = size
    }
    used[v] = false
    return best
  }
  return rec(0)
}

/** Number of proper k-colourings, counted one assignment at a time. */
const countColorings = (graph: Graph, k: number): number => {
  const ids = graph.vertexIds
  const n = ids.length
  const colors = new Array<number>(n).fill(-1)
  let total = 0
  const rec = (i: number): void => {
    if (i === n) {
      total++
      return
    }
    for (let c = 0; c < k; c++) {
      let ok = true
      for (let j = 0; j < i; j++) {
        if (colors[j] === c && graph.hasEdge(ids[i], ids[j])) {
          ok = false
          break
        }
      }
      if (!ok) continue
      colors[i] = c
      rec(i + 1)
    }
    colors[i] = -1
  }
  rec(0)
  return total
}

const isTreeOrForest = (graph: Graph, edgeIds: readonly EdgeId[]): boolean => {
  const parent = new Map<VertexId, VertexId>()
  const find = (x: VertexId): VertexId => {
    let root = x
    while (parent.get(root) !== root) root = parent.get(root)!
    return root
  }
  for (const id of graph.vertexIds) parent.set(id, id)
  for (const id of edgeIds) {
    const e = graph.edge(id)
    if (!e) return false
    const a = find(e.source)
    const b = find(e.target)
    if (a === b) return false
    parent.set(a, b)
  }
  return true
}

const ORDERINGS: ColoringOrdering[] = ['document', 'largest-first', 'smallest-last', 'dsatur']

/* ------------------------------------------------------------------ */
/* Colouring                                                           */
/* ------------------------------------------------------------------ */

describe('greedyColoring', () => {
  const fixtures: [string, string[]][] = [
    ['K5', completeSpec(5)],
    ['C5', cycleSpec(5)],
    ['C6', cycleSpec(6)],
    ['Petersen', PETERSEN],
    ['K3,3', completeBipartiteSpec(3, 3)],
    ['tree', TREE],
    ['path P6', pathSpec(6)],
    ['K4 minus an edge', K4_MINUS_EDGE],
    ['star with 6 leaves', starSpec(6)],
    ['random G(18, 0.4)', randomSpec(18, 0.4, mulberry32(20240117))],
  ]

  for (const [label, spec] of fixtures) {
    for (const ordering of ORDERINGS) {
      it(`is a proper colouring of ${label} in ${ordering} order`, () => {
        const graph = g(spec)
        const coloring = greedyColoring(graph, ordering)
        expect(isProperColoring(graph, coloring.colors)).toBe(true)
        expect(coloring.ordering).toBe(ordering)
        expect(Object.keys(coloring.colors)).toHaveLength(graph.order)
        const used = new Set(Object.values(coloring.colors))
        expect(coloring.count).toBe(used.size)
        // Colours are a contiguous 0-based palette range.
        expect(Math.max(...used)).toBe(coloring.count - 1)
      })
    }
  }

  it('is deterministic', () => {
    const graph = g(randomSpec(14, 0.5, mulberry32(99)))
    for (const ordering of ORDERINGS) {
      const a = greedyColoring(graph, ordering)
      const b = greedyColoring(graph, ordering)
      expect(a.colors).toEqual(b.colors)
    }
  })

  it('gives every ordering the same answer on a complete graph', () => {
    const graph = g(completeSpec(6))
    for (const ordering of ORDERINGS) {
      expect(greedyColoring(graph, ordering).count).toBe(6)
    }
  })

  it('lets DSATUR 2-colour a bipartite graph that document order gets wrong', () => {
    // The crown S_4^0: a bipartite graph built to fool naive greedy orderings.
    const spec = ['A-Y', 'A-Z', 'B-X', 'B-Z', 'C-X', 'C-Y']
    const graph = g(spec)
    expect(greedyColoring(graph, 'dsatur').count).toBe(2)
    for (const ordering of ORDERINGS) {
      expect(isProperColoring(graph, greedyColoring(graph, ordering).colors)).toBe(true)
    }
  })

  it('rejects an improper colouring', () => {
    const graph = g(['A-B'])
    const [a, b] = graph.vertexIds
    expect(isProperColoring(graph, { [a]: 0, [b]: 0 })).toBe(false)
    expect(isProperColoring(graph, { [a]: 0, [b]: 1 })).toBe(true)
    expect(isProperColoring(graph, { [a]: 0 })).toBe(false)
  })
})

describe('chromaticNumber', () => {
  const exactCases: [string, string[], number][] = [
    ['K5', completeSpec(5), 5],
    ['C5', cycleSpec(5), 3],
    ['C6', cycleSpec(6), 2],
    ['Petersen', PETERSEN, 3],
    ['K3,3', completeBipartiteSpec(3, 3), 2],
    ['a tree', TREE, 2],
    ['a single vertex', ['A'], 1],
    ['the empty graph', [], 0],
    ['K4 minus an edge', K4_MINUS_EDGE, 3],
  ]

  for (const [label, spec, expected] of exactCases) {
    it(`is exactly ${expected} for ${label}`, () => {
      const graph = g(spec)
      const result = chromaticNumber(graph)
      expect(result.value.exact).toBe(true)
      expect(result.exactness).toBe('exact')
      expect(result.value.lower).toBe(expected)
      expect(result.value.upper).toBe(expected)
      expect(result.display).toBe(String(expected))
      expect(result.explanation).toBeTruthy()
      if (expected > 0) {
        const coloring = result.value.coloring
        expect(coloring).not.toBeNull()
        expect(coloring!.count).toBe(expected)
        expect(isProperColoring(graph, coloring!.colors)).toBe(true)
        expect(result.witness).toEqual({
          type: 'coloring',
          colors: coloring!.colors,
          count: expected,
        })
      }
    })
  }

  it('returns honest bounds above the exact limit, never a bare number', () => {
    const graph = g(bigMycielskiSpec())
    expect(graph.order).toBe(47)
    expect(graph.order).toBeGreaterThan(CHROMATIC_EXACT_VERTEX_LIMIT)

    const result = chromaticNumber(graph)
    expect(result.value.exact).toBe(false)
    expect(result.exactness).toBe('bounded')
    expect(result.display).toMatch(/^\d+-\d+$/)
    expect(result.display).toBe(`${result.value.lower}-${result.value.upper}`)
    expect(result.value.lower).toBeLessThanOrEqual(result.value.upper)

    // Both bounds are genuinely correct: this graph is triangle-free with an
    // odd cycle (so the lower bound is 3) and has chromatic number 6, so any
    // proper colouring — the greedy one included — needs at least 6 colours.
    expect(result.value.lower).toBe(3)
    expect(result.value.upper).toBeGreaterThanOrEqual(6)

    // The upper bound is not a guess: it is a colouring anyone can check.
    const coloring = result.value.coloring
    expect(coloring).not.toBeNull()
    expect(isProperColoring(graph, coloring!.colors)).toBe(true)
    expect(coloring!.count).toBe(result.value.upper)

    // And the prose says why the exact answer is missing.
    expect(result.explanation).toContain(String(CHROMATIC_EXACT_VERTEX_LIMIT))
    expect(result.explanation).toMatch(/between 3 and \d+/)
    expect(result.value.lowerReason).toBeTruthy()
  })

  it('proves the answer by search when the bounds alone cannot', () => {
    // The Grötzsch graph is triangle-free, so the clique bound stops at 2 and
    // the odd cycle bound at 3 — but its chromatic number is 4. Only an
    // exhaustive search can close that gap, and it must close it honestly.
    const grotzsch = g(mycielskiSpec(1))
    expect(grotzsch.order).toBe(11)
    const result = chromaticNumber(grotzsch)
    expect(result.value.exact).toBe(true)
    expect(result.exactness).toBe('exact')
    expect(result.value.lower).toBe(4)
    expect(result.value.upper).toBe(4)
    expect(result.explanation).toMatch(/exhaustive search/i)
    expect(isProperColoring(grotzsch, result.value.coloring!.colors)).toBe(true)
    expect(result.value.coloring!.count).toBe(4)

    // One Mycielski step further: 23 vertices, chromatic number 5, and still
    // inside both the vertex limit and the step budget.
    const bigger = g(mycielskiSpec(2))
    expect(bigger.order).toBe(23)
    expect(bigger.order).toBeLessThanOrEqual(CHROMATIC_EXACT_VERTEX_LIMIT)
    const biggerResult = chromaticNumber(bigger)
    expect(biggerResult.value.exact).toBe(true)
    expect(biggerResult.display).toBe('5')
    expect(isProperColoring(bigger, biggerResult.value.coloring!.colors)).toBe(true)
  })

  it('names the reason behind the lower bound', () => {
    const triangleHeavy = chromaticNumber(g([...cycleSpec(30), 'A-C']))
    expect(triangleHeavy.value.lowerReason).toContain('triangle')

    const oddCycle = chromaticNumber(g(cycleSpec(31)))
    expect(oddCycle.value.lowerReason).toContain('odd cycle')

    const bipartite = chromaticNumber(g(completeBipartiteSpec(4, 4)))
    expect(bipartite.value.lowerReason).toContain('edge')
  })

  it('says plainly that a self-loop makes colouring impossible', () => {
    const graph = g(['A-B', 'B-C', 'B-B'])
    const result = chromaticNumber(graph)
    expect(result.status).toBe('danger')
    expect(result.exactness).toBe('not-applicable')
    expect(result.value.coloring).toBeNull()
    expect(result.display).toMatch(/self-loop/i)
    expect(result.explanation).toMatch(/self-loop/i)
    expect(result.explanation).toMatch(/no proper colouring|undefined/i)
    expect(result.witness).toBeUndefined()
    // The vertex carrying the loop is named.
    expect(result.explanation).toContain('B')
  })

  it('never claims exactness it has not earned', () => {
    for (const spec of [cycleSpec(40), randomSpec(30, 0.5, mulberry32(7)), bigMycielskiSpec()]) {
      const result = chromaticNumber(g(spec))
      if (!result.value.exact) {
        expect(result.exactness).toBe('bounded')
        expect(result.display).toContain('-')
        expect(result.explanation).toBeTruthy()
      } else {
        expect(result.value.lower).toBe(result.value.upper)
      }
    }
  })
})

describe('chromaticPolynomialSmall', () => {
  const text = (spec: string[]): string => chromaticPolynomialSmall(g(spec))!.text

  it('matches the textbook polynomials', () => {
    expect(text(cycleSpec(3))).toBe('k^3 - 3k^2 + 2k') // k(k-1)(k-2)
    expect(text(pathSpec(3))).toBe('k^3 - 2k^2 + k') // k(k-1)^2
    expect(text(cycleSpec(4))).toBe('k^4 - 4k^3 + 6k^2 - 3k') // (k-1)^4 + (k-1)
    expect(text(completeSpec(4))).toBe('k^4 - 6k^3 + 11k^2 - 6k')
    expect(text(['A', 'B', 'C'])).toBe('k^3')
    expect(text([])).toBe('1')
  })

  it('is identically zero when a self-loop makes colouring impossible', () => {
    const poly = chromaticPolynomialSmall(g(['A-A', 'A-B']))!
    expect(poly.text).toBe('0')
    for (const k of [0, 1, 2, 5]) {
      expect(evaluateChromaticPolynomial(poly, k)).toBe(0n)
    }
  })

  it('counts proper colourings exactly, cross-checked by brute force', () => {
    const rnd = mulberry32(606)
    for (let trial = 0; trial < 12; trial++) {
      const n = 2 + Math.floor(rnd() * 5)
      const graph = g(randomSpec(n, 0.2 + rnd() * 0.5, rnd))
      const poly = chromaticPolynomialSmall(graph)!
      for (let k = 0; k <= 4; k++) {
        expect(evaluateChromaticPolynomial(poly, k)).toBe(BigInt(countColorings(graph, k)))
      }
      // The smallest k with a positive count is the chromatic number itself.
      let chi = 0
      while (chi <= graph.order && evaluateChromaticPolynomial(poly, chi) === 0n) chi++
      const exact = chromaticNumber(graph)
      expect(exact.value.exact).toBe(true)
      expect(chi).toBe(exact.value.upper)
    }
  })

  it('declines above its own limit rather than approximating', () => {
    const big = g(completeSpec(CHROMATIC_POLYNOMIAL_VERTEX_LIMIT + 1))
    expect(chromaticPolynomialSmall(big)).toBeNull()
  })
})

/* ------------------------------------------------------------------ */
/* Cliques and independent sets                                        */
/* ------------------------------------------------------------------ */

describe('maximumClique', () => {
  const cases: [string, string[], number][] = [
    ['K5', completeSpec(5), 5],
    ['Petersen', PETERSEN, 2],
    ['C5', cycleSpec(5), 2],
    ['a graph with a planted K4', [...cycleSpec(9), 'A-C', 'A-D', 'B-D', 'B-C', 'C-D'], 4],
    ['the empty graph', [], 0],
    ['a single vertex', ['A'], 1],
    ['K3,3', completeBipartiteSpec(3, 3), 2],
  ]

  for (const [label, spec, expected] of cases) {
    it(`is ${expected} for ${label}`, () => {
      const graph = g(spec)
      const result = maximumClique(graph)
      expect(result.exactness).toBe('exact')
      expect(result.value).not.toBeNull()
      expect(result.value!).toHaveLength(expected)
      expect(result.display).toBe(String(expected))
      expect(isClique(graph, result.value!)).toBe(true)
      if (expected > 0) {
        expect(result.witness).toMatchObject({ type: 'vertices', vertexIds: result.value! })
      }
    })
  }

  it('counts a vertex with a self-loop as a normal clique member', () => {
    const graph = g(['A-B', 'B-C', 'C-A', 'A-A'])
    const result = maximumClique(graph)
    expect(result.value!).toHaveLength(3)
    expect(result.detail).toMatch(/self-loop/i)
  })

  it('falls back to a labelled lower bound above the vertex limit', () => {
    const n = CLIQUE_EXACT_VERTEX_LIMIT + 4
    const spec = completeSpec(n)
    const graph = g(spec)
    const result = maximumClique(graph)
    expect(result.exactness).toBe('lower-bound')
    expect(result.display.startsWith('≥')).toBe(true)
    expect(result.explanation).toContain(String(CLIQUE_EXACT_VERTEX_LIMIT))
    expect(isClique(graph, result.value!)).toBe(true)
  })
})

describe('maximumIndependentSet', () => {
  const cases: [string, string[], number][] = [
    ['Petersen', PETERSEN, 4],
    ['C5', cycleSpec(5), 2],
    ['K5', completeSpec(5), 1],
    ['a star with 6 leaves', starSpec(6), 6],
    ['C6', cycleSpec(6), 3],
    ['the empty graph', [], 0],
    ['six isolated vertices', ['A', 'B', 'C', 'D', 'E', 'F'], 6],
  ]

  for (const [label, spec, expected] of cases) {
    it(`is ${expected} for ${label}`, () => {
      const graph = g(spec)
      const result = maximumIndependentSet(graph)
      expect(result.exactness).toBe('exact')
      expect(result.value!).toHaveLength(expected)
      expect(result.display).toBe(String(expected))
      expect(isIndependentSet(graph, result.value!)).toBe(true)
    })
  }

  it('matches brute force on small random graphs', () => {
    const rnd = mulberry32(31337)
    for (let trial = 0; trial < 12; trial++) {
      const n = 5 + Math.floor(rnd() * 5)
      const graph = g(randomSpec(n, 0.3 + rnd() * 0.4, rnd))
      const ids = graph.vertexIds
      let best = 0
      for (let mask = 0; mask < 1 << ids.length; mask++) {
        const chosen = ids.filter((_, i) => (mask >> i) & 1)
        if (chosen.length > best && isIndependentSet(graph, chosen)) best = chosen.length
      }
      expect(maximumIndependentSet(graph).value!).toHaveLength(best)
    }
  })
})

describe('maximalCliques', () => {
  it('finds every maximal clique of a triangle with a pendant', () => {
    const graph = g(['A-B', 'B-C', 'C-A', 'C-D'])
    const { cliques, complete } = maximalCliques(graph)
    expect(complete).toBe(true)
    const labelled = cliques.map((c) => graph.labels(c).join('')).sort()
    expect(labelled).toEqual(['ABC', 'CD'])
  })

  it('reports incompleteness rather than a short list when the budget runs out', () => {
    // Moon-Moser: complete multipartite with parts of three, 3^(n/3) maximal
    // cliques. At 45 vertices that is over 14 million, far past the budget.
    const n = 45
    const spec: string[] = []
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        if (Math.floor(i / 3) !== Math.floor(j / 3)) spec.push(`${name(i)}-${name(j)}`)
      }
    }
    const { cliques, complete } = maximalCliques(g(spec))
    expect(complete).toBe(false)
    expect(cliques.length).toBeGreaterThan(0)
  })
})

describe('greedy clique and independent set', () => {
  it('always returns something valid', () => {
    const rnd = mulberry32(4242)
    for (let trial = 0; trial < 10; trial++) {
      const graph = g(randomSpec(12, 0.2 + rnd() * 0.6, rnd))
      const clique = greedyClique(graph)
      const independent = greedyIndependentSet(graph)
      expect(isClique(graph, clique)).toBe(true)
      expect(isIndependentSet(graph, independent)).toBe(true)
      expect(clique.length).toBeLessThanOrEqual(maximumClique(graph).value!.length)
      expect(independent.length).toBeLessThanOrEqual(
        maximumIndependentSet(graph).value!.length,
      )
      // Deterministic: the heap-driven selection must not wobble between runs.
      expect(greedyClique(graph)).toEqual(clique)
      expect(greedyIndependentSet(graph)).toEqual(independent)
    }
  })
})

/* ------------------------------------------------------------------ */
/* Matching                                                            */
/* ------------------------------------------------------------------ */

describe('maximumMatching', () => {
  const cases: [string, string[], number][] = [
    ['C5', cycleSpec(5), 2],
    ['C6', cycleSpec(6), 3],
    ['K4', completeSpec(4), 2],
    ['Petersen', PETERSEN, 5],
    ['P5', pathSpec(5), 2],
    ['a triangle with three pendants', TRIANGLE_WITH_PENDANTS, 3],
    ['a bowtie', BOWTIE, 2],
    ['a star with 6 leaves', starSpec(6), 1],
    ['K3,3', completeBipartiteSpec(3, 3), 3],
    ['a triangle', cycleSpec(3), 1],
    ['the empty graph', [], 0],
    ['isolated vertices', ['A', 'B', 'C'], 0],
  ]

  for (const [label, spec, expected] of cases) {
    it(`is ${expected} for ${label}`, () => {
      const graph = g(spec)
      const result = maximumMatching(graph)
      expect(result.exactness).toBe('exact')
      expect(result.value.size).toBe(expected)
      expect(result.value.edgeIds).toHaveLength(expected)
      expect(isMatching(graph, result.value.edgeIds)).toBe(true)
      expect(result.value.isMaximum).toBe(true)
      // Bipartite graphs take the Hopcroft-Karp path, everything else blossom.
      expect(['blossom', 'hopcroft-karp']).toContain(result.value.method)
    })
  }

  it('picks Hopcroft-Karp for bipartite graphs and blossom otherwise', () => {
    expect(maximumMatching(g(cycleSpec(6))).value.method).toBe('hopcroft-karp')
    expect(maximumMatching(g(['A-X', 'A-Y', 'B-X', 'B-Z'])).value.method).toBe('hopcroft-karp')
    expect(maximumMatching(g(cycleSpec(5))).value.method).toBe('blossom')
    expect(maximumMatching(g(PETERSEN)).value.method).toBe('blossom')
    expect(maximumMatching(g(cycleSpec(6))).detail).toMatch(/Hopcroft-Karp/)
    expect(maximumMatching(g(cycleSpec(5))).detail).toMatch(/blossom/)
  })

  it('reports perfection honestly', () => {
    const perfect = maximumMatching(g(cycleSpec(6)))
    expect(perfect.value.isPerfect).toBe(true)
    expect(perfect.explanation).toMatch(/perfect/i)

    const petersen = maximumMatching(g(PETERSEN))
    expect(petersen.value.isPerfect).toBe(true)

    const nearPerfect = maximumMatching(g(cycleSpec(5)))
    expect(nearPerfect.value.isPerfect).toBe(false)
    expect(nearPerfect.explanation).toMatch(/near-perfect|unmatched/i)

    // A star matches one edge and leaves every other leaf out; few enough
    // unmatched vertices are named outright.
    const star = maximumMatching(g(starSpec(6)))
    expect(star.value.isPerfect).toBe(false)
    expect(star.explanation).toMatch(/unmatched/i)
    expect(star.explanation).toContain('C, D, E, F, G')

    // Too many to name, so they are counted instead.
    const bigStar = maximumMatching(g(starSpec(9)))
    expect(bigStar.value.size).toBe(1)
    expect(bigStar.explanation).toContain('8 vertices')
  })

  it('names the few unmatched vertices', () => {
    const graph = g(['A-B', 'C-D', 'E'])
    const result = maximumMatching(graph)
    expect(result.value.size).toBe(2)
    expect(result.explanation).toContain('E')
  })

  it('beats a greedy maximal matching where greedy is short', () => {
    const graph = g(TRIANGLE_WITH_PENDANTS)
    const greedy = maximalMatching(graph)
    const maximum = maximumMatching(graph)
    expect(greedy.size).toBe(2)
    expect(maximum.value.size).toBe(3)
    expect(greedy.size).toBeLessThan(maximum.value.size)
    // Greedy never claims to be maximum.
    expect(greedy.isMaximum).toBe(false)
    expect(greedy.method).toBe('greedy')
    expect(isMatching(graph, greedy.edgeIds)).toBe(true)
    // ...and the maximum is never reported as merely maximal.
    expect(maximum.value.isMaximum).toBe(true)
  })

  it('ignores self-loops and parallel edges', () => {
    const graph = g(['A-A', 'A-B', 'A-B', 'B-B', 'C-D'])
    const result = maximumMatching(graph)
    expect(result.value.size).toBe(2)
    expect(isMatching(graph, result.value.edgeIds)).toBe(true)
    expect(result.detail).toMatch(/self-loop/i)
    expect(result.detail).toMatch(/parallel/i)

    const loopsOnly = maximumMatching(g(['A-A', 'B-B']))
    expect(loopsOnly.value.size).toBe(0)
  })

  it('declines above the vertex limit instead of guessing', () => {
    const n = MATCHING_VERTEX_LIMIT + 1
    const graph = g(pathSpec(n))
    expect(graph.order).toBe(n)
    const result = maximumMatching(graph)
    expect(result.exactness).toBe('not-computed')
    expect(result.display).toMatch(/not computed/i)
    expect(result.value.isMaximum).toBe(false)
    expect(result.value.method).toBe('greedy')
    expect(result.explanation).toContain(String(MATCHING_VERTEX_LIMIT))
    // What it does show is still a real matching.
    expect(isMatching(graph, result.value.edgeIds)).toBe(true)
  })

  /* The test that catches blossom bugs. */
  it('agrees with brute force on 30 seeded random graphs', () => {
    const rnd = mulberry32(20260827)
    const mismatches: string[] = []
    for (let trial = 0; trial < 30; trial++) {
      const n = 4 + Math.floor(rnd() * 7) // 4..10 vertices
      const p = 0.15 + rnd() * 0.6
      const spec = randomSpec(n, p, rnd)
      // Sprinkle in the awkward cases a matching has to survive.
      if (rnd() < 0.3) spec.push(`${name(Math.floor(rnd() * n))}-${name(Math.floor(rnd() * n))}`)
      if (rnd() < 0.3) {
        const a = Math.floor(rnd() * n)
        spec.push(`${name(a)}-${name(a)}`)
      }
      const graph = g(spec)
      const result = maximumMatching(graph)
      const brute = bruteForceMatchingSize(graph)
      expect(isMatching(graph, result.value.edgeIds)).toBe(true)
      if (result.value.size !== brute) {
        mismatches.push(`trial ${trial} (n=${n}): blossom ${result.value.size}, brute ${brute}`)
      }
    }
    expect(mismatches).toEqual([])
  })

  it('agrees with brute force on odd-cycle-heavy graphs, where naive search fails', () => {
    const rnd = mulberry32(5150)
    for (let trial = 0; trial < 15; trial++) {
      // Triangles wired together: every augmenting path has to cross a blossom.
      const triangles = 2 + Math.floor(rnd() * 2)
      const spec: string[] = []
      for (let t = 0; t < triangles; t++) {
        const a = name(3 * t)
        const b = name(3 * t + 1)
        const c = name(3 * t + 2)
        spec.push(`${a}-${b}`, `${b}-${c}`, `${c}-${a}`)
        if (t > 0) spec.push(`${name(3 * (t - 1))}-${a}`)
      }
      if (rnd() < 0.5) spec.push(`${name(0)}-${name(3 * triangles - 1)}`)
      const graph = g(spec)
      const result = maximumMatching(graph)
      expect(result.value.size).toBe(bruteForceMatchingSize(graph))
      expect(isMatching(graph, result.value.edgeIds)).toBe(true)
    }
  })
})

describe('bipartiteMaximumMatching', () => {
  const split = (graph: Graph, prefix: string): [VertexId[], VertexId[]] => [
    graph.vertexIds.filter((id) => graph.label(id).startsWith(prefix)),
    graph.vertexIds.filter((id) => !graph.label(id).startsWith(prefix)),
  ]

  it('matches Hopcroft-Karp against blossom on K3,3 and friends', () => {
    for (const [m, n, expected] of [
      [3, 3, 3],
      [2, 5, 2],
      [4, 4, 4],
      [1, 6, 1],
    ] as [number, number, number][]) {
      const graph = g(completeBipartiteSpec(m, n))
      const result = bipartiteMaximumMatching(graph, split(graph, 'L'))
      expect(result.size).toBe(expected)
      expect(result.method).toBe('hopcroft-karp')
      expect(result.isMaximum).toBe(true)
      expect(isMatching(graph, result.edgeIds)).toBe(true)
      expect(result.size).toBe(maximumMatching(graph).value.size)
    }
  })

  it('agrees with blossom on random bipartite graphs', () => {
    const rnd = mulberry32(864213)
    for (let trial = 0; trial < 15; trial++) {
      const m = 2 + Math.floor(rnd() * 5)
      const n = 2 + Math.floor(rnd() * 5)
      const spec: string[] = []
      for (let i = 0; i < m; i++) for (let j = 0; j < n; j++) if (rnd() < 0.45) spec.push(`L${i}-R${j}`)
      for (let i = 0; i < m; i++) spec.push(`L${i}`)
      for (let j = 0; j < n; j++) spec.push(`R${j}`)
      const graph = g(spec)
      const hk = bipartiteMaximumMatching(graph, split(graph, 'L'))
      expect(isMatching(graph, hk.edgeIds)).toBe(true)
      expect(hk.size).toBe(maximumMatching(graph).value.size)
      expect(hk.size).toBe(bruteForceMatchingSize(graph))
    }
  })

  it('reports perfection across the whole graph, not just one side', () => {
    const graph = g(completeBipartiteSpec(3, 3))
    const result = bipartiteMaximumMatching(graph, split(graph, 'L'))
    expect(result.isPerfect).toBe(true)

    const lopsided = g(completeBipartiteSpec(2, 4))
    const partial = bipartiteMaximumMatching(lopsided, split(lopsided, 'L'))
    expect(partial.isPerfect).toBe(false)
  })
})

describe('maximalMatching', () => {
  it('is maximal: no edge can be added', () => {
    for (const spec of [TRIANGLE_WITH_PENDANTS, PETERSEN, cycleSpec(7), BOWTIE, TREE]) {
      const graph = g(spec)
      const result = maximalMatching(graph)
      expect(isMatching(graph, result.edgeIds)).toBe(true)
      const covered = new Set<VertexId>()
      for (const id of result.edgeIds) {
        const e = graph.edge(id)!
        covered.add(e.source)
        covered.add(e.target)
      }
      for (const e of graph.edges) {
        if (e.source === e.target) continue
        expect(covered.has(e.source) || covered.has(e.target)).toBe(true)
      }
      // Maximal is at least half of maximum — the standard guarantee.
      expect(result.size * 2).toBeGreaterThanOrEqual(maximumMatching(graph).value.size)
    }
  })
})

/* ------------------------------------------------------------------ */
/* Minimum spanning tree                                               */
/* ------------------------------------------------------------------ */

describe('minimumSpanningTree', () => {
  const weighted: [string, string[], number, number][] = [
    ['a weighted path with a heavy shortcut', ['A-B:1', 'B-C:2', 'C-D:3', 'A-D:10'], 6, 3],
    ['a weighted triangle', ['A-B:5', 'B-C:1', 'A-C:2'], 3, 2],
    [
      'a five-vertex weighted graph',
      ['A-B:2', 'A-C:3', 'B-C:1', 'B-D:4', 'C-D:5', 'D-E:7'],
      14,
      4,
    ],
  ]

  for (const [label, spec, total, edges] of weighted) {
    it(`weighs ${total} on ${label}`, () => {
      const graph = g(spec, { weighted: true })
      const result = minimumSpanningTree(graph)
      expect(result.exactness).toBe('exact')
      expect(result.value).not.toBeNull()
      expect(result.value!.totalWeight).toBe(total)
      expect(result.value!.edgeIds).toHaveLength(edges)
      expect(result.value!.spansAll).toBe(true)
      expect(result.value!.componentCount).toBe(1)
      expect(isTreeOrForest(graph, result.value!.edgeIds)).toBe(true)
      expect(result.witness).toMatchObject({ type: 'tree', edgeIds: result.value!.edgeIds })
    })
  }

  it('returns a forest, and says so, when the graph is disconnected', () => {
    const graph = g(['A-B:1', 'C-D:2', 'E'], { weighted: true })
    const result = minimumSpanningTree(graph)
    expect(result.value!.spansAll).toBe(false)
    expect(result.value!.componentCount).toBe(3)
    expect(result.value!.edgeIds).toHaveLength(2)
    expect(result.value!.totalWeight).toBe(3)
    expect(result.explanation).toMatch(/forest/i)
    expect(result.explanation).toContain('3 components')
    expect(result.exactness).toBe('exact')
  })

  it('totals V minus the component count on an unweighted graph', () => {
    for (const spec of [cycleSpec(5), TREE, PETERSEN, K4_MINUS_EDGE]) {
      const graph = g(spec)
      const result = minimumSpanningForest(graph)
      expect(result.totalWeight).toBe(graph.order - result.componentCount)
      expect(result.edgeIds).toHaveLength(graph.order - result.componentCount)
    }
    const split = g([...cycleSpec(4), 'X-Y', 'Z'])
    const forest = minimumSpanningForest(split)
    expect(forest.componentCount).toBe(3)
    expect(forest.totalWeight).toBe(split.order - 3)
  })

  it('handles negative weights without alarm', () => {
    const graph = g(['A-B:-5', 'B-C:-2', 'A-C:1'], { weighted: true })
    const result = minimumSpanningTree(graph)
    expect(result.value!.totalWeight).toBe(-7)
    expect(result.exactness).toBe('exact')
    expect(result.status).not.toBe('danger')
    expect(result.detail).toMatch(/negative/i)
  })

  it('breaks weight ties by document order', () => {
    const graph = g(['A-B:1', 'A-C:1', 'B-C:1'], { weighted: true })
    const result = minimumSpanningTree(graph)
    expect(result.value!.edgeIds).toEqual(graph.edgeIds.slice(0, 2))
  })

  it('skips self-loops', () => {
    const graph = g(['A-A:1', 'A-B:2', 'B-C:3'], { weighted: true })
    const result = minimumSpanningTree(graph)
    expect(result.value!.edgeIds).toHaveLength(2)
    expect(result.value!.totalWeight).toBe(5)
    expect(result.detail).toMatch(/self-loop/i)
  })

  it('says plainly what it does with a digraph', () => {
    const graph = g(['A->B:1', 'B->C:2', 'C->A:9'], { weighted: true, directed: true })
    const result = minimumSpanningTree(graph)
    expect(result.value!.totalWeight).toBe(3)
    expect(result.detail).toMatch(/undirected/i)
    expect(result.detail).toMatch(/arborescence/i)
  })

  it('has nothing to span in an empty graph', () => {
    const result = minimumSpanningTree(g([]))
    expect(result.value).toBeNull()
    expect(result.exactness).toBe('not-applicable')
  })
})

/* ------------------------------------------------------------------ */
/* Hamiltonicity                                                       */
/* ------------------------------------------------------------------ */

describe('hamiltonian', () => {
  it('finds a cycle in C5', () => {
    const graph = g(cycleSpec(5))
    const result = hamiltonian(graph)
    expect(result.value.cycle).not.toBeNull()
    expect(result.value.searched).toBe(true)
    expect(result.exactness).toBe('exact')
    expect(result.display).toMatch(/cycle/i)
    expect(new Set(result.value.cycle!).size).toBe(5)
    expect(result.witness?.type).toBe('cycle')
    expect(result.witness).toMatchObject({ type: 'cycle' })
    if (result.witness?.type === 'cycle') {
      expect(result.witness.edgeIds).toHaveLength(5)
      expect(result.witness.vertexIds).toHaveLength(5)
    }
    // A cycle implies a path.
    expect(result.value.path).not.toBeNull()
  })

  it('finds a cycle in K4', () => {
    const graph = g(completeSpec(4))
    const result = hamiltonian(graph)
    expect(result.value.cycle).not.toBeNull()
    expect(new Set(result.value.cycle!).size).toBe(4)
    // Consecutive vertices really are adjacent, including the closing step.
    const cycle = result.value.cycle!
    for (let i = 0; i < cycle.length; i++) {
      expect(graph.hasEdge(cycle[i], cycle[(i + 1) % cycle.length])).toBe(true)
    }
  })

  it('finds a path but no cycle in P4', () => {
    const graph = g(pathSpec(4))
    const result = hamiltonian(graph)
    expect(result.value.cycle).toBeNull()
    expect(result.value.path).not.toBeNull()
    expect(result.value.path!).toHaveLength(4)
    expect(result.value.searched).toBe(true)
    expect(result.exactness).toBe('exact')
    expect(result.display).toMatch(/path/i)
    expect(result.witness?.type).toBe('path')
    // The "no cycle" half is proved by the degree-1 ends.
    expect(result.explanation).toMatch(/at most one neighbour/i)
    const path = result.value.path!
    for (let i = 0; i + 1 < path.length; i++) {
      expect(graph.hasEdge(path[i], path[i + 1])).toBe(true)
    }
  })

  it('rules a star out with a degree argument, not a search', () => {
    const graph = g(starSpec(4))
    const result = hamiltonian(graph)
    expect(result.value.cycle).toBeNull()
    expect(result.value.path).toBeNull()
    expect(result.value.searched).toBe(true)
    expect(result.exactness).toBe('exact')
    expect(result.display).toBe('No')
    expect(result.explanation).toMatch(/at most one neighbour/i)
    expect(result.explanation).toMatch(/only two ends|two ends/i)
  })

  it('rules a disconnected graph out exactly', () => {
    const graph = g([...cycleSpec(4), 'X-Y'])
    const result = hamiltonian(graph)
    expect(result.display).toBe('No')
    expect(result.exactness).toBe('exact')
    expect(result.value.searched).toBe(true)
    expect(result.explanation).toMatch(/components/i)
  })

  it('never says No above the search limit', () => {
    const n = HAMILTONIAN_EXACT_VERTEX_LIMIT + 5
    const graph = g(cycleSpec(n))
    expect(graph.order).toBeGreaterThan(HAMILTONIAN_EXACT_VERTEX_LIMIT)
    const result = hamiltonian(graph)
    expect(result.value.searched).toBe(false)
    expect(result.value.cycle).toBeNull()
    expect(result.exactness).toBe('not-computed')
    expect(result.display).toMatch(/not computed/i)
    expect(result.display).not.toBe('No')
    expect(result.explanation).toContain(String(HAMILTONIAN_EXACT_VERTEX_LIMIT))
    expect(result.explanation).toMatch(/not the same as "no"/i)
  })

  it('still proves "no cycle" above the limit when a degree does it for free', () => {
    const n = HAMILTONIAN_EXACT_VERTEX_LIMIT + 5
    const graph = g([...pathSpec(n)]) // two ends of degree 1
    const result = hamiltonian(graph)
    expect(result.exactness).toBe('not-computed')
    expect(result.value.searched).toBe(false)
    expect(result.explanation).toMatch(/at most one neighbour/i)
    expect(result.explanation).toMatch(/not computed/i)
    expect(result.display).not.toBe('No')
  })

  it('says no, exhaustively, for a small graph with neither', () => {
    // K2,4: connected, min degree 2, but too lopsided for any tour.
    const graph = g(completeBipartiteSpec(2, 4))
    const result = hamiltonian(graph)
    expect(result.value.cycle).toBeNull()
    expect(result.value.path).toBeNull()
    expect(result.display).toBe('No')
    expect(result.exactness).toBe('exact')
    expect(result.detail).toMatch(/proved/i)
  })

  it('knows Petersen has a path but no cycle', () => {
    const graph = g(PETERSEN)
    const result = hamiltonian(graph)
    expect(result.value.cycle).toBeNull()
    expect(result.value.path).not.toBeNull()
    expect(result.value.path!).toHaveLength(10)
    expect(result.exactness).toBe('exact')
  })

  it('handles the degenerate sizes', () => {
    expect(hamiltonian(g([])).exactness).toBe('not-applicable')

    const single = hamiltonian(g(['A']))
    expect(single.value.path).toHaveLength(1)
    expect(single.value.cycle).toBeNull()

    const pair = hamiltonian(g(['A-B']))
    expect(pair.value.path).toHaveLength(2)
    expect(pair.value.cycle).toBeNull()
    expect(pair.explanation).toMatch(/three vertices/i)
  })

  it('follows the arrows on a digraph', () => {
    const cycle = g(['A->B', 'B->C', 'C->A'], { directed: true })
    expect(hamiltonian(cycle).value.cycle).not.toBeNull()

    const broken = g(['A->B', 'C->B', 'A->C'], { directed: true })
    const result = hamiltonian(broken)
    expect(result.value.cycle).toBeNull()
    expect(result.exactness).toBe('exact')
  })
})

/* ------------------------------------------------------------------ */
/* The product rule, checked across the module                         */
/* ------------------------------------------------------------------ */

describe('honesty', () => {
  it('never labels an inexact answer as exact, and always explains itself', () => {
    const specs: string[][] = [
      cycleSpec(5),
      completeSpec(5),
      PETERSEN,
      bigMycielskiSpec(),
      cycleSpec(HAMILTONIAN_EXACT_VERTEX_LIMIT + 3),
      randomSpec(30, 0.5, mulberry32(11)),
    ]
    for (const spec of specs) {
      const graph = g(spec)
      const results = [
        chromaticNumber(graph),
        maximumClique(graph),
        maximumIndependentSet(graph),
        maximumMatching(graph),
        minimumSpanningTree(graph),
        hamiltonian(graph),
      ]
      for (const result of results) {
        expect(result.exactness).toBeDefined()
        expect(result.display.length).toBeGreaterThan(0)
        if (result.exactness !== 'exact') {
          expect(result.explanation && result.explanation.length > 20).toBe(true)
        }
      }
    }
  })
})
