import { describe, expect, it } from 'vitest'

import { Graph } from '../model/graph'
import type { GraphDocument } from '../model/types'
import {
  GENERATORS,
  GeneratorError,
  generate,
  generatorById,
} from './index'
import { parseGraphCommand } from './commands'

/* ------------------------------------------------------------------ */
/* Local helpers — deliberately self-contained so this file never      */
/* depends on analysis modules that may not exist yet.                 */
/* ------------------------------------------------------------------ */

const build = (
  id: string,
  params: Record<string, number> = {},
  options?: { seed?: number; directed?: boolean; weighted?: boolean },
): Graph => new Graph(generate(id, params, options))

/** Structure fingerprint in terms of labels, so ids may differ between runs. */
const signature = (doc: GraphDocument): string => {
  const label = new Map(doc.vertices.map((v) => [v.id, v.label]))
  return doc.edges
    .map((e) => {
      const a = label.get(e.source) ?? e.source
      const b = label.get(e.target) ?? e.target
      return a <= b ? `${a}-${b}` : `${b}-${a}`
    })
    .sort()
    .join(' ')
}

/** Tiny BFS over the undirected incidence structure. */
const isConnected = (doc: GraphDocument): boolean => {
  if (doc.vertices.length === 0) return true
  const adj = new Map<string, string[]>()
  for (const v of doc.vertices) adj.set(v.id, [])
  for (const e of doc.edges) {
    adj.get(e.source)?.push(e.target)
    adj.get(e.target)?.push(e.source)
  }
  const start = doc.vertices[0].id
  const seen = new Set<string>([start])
  const queue: string[] = [start]
  while (queue.length > 0) {
    const current = queue.shift() as string
    for (const next of adj.get(current) ?? []) {
      if (!seen.has(next)) {
        seen.add(next)
        queue.push(next)
      }
    }
  }
  return seen.size === doc.vertices.length
}

/** Union-find cycle detection, ignoring edge direction. */
const hasCycle = (doc: GraphDocument): boolean => {
  const parent = new Map<string, string>()
  for (const v of doc.vertices) parent.set(v.id, v.id)
  const find = (x: string): string => {
    let root = x
    while (parent.get(root) !== root) root = parent.get(root) as string
    return root
  }
  for (const e of doc.edges) {
    const a = find(e.source)
    const b = find(e.target)
    if (a === b) return true
    parent.set(a, b)
  }
  return false
}

const degreesAscending = (g: Graph): number[] =>
  g.degreeSequence().slice().sort((a, b) => a - b)

const degreeCounts = (g: Graph): Map<number, number> => {
  const counts = new Map<number, number>()
  for (const id of g.vertexIds) {
    const d = g.degree(id)
    counts.set(d, (counts.get(d) ?? 0) + 1)
  }
  return counts
}

/* ------------------------------------------------------------------ */
/* Classic families                                                    */
/* ------------------------------------------------------------------ */

describe('complete graph Kn', () => {
  it('has n vertices, n(n-1)/2 edges and is (n-1)-regular', () => {
    for (const n of [1, 2, 3, 5, 8, 12]) {
      const g = build('complete', { n })
      expect(g.order).toBe(n)
      expect(g.size).toBe((n * (n - 1)) / 2)
      expect(g.degreeSequence()).toEqual(Array.from({ length: n }, () => n - 1))
      expect(g.isSimple()).toBe(true)
    }
  })

  it('joins every pair exactly once', () => {
    const g = build('complete', { n: 6 })
    const ids = g.vertexIds
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        expect(g.edgesBetween(ids[i], ids[j])).toHaveLength(1)
      }
    }
  })

  it('rejects n below the minimum', () => {
    expect(() => build('complete', { n: 0 })).toThrow(GeneratorError)
  })

  it('reports K200 as 19900 edges without building it', () => {
    const def = generatorById('complete')
    expect(def?.estimateSize?.({ n: 200 })).toEqual({ vertices: 200, edges: 19900 })
  })
})

describe('cycle Cn', () => {
  it('has n vertices, n edges and is 2-regular', () => {
    for (const n of [3, 4, 7, 20]) {
      const g = build('cycle', { n })
      expect(g.order).toBe(n)
      expect(g.size).toBe(n)
      expect(g.degreeSequence()).toEqual(Array.from({ length: n }, () => 2))
      expect(g.isSimple()).toBe(true)
      expect(isConnected(g.toDocument())).toBe(true)
    }
  })

  it('needs at least three vertices', () => {
    expect(() => build('cycle', { n: 2 })).toThrow(GeneratorError)
    expect(() => build('cycle', { n: 2 })).toThrow(/at least 3 vertices/)
  })
})

describe('path Pn', () => {
  it('has n vertices and n-1 edges', () => {
    for (const n of [2, 3, 6, 15]) {
      const g = build('path', { n })
      expect(g.order).toBe(n)
      expect(g.size).toBe(n - 1)
    }
  })

  it('has degree sequence [2,...,2,1,1] for n >= 2', () => {
    for (const n of [2, 3, 6, 15]) {
      const g = build('path', { n })
      const expected =
        n === 2 ? [1, 1] : [...Array.from({ length: n - 2 }, () => 2), 1, 1]
      expect(g.degreeSequence()).toEqual(expected)
    }
  })

  it('degenerates gracefully to a single vertex', () => {
    const g = build('path', { n: 1 })
    expect(g.order).toBe(1)
    expect(g.size).toBe(0)
    expect(g.degreeSequence()).toEqual([0])
  })
})

describe('complete bipartite Km,n', () => {
  it('has m+n vertices, m*n edges and the right degrees', () => {
    for (const [m, n] of [
      [1, 1],
      [2, 3],
      [3, 3],
      [4, 7],
    ]) {
      const g = build('completeBipartite', { m, n })
      expect(g.order).toBe(m + n)
      expect(g.size).toBe(m * n)
      expect(g.isSimple()).toBe(true)

      // m vertices of degree n, and n vertices of degree m.
      const counts = degreeCounts(g)
      if (m === n) {
        expect(counts.get(n)).toBe(m + n)
      } else {
        expect(counts.get(n)).toBe(m)
        expect(counts.get(m)).toBe(n)
      }
    }
  })

  it('keeps the two parts independent', () => {
    const g = build('completeBipartite', { m: 3, n: 4 })
    const ids = g.vertexIds
    const left = ids.slice(0, 3)
    const right = ids.slice(3)
    for (let i = 0; i < left.length; i++) {
      for (let j = i + 1; j < left.length; j++) {
        expect(g.hasEdge(left[i], left[j])).toBe(false)
      }
    }
    for (let i = 0; i < right.length; i++) {
      for (let j = i + 1; j < right.length; j++) {
        expect(g.hasEdge(right[i], right[j])).toBe(false)
      }
    }
    for (const a of left) for (const b of right) expect(g.hasEdge(a, b)).toBe(true)
  })

  it('separates the parts horizontally', () => {
    const doc = generate('completeBipartite', { m: 2, n: 2 })
    const xs = doc.vertices.map((v) => v.x)
    expect(new Set(xs).size).toBe(2)
  })
})

describe('star Sn — n leaves plus one centre', () => {
  it('has n+1 vertices and n edges', () => {
    for (const n of [1, 2, 5, 11]) {
      const g = build('star', { n })
      expect(g.order).toBe(n + 1)
      expect(g.size).toBe(n)
      expect(g.isSimple()).toBe(true)
      expect(isConnected(g.toDocument())).toBe(true)
      // One hub of degree n, n leaves of degree 1.
      expect(degreesAscending(g)).toEqual([
        ...Array.from({ length: n }, () => 1),
        n,
      ].sort((a, b) => a - b))
    }
  })

  it('matches K1,n exactly', () => {
    const star = build('star', { n: 5 })
    const bipartite = build('completeBipartite', { m: 1, n: 5 })
    expect(star.degreeSequence()).toEqual(bipartite.degreeSequence())
    expect(star.order).toBe(bipartite.order)
    expect(star.size).toBe(bipartite.size)
  })
})

describe('wheel Wn — rim Cn plus a hub', () => {
  it('has n+1 vertices and 2n edges', () => {
    for (const n of [3, 4, 6, 9]) {
      const g = build('wheel', { n })
      expect(g.order).toBe(n + 1)
      expect(g.size).toBe(2 * n)
      expect(g.isSimple()).toBe(true)
      // Hub has degree n; every rim vertex has degree 3.
      const counts = degreeCounts(g)
      if (n === 3) {
        expect(counts.get(3)).toBe(4) // W3 is K4
      } else {
        expect(counts.get(n)).toBe(1)
        expect(counts.get(3)).toBe(n)
      }
    }
  })

  it('needs a rim of at least three vertices', () => {
    expect(() => build('wheel', { n: 2 })).toThrow(GeneratorError)
  })
})

describe('grid r x c', () => {
  it('has r*c vertices and r(c-1) + c(r-1) edges', () => {
    for (const [rows, cols] of [
      [1, 1],
      [1, 5],
      [3, 4],
      [5, 5],
      [2, 9],
    ]) {
      const g = build('grid', { rows, cols })
      expect(g.order).toBe(rows * cols)
      expect(g.size).toBe(rows * (cols - 1) + cols * (rows - 1))
      expect(g.isSimple()).toBe(true)
      expect(isConnected(g.toDocument())).toBe(true)
    }
  })

  it('places vertices on a lattice', () => {
    const doc = generate('grid', { rows: 3, cols: 4 })
    expect(new Set(doc.vertices.map((v) => v.x)).size).toBe(4)
    expect(new Set(doc.vertices.map((v) => v.y)).size).toBe(3)
  })
})

describe('hypercube Qn', () => {
  it('has 2^n vertices, n*2^(n-1) edges and is n-regular', () => {
    for (let n = 0; n <= 4; n++) {
      const g = build('hypercube', { n })
      const count = 2 ** n
      expect(g.order).toBe(count)
      expect(g.size).toBe((n * count) / 2)
      expect(g.degreeSequence()).toEqual(Array.from({ length: count }, () => n))
      expect(g.isSimple()).toBe(true)
    }
  })

  it('draws every vertex at a distinct point, up to Q7', () => {
    for (let n = 0; n <= 7; n++) {
      const doc = generate('hypercube', { n })
      const points = new Set(doc.vertices.map((v) => `${v.x.toFixed(3)},${v.y.toFixed(3)}`))
      expect(points.size).toBe(doc.vertices.length)
    }
  })

  it('joins vertices whose indices differ in one bit', () => {
    const g = build('hypercube', { n: 3 })
    const ids = g.vertexIds
    for (let i = 0; i < 8; i++) {
      for (let j = 0; j < 8; j++) {
        if (i === j) continue
        const differsInOneBit = ((i ^ j) & ((i ^ j) - 1)) === 0
        expect(g.hasEdge(ids[i], ids[j])).toBe(differsInOneBit)
      }
    }
  })
})

describe('Petersen graph', () => {
  it('is the 3-regular graph on 10 vertices and 15 edges', () => {
    const g = build('petersen')
    expect(g.order).toBe(10)
    expect(g.size).toBe(15)
    expect(g.degreeSequence()).toEqual(Array.from({ length: 10 }, () => 3))
    expect(g.isSimple()).toBe(true)
    expect(isConnected(g.toDocument())).toBe(true)
  })

  it('labels all ten vertices distinctly', () => {
    const doc = generate('petersen', {})
    expect(new Set(doc.vertices.map((v) => v.label)).size).toBe(10)
  })

  it('has girth 5 — no triangles and no squares', () => {
    const g = build('petersen')
    const ids = g.vertexIds
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const common = ids.filter(
          (k) => k !== ids[i] && k !== ids[j] && g.hasEdge(ids[i], k) && g.hasEdge(ids[j], k),
        )
        // Adjacent vertices share no neighbour (no triangle); non-adjacent
        // vertices share exactly one (so no 4-cycle either).
        expect(common.length).toBe(g.hasEdge(ids[i], ids[j]) ? 0 : 1)
      }
    }
  })

  it('draws a pentagon outside a pentagram', () => {
    const doc = generate('petersen', {})
    const radii = doc.vertices.map((v) => Math.hypot(v.x, v.y))
    const outer = radii.slice(0, 5)
    const inner = radii.slice(5)
    expect(Math.min(...outer)).toBeGreaterThan(Math.max(...inner))
  })
})

describe('complete r-ary tree', () => {
  it('is a tree with the expected order', () => {
    for (const [r, h] of [
      [2, 0],
      [2, 3],
      [3, 2],
      [1, 5],
    ]) {
      const doc = generate('completeTree', { r, h })
      const expected = r === 1 ? h + 1 : (r ** (h + 1) - 1) / (r - 1)
      expect(doc.vertices).toHaveLength(expected)
      expect(doc.edges).toHaveLength(expected - 1)
      expect(isConnected(doc)).toBe(true)
      expect(hasCycle(doc)).toBe(false)
    }
  })
})

/* ------------------------------------------------------------------ */
/* Random families                                                     */
/* ------------------------------------------------------------------ */

describe('Erdos-Renyi G(n, p)', () => {
  it('is deterministic for a fixed seed', () => {
    const a = generate('erdosRenyi', { n: 24, p: 0.3 }, { seed: 42 })
    const b = generate('erdosRenyi', { n: 24, p: 0.3 }, { seed: 42 })
    expect(signature(a)).toBe(signature(b))
    expect(a.edges.length).toBe(b.edges.length)
  })

  it('changes when the seed changes', () => {
    const a = generate('erdosRenyi', { n: 24, p: 0.3 }, { seed: 1 })
    const b = generate('erdosRenyi', { n: 24, p: 0.3 }, { seed: 2 })
    expect(signature(a)).not.toBe(signature(b))
  })

  it('gives the empty graph at p = 0', () => {
    const g = build('erdosRenyi', { n: 15, p: 0 }, { seed: 7 })
    expect(g.order).toBe(15)
    expect(g.size).toBe(0)
  })

  it('gives the complete graph at p = 1', () => {
    const n = 9
    const g = build('erdosRenyi', { n, p: 1 }, { seed: 7 })
    expect(g.size).toBe((n * (n - 1)) / 2)
    expect(g.degreeSequence()).toEqual(Array.from({ length: n }, () => n - 1))
    expect(g.isSimple()).toBe(true)
  })

  it('lands near the expected density', () => {
    const n = 60
    const p = 0.5
    const g = build('erdosRenyi', { n, p }, { seed: 99 })
    const pairs = (n * (n - 1)) / 2
    expect(g.size).toBeGreaterThan(pairs * 0.4)
    expect(g.size).toBeLessThan(pairs * 0.6)
  })

  it('refuses a probability outside [0, 1]', () => {
    expect(() => build('erdosRenyi', { n: 10, p: 1.5 })).toThrow(GeneratorError)
    expect(() => build('erdosRenyi', { n: 10, p: -0.1 })).toThrow(GeneratorError)
  })
})

describe('random tree', () => {
  it('is a tree: n-1 edges, connected and acyclic', () => {
    for (const n of [1, 2, 3, 7, 40]) {
      const doc = generate('randomTree', { n }, { seed: 2024 })
      expect(doc.vertices).toHaveLength(n)
      expect(doc.edges).toHaveLength(n - 1)
      expect(isConnected(doc)).toBe(true)
      expect(hasCycle(doc)).toBe(false)
      expect(new Graph(doc).isSimple()).toBe(true)
    }
  })

  it('is deterministic for a fixed seed', () => {
    const a = generate('randomTree', { n: 30 }, { seed: 5 })
    const b = generate('randomTree', { n: 30 }, { seed: 5 })
    expect(signature(a)).toBe(signature(b))
    expect(signature(a)).not.toBe(signature(generate('randomTree', { n: 30 }, { seed: 6 })))
  })

  it('samples uniformly from the 16 labelled trees on 4 vertices', () => {
    // Cayley: n^(n-2) = 4^2 = 16 labelled trees. A uniform Prufer sequence
    // must reach all of them, and 4 of the 16 are stars, so roughly a quarter
    // of the samples should have a degree-3 vertex.
    const seen = new Map<string, number>()
    let stars = 0
    const samples = 1600
    for (let i = 0; i < samples; i++) {
      const doc = generate('randomTree', { n: 4 }, { seed: i * 2654435761 })
      const key = signature(doc)
      seen.set(key, (seen.get(key) ?? 0) + 1)
      if (new Graph(doc).degreeSequence()[0] === 3) stars += 1
    }
    expect(seen.size).toBe(16)
    expect(stars / samples).toBeGreaterThan(0.19)
    expect(stars / samples).toBeLessThan(0.31)
    for (const count of seen.values()) {
      expect(count).toBeGreaterThan(samples / 16 / 2)
    }
  })
})

describe('random d-regular graph', () => {
  it('gives every vertex degree exactly d', () => {
    for (const [n, d] of [
      [10, 3],
      [12, 4],
      [16, 5],
      [30, 3],
      [9, 4],
    ]) {
      const g = build('randomRegular', { n, d }, { seed: 11 })
      expect(g.order).toBe(n)
      expect(g.size).toBe((n * d) / 2)
      expect(g.degreeSequence()).toEqual(Array.from({ length: n }, () => d))
      expect(g.isSimple()).toBe(true)
    }
  })

  it('handles d = 0 as an empty graph', () => {
    const g = build('randomRegular', { n: 6, d: 0 }, { seed: 3 })
    expect(g.order).toBe(6)
    expect(g.size).toBe(0)
  })

  it('is deterministic for a fixed seed', () => {
    const a = generate('randomRegular', { n: 14, d: 3 }, { seed: 8 })
    const b = generate('randomRegular', { n: 14, d: 3 }, { seed: 8 })
    expect(signature(a)).toBe(signature(b))
  })

  it('throws when n*d is odd', () => {
    expect(() => build('randomRegular', { n: 5, d: 3 })).toThrow(GeneratorError)
    expect(() => build('randomRegular', { n: 5, d: 3 })).toThrow(/odd/)
    expect(() => build('randomRegular', { n: 7, d: 1 })).toThrow(GeneratorError)
  })

  it('throws when d is too large for n', () => {
    expect(() => build('randomRegular', { n: 4, d: 4 })).toThrow(GeneratorError)
  })
})

/* ------------------------------------------------------------------ */
/* Registry-wide invariants                                            */
/* ------------------------------------------------------------------ */

describe('every generator', () => {
  it('produces finite positions and distinct labels from its defaults', () => {
    for (const def of GENERATORS) {
      const doc = generate(def.id, {}, { seed: 1234 })
      expect(doc.vertices.length, def.id).toBeGreaterThan(0)
      for (const v of doc.vertices) {
        expect(Number.isFinite(v.x), `${def.id}/${v.label}.x`).toBe(true)
        expect(Number.isFinite(v.y), `${def.id}/${v.label}.y`).toBe(true)
      }
      const labels = new Set(doc.vertices.map((v) => v.label))
      expect(labels.size, def.id).toBe(doc.vertices.length)
    }
  })

  it('emits edges that reference real vertices', () => {
    for (const def of GENERATORS) {
      const doc = generate(def.id, {}, { seed: 5 })
      const ids = new Set(doc.vertices.map((v) => v.id))
      for (const e of doc.edges) {
        expect(ids.has(e.source), def.id).toBe(true)
        expect(ids.has(e.target), def.id).toBe(true)
        expect(e.source).not.toBe(e.target)
      }
      expect(new Graph(doc).size, def.id).toBe(doc.edges.length)
    }
  })

  it('honours the directed and weighted flags', () => {
    for (const def of GENERATORS) {
      const doc = generate(def.id, {}, { seed: 5, directed: true, weighted: true })
      expect(doc.directed, def.id).toBe(true)
      expect(doc.weighted, def.id).toBe(true)
      for (const e of doc.edges) expect(e.weight).toBe(1)
    }
  })

  it('estimates its own size correctly', () => {
    for (const def of GENERATORS) {
      if (!def.estimateSize) continue
      const params: Record<string, number> = {}
      for (const p of def.params) params[p.key] = p.default
      const doc = generate(def.id, params, { seed: 5 })
      const estimate = def.estimateSize(params)
      expect(estimate.vertices, def.id).toBe(doc.vertices.length)
      if (def.category === 'classic') {
        expect(estimate.edges, def.id).toBe(doc.edges.length)
      }
    }
  })

  it('has unique ids and a well-formed parameter spec', () => {
    expect(new Set(GENERATORS.map((d) => d.id)).size).toBe(GENERATORS.length)
    for (const def of GENERATORS) {
      expect(def.description.length, def.id).toBeGreaterThan(10)
      expect(['classic', 'random']).toContain(def.category)
      for (const p of def.params) {
        expect(p.min, `${def.id}.${p.key}`).toBeLessThanOrEqual(p.max)
        expect(p.default).toBeGreaterThanOrEqual(p.min)
        expect(p.default).toBeLessThanOrEqual(p.max)
        if (p.kind === 'int') expect(Number.isInteger(p.default)).toBe(true)
      }
      expect(generatorById(def.id)).toBe(def)
    }
  })

  it('rejects an unknown id', () => {
    expect(() => generate('no-such-generator', {})).toThrow(GeneratorError)
  })
})

/* ------------------------------------------------------------------ */
/* Quick-input command parsing                                         */
/* ------------------------------------------------------------------ */

describe('parseGraphCommand', () => {
  const cases: Array<[string, string, Record<string, number>, string]> = [
    ['K5', 'complete', { n: 5 }, 'K5'],
    ['C8', 'cycle', { n: 8 }, 'C8'],
    ['P12', 'path', { n: 12 }, 'P12'],
    ['K3,4', 'completeBipartite', { m: 3, n: 4 }, 'K3,4'],
    ['S6', 'star', { n: 6 }, 'S6'],
    ['W7', 'wheel', { n: 7 }, 'W7'],
    ['Q4', 'hypercube', { n: 4 }, 'Q4'],
    ['G(20,0.2)', 'erdosRenyi', { n: 20, p: 0.2 }, 'G(20,0.2)'],
    ['grid(3,4)', 'grid', { rows: 3, cols: 4 }, 'grid(3,4)'],
    ['3x4', 'grid', { rows: 3, cols: 4 }, 'grid(3,4)'],
    ['petersen', 'petersen', {}, 'petersen'],
    ['tree(12)', 'randomTree', { n: 12 }, 'tree(12)'],
    ['random(10,3)', 'randomRegular', { n: 10, d: 3 }, 'random(10,3)'],
  ]

  it.each(cases)('parses %s', (input, generatorId, params, canonical) => {
    expect(parseGraphCommand(input)).toEqual({ generatorId, params, canonical })
  })

  it('ignores case and whitespace', () => {
    expect(parseGraphCommand('  k5 ')).toEqual(parseGraphCommand('K5'))
    expect(parseGraphCommand('k 3 , 4')).toEqual(parseGraphCommand('K3,4'))
    expect(parseGraphCommand('GRID( 3 , 4 )')).toEqual(parseGraphCommand('grid(3,4)'))
    expect(parseGraphCommand('PETERSEN')).toEqual(parseGraphCommand('petersen'))
    expect(parseGraphCommand('g(20,.2)')).toEqual(parseGraphCommand('G(20,0.2)'))
  })

  it('returns null for junk', () => {
    for (const junk of [
      'hello',
      'K',
      'K-3',
      '',
      '   ',
      'K3,',
      'C',
      'Q',
      '4x',
      'grid(3)',
      'G()',
      'tree()',
      'random(10)',
      'K3.5',
      'petersen(3)',
      '-5',
    ]) {
      expect(parseGraphCommand(junk), junk).toBeNull()
    }
  })

  it('feeds straight into generate()', () => {
    for (const [input] of cases) {
      const parsed = parseGraphCommand(input)
      expect(parsed, input).not.toBeNull()
      const doc = generate(parsed!.generatorId, parsed!.params, { seed: 1 })
      expect(doc.vertices.length, input).toBeGreaterThan(0)
      expect(parseGraphCommand(parsed!.canonical)).toEqual(parsed)
    }
  })

  it('leaves impossible-but-well-formed requests to the generator', () => {
    const parsed = parseGraphCommand('C2')
    expect(parsed).toEqual({ generatorId: 'cycle', params: { n: 2 }, canonical: 'C2' })
    expect(() => generate(parsed!.generatorId, parsed!.params)).toThrow(GeneratorError)
  })
})
