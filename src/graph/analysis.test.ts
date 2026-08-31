import { describe, expect, it } from 'vitest'
import { Graph } from './model/graph'
import { docFromEdges } from './model/builder'
import { analyzeCore, analyzeHard, analyzeMetrics, type InspectorRow } from './analysis'
import type { Exactness } from './model/types'

const g = (spec: string[], options?: { directed?: boolean; weighted?: boolean }) =>
  new Graph(docFromEdges(spec, options))

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

/** Mycielskian of C5: 11 vertices, triangle-free, chromatic number 4. */
const grotzschSpec = (): string[] => {
  const out: string[] = []
  for (let i = 0; i < 5; i++) out.push(`a${i}-a${(i + 1) % 5}`)
  for (let i = 0; i < 5; i++) {
    out.push(`b${i}-a${(i + 4) % 5}`, `b${i}-a${(i + 1) % 5}`, `z-b${i}`)
  }
  return out
}

const PETERSEN = [
  'A-B', 'B-C', 'C-D', 'D-E', 'E-A',
  'F-H', 'H-J', 'J-G', 'G-I', 'I-F',
  'A-F', 'B-G', 'C-H', 'D-I', 'E-J',
]

const allRows = (graph: Graph): InspectorRow[] => [
  ...analyzeCore(graph).sections.flatMap((s) => s.rows),
  ...analyzeMetrics(graph).sections.flatMap((s) => s.rows),
  ...analyzeHard(graph).sections.flatMap((s) => s.rows),
]

const rowValue = (rows: InspectorRow[], id: string): string => {
  const row = rows.find((r) => r.id === id)
  if (!row) throw new Error(`No inspector row with id "${id}"`)
  return row.value
}

const rowFor = (rows: InspectorRow[], id: string): InspectorRow => {
  const row = rows.find((r) => r.id === id)
  if (!row) throw new Error(`No inspector row with id "${id}"`)
  return row
}

describe('inspector rows for named graphs', () => {
  it('describes K5 correctly', () => {
    const rows = allRows(g(completeSpec(5)))
    expect(rowValue(rows, 'vertices')).toBe('5')
    expect(rowValue(rows, 'edges')).toBe('10')
    expect(rowValue(rows, 'degreeSequence')).toBe('[4, 4, 4, 4, 4]')
    expect(rowValue(rows, 'complete')).toBe('Yes')
    expect(rowValue(rows, 'regular')).toBe('Yes, 4-regular')
    expect(rowValue(rows, 'bipartite')).toBe('No')
    expect(rowValue(rows, 'diameter')).toBe('1')
    expect(rowValue(rows, 'planar')).toBe('No')
    expect(rowValue(rows, 'chromaticNumber')).toBe('5')
    expect(rowFor(rows, 'chromaticNumber').exactness).toBe('exact')
    expect(rowValue(rows, 'girth')).toBe('3')
    expect(rowValue(rows, 'spanningTreeCount')).toBe('125') // 5^3 by Cayley
  })

  it('describes C5 correctly', () => {
    const rows = allRows(g(cycleSpec(5)))
    expect(rowValue(rows, 'vertices')).toBe('5')
    expect(rowValue(rows, 'edges')).toBe('5')
    expect(rowValue(rows, 'regular')).toBe('Yes, 2-regular')
    expect(rowValue(rows, 'connected')).toBe('Yes')
    expect(rowValue(rows, 'bipartite')).toBe('No')
    expect(rowValue(rows, 'chromaticNumber')).toBe('3')
    expect(rowValue(rows, 'eulerCircuit')).toBe('Yes')
    expect(rowValue(rows, 'girth')).toBe('5')
    expect(rowValue(rows, 'spanningTreeCount')).toBe('5')
  })

  it('describes C6 correctly', () => {
    const rows = allRows(g(cycleSpec(6)))
    expect(rowValue(rows, 'regular')).toBe('Yes, 2-regular')
    expect(rowValue(rows, 'bipartite')).toBe('Yes')
    expect(rowValue(rows, 'chromaticNumber')).toBe('2')
    expect(rowValue(rows, 'eulerCircuit')).toBe('Yes')
    expect(rowValue(rows, 'diameter')).toBe('3')
  })

  it('describes the Petersen graph correctly', () => {
    const rows = allRows(g(PETERSEN))
    expect(rowValue(rows, 'vertices')).toBe('10')
    expect(rowValue(rows, 'edges')).toBe('15')
    expect(rowValue(rows, 'regular')).toBe('Yes, 3-regular')
    expect(rowValue(rows, 'girth')).toBe('5')
    expect(rowValue(rows, 'diameter')).toBe('2')
    expect(rowValue(rows, 'planar')).toBe('No')
    expect(rowValue(rows, 'chromaticNumber')).toBe('3')
    expect(rowValue(rows, 'spanningTreeCount')).toBe('2,000')
    expect(rowValue(rows, 'edgeConnectivity')).toBe('3')
    expect(rowValue(rows, 'vertexConnectivity')).toBe('3')
    expect(rowValue(rows, 'bridges')).toBe('0')
  })

  it('describes a tree correctly', () => {
    const rows = allRows(g(['A-B', 'A-C', 'B-D', 'B-E', 'C-F']))
    expect(rowValue(rows, 'vertices')).toBe('6')
    expect(rowValue(rows, 'edges')).toBe('5')
    expect(rowValue(rows, 'tree')).toBe('Yes')
    expect(rowValue(rows, 'forest')).toBe('Yes')
    expect(rowValue(rows, 'hasCycle')).toBe('No')
    expect(rowValue(rows, 'girth')).toBe('∞')
    expect(rowValue(rows, 'bridges')).toBe('5')
    expect(rowValue(rows, 'spanningTreeCount')).toBe('1')
    expect(rowValue(rows, 'chromaticNumber')).toBe('2')
  })

  it('describes a disconnected graph correctly', () => {
    const rows = allRows(g(['A-B', 'B-C', 'D-E']))
    expect(rowValue(rows, 'connected')).toBe('No')
    expect(rowValue(rows, 'components')).toBe('2')
    expect(rowValue(rows, 'diameter')).toBe('∞')
    expect(rowValue(rows, 'spanningTreeCount')).toBe('0')
    expect(rowFor(rows, 'connected').witness?.type).toBe('partition')
  })

  it('adapts to a directed graph', () => {
    const rows = allRows(g(['A->B', 'B->C', 'C->A'], { directed: true }))
    expect(rowFor(rows, 'connected').label).toBe('Weakly connected')
    expect(rowValue(rows, 'stronglyConnected')).toBe('Yes')
    expect(rowValue(rows, 'dag')).toBe('No')
    expect(rows.some((r) => r.id === 'indegSeq')).toBe(true)
    expect(rowFor(rows, 'adjacencySpectrum').exactness).toBe('not-applicable')
  })

  it('shows a topological order for a DAG', () => {
    const rows = allRows(g(['A->B', 'A->C', 'B->D', 'C->D'], { directed: true }))
    expect(rowValue(rows, 'dag')).toBe('Yes')
    expect(rowFor(rows, 'topoOrder').witness?.type).toBe('vertices')
  })

  it('says nothing confident about an empty graph', () => {
    const rows = allRows(g([]))
    expect(rowValue(rows, 'vertices')).toBe('0')
    for (const id of ['complete', 'regular', 'tree', 'bipartite', 'planar', 'connected']) {
      expect(rowValue(rows, id)).toBe('—')
    }
  })
})

describe('honesty of the reported labels', () => {
  const INEXACT: Exactness[] = [
    'heuristic',
    'upper-bound',
    'lower-bound',
    'bounded',
    'not-computed',
    'not-applicable',
  ]

  it('always explains a result that is not exact', () => {
    for (const spec of [completeSpec(5), cycleSpec(7), PETERSEN, ['A-B', 'C-D']]) {
      for (const row of allRows(g(spec))) {
        if (row.exactness && INEXACT.includes(row.exactness)) {
          expect(row.explanation, `${row.id} has no explanation`).toBeTruthy()
        }
      }
    }
  })

  it('reports bounds rather than a guess when the search is skipped', () => {
    // The Grotzsch graph is triangle-free with chromatic number 4, so the
    // clique bound cannot close the gap. Padding it past the exact limit
    // forces an interval rather than a claim.
    const spec = [...grotzschSpec()]
    for (let i = 0; i < 20; i++) spec.push(`p${i}-p${i + 1}`)
    const row = rowFor(allRows(g(spec)), 'chromaticNumber')
    expect(row.exactness).toBe('bounded')
    expect(row.value).toMatch(/^\d+-\d+$/)
    expect(row.explanation).toMatch(/24 vertices|disabled/)
  })

  it('reports a single number only when the bounds actually meet', () => {
    // Above the limit, but the greedy colouring matches the clique bound, so
    // the answer is proved without any search.
    const spec: string[] = []
    for (let i = 0; i < 30; i++) spec.push(`v${i}-v${(i + 1) % 30}`, `v${i}-v${(i + 7) % 30}`)
    const row = rowFor(allRows(g(spec)), 'chromaticNumber')
    expect(row.exactness).toBe('exact')
    expect(row.value).toMatch(/^\d+$/)
  })

  it('never labels an eigenvalue as exact', () => {
    const row = rowFor(allRows(g(cycleSpec(5))), 'adjacencySpectrum')
    expect(row.exactness).toBe('heuristic')
    expect(row.explanation ?? row.detail).toBeTruthy()
  })

  it('labels the spanning tree count as exact, because it is', () => {
    expect(rowFor(allRows(g(completeSpec(4))), 'spanningTreeCount').exactness).toBe('exact')
  })
})

describe('witness integrity', () => {
  it('only ever references elements that exist', () => {
    for (const spec of [
      completeSpec(5),
      cycleSpec(6),
      PETERSEN,
      ['A-B', 'B-C', 'C-A', 'C-D'],
      ['A-B', 'C-D'],
      ['A-A', 'A-B'],
    ]) {
      const graph = g(spec)
      for (const row of allRows(graph)) {
        const witness = row.witness
        if (!witness) continue
        const vertexIds =
          witness.type === 'partition'
            ? witness.groups.flat()
            : witness.type === 'coloring'
              ? Object.keys(witness.colors)
              : 'vertexIds' in witness
                ? witness.vertexIds
                : []
        const edgeIds = 'edgeIds' in witness ? witness.edgeIds : []
        for (const id of vertexIds) {
          expect(graph.hasVertex(id), `${row.id} referenced a missing vertex`).toBe(true)
        }
        for (const id of edgeIds) {
          expect(graph.edge(id), `${row.id} referenced a missing edge`).toBeTruthy()
        }
      }
    }
  })

  it('gives the diameter a path of exactly that length', () => {
    const rows = allRows(g(['A-B', 'B-C', 'C-D', 'D-E']))
    const row = rowFor(rows, 'diameter')
    expect(row.witness?.type).toBe('path')
    if (row.witness?.type === 'path') {
      expect(row.witness.edgeIds).toHaveLength(Number(row.value))
    }
  })

  it('gives a colouring witness that is proper', () => {
    const graph = g(PETERSEN)
    const row = rowFor(allRows(graph), 'greedyColoring')
    expect(row.witness?.type).toBe('coloring')
    if (row.witness?.type === 'coloring') {
      for (const edge of graph.edges) {
        expect(row.witness.colors[edge.source]).not.toBe(row.witness.colors[edge.target])
      }
    }
  })
})

describe('performance guards', () => {
  it('keeps the core analysis fast on a few hundred vertices', () => {
    const spec: string[] = []
    for (let i = 0; i < 400; i++) spec.push(`v${i}-v${(i + 1) % 400}`, `v${i}-v${(i + 13) % 400}`)
    const graph = g(spec)
    const started = performance.now()
    analyzeCore(graph)
    expect(performance.now() - started).toBeLessThan(1500)
  })
})
