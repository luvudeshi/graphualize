import { describe, expect, it } from 'vitest'

import { Graph } from '../model/graph'
import { docFromEdges } from '../model/builder'
import type { BuildOptions } from '../model/builder'
import type { EdgeId, VertexId } from '../model/types'
import type { AlgorithmRun, AlgorithmStep } from './types'
import {
  ALGORITHMS,
  algorithmById,
  bellmanFordAlgorithm,
  bfsAlgorithm,
  dfsAlgorithm,
  dijkstraAlgorithm,
  greedyColoringAlgorithm,
  kruskalAlgorithm,
  primAlgorithm,
  topologicalSortAlgorithm,
} from './index'

/* ------------------------------------------------------------------ */
/* Fixtures and helpers                                                */
/* ------------------------------------------------------------------ */

interface Fixture {
  graph: Graph
  /** Vertex id for a label, e.g. `at('A')`. */
  at: (label: string) => VertexId
}

const build = (spec: readonly string[], options: BuildOptions = {}): Fixture => {
  const doc = docFromEdges(spec, options)
  const graph = new Graph(doc)
  const byLabel = new Map(doc.vertices.map((v) => [v.label, v.id] as const))
  return {
    graph,
    at: (label) => {
      const id = byLabel.get(label)
      if (!id) throw new Error(`no vertex labelled ${label}`)
      return id
    },
  }
}

const lastStep = (run: AlgorithmRun): AlgorithmStep => {
  expect(run.steps.length).toBeGreaterThan(0)
  return run.steps[run.steps.length - 1]
}

/** Badge text keyed by label — the distance/order/indegree a viewer sees. */
const badgesByLabel = (graph: Graph, step: AlgorithmStep): Record<string, string> => {
  const out: Record<string, string> = {}
  for (const [id, text] of Object.entries(step.badges ?? {})) out[graph.label(id)] = text
  return out
}

const labelsOf = (graph: Graph, ids: readonly VertexId[]): string[] =>
  ids.map((id) => graph.label(id))

/** `activeVertices[0]` is by convention the vertex a step is about. */
const subjectsOfType = (graph: Graph, run: AlgorithmRun, ...types: string[]): string[] =>
  run.steps
    .filter((s) => types.includes(s.type))
    .map((s) => graph.label((s.activeVertices ?? [])[0]))

const treeWeight = (graph: Graph, run: AlgorithmRun): number =>
  (lastStep(run).treeEdges ?? []).reduce((sum, id) => sum + graph.weight(id), 0)

const resultValue = (run: AlgorithmRun, label: string): string =>
  run.result?.find((row) => row.label === label)?.value ?? ''

/**
 * A run with every generated id swapped for something stable, so two runs over
 * two builds of the same document can be compared directly.
 */
const normalized = (graph: Graph, run: AlgorithmRun): string => {
  const edgeIndex = new Map(graph.edges.map((e, i) => [e.id, `edge#${i}`] as const))
  const swap = (value: string): string =>
    graph.hasVertex(value) ? `vertex:${graph.label(value)}` : (edgeIndex.get(value) ?? value)
  const walk = (node: unknown): unknown => {
    if (typeof node === 'string') return swap(node)
    if (Array.isArray(node)) return node.map(walk)
    if (node && typeof node === 'object') {
      const out: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(node)) out[swap(key)] = walk(value)
      return out
    }
    return node
  }
  return JSON.stringify(walk(run))
}

/** Vertex ids in the order the given step types touched them. */
const subjectIdsOfType = (run: AlgorithmRun, ...types: string[]): VertexId[] =>
  run.steps.filter((s) => types.includes(s.type)).map((s) => (s.activeVertices ?? [])[0])

/**
 * The largest number of already-placed neighbours any vertex sees. A
 * smallest-last colouring order drives this down to the graph's degeneracy,
 * which is exactly the bound on the colours greedy can then need.
 */
const maxBackwardDegree = (graph: Graph, order: readonly VertexId[]): number => {
  const position = new Map(order.map((id, i) => [id, i] as const))
  let worst = 0
  order.forEach((id, i) => {
    const earlier = new Set(
      graph
        .neighbors(id)
        .filter((n) => {
          const at = position.get(n.to)
          return n.to !== id && at !== undefined && at < i
        })
        .map((n) => n.to),
    )
    worst = Math.max(worst, earlier.size)
  })
  return worst
}

/** Colour classes must never join two ends of an edge. */
const isProperColoring = (graph: Graph, colors: Record<VertexId, number>): boolean =>
  graph.edges.every(
    (e) => e.source === e.target || colors[e.source] !== colors[e.target],
  )

const colorsUsed = (colors: Record<VertexId, number>): number =>
  new Set(Object.values(colors)).size

/* ------------------------------------------------------------------ */
/* Breadth-first search                                                */
/* ------------------------------------------------------------------ */

describe('breadth-first search', () => {
  // A-B, A-C, B-D, C-D, D-E, plus an isolated F.
  const spec = ['A-B', 'A-C', 'B-D', 'C-D', 'D-E', 'F']

  it('visits in wave order and records hop distances', () => {
    const { graph, at } = build(spec)
    const run = bfsAlgorithm.run(graph, { source: at('A') })

    expect(run.error).toBeUndefined()
    expect(run.steps.length).toBeGreaterThan(0)
    expect(subjectsOfType(graph, run, 'visit')).toEqual(['A', 'B', 'C', 'D', 'E'])
    expect(badgesByLabel(graph, lastStep(run))).toEqual({ A: '0', B: '1', C: '1', D: '2', E: '3' })
  })

  it('grows visitedVertices monotonically', () => {
    const { graph, at } = build(spec)
    const run = bfsAlgorithm.run(graph, { source: at('A') })

    for (let i = 1; i < run.steps.length; i++) {
      const before = new Set(run.steps[i - 1].visitedVertices ?? [])
      const after = run.steps[i].visitedVertices ?? []
      for (const id of before) expect(after).toContain(id)
    }
  })

  it('reports unreached vertices in the summary', () => {
    const { graph, at } = build(spec)
    const run = bfsAlgorithm.run(graph, { source: at('A') })

    expect(resultValue(run, 'Unreached')).toBe('F')
    expect(resultValue(run, 'Reached')).toBe('5 of 6')
    expect(lastStep(run).description).toContain('5 of 6')
  })

  it('emits one discover step per tree edge and skips seen neighbours', () => {
    const { graph, at } = build(spec)
    const run = bfsAlgorithm.run(graph, { source: at('A') })

    const discovers = run.steps.filter((s) => s.type === 'discover')
    expect(discovers).toHaveLength(4) // B, C, D, E
    for (const step of discovers) expect(step.activeEdges).toHaveLength(1)
    expect(run.steps.some((s) => s.type === 'skip')).toBe(true)
  })

  it('follows direction on a digraph', () => {
    const { graph, at } = build(['A->B', 'B->C', 'D->A'], { directed: true })
    const run = bfsAlgorithm.run(graph, { source: at('A') })

    expect(subjectsOfType(graph, run, 'visit')).toEqual(['A', 'B', 'C'])
    expect(resultValue(run, 'Unreached')).toBe('D')
  })

  it('is deterministic', () => {
    const first = build(spec)
    const second = build(spec)
    expect(normalized(first.graph, bfsAlgorithm.run(first.graph, { source: first.at('A') }))).toBe(
      normalized(second.graph, bfsAlgorithm.run(second.graph, { source: second.at('A') })),
    )
  })
})

/* ------------------------------------------------------------------ */
/* Snapshot isolation — the bug this design exists to prevent          */
/* ------------------------------------------------------------------ */

describe('step snapshots', () => {
  const spec = ['A-B:1', 'A-C:4', 'B-C:1', 'B-D:7', 'C-D:2', 'D-E:3']

  it('does not leak a mutation of one step into the next', () => {
    const { graph, at } = build(spec, { weighted: true })
    const run = bfsAlgorithm.run(graph, { source: at('A') })
    const secondBefore = [...(run.steps[1].visitedVertices ?? [])]

    run.steps[0].visitedVertices?.push('injected')
    run.steps[0].badges!['injected'] = 'x'
    run.steps[0].treeEdges?.push('injected-edge')

    expect(run.steps[1].visitedVertices).toEqual(secondBefore)
    expect(run.steps[1].visitedVertices).not.toContain('injected')
    expect(run.steps[1].badges).not.toHaveProperty('injected')
    expect(run.steps[1].treeEdges).not.toContain('injected-edge')
  })

  it('never shares a mutable field between two steps, in any algorithm', () => {
    const fields = [
      'activeVertices',
      'visitedVertices',
      'frontierVertices',
      'activeEdges',
      'treeEdges',
      'rejectedEdges',
      'state',
      'badges',
      'colors',
    ] as const

    for (const algorithm of ALGORITHMS) {
      const { graph, at } = build(spec, { weighted: true })
      const run = algorithm.run(graph, { source: at('A'), target: at('E') })
      for (const field of fields) {
        const seen = new Set<unknown>()
        for (const step of run.steps) {
          const value = step[field]
          if (value === undefined) continue
          expect(seen.has(value), `${algorithm.id} reused ${field}`).toBe(false)
          seen.add(value)
        }
      }
    }
  })
})

/* ------------------------------------------------------------------ */
/* Depth-first search                                                  */
/* ------------------------------------------------------------------ */

describe('depth-first search', () => {
  const spec = ['A-B', 'A-C', 'B-D', 'C-D', 'D-E', 'F']

  it('dives before it widens, unlike BFS', () => {
    const { graph, at } = build(spec)
    const dfs = dfsAlgorithm.run(graph, { source: at('A') })
    const bfs = bfsAlgorithm.run(graph, { source: at('A') })

    const dfsOrder = subjectsOfType(graph, dfs, 'start', 'discover')
    expect(dfsOrder).toEqual(['A', 'B', 'D', 'C', 'E'])
    expect(dfsOrder).not.toEqual(subjectsOfType(graph, bfs, 'visit'))
    expect(resultValue(dfs, 'Discovery order')).toBe('A, B, D, C, E')
  })

  it('badges vertices with their discovery number', () => {
    const { graph, at } = build(spec)
    const run = dfsAlgorithm.run(graph, { source: at('A') })
    expect(badgesByLabel(graph, lastStep(run))).toEqual({ A: '1', B: '2', D: '3', C: '4', E: '5' })
  })

  it('shows the recursion path on the stack and backtracks out of it', () => {
    const { graph, at } = build(spec)
    const run = dfsAlgorithm.run(graph, { source: at('A') })

    const deepest = run.steps.find((s) => s.description.startsWith('Discover C'))
    expect(deepest?.state?.Stack).toBe('[A, B, D, C]')

    const backtracks = run.steps.filter((s) => s.type === 'backtrack')
    expect(backtracks.length).toBe(5)
    expect(backtracks[0].description).toBe('Backtrack from C to D')
    expect(lastStep(run).state?.Stack).toBe('[ ]')
  })

  it('reports unreached vertices', () => {
    const { graph, at } = build(spec)
    expect(resultValue(dfsAlgorithm.run(graph, { source: at('A') }), 'Unreached')).toBe('F')
  })
})

/* ------------------------------------------------------------------ */
/* Dijkstra                                                            */
/* ------------------------------------------------------------------ */

describe('dijkstra', () => {
  it('beats the greedy-looking direct edge', () => {
    // A-C costs 4 directly, but A-B-C costs 2.
    const { graph, at } = build(['A-B:1', 'A-C:4', 'B-C:1', 'B-D:7', 'C-D:2', 'D-E:3'], {
      weighted: true,
    })
    const run = dijkstraAlgorithm.run(graph, { source: at('A') })

    expect(run.error).toBeUndefined()
    expect(badgesByLabel(graph, lastStep(run))).toEqual({
      A: '0',
      B: '1',
      C: '2',
      D: '4',
      E: '7',
    })
    expect(subjectsOfType(graph, run, 'visit')).toEqual(['A', 'B', 'C', 'D', 'E'])
  })

  it('writes the arithmetic into relax steps', () => {
    const { graph, at } = build(['A-B:3', 'B-C:4'], { weighted: true })
    const run = dijkstraAlgorithm.run(graph, { source: at('A') })
    const relaxC = run.steps.find((s) => s.type === 'relax' && s.detail?.startsWith('d(C)'))
    expect(relaxC?.detail).toBe('d(C) = min(∞, 3 + 4) = 7')
    expect(run.steps.some((s) => s.type === 'no-improvement')).toBe(true)
  })

  it('honours direction on a weighted digraph', () => {
    const { graph, at } = build(
      ['A->B:1', 'B->C:2', 'A->C:10', 'C->D:1', 'D->B:1', 'E'],
      { directed: true, weighted: true },
    )

    const fromA = dijkstraAlgorithm.run(graph, { source: at('A') })
    expect(badgesByLabel(graph, lastStep(fromA))).toEqual({
      A: '0',
      B: '1',
      C: '3',
      D: '4',
      E: '∞',
    })

    const fromC = dijkstraAlgorithm.run(graph, { source: at('C') })
    expect(badgesByLabel(graph, lastStep(fromC))).toEqual({
      A: '∞',
      B: '2',
      C: '0',
      D: '1',
      E: '∞',
    })
  })

  it('reports the path when a target is given', () => {
    const { graph, at } = build(['A-B:1', 'A-C:4', 'B-C:1', 'C-D:2'], { weighted: true })
    const run = dijkstraAlgorithm.run(graph, { source: at('A'), target: at('D') })

    expect(resultValue(run, 'Path to D')).toBe('A → B → C → D')
    expect(resultValue(run, 'Distance to D')).toBe('4')
    expect(lastStep(run).activeEdges).toHaveLength(3)
  })

  it('refuses a negative edge weight and names Bellman-Ford', () => {
    const { graph } = build(['A-B:3', 'B-C:-2'], { weighted: true })
    const refusal = dijkstraAlgorithm.precondition?.(graph, {})

    expect(refusal).toBeTruthy()
    expect(refusal).toContain('B to C is -2')
    expect(refusal).toContain('Bellman-Ford')

    const run = dijkstraAlgorithm.run(graph, {})
    expect(run.steps).toHaveLength(0)
    expect(run.error).toBe(refusal)
  })

  it('allows a negative-looking weight on an unweighted document', () => {
    const { graph } = build(['A-B:-5'], { weighted: false })
    expect(dijkstraAlgorithm.precondition?.(graph, {})).toBeNull()
  })
})

/* ------------------------------------------------------------------ */
/* Bellman-Ford                                                        */
/* ------------------------------------------------------------------ */

describe('bellman-ford', () => {
  it('agrees with dijkstra when no weight is negative', () => {
    for (const spec of [
      ['A-B:1', 'A-C:4', 'B-C:1', 'B-D:7', 'C-D:2', 'D-E:3'],
      ['A-B:2', 'B-C:2', 'C-D:2', 'D-A:2', 'A-C:3'],
      ['A-B:5', 'C-D:1', 'E'],
    ]) {
      const { graph, at } = build(spec, { weighted: true })
      const source = at('A')
      const bf = bellmanFordAlgorithm.run(graph, { source })
      const dj = dijkstraAlgorithm.run(graph, { source })
      expect(badgesByLabel(graph, lastStep(bf))).toEqual(badgesByLabel(graph, lastStep(dj)))
    }
  })

  it('handles a negative edge that no cycle exploits', () => {
    const { graph, at } = build(['A->B:4', 'A->C:5', 'C->B:-3'], {
      directed: true,
      weighted: true,
    })
    const run = bellmanFordAlgorithm.run(graph, { source: at('A') })

    expect(badgesByLabel(graph, lastStep(run))).toEqual({ A: '0', B: '2', C: '5' })
    expect(resultValue(run, 'Negative cycle')).toBe('no')
  })

  it('extracts a real negative cycle', () => {
    const { graph, at } = build(
      ['A->B:1', 'B->C:-1', 'C->D:-1', 'D->B:-1', 'C->E:2'],
      { directed: true, weighted: true },
    )
    const run = bellmanFordAlgorithm.run(graph, { source: at('A') })
    const final = lastStep(run)

    expect(final.type).toBe('negative-cycle')
    expect(resultValue(run, 'Negative cycle')).toContain('yes')

    const cycleVertices = final.activeVertices ?? []
    const cycleEdges = final.activeEdges ?? []
    expect(cycleEdges.length).toBeGreaterThan(0)
    expect(cycleEdges).toHaveLength(cycleVertices.length)

    // Every reported edge really runs from one cycle vertex to the next.
    cycleEdges.forEach((edgeId: EdgeId, i: number) => {
      const edge = graph.edge(edgeId)
      expect(edge).toBeDefined()
      expect(edge?.source).toBe(cycleVertices[i])
      expect(edge?.target).toBe(cycleVertices[(i + 1) % cycleVertices.length])
    })

    const total = cycleEdges.reduce((sum: number, id: EdgeId) => sum + graph.weight(id), 0)
    expect(total).toBeLessThan(0)
    expect(new Set(cycleVertices).size).toBe(cycleVertices.length)
    expect(labelsOf(graph, cycleVertices).sort()).toEqual(['B', 'C', 'D'])
  })

  it('stops early once a round changes nothing', () => {
    const { graph, at } = build(['A-B:1', 'B-C:1'], { weighted: true })
    const run = bellmanFordAlgorithm.run(graph, { source: at('A') })
    expect(run.steps.some((s) => s.type === 'stable')).toBe(true)
    expect(lastStep(run).description).toContain('no negative cycle')
  })
})

/* ------------------------------------------------------------------ */
/* Minimum spanning trees                                              */
/* ------------------------------------------------------------------ */

describe('prim and kruskal', () => {
  const connected: { spec: string[]; weight: number; note: string }[] = [
    {
      spec: ['A-B:1', 'A-C:4', 'B-C:1', 'B-D:7', 'C-D:2', 'D-E:3'],
      weight: 7, // A-B(1) + B-C(1) + C-D(2) + D-E(3)
      note: 'distinct weights',
    },
    {
      spec: ['A-B:2', 'B-C:2', 'C-D:2', 'D-A:2', 'A-C:3'],
      weight: 6, // any three of the four 2s
      note: 'tied weights',
    },
    {
      spec: ['A-B', 'B-C', 'C-A', 'C-D'],
      weight: 3, // unweighted document: every edge counts 1
      note: 'unweighted',
    },
    {
      spec: ['A-B:5', 'A-C:5', 'B-C:5', 'C-D:1', 'D-E:1', 'E-A:9'],
      weight: 12, // 5 + 5 + 1 + 1
      note: 'a heavy triangle with a cheap tail',
    },
  ]

  it.each(connected)('agrees on total weight ($note)', ({ spec, weight }) => {
    const p = build(spec, { weighted: spec.some((s) => s.includes(':')) })
    const k = build(spec, { weighted: spec.some((s) => s.includes(':')) })

    const prim = primAlgorithm.run(p.graph, { source: p.at('A') })
    const kruskal = kruskalAlgorithm.run(k.graph, {})

    expect(treeWeight(p.graph, prim)).toBe(weight)
    expect(treeWeight(k.graph, kruskal)).toBe(weight)
    expect(lastStep(prim).treeEdges).toHaveLength(p.graph.order - 1)
    expect(lastStep(kruskal).treeEdges).toHaveLength(k.graph.order - 1)
  })

  it('starts prim anywhere and still finds the same weight', () => {
    const spec = ['A-B:1', 'A-C:4', 'B-C:1', 'B-D:7', 'C-D:2', 'D-E:3']
    for (const label of ['A', 'B', 'C', 'D', 'E']) {
      const { graph, at } = build(spec, { weighted: true })
      expect(treeWeight(graph, primAlgorithm.run(graph, { source: at(label) }))).toBe(7)
    }
  })

  it('emits accept and reject steps', () => {
    const spec = ['A-B:1', 'A-C:4', 'B-C:1', 'C-D:2']
    const p = build(spec, { weighted: true })
    const prim = primAlgorithm.run(p.graph, { source: p.at('A') })
    expect(prim.steps.some((s) => s.type === 'accept')).toBe(true)
    expect(prim.steps.some((s) => s.type === 'reject')).toBe(true)

    const k = build(spec, { weighted: true })
    const kruskal = kruskalAlgorithm.run(k.graph, {})
    const reject = kruskal.steps.find((s) => s.type === 'reject')
    expect(reject?.description).toBe('Reject A-C: would form a cycle')
    expect(lastStep(kruskal).rejectedEdges).toHaveLength(1)
  })

  it('keeps kruskal rejections accumulating', () => {
    const { graph } = build(['A-B:1', 'B-C:1', 'A-C:1', 'C-A:2'], { weighted: true })
    const run = kruskalAlgorithm.run(graph, {})
    let seen = 0
    for (const step of run.steps) {
      const count = (step.rejectedEdges ?? []).length
      expect(count).toBeGreaterThanOrEqual(seen)
      seen = count
    }
    expect(seen).toBe(2)
  })

  it('handles a disconnected graph without throwing', () => {
    const spec = ['A-B:1', 'C-D:2', 'E']
    const p = build(spec, { weighted: true })
    const prim = primAlgorithm.run(p.graph, { source: p.at('A') })

    expect(prim.error).toBeUndefined()
    expect(treeWeight(p.graph, prim)).toBe(1)
    expect(resultValue(prim, 'Vertices reached')).toBe('2 of 5')
    expect(resultValue(prim, 'Note')).toContain('spanning tree')
    expect(resultValue(prim, 'Note')).toContain('2 of 5')
    expect(lastStep(prim).description).toContain("A's component")

    const k = build(spec, { weighted: true })
    const kruskal = kruskalAlgorithm.run(k.graph, {})
    expect(kruskal.error).toBeUndefined()
    expect(treeWeight(k.graph, kruskal)).toBe(3)
    expect(resultValue(kruskal, 'Result')).toBe('spanning forest with 3 components')
  })

  it('reads a digraph as undirected', () => {
    const spec = ['A->B:1', 'C->B:2', 'C->D:5']
    const p = build(spec, { directed: true, weighted: true })
    const k = build(spec, { directed: true, weighted: true })

    expect(treeWeight(p.graph, primAlgorithm.run(p.graph, { source: p.at('A') }))).toBe(8)
    expect(treeWeight(k.graph, kruskalAlgorithm.run(k.graph, {}))).toBe(8)
  })

  it('sorts kruskal deterministically and marks a cursor', () => {
    const spec = ['A-B:3', 'B-C:1', 'C-D:2', 'A-D:1']
    const first = build(spec, { weighted: true })
    const second = build(spec, { weighted: true })
    expect(normalized(first.graph, kruskalAlgorithm.run(first.graph, {}))).toBe(
      normalized(second.graph, kruskalAlgorithm.run(second.graph, {})),
    )
    const accepts = kruskalAlgorithm
      .run(first.graph, {})
      .steps.filter((s) => s.type === 'accept')
    // Cheapest first, ties in document order: B-C(1), A-D(1), C-D(2).
    expect(accepts.map((s) => s.description)).toEqual([
      'Add B-C (1) to the forest',
      'Add A-D (1) to the forest',
      'Add C-D (2) to the forest',
    ])
    expect(accepts[0].state?.['Sorted edges']).toContain('▸B-C (1)')
  })
})

/* ------------------------------------------------------------------ */
/* Topological sort                                                    */
/* ------------------------------------------------------------------ */

describe('topological sort', () => {
  it('orders a DAG so every edge runs forwards', () => {
    const { graph, at } = build(['A->B', 'A->C', 'B->D', 'C->D', 'D->E'], { directed: true })
    const run = topologicalSortAlgorithm.run(graph, {})

    const order = subjectsOfType(graph, run, 'output')
    expect(order).toHaveLength(graph.order)
    const position = new Map(order.map((label, i) => [label, i] as const))
    for (const e of graph.edges) {
      expect(position.get(graph.label(e.source))!).toBeLessThan(
        position.get(graph.label(e.target))!,
      )
    }
    expect(resultValue(run, 'Cycle')).toBe('no, the graph is a DAG')
    expect(order[0]).toBe('A')
    expect(order[order.length - 1]).toBe('E')
    expect(at('A')).toBeTruthy()
  })

  it('badges the remaining indegree', () => {
    const { graph } = build(['A->C', 'B->C'], { directed: true })
    const run = topologicalSortAlgorithm.run(graph, {})
    expect(badgesByLabel(graph, run.steps[0])).toEqual({ A: '0', B: '0', C: '2' })
    expect(badgesByLabel(graph, lastStep(run))).toEqual({ A: '0', B: '0', C: '0' })
  })

  it('terminates on a cyclic digraph and names the stuck vertices', () => {
    const { graph } = build(['S->A', 'A->B', 'B->C', 'C->A'], { directed: true })
    const run = topologicalSortAlgorithm.run(graph, {})
    const final = lastStep(run)

    expect(subjectsOfType(graph, run, 'output')).toEqual(['S'])
    expect(final.type).toBe('cycle')
    expect(final.description).toContain('Stuck')
    expect(labelsOf(graph, final.activeVertices ?? []).sort()).toEqual(['A', 'B', 'C'])
    expect(resultValue(run, 'Cycle')).toContain('A, B, C')
  })

  it('refuses an undirected graph', () => {
    const { graph } = build(['A-B', 'B-C'])
    const refusal = topologicalSortAlgorithm.precondition?.(graph, {})
    expect(refusal).toBeTruthy()
    expect(refusal).toContain('directed')

    const run = topologicalSortAlgorithm.run(graph, {})
    expect(run.steps).toHaveLength(0)
    expect(run.error).toBe(refusal)
  })

  it('accepts a directed graph in the precondition', () => {
    const { graph } = build(['A->B'], { directed: true })
    expect(topologicalSortAlgorithm.precondition?.(graph, {})).toBeNull()
  })
})

/* ------------------------------------------------------------------ */
/* Greedy colouring                                                    */
/* ------------------------------------------------------------------ */

describe('greedy colouring', () => {
  const orderings = ['document', 'largest-first', 'smallest-last', 'dsatur'] as const

  const specs: { name: string; spec: string[] }[] = [
    { name: 'C5', spec: ['A-B', 'B-C', 'C-D', 'D-E', 'E-A'] },
    { name: 'C6', spec: ['A-B', 'B-C', 'C-D', 'D-E', 'E-F', 'F-A'] },
    {
      name: 'K5',
      spec: [
        'A-B', 'A-C', 'A-D', 'A-E',
        'B-C', 'B-D', 'B-E',
        'C-D', 'C-E',
        'D-E',
      ],
    },
    { name: 'a tree with an isolated vertex', spec: ['A-B', 'A-C', 'C-D', 'C-E', 'F'] },
    { name: 'bipartite K3,3', spec: ['A-D', 'A-E', 'A-F', 'B-D', 'B-E', 'B-F', 'C-D', 'C-E', 'C-F'] },
    { name: 'the Petersen outer ring plus spokes', spec: ['A-B', 'B-C', 'C-D', 'D-E', 'E-A', 'A-F', 'B-G', 'C-H', 'D-I', 'E-J'] },
  ]

  for (const { name, spec } of specs) {
    for (const ordering of orderings) {
      it(`is proper on ${name} with ${ordering} order`, () => {
        const { graph } = build(spec)
        const run = greedyColoringAlgorithm.run(graph, { ordering })
        const colors = lastStep(run).colors ?? {}

        expect(Object.keys(colors)).toHaveLength(graph.order)
        expect(isProperColoring(graph, colors)).toBe(true)
      })
    }
  }

  it('uses 2 colours on C6, 3 on C5 and 5 on K5', () => {
    const expected: [string, string[], number][] = [
      ['C6', ['A-B', 'B-C', 'C-D', 'D-E', 'E-F', 'F-A'], 2],
      ['C5', ['A-B', 'B-C', 'C-D', 'D-E', 'E-A'], 3],
      [
        'K5',
        ['A-B', 'A-C', 'A-D', 'A-E', 'B-C', 'B-D', 'B-E', 'C-D', 'C-E', 'D-E'],
        5,
      ],
    ]
    for (const [, spec, count] of expected) {
      for (const ordering of orderings) {
        const { graph } = build(spec)
        const run = greedyColoringAlgorithm.run(graph, { ordering })
        expect(colorsUsed(lastStep(run).colors ?? {})).toBe(count)
        expect(resultValue(run, 'Colours used')).toBe(String(count))
      }
    }
  })

  it('defaults to largest-first and reports the ordering', () => {
    const { graph } = build(['A-B', 'A-C', 'A-D', 'B-C'])
    const run = greedyColoringAlgorithm.run(graph, {})
    expect(resultValue(run, 'Ordering')).toContain('largest first')
    expect(run.steps[0].description).toContain('largest first')
    // A has degree 3, so it goes first and takes colour 1.
    expect(run.steps[1].description).toBe('Colour A with colour 1')
  })

  it('names the forbidden colours in the detail line', () => {
    const { graph } = build(['A-B', 'A-C', 'B-C'])
    const run = greedyColoringAlgorithm.run(graph, { ordering: 'document' })
    const third = run.steps.filter((s) => s.type === 'color')[2]
    expect(third.description).toBe('Colour C with colour 3')
    expect(third.detail).toContain('forbid colours 1, 2')
  })

  const degeneracies: { name: string; spec: string[]; degeneracy: number }[] = [
    { name: 'a star', spec: ['A-B', 'A-C', 'A-D', 'A-E'], degeneracy: 1 },
    { name: 'a path', spec: ['A-B', 'B-C', 'C-D'], degeneracy: 1 },
    { name: 'C5', spec: ['A-B', 'B-C', 'C-D', 'D-E', 'E-A'], degeneracy: 2 },
    {
      name: 'K5',
      spec: ['A-B', 'A-C', 'A-D', 'A-E', 'B-C', 'B-D', 'B-E', 'C-D', 'C-E', 'D-E'],
      degeneracy: 4,
    },
    {
      // 3-regular, so its degeneracy is 3.
      name: 'K3,3',
      spec: ['A-D', 'A-E', 'A-F', 'B-D', 'B-E', 'B-F', 'C-D', 'C-E', 'C-F'],
      degeneracy: 3,
    },
  ]

  it.each(degeneracies)(
    'builds a real degeneracy order for $name (smallest-last)',
    ({ spec, degeneracy }) => {
      const { graph } = build(spec)
      const run = greedyColoringAlgorithm.run(graph, { ordering: 'smallest-last' })
      const order = subjectIdsOfType(run, 'color')

      expect(order).toHaveLength(graph.order)
      expect(new Set(order).size).toBe(graph.order)
      // The defining property: reversed, each vertex had the least remaining degree.
      expect(maxBackwardDegree(graph, order)).toBe(degeneracy)
      // ...which is exactly the bound greedy then respects.
      expect(colorsUsed(lastStep(run).colors ?? {})).toBeLessThanOrEqual(degeneracy + 1)
    },
  )

  it('accumulates colours across steps', () => {
    const { graph } = build(['A-B', 'B-C', 'C-A'])
    const run = greedyColoringAlgorithm.run(graph, { ordering: 'document' })
    const sizes = run.steps.map((s) => Object.keys(s.colors ?? {}).length)
    expect(sizes).toEqual([0, 1, 2, 3, 3])
  })

  it('ignores direction', () => {
    const { graph } = build(['A->B', 'B->C', 'C->A'], { directed: true })
    const run = greedyColoringAlgorithm.run(graph, {})
    expect(isProperColoring(graph, lastStep(run).colors ?? {})).toBe(true)
    expect(colorsUsed(lastStep(run).colors ?? {})).toBe(3)
  })
})

/* ------------------------------------------------------------------ */
/* Registry and degenerate input                                       */
/* ------------------------------------------------------------------ */

describe('registry', () => {
  it('exposes every algorithm with a unique id', () => {
    expect(ALGORITHMS).toHaveLength(8)
    const ids = ALGORITHMS.map((a) => a.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(algorithmById(id)?.id).toBe(id)
    expect(algorithmById('nope')).toBeUndefined()
  })

  it('names every algorithm and gives it a description', () => {
    for (const a of ALGORITHMS) {
      expect(a.name.length).toBeGreaterThan(0)
      expect(a.description.length).toBeGreaterThan(0)
      expect(typeof a.needsSource).toBe('boolean')
    }
  })
})

describe('degenerate input', () => {
  it('survives an empty graph', () => {
    const { graph } = build([])
    for (const algorithm of ALGORITHMS) {
      const run = (): AlgorithmRun => algorithm.run(graph, {})
      expect(run, algorithm.id).not.toThrow()
      const result = run()
      expect(result.algorithmId, algorithm.id).toBe(algorithm.id)
      expect(Array.isArray(result.steps), algorithm.id).toBe(true)
      expect(result.steps, algorithm.id).toHaveLength(0)
      expect(typeof result.error, algorithm.id).toBe('string')
    }
  })

  it('survives a single vertex', () => {
    for (const algorithm of ALGORITHMS) {
      const { graph, at } = build(['A'])
      const run = (): AlgorithmRun => algorithm.run(graph, { source: at('A') })
      expect(run, algorithm.id).not.toThrow()
      const result = run()
      // Only topological sort refuses, because the document is undirected.
      if (result.error === undefined) expect(result.steps.length, algorithm.id).toBeGreaterThan(0)
    }
  })

  it('survives a single vertex on a directed document', () => {
    for (const algorithm of ALGORITHMS) {
      const { graph, at } = build(['A'], { directed: true, weighted: true })
      const result = algorithm.run(graph, { source: at('A') })
      expect(result.error, algorithm.id).toBeUndefined()
      expect(result.steps.length, algorithm.id).toBeGreaterThan(0)
    }
  })

  it('refuses a source that is not in the graph', () => {
    const { graph } = build(['A-B'])
    for (const algorithm of ALGORITHMS.filter((a) => a.needsSource)) {
      const result = algorithm.run(graph, { source: 'not-a-vertex' })
      expect(result.steps, algorithm.id).toHaveLength(0)
      expect(result.error, algorithm.id).toContain("can't start there")
    }
  })

  it('falls back to the first vertex when no source is given', () => {
    const { graph, at } = build(['A-B', 'B-C'])
    for (const algorithm of ALGORITHMS.filter((a) => a.needsSource)) {
      const withoutSource = algorithm.run(graph, {})
      const withSource = algorithm.run(graph, { source: at('A') })
      expect(withoutSource.error, algorithm.id).toBeUndefined()
      expect(JSON.stringify(withoutSource.steps), algorithm.id).toBe(
        JSON.stringify(withSource.steps),
      )
    }
  })

  it('survives a self-loop and parallel edges', () => {
    const { graph, at } = build(['A-A:1', 'A-B:2', 'A-B:3', 'B-C:1'], { weighted: true })
    for (const algorithm of ALGORITHMS) {
      // Topological sort refuses an undirected document, which is its own test.
      if (algorithm.precondition?.(graph, {})) continue
      const result = algorithm.run(graph, { source: at('A') })
      expect(result.error, algorithm.id).toBeUndefined()
      expect(result.steps.length, algorithm.id).toBeGreaterThan(0)
    }
  })

  it('survives a self-loop and parallel arcs on a digraph', () => {
    const { graph, at } = build(['A->A:1', 'A->B:2', 'A->B:3', 'B->C:1'], {
      directed: true,
      weighted: true,
    })
    for (const algorithm of ALGORITHMS) {
      const result = algorithm.run(graph, { source: at('A') })
      expect(result.error, algorithm.id).toBeUndefined()
      expect(result.steps.length, algorithm.id).toBeGreaterThan(0)
    }
    // The self-loop is a cycle, so no topological order exists.
    expect(lastStep(topologicalSortAlgorithm.run(graph, {})).type).toBe('cycle')
  })

  it('runs every algorithm deterministically twice over', () => {
    const spec = ['A-B:1', 'A-C:4', 'B-C:1', 'B-D:7', 'C-D:2', 'D-E:3', 'F']
    for (const algorithm of ALGORITHMS) {
      const first = build(spec, { weighted: true })
      const second = build(spec, { weighted: true })
      expect(
        normalized(first.graph, algorithm.run(first.graph, { source: first.at('A') })),
        algorithm.id,
      ).toBe(normalized(second.graph, algorithm.run(second.graph, { source: second.at('A') })))
    }
  })
})
