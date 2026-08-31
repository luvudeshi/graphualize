import { describe, expect, it } from 'vitest'
import { Graph } from '../model/graph'
import { docFromEdges } from '../model/builder'
import type { GraphDocument, VertexId } from '../model/types'
import {
  biconnectivity,
  edgeConnectivity,
  stronglyConnectedComponents,
  vertexConnectivity,
} from './connectivity'
import {
  analyzeBipartite,
  analyzeCompleteBipartite,
  analyzeCompleteness,
  analyzeRegularity,
  analyzeTree,
  density,
  findDirectedCycle,
  findUndirectedCycle,
  topologicalOrder,
} from './structure'
import { analyzeEulerian, girth } from './cycles'
import { analyzeDistances, shortestWalkBetween } from './distance'
import { analyzePlanarity } from './planarity'
import { bfs, connectedComponents } from './traversal'

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

const g = (spec: string[], options?: { directed?: boolean; weighted?: boolean }) =>
  new Graph(docFromEdges(spec, options))

const labels = (graph: Graph, ids: readonly VertexId[]) => graph.labels(ids).sort()

const completeSpec = (n: number): string[] => {
  const names = Array.from({ length: n }, (_, i) => String.fromCharCode(65 + i))
  const out: string[] = []
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) out.push(`${names[i]}-${names[j]}`)
  return out
}

const cycleSpec = (n: number): string[] => {
  const names = Array.from({ length: n }, (_, i) => String.fromCharCode(65 + i))
  return names.map((name, i) => `${name}-${names[(i + 1) % n]}`)
}

const pathSpec = (n: number): string[] => {
  const names = Array.from({ length: n }, (_, i) => String.fromCharCode(65 + i))
  return names.slice(0, -1).map((name, i) => `${name}-${names[i + 1]}`)
}

const bipartiteSpec = (m: number, n: number): string[] => {
  const left = Array.from({ length: m }, (_, i) => `L${i}`)
  const right = Array.from({ length: n }, (_, i) => `R${i}`)
  return left.flatMap((a) => right.map((b) => `${a}-${b}`))
}

/** Outer pentagon 0-4, inner pentagram 5-9. */
const PETERSEN: string[] = [
  'A-B', 'B-C', 'C-D', 'D-E', 'E-A',
  'F-H', 'H-J', 'J-G', 'G-I', 'I-F',
  'A-F', 'B-G', 'C-H', 'D-I', 'E-J',
]

const hypercubeSpec = (dimension: number): string[] => {
  const out: string[] = []
  const total = 1 << dimension
  for (let v = 0; v < total; v++) {
    for (let bit = 0; bit < dimension; bit++) {
      const u = v ^ (1 << bit)
      if (u > v) out.push(`q${v}-q${u}`)
    }
  }
  return out
}

const gridSpec = (rows: number, cols: number): string[] => {
  const out: string[] = []
  const id = (r: number, c: number) => `r${r}c${c}`
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (c + 1 < cols) out.push(`${id(r, c)}-${id(r, c + 1)}`)
      if (r + 1 < rows) out.push(`${id(r, c)}-${id(r + 1, c)}`)
    }
  }
  return out
}

/** K2,2,2, the octahedron: 6 vertices, 12 edges, planar, and exactly 3n-6. */
const OCTAHEDRON = [
  'A-C', 'A-D', 'A-E', 'A-F',
  'B-C', 'B-D', 'B-E', 'B-F',
  'C-E', 'C-F', 'D-E', 'D-F',
]

/** Verifies a witness really is a cycle of the graph. */
const isCycle = (graph: Graph, vertexIds: VertexId[], edgeIds: string[]): boolean => {
  if (vertexIds.length === 0) return false
  if (vertexIds.length === 1) {
    const e = graph.edge(edgeIds[0]!)
    return edgeIds.length === 1 && e?.source === e?.target
  }
  if (edgeIds.length !== vertexIds.length) return false
  if (new Set(vertexIds).size !== vertexIds.length) return false
  for (let i = 0; i < vertexIds.length; i++) {
    const a = vertexIds[i]!
    const b = vertexIds[(i + 1) % vertexIds.length]!
    const edge = graph.edge(edgeIds[i]!)
    if (!edge) return false
    const matches = graph.directed
      ? edge.source === a && edge.target === b
      : (edge.source === a && edge.target === b) || (edge.source === b && edge.target === a)
    if (!matches) return false
  }
  return new Set(edgeIds).size === edgeIds.length
}

/** Recomputes component count with the edge removed. */
const isBridge = (doc: GraphDocument, edgeId: string): boolean => {
  const before = connectedComponents(new Graph(doc)).length
  const after = connectedComponents(
    new Graph({ ...doc, edges: doc.edges.filter((e) => e.id !== edgeId) }),
  ).length
  return after > before
}

const isArticulation = (doc: GraphDocument, vertexId: VertexId): boolean => {
  const before = connectedComponents(new Graph(doc)).length
  const trimmed: GraphDocument = {
    ...doc,
    vertices: doc.vertices.filter((v) => v.id !== vertexId),
    edges: doc.edges.filter((e) => e.source !== vertexId && e.target !== vertexId),
  }
  const after = connectedComponents(new Graph(trimmed)).length
  // Removing an isolated vertex lowers the count without disconnecting anything.
  return after > before
}

/* ------------------------------------------------------------------ */
/* Structure                                                           */
/* ------------------------------------------------------------------ */

describe('bipartite detection', () => {
  it('splits an even cycle into two equal parts', () => {
    const graph = g(cycleSpec(6))
    const result = analyzeBipartite(graph)
    expect(result.isBipartite).toBe(true)
    expect(result.partition![0]).toHaveLength(3)
    expect(result.partition![1]).toHaveLength(3)
    for (const e of graph.edges) {
      const left = new Set(result.partition![0])
      expect(left.has(e.source)).not.toBe(left.has(e.target))
    }
  })

  it('returns a genuine odd cycle when the graph is not bipartite', () => {
    for (const spec of [cycleSpec(5), cycleSpec(7), completeSpec(5), PETERSEN]) {
      const graph = g(spec)
      const result = analyzeBipartite(graph)
      expect(result.isBipartite).toBe(false)
      const cycle = result.oddCycle!
      expect(cycle).toBeTruthy()
      expect(isCycle(graph, cycle.vertexIds, cycle.edgeIds)).toBe(true)
      expect(cycle.edgeIds.length % 2).toBe(1)
    }
  })

  it('treats a self-loop as an odd cycle of length one', () => {
    const graph = g(['A-B', 'A-A'])
    const result = analyzeBipartite(graph)
    expect(result.isBipartite).toBe(false)
    expect(result.oddCycle!.edgeIds).toHaveLength(1)
  })

  it('says the empty graph and a single vertex are bipartite', () => {
    expect(analyzeBipartite(g([])).isBipartite).toBe(true)
    expect(analyzeBipartite(g(['A'])).isBipartite).toBe(true)
  })

  it('detects complete bipartite graphs and their sizes', () => {
    const result = analyzeCompleteBipartite(g(bipartiteSpec(3, 4)))
    expect(result.isCompleteBipartite).toBe(true)
    expect(result.sizes!.slice().sort((a, b) => a - b)).toEqual([3, 4])
    expect(analyzeCompleteBipartite(g(cycleSpec(6))).isCompleteBipartite).toBe(false)
    expect(analyzeCompleteBipartite(g(completeSpec(4))).isCompleteBipartite).toBe(false)
  })
})

describe('trees, forests and cycles', () => {
  it('classifies a path as a tree and two paths as a forest', () => {
    const tree = analyzeTree(g(pathSpec(5)))
    expect(tree.isTree).toBe(true)
    expect(tree.isForest).toBe(true)
    expect(tree.cycle).toBeNull()

    const forest = analyzeTree(g(['A-B', 'C-D']))
    expect(forest.isTree).toBe(false)
    expect(forest.isForest).toBe(true)
    expect(forest.componentCount).toBe(2)
    expect(forest.reason).toContain('forest')
  })

  it('returns a real cycle when the graph is not a forest', () => {
    for (const spec of [cycleSpec(3), cycleSpec(6), completeSpec(4), gridSpec(3, 3)]) {
      const graph = g(spec)
      const cycle = findUndirectedCycle(graph)!
      expect(cycle).toBeTruthy()
      expect(isCycle(graph, cycle.vertexIds, cycle.edgeIds)).toBe(true)
    }
  })

  it('treats parallel edges and self-loops as cycles', () => {
    const parallel = g(['A-B', 'A-B'])
    expect(findUndirectedCycle(parallel)!.edgeIds).toHaveLength(2)
    const loop = g(['A-A'])
    expect(findUndirectedCycle(loop)!.edgeIds).toHaveLength(1)
  })

  it('finds directed cycles only when they follow the arrows', () => {
    const acyclic = g(['A->B', 'A->C', 'B->D', 'C->D'], { directed: true })
    expect(findDirectedCycle(acyclic)).toBeNull()
    const cyclic = g(['A->B', 'B->C', 'C->A'], { directed: true })
    const cycle = findDirectedCycle(cyclic)!
    expect(isCycle(cyclic, cycle.vertexIds, cycle.edgeIds)).toBe(true)
  })

  it('orders a DAG topologically and refuses a cyclic digraph', () => {
    const dag = g(['A->B', 'A->C', 'B->D', 'C->D', 'D->E'], { directed: true })
    const { order } = topologicalOrder(dag)
    expect(order).toHaveLength(5)
    const position = new Map(order!.map((id, i) => [id, i] as const))
    for (const e of dag.edges) {
      expect(position.get(e.source)!).toBeLessThan(position.get(e.target)!)
    }
    const cyclic = g(['A->B', 'B->A'], { directed: true })
    expect(topologicalOrder(cyclic).order).toBeNull()
    expect(topologicalOrder(cyclic).cycle).not.toBeNull()
    expect(topologicalOrder(g(['A-B'])).order).toBeNull()
  })
})

describe('degrees, regularity and completeness', () => {
  it('recognises Kn as complete and (n-1)-regular', () => {
    const graph = g(completeSpec(5))
    expect(analyzeCompleteness(graph).isComplete).toBe(true)
    expect(analyzeRegularity(graph)).toMatchObject({ regular: true, degree: 4 })
    expect(density(graph)).toBeCloseTo(1)
  })

  it('counts the missing edges of an incomplete graph', () => {
    const graph = g(cycleSpec(5))
    const completeness = analyzeCompleteness(graph)
    expect(completeness.isComplete).toBe(false)
    expect(completeness.missing).toHaveLength(5) // C5 has 5 of 10 possible edges
  })

  it('never calls a multigraph complete', () => {
    expect(analyzeCompleteness(g(['A-B', 'A-B'])).isComplete).toBe(false)
  })
})

/* ------------------------------------------------------------------ */
/* Connectivity                                                        */
/* ------------------------------------------------------------------ */

describe('bridges and articulation points', () => {
  it('finds every bridge and nothing else', () => {
    const specs = [
      ['A-B', 'B-C', 'C-A', 'C-D', 'D-E', 'E-F', 'F-D'],
      pathSpec(5),
      cycleSpec(5),
      gridSpec(3, 3),
      PETERSEN,
      ['A-B', 'C-D'],
    ]
    for (const spec of specs) {
      const doc = docFromEdges(spec)
      const graph = new Graph(doc)
      const { bridges } = biconnectivity(graph)
      const expected = doc.edges.filter((e) => isBridge(doc, e.id)).map((e) => e.id)
      expect(bridges.slice().sort()).toEqual(expected.slice().sort())
    }
  })

  it('does not call a doubled edge a bridge', () => {
    const graph = g(['A-B', 'A-B'])
    expect(biconnectivity(graph).bridges).toHaveLength(0)
  })

  it('finds every articulation vertex and nothing else', () => {
    const specs = [
      ['A-B', 'B-C', 'C-A', 'C-D', 'D-E', 'E-F', 'F-D'],
      pathSpec(5),
      cycleSpec(6),
      gridSpec(3, 3),
      PETERSEN,
      ['A-B', 'B-C', 'B-D', 'B-E'],
    ]
    for (const spec of specs) {
      const doc = docFromEdges(spec)
      const graph = new Graph(doc)
      const found = biconnectivity(graph).articulationPoints
      const expected = doc.vertices.filter((v) => isArticulation(doc, v.id)).map((v) => v.id)
      expect(found.slice().sort()).toEqual(expected.slice().sort())
    }
  })
})

describe('strongly connected components', () => {
  it('splits a digraph into its strong components', () => {
    const graph = g(['A->B', 'B->C', 'C->A', 'C->D', 'D->E', 'E->D'], { directed: true })
    const sccs = stronglyConnectedComponents(graph)
    const sizes = sccs.map((c) => c.length).sort()
    expect(sizes).toEqual([2, 3])
    const names = sccs.map((c) => labels(graph, c).join(''))
    expect(names).toContain('ABC')
    expect(names).toContain('DE')
  })

  it('reports one component for a directed cycle and n for a DAG', () => {
    expect(stronglyConnectedComponents(g(['A->B', 'B->C', 'C->A'], { directed: true }))).toHaveLength(1)
    expect(stronglyConnectedComponents(g(['A->B', 'B->C'], { directed: true }))).toHaveLength(3)
  })
})

describe('edge and vertex connectivity', () => {
  const cases: [string, string[], number, number][] = [
    // spec, expected edge connectivity, expected vertex connectivity
    ['path', pathSpec(4), 1, 1],
    ['cycle', cycleSpec(5), 2, 2],
    ['K4', completeSpec(4), 3, 3],
    ['K5', completeSpec(5), 4, 4],
    ['Petersen', PETERSEN, 3, 3],
    ['K3,3', bipartiteSpec(3, 3), 3, 3],
    ['bowtie', ['A-B', 'B-C', 'C-A', 'C-D', 'D-E', 'E-C'], 2, 1],
    ['3-cube', hypercubeSpec(3), 3, 3],
  ]

  for (const [name, spec, lambda, kappa] of cases) {
    it(`computes lambda and kappa for ${name}`, () => {
      const graph = g(spec)
      expect(edgeConnectivity(graph)!.value).toBe(lambda)
      expect(vertexConnectivity(graph)!.value).toBe(kappa)
    })
  }

  it('reports zero for a disconnected graph', () => {
    const graph = g(['A-B', 'C-D'])
    expect(edgeConnectivity(graph)!.value).toBe(0)
    expect(vertexConnectivity(graph)!.value).toBe(0)
  })

  it('returns a cut whose removal really disconnects the graph', () => {
    const doc = docFromEdges(['A-B', 'B-C', 'C-A', 'C-D', 'D-E', 'E-C'])
    const graph = new Graph(doc)
    const cut = edgeConnectivity(graph)!
    expect(cut.edgeIds).toHaveLength(cut.value)
    const remaining = new Graph({
      ...doc,
      edges: doc.edges.filter((e) => !cut.edgeIds!.includes(e.id)),
    })
    expect(connectedComponents(remaining).length).toBeGreaterThan(1)
  })
})

/* ------------------------------------------------------------------ */
/* Cycles: girth and Eulerian walks                                    */
/* ------------------------------------------------------------------ */

describe('girth', () => {
  const cases: [string, string[], number][] = [
    ['triangle', cycleSpec(3), 3],
    ['C7', cycleSpec(7), 7],
    ['K4', completeSpec(4), 3],
    ['K3,3', bipartiteSpec(3, 3), 4],
    ['Petersen', PETERSEN, 5],
    ['3-cube', hypercubeSpec(3), 4],
    ['4-cube', hypercubeSpec(4), 4],
    ['grid', gridSpec(3, 3), 4],
  ]

  for (const [name, spec, expected] of cases) {
    it(`is ${expected} for ${name}`, () => {
      const graph = g(spec)
      const result = girth(graph)
      expect(result.value).toBe(expected)
      expect(result.cycle).not.toBeNull()
      expect(result.cycle!.edgeIds).toHaveLength(expected)
      expect(isCycle(graph, result.cycle!.vertexIds, result.cycle!.edgeIds)).toBe(true)
    })
  }

  it('is infinite for a forest', () => {
    expect(girth(g(pathSpec(6))).value).toBe(Infinity)
    expect(girth(g([])).value).toBe(Infinity)
  })

  it('is 1 for a self-loop and 2 for a doubled edge', () => {
    expect(girth(g(['A-A', 'A-B'])).value).toBe(1)
    expect(girth(g(['A-B', 'A-B'])).value).toBe(2)
  })

  it('measures directed girth along the arrows', () => {
    const graph = g(['A->B', 'B->C', 'C->A', 'A->D', 'D->A'], { directed: true })
    expect(girth(graph).value).toBe(2)
    const oneWay = g(['A->B', 'B->C', 'C->A'], { directed: true })
    expect(girth(oneWay).value).toBe(3)
    const acyclic = g(['A->B', 'B->C'], { directed: true })
    expect(girth(acyclic).value).toBe(Infinity)
  })
})

describe('Eulerian circuits and trails', () => {
  const usesEveryEdgeOnce = (graph: Graph, edgeIds: string[]) =>
    edgeIds.length === graph.size && new Set(edgeIds).size === graph.size

  it('finds a circuit when every degree is even', () => {
    for (const spec of [cycleSpec(5), cycleSpec(6), completeSpec(5), OCTAHEDRON]) {
      const graph = g(spec)
      const result = analyzeEulerian(graph)
      expect(result.hasCircuit).toBe(true)
      expect(usesEveryEdgeOnce(graph, result.walk!.edgeIds)).toBe(true)
      // A circuit returns to its start.
      expect(result.walk!.vertexIds[0]).toBe(
        result.walk!.vertexIds[result.walk!.vertexIds.length - 1],
      )
    }
  })

  it('finds a trail but no circuit with exactly two odd vertices', () => {
    const graph = g(['A-B', 'B-C', 'C-A', 'C-D'])
    const result = analyzeEulerian(graph)
    expect(result.hasCircuit).toBe(false)
    expect(result.hasTrail).toBe(true)
    expect(usesEveryEdgeOnce(graph, result.walk!.edgeIds)).toBe(true)
    expect(labels(graph, result.oddVertices)).toEqual(['C', 'D'])
  })

  it('refuses Königsberg and says why', () => {
    const graph = g(['N-I', 'N-I', 'S-I', 'S-I', 'E-I', 'N-E', 'S-E'])
    const result = analyzeEulerian(graph)
    expect(result.hasCircuit).toBe(false)
    expect(result.hasTrail).toBe(false)
    expect(result.oddVertices).toHaveLength(4)
    expect(result.reason).toContain('odd degree')
  })

  it('refuses when the edges span several components', () => {
    const result = analyzeEulerian(g(['A-B', 'B-C', 'C-A', 'D-E', 'E-F', 'F-D']))
    expect(result.hasTrail).toBe(false)
    expect(result.reason).toContain('components')
  })

  it('handles directed Eulerian conditions', () => {
    const circuit = analyzeEulerian(g(['A->B', 'B->C', 'C->A'], { directed: true }))
    expect(circuit.hasCircuit).toBe(true)

    const trail = analyzeEulerian(g(['A->B', 'B->C'], { directed: true }))
    expect(trail.hasCircuit).toBe(false)
    expect(trail.hasTrail).toBe(true)

    const unbalanced = analyzeEulerian(g(['A->B', 'A->C', 'B->C'], { directed: true }))
    expect(unbalanced.hasCircuit).toBe(false)
  })

  it('treats an edgeless graph as trivially Eulerian', () => {
    expect(analyzeEulerian(g(['A'])).hasCircuit).toBe(true)
    expect(analyzeEulerian(g([])).hasCircuit).toBe(false)
  })
})

/* ------------------------------------------------------------------ */
/* Distance                                                            */
/* ------------------------------------------------------------------ */

describe('distance metrics', () => {
  it('matches the known values for a path', () => {
    const graph = g(pathSpec(5))
    const metrics = analyzeDistances(graph)
    expect(metrics.diameter).toBe(4)
    expect(metrics.radius).toBe(2)
    expect(labels(graph, metrics.center)).toEqual(['C'])
    expect(labels(graph, metrics.periphery)).toEqual(['A', 'E'])
  })

  it('matches the known values for a cycle and a complete graph', () => {
    const c6 = analyzeDistances(g(cycleSpec(6)))
    expect(c6.diameter).toBe(3)
    expect(c6.radius).toBe(3)
    expect(c6.center).toHaveLength(6)

    const k5 = analyzeDistances(g(completeSpec(5)))
    expect(k5.diameter).toBe(1)
    expect(k5.radius).toBe(1)

    expect(analyzeDistances(g(PETERSEN)).diameter).toBe(2)
  })

  it('reports an infinite diameter when the graph is disconnected', () => {
    const metrics = analyzeDistances(g(['A-B', 'B-C', 'D-E']))
    expect(metrics.diameter).toBe(Infinity)
    expect(metrics.stronglyReachable).toBe(false)
    expect(metrics.largestComponentDiameter).toBe(2)
  })

  it('produces a witness path whose length equals the diameter', () => {
    for (const spec of [pathSpec(6), cycleSpec(7), gridSpec(3, 4), PETERSEN]) {
      const graph = g(spec)
      const metrics = analyzeDistances(graph)
      const [a, b] = metrics.diameterPair!
      const walk = shortestWalkBetween(graph, a, b, false)!
      expect(walk.edgeIds).toHaveLength(metrics.diameter)
      expect(walk.length).toBe(metrics.diameter)
    }
  })

  it('uses weights when the document is weighted', () => {
    const graph = g(['A-B:1', 'B-C:1', 'A-C:5'], { weighted: true })
    const metrics = analyzeDistances(graph)
    expect(metrics.diameter).toBe(2)
    const walk = shortestWalkBetween(graph, graph.vertexIds[0]!, graph.vertexIds[2]!, true)!
    expect(walk.length).toBe(2)
    expect(walk.edgeIds).toHaveLength(2)
  })

  it('flags a negative cycle instead of returning nonsense', () => {
    const undirected = g(['A-B:-1', 'B-C:2'], { weighted: true })
    expect(analyzeDistances(undirected).negativeCycle).toBe(true)

    const directed = g(['A->B:1', 'B->C:-4', 'C->A:1'], { weighted: true, directed: true })
    expect(analyzeDistances(directed).negativeCycle).toBe(true)

    const fine = g(['A->B:1', 'B->C:-4'], { weighted: true, directed: true })
    expect(analyzeDistances(fine).negativeCycle).toBe(false)
  })

  it('respects direction', () => {
    const graph = g(['A->B', 'B->C'], { directed: true })
    const metrics = analyzeDistances(graph)
    expect(metrics.stronglyReachable).toBe(false)
    expect(bfs(graph, graph.vertexIds[2]!).dist.size).toBe(1)
  })

  it('survives empty and single-vertex graphs', () => {
    expect(analyzeDistances(g([])).computed).toBe(true)
    const single = analyzeDistances(g(['A']))
    expect(single.diameter).toBe(0)
    expect(single.radius).toBe(0)
  })
})

/* ------------------------------------------------------------------ */
/* Planarity                                                           */
/* ------------------------------------------------------------------ */

describe('planarity', () => {
  const planarCases: [string, string[]][] = [
    ['triangle', cycleSpec(3)],
    ['C7', cycleSpec(7)],
    ['tree', pathSpec(8)],
    ['K4', completeSpec(4)],
    ['K5 minus an edge', completeSpec(5).slice(0, 9)],
    ['K5 minus an edge with a path across the gap', [...completeSpec(5).slice(0, 9), 'A-M', 'M-E']],
    ['grid 4x4', gridSpec(4, 4)],
    ['3-cube', hypercubeSpec(3)],
    ['octahedron', OCTAHEDRON],
    ['wheel W6', [...cycleSpec(6), 'A-Z', 'B-Z', 'C-Z', 'D-Z', 'E-Z', 'F-Z']],
    ['two triangles joined by a bridge', ['A-B', 'B-C', 'C-A', 'C-D', 'D-E', 'E-F', 'F-D']],
    ['disconnected planar pieces', [...completeSpec(4), 'X-Y', 'Y-Z', 'Z-X']],
  ]

  for (const [name, spec] of planarCases) {
    it(`says ${name} is planar`, () => {
      const result = analyzePlanarity(g(spec))
      expect(result.planar).toBe(true)
      expect(result.reason).toBeTruthy()
    })
  }

  const nonPlanarCases: [string, string[]][] = [
    ['K5', completeSpec(5)],
    ['K6', completeSpec(6)],
    ['K3,3', bipartiteSpec(3, 3)],
    ['K4,4', bipartiteSpec(4, 4)],
    ['Petersen', PETERSEN],
    ['4-cube', hypercubeSpec(4)],
    ['K5 with a pendant vertex', [...completeSpec(5), 'A-Z']],
    ['K3,3 plus a disjoint triangle', [...bipartiteSpec(3, 3), 'X-Y', 'Y-Z', 'Z-X']],
    // K5 with the edge D-E replaced by the path D-M-E: homeomorphic to K5.
    ['a subdivision of K5', [...completeSpec(5).slice(0, 9), 'D-M', 'M-E']],
  ]

  for (const [name, spec] of nonPlanarCases) {
    it(`says ${name} is not planar`, () => {
      const result = analyzePlanarity(g(spec))
      expect(result.planar).toBe(false)
      expect(result.reason).toBeTruthy()
    })
  }

  it('ignores self-loops and parallel edges', () => {
    expect(analyzePlanarity(g([...cycleSpec(4), 'A-A', 'A-B'])).planar).toBe(true)
  })

  it('declines rather than guessing above its size limit', () => {
    const big = gridSpec(20, 20) // 400 vertices
    const result = analyzePlanarity(g(big))
    expect(result.planar).toBeNull()
    expect(result.method).toBe('not-computed')
  })
})
