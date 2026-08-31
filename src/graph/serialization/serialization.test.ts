import { describe, expect, it } from 'vitest'

import { Graph } from '../model/graph'
import { GraphBuilder, docFromEdges } from '../model/builder'
import type { GraphDocument } from '../model/types'
import {
  GRAPHUALIZE_FORMAT_VERSION,
  ImportError,
  parseAdjacencyList,
  parseAdjacencyMatrix,
  parseAnyGraphText,
  parseDot,
  parseEdgeListCsv,
  parseGraphualizeJson,
  serializeGraph,
  toAdjacencyList,
  toAdjacencyMatrixText,
  toDot,
  toEdgeListCsv,
  toGraphml,
  toJsonString,
} from './index'

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const graphOf = (doc: GraphDocument): Graph => new Graph(doc)

/** Edges as label pairs, canonicalised so two documents can be compared. */
const edgeKeys = (g: Graph): string[] =>
  g.edges
    .map((e) => {
      const a = g.label(e.source)
      const b = g.label(e.target)
      return g.directed ? `${a}->${b}` : [a, b].sort().join('-')
    })
    .sort()

/** label -> sorted set of neighbour labels (successors when directed). */
const neighbourSets = (g: Graph): Record<string, string[]> => {
  const out: Record<string, string[]> = {}
  for (const v of g.vertices) {
    const names = new Set(g.successors(v.id).map((n) => g.label(n.to)))
    out[g.label(v.id)] = [...names].sort()
  }
  return out
}

/** label pair -> weight, for comparing weighted graphs across formats. */
const weightMap = (g: Graph): Record<string, number> => {
  const out: Record<string, number> = {}
  for (const e of g.edges) {
    const a = g.label(e.source)
    const b = g.label(e.target)
    out[g.directed ? `${a}->${b}` : [a, b].sort().join('-')] = g.weight(e.id)
  }
  return out
}

const undirectedSimple = (): GraphDocument =>
  docFromEdges(['A-B', 'B-C', 'C-D', 'D-A', 'A-C'])

const directedSample = (): GraphDocument =>
  docFromEdges(['A->B', 'B->C', 'C->A', 'A->D'], { directed: true })

const weightedSample = (): GraphDocument =>
  docFromEdges(['A-B:4', 'B-C:1.5', 'C-D:2', 'A-D:7'], { weighted: true })

/** A weighted, directed document with hand-placed vertices. */
const weightedDirectedDocument = (): GraphDocument => {
  const b = new GraphBuilder({ directed: true, weighted: true })
  const a = b.addVertex('Alpha', 10, -20)
  const bb = b.addVertex('Beta', 130.5, 44)
  const c = b.addVertex('Gamma', -60, 88)
  const d = b.addVertex('Delta', 0, 0)
  b.addEdge(a, bb, 4)
  b.addEdge(bb, c, 1.5)
  b.addEdge(c, a, 12)
  b.addEdge(a, d, 0.25)
  return b.build()
}

/* ------------------------------------------------------------------ */
/* Native document round trip                                          */
/* ------------------------------------------------------------------ */

describe('Graphualize JSON round trip', () => {
  it('preserves a weighted directed document through save and load', () => {
    const doc = weightedDirectedDocument()
    const saved = serializeGraph({
      id: 'doc-1',
      name: 'Flow network',
      graph: doc,
      createdAt: 1000,
      updatedAt: 2000,
      viewport: { zoom: 1.5, pan: { x: 12, y: -8 } },
      notes: 'A note that should survive.',
    })

    expect(saved.format).toBe('graphualize')
    expect(saved.version).toBe(GRAPHUALIZE_FORMAT_VERSION)

    const text = toJsonString(saved)
    expect(text).toContain('\n  "format": "graphualize"')
    expect(text.split('\n').length).toBeGreaterThan(10)

    const loaded = parseGraphualizeJson(text)
    expect(loaded.id).toBe('doc-1')
    expect(loaded.name).toBe('Flow network')
    expect(loaded.createdAt).toBe(1000)
    expect(loaded.updatedAt).toBe(2000)
    expect(loaded.viewport).toEqual({ zoom: 1.5, pan: { x: 12, y: -8 } })
    expect(loaded.notes).toBe('A note that should survive.')

    expect(loaded.graph.directed).toBe(true)
    expect(loaded.graph.weighted).toBe(true)
    expect(loaded.graph.vertices).toEqual(doc.vertices)
    expect(loaded.graph.edges).toEqual(doc.edges)

    const before = graphOf(doc)
    const after = graphOf(loaded.graph)
    expect(after.order).toBe(before.order)
    expect(after.size).toBe(before.size)
    expect(after.vertices.map((v) => v.label)).toEqual(['Alpha', 'Beta', 'Gamma', 'Delta'])
    expect(after.vertices.map((v) => [v.x, v.y])).toEqual([
      [10, -20],
      [130.5, 44],
      [-60, 88],
      [0, 0],
    ])
    expect(edgeKeys(after)).toEqual(edgeKeys(before))
    expect(weightMap(after)).toEqual(weightMap(before))
    expect(neighbourSets(after)).toEqual(neighbourSets(before))
  })

  it('deep-copies the document so later edits cannot mutate the snapshot', () => {
    const doc = undirectedSimple()
    const saved = serializeGraph({ id: 'x', name: 'x', graph: doc })
    doc.vertices[0].label = 'CHANGED'
    expect(saved.graph.vertices[0].label).toBe('A')
  })

  it('drops a viewport whose numbers are not finite instead of saving it', () => {
    const saved = serializeGraph({
      id: 'x',
      name: 'x',
      graph: undirectedSimple(),
      viewport: { zoom: Number.NaN, pan: { x: 0, y: 0 } },
    })
    expect(saved.viewport).toBeUndefined()
  })
})

/* ------------------------------------------------------------------ */
/* Migration                                                           */
/* ------------------------------------------------------------------ */

describe('version 1 migration', () => {
  it('reads a v1 payload that uses nodes/links and has no viewport or notes', () => {
    const v1 = JSON.stringify({
      format: 'graphualize',
      version: 1,
      id: 'legacy-7',
      name: 'Legacy graph',
      createdAt: 111,
      updatedAt: 222,
      graph: {
        nodes: [
          { id: 'n1', label: 'A', x: 5, y: 6 },
          { id: 'n2', label: 'B', x: 7, y: 8 },
          { id: 'n3', label: 'C', x: 9, y: 10 },
        ],
        links: [
          { id: 'l1', source: 'n1', target: 'n2', weight: 3 },
          { id: 'l2', source: 'n2', target: 'n3' },
        ],
        directed: false,
        weighted: true,
      },
    })

    const loaded = parseGraphualizeJson(v1)
    expect(loaded.version).toBe(GRAPHUALIZE_FORMAT_VERSION)
    expect(loaded.id).toBe('legacy-7')
    expect(loaded.name).toBe('Legacy graph')
    expect(loaded.viewport).toBeUndefined()
    expect(loaded.notes).toBeUndefined()

    const g = graphOf(loaded.graph)
    expect(g.order).toBe(3)
    expect(g.size).toBe(2)
    expect(g.weighted).toBe(true)
    expect(edgeKeys(g)).toEqual(['A-B', 'B-C'])
    expect(g.vertices.map((v) => [v.x, v.y])).toEqual([
      [5, 6],
      [7, 8],
      [9, 10],
    ])
  })

  it('treats a payload with no version field as version 1', () => {
    const text = JSON.stringify({
      format: 'graphualize',
      graph: { vertices: [{ id: 'a' }, { id: 'b' }], edges: [{ source: 'a', target: 'b' }] },
    })
    const loaded = parseGraphualizeJson(text)
    expect(loaded.version).toBe(GRAPHUALIZE_FORMAT_VERSION)
    expect(loaded.graph.edges).toHaveLength(1)
  })

  it('fills in labels, coordinates and edge ids that the file omitted', () => {
    const text = JSON.stringify({
      format: 'graphualize',
      version: 2,
      graph: {
        vertices: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
        edges: [
          { source: 'a', target: 'b' },
          { source: 'b', target: 'c' },
        ],
      },
    })
    const loaded = parseGraphualizeJson(text)
    expect(loaded.graph.vertices.map((v) => v.label)).toEqual(['A', 'B', 'C'])
    for (const v of loaded.graph.vertices) {
      expect(Number.isFinite(v.x)).toBe(true)
      expect(Number.isFinite(v.y)).toBe(true)
    }
    // A circle layout puts every vertex the same distance from the centre.
    const radii = loaded.graph.vertices.map((v) => Math.round(Math.hypot(v.x, v.y)))
    expect(new Set(radii).size).toBe(1)
    expect(radii[0]).toBeGreaterThan(0)

    const ids = loaded.graph.edges.map((e) => e.id)
    expect(new Set(ids).size).toBe(2)
    for (const id of ids) expect(id).not.toBe('')
    expect(loaded.graph.weighted).toBe(false)
  })

  it('regenerates ids that collide rather than losing a vertex', () => {
    const text = JSON.stringify({
      format: 'graphualize',
      version: 2,
      graph: {
        vertices: [
          { id: 'same', label: 'A' },
          { id: 'same', label: 'B' },
        ],
        edges: [
          { id: 'dup', source: 'same', target: 'same' },
          { id: 'dup', source: 'same', target: 'same' },
        ],
      },
    })
    const loaded = parseGraphualizeJson(text)
    expect(loaded.graph.vertices).toHaveLength(2)
    expect(new Set(loaded.graph.vertices.map((v) => v.id)).size).toBe(2)
    expect(new Set(loaded.graph.edges.map((e) => e.id)).size).toBe(2)
  })
})

/* ------------------------------------------------------------------ */
/* Malformed native documents                                          */
/* ------------------------------------------------------------------ */

describe('malformed Graphualize JSON', () => {
  const expectImportError = (run: () => unknown, pattern: RegExp): Error => {
    let caught: unknown
    try {
      run()
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(ImportError)
    const error = caught as Error
    expect(error.name).toBe('ImportError')
    expect(error.message).toMatch(pattern)
    // Every message must read as a sentence the import dialog can show.
    expect(error.message.length).toBeGreaterThan(20)
    expect(error.message.trimEnd().endsWith('.')).toBe(true)
    expect(error.message[0]).toBe(error.message[0].toUpperCase())
    return error
  }

  it('rejects text that is not JSON at all', () => {
    expectImportError(() => parseGraphualizeJson('{ not json at all'), /not valid JSON/)
  })

  it('rejects an empty file', () => {
    expectImportError(() => parseGraphualizeJson('   '), /nothing to import/)
  })

  it('rejects a JSON file with no format field', () => {
    expectImportError(
      () => parseGraphualizeJson(JSON.stringify({ version: 2, graph: { vertices: [] } })),
      /"format" field is missing/,
    )
  })

  it('names the wrong format when one is present', () => {
    expectImportError(
      () => parseGraphualizeJson(JSON.stringify({ format: 'gexf', version: 1, graph: {} })),
      /says "gexf"/,
    )
  })

  it('refuses a file from a newer version of the app', () => {
    const error = expectImportError(
      () =>
        parseGraphualizeJson(
          JSON.stringify({ format: 'graphualize', version: 99, graph: { vertices: [] } }),
        ),
      /newer version of Graphualize/,
    )
    expect(error.message).toContain('99')
    expect(error.message).toContain(String(GRAPHUALIZE_FORMAT_VERSION))
  })

  it('refuses a vertex with no id', () => {
    expectImportError(
      () =>
        parseGraphualizeJson(
          JSON.stringify({
            format: 'graphualize',
            version: 2,
            graph: { vertices: [{ id: 'a', label: 'A' }, { label: 'B' }], edges: [] },
          }),
        ),
      /Vertex at position 2 has no id/,
    )
  })

  it('refuses an edge that points at a vertex which is not in the file', () => {
    const error = expectImportError(
      () =>
        parseGraphualizeJson(
          JSON.stringify({
            format: 'graphualize',
            version: 2,
            graph: {
              vertices: [{ id: 'a', label: 'A' }],
              edges: [{ id: 'e9', source: 'a', target: 'ghost' }],
            },
          }),
        ),
      /refers to a vertex "ghost" that is not in this file/,
    )
    expect(error.message).toContain('Edge "e9"')
  })

  it('refuses a non-finite coordinate', () => {
    expectImportError(
      () =>
        parseGraphualizeJson(
          '{"format":"graphualize","version":2,"graph":{"vertices":[{"id":"a","label":"A","x":"oops","y":0}],"edges":[]}}',
        ),
      /Vertex "A" has an x coordinate that is not a finite number/,
    )
    expectImportError(
      () =>
        parseGraphualizeJson(
          '{"format":"graphualize","version":2,"graph":{"vertices":[{"id":"a","label":"A","x":0,"y":"NaN"}],"edges":[]}}',
        ),
      /y coordinate that is not a finite number/,
    )
  })

  it('refuses a non-finite weight', () => {
    expectImportError(
      () =>
        parseGraphualizeJson(
          '{"format":"graphualize","version":2,"graph":{"vertices":[{"id":"a"},{"id":"b"}],"edges":[{"id":"e1","source":"a","target":"b","weight":"heavy"}]}}',
        ),
      /Edge "e1" has a weight that is not a finite number/,
    )
  })

  it('refuses a file with no graph section', () => {
    expectImportError(
      () => parseGraphualizeJson(JSON.stringify({ format: 'graphualize', version: 2 })),
      /no "graph" section/,
    )
  })

  it('refuses a vertex list that is not an array', () => {
    expectImportError(
      () =>
        parseGraphualizeJson(
          JSON.stringify({ format: 'graphualize', version: 2, graph: { vertices: 'A, B' } }),
        ),
      /vertex list in this file is not an array/,
    )
  })
})

/* ------------------------------------------------------------------ */
/* Text format round trips                                             */
/* ------------------------------------------------------------------ */

describe('adjacency list', () => {
  it('renders neighbours, isolated vertices and weights', () => {
    const g = graphOf(docFromEdges(['A-B', 'A-C', 'D']))
    expect(toAdjacencyList(g)).toBe('A: B, C\nB: A\nC: A\nD:')

    const weighted = graphOf(weightedSample())
    expect(toAdjacencyList(weighted).split('\n')[0]).toBe('A: B(4), D(7)')
  })

  it('round trips an undirected simple graph', () => {
    const before = graphOf(undirectedSimple())
    const { document, warnings } = parseAdjacencyList(toAdjacencyList(before))
    const after = graphOf(document)
    expect(warnings).toEqual([])
    expect(after.directed).toBe(false)
    expect(after.size).toBe(before.size)
    expect(edgeKeys(after)).toEqual(edgeKeys(before))
    expect(neighbourSets(after)).toEqual(neighbourSets(before))
  })

  it('round trips a directed graph', () => {
    const before = graphOf(directedSample())
    const { document } = parseAdjacencyList(toAdjacencyList(before), { directed: true })
    const after = graphOf(document)
    expect(after.directed).toBe(true)
    expect(after.size).toBe(before.size)
    expect(edgeKeys(after)).toEqual(edgeKeys(before))
    expect(neighbourSets(after)).toEqual(neighbourSets(before))
  })

  it('round trips a weighted graph', () => {
    const before = graphOf(weightedSample())
    const { document } = parseAdjacencyList(toAdjacencyList(before))
    const after = graphOf(document)
    expect(after.weighted).toBe(true)
    expect(after.size).toBe(before.size)
    expect(edgeKeys(after)).toEqual(edgeKeys(before))
    expect(weightMap(after)).toEqual(weightMap(before))
  })

  it('accepts the loose spellings people actually type', () => {
    const spellings = ['A: B C D', 'A: B,C,D', 'A B C D', 'A -> B, C, D']
    for (const text of spellings) {
      const g = graphOf(parseAdjacencyList(text, { directed: false }).document)
      expect(g.order).toBe(4)
      expect(g.size).toBe(3)
      expect(neighbourSets(g).A).toEqual(['B', 'C', 'D'])
    }
  })

  it('treats arrows as a hint that the graph is directed', () => {
    const g = graphOf(parseAdjacencyList('A -> B\nB -> C').document)
    expect(g.directed).toBe(true)
    expect(edgeKeys(g)).toEqual(['A->B', 'B->C'])
  })

  it('skips blank lines and comments', () => {
    const text = ['# a triangle', '', 'A: B, C  // from A', 'B: A, C', '', 'C: A, B'].join('\n')
    const { document, warnings } = parseAdjacencyList(text)
    const g = graphOf(document)
    expect(g.order).toBe(3)
    expect(g.size).toBe(3)
    expect(warnings).toEqual([])
  })

  it('warns instead of creating a parallel edge when a line repeats a neighbour', () => {
    const { document, warnings } = parseAdjacencyList('A: B, B\nB: A')
    expect(graphOf(document).size).toBe(1)
    expect(warnings).toEqual(['Duplicate edge A-B was ignored.'])
  })

  it('accepts every weight spelling it documents', () => {
    const g = graphOf(parseAdjacencyList('A: B(3), C[2], D:1.5').document)
    expect(g.weighted).toBe(true)
    expect(weightMap(g)).toEqual({ 'A-B': 3, 'A-C': 2, 'A-D': 1.5 })
  })

  it('writes a self-loop once rather than twice', () => {
    const g = graphOf(docFromEdges(['A-A', 'A-B']))
    expect(toAdjacencyList(g)).toBe('A: A, B\nB: A')
  })
})

describe('adjacency matrix', () => {
  it('writes a header row and column by default', () => {
    const g = graphOf(docFromEdges(['A-B', 'B-C']))
    expect(toAdjacencyMatrixText(g)).toBe(
      ['  A B C', 'A 0 1 0', 'B 1 0 1', 'C 0 1 0'].join('\n'),
    )
    expect(toAdjacencyMatrixText(g, { withHeaders: false })).toBe(
      ['0 1 0', '1 0 1', '0 1 0'].join('\n'),
    )
    expect(toAdjacencyMatrixText(g, { delimiter: ',' })).toBe(
      [',A,B,C', 'A,0,1,0', 'B,1,0,1', 'C,0,1,0'].join('\n'),
    )
  })

  it('puts weights in the entries of a weighted graph', () => {
    const g = graphOf(weightedSample())
    const text = toAdjacencyMatrixText(g, { delimiter: ',' })
    expect(text.split('\n')[1]).toBe('A,0,4,0,7')
  })

  it('uses rows as sources in a directed graph', () => {
    const g = graphOf(docFromEdges(['A->B'], { directed: true }))
    expect(toAdjacencyMatrixText(g, { delimiter: ',' })).toBe(
      [',A,B', 'A,0,1', 'B,0,0'].join('\n'),
    )
  })

  it('round trips an undirected simple graph', () => {
    const before = graphOf(undirectedSimple())
    const { document, warnings } = parseAdjacencyMatrix(toAdjacencyMatrixText(before))
    const after = graphOf(document)
    expect(warnings).toEqual([])
    expect(after.directed).toBe(false)
    expect(after.size).toBe(before.size)
    expect(edgeKeys(after)).toEqual(edgeKeys(before))
    expect(neighbourSets(after)).toEqual(neighbourSets(before))
  })

  it('round trips a directed graph', () => {
    const before = graphOf(directedSample())
    const { document } = parseAdjacencyMatrix(toAdjacencyMatrixText(before))
    const after = graphOf(document)
    expect(after.directed).toBe(true)
    expect(after.size).toBe(before.size)
    expect(edgeKeys(after)).toEqual(edgeKeys(before))
    expect(neighbourSets(after)).toEqual(neighbourSets(before))
  })

  it('round trips a weighted graph', () => {
    const before = graphOf(weightedSample())
    const { document } = parseAdjacencyMatrix(toAdjacencyMatrixText(before, { delimiter: ',' }))
    const after = graphOf(document)
    expect(after.weighted).toBe(true)
    expect(after.size).toBe(before.size)
    expect(edgeKeys(after)).toEqual(edgeKeys(before))
    expect(weightMap(after)).toEqual(weightMap(before))
  })

  it('names vertices A, B, C and lays them on a circle when there are no headers', () => {
    const { document } = parseAdjacencyMatrix('0 1 0\n1 0 1\n0 1 0')
    const g = graphOf(document)
    expect(g.vertices.map((v) => v.label)).toEqual(['A', 'B', 'C'])
    const radii = g.vertices.map((v) => Math.round(Math.hypot(v.x, v.y)))
    expect(new Set(radii).size).toBe(1)
    expect(radii[0]).toBeGreaterThan(0)
  })

  it('accepts a matrix that has only a header column', () => {
    const g = graphOf(parseAdjacencyMatrix('X 0 1 0\nY 1 0 1\nZ 0 1 0').document)
    expect(g.vertices.map((v) => v.label)).toEqual(['X', 'Y', 'Z'])
    expect(edgeKeys(g)).toEqual(['X-Y', 'Y-Z'])
  })

  it('rejects a matrix that is not square with a clear message', () => {
    let caught: unknown
    try {
      parseAdjacencyMatrix('0 1 0\n1 0 1 1\n0 1 0')
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(ImportError)
    expect((caught as Error).message).toMatch(
      /adjacency matrix is not square: row 2 has 4 entries but the matrix has 3 rows\./,
    )
  })

  it('rejects a cell that is not a number', () => {
    expect(() => parseAdjacencyMatrix('0 1\n1 x')).toThrowError(ImportError)
    expect(() => parseAdjacencyMatrix('0 1\n1 x')).toThrowError(
      /Row 2 of the adjacency matrix contains "x", which is not a number\./,
    )
  })

  it('reads an asymmetric matrix as directed', () => {
    const g = graphOf(parseAdjacencyMatrix('0 1\n0 0').document)
    expect(g.directed).toBe(true)
    expect(edgeKeys(g)).toEqual(['A->B'])
  })

  it('warns when an asymmetric matrix is forced to be undirected', () => {
    const { document, warnings } = parseAdjacencyMatrix('0 1\n0 0', { directed: false })
    expect(graphOf(document).size).toBe(1)
    expect(warnings).toEqual([
      'The matrix is not symmetric, so the entry above the diagonal was used for each undirected edge.',
    ])
  })
})

describe('CSV edge list', () => {
  it('writes a header that matches the weighted mode', () => {
    expect(toEdgeListCsv(graphOf(docFromEdges(['A-B']))).split('\n')[0]).toBe('source,target')
    expect(toEdgeListCsv(graphOf(weightedSample())).split('\n')[0]).toBe('source,target,weight')
    expect(toEdgeListCsv(graphOf(docFromEdges(['A-B'])))).toBe('source,target\nA,B')
  })

  it('round trips an undirected simple graph', () => {
    const before = graphOf(undirectedSimple())
    const { document, warnings } = parseEdgeListCsv(toEdgeListCsv(before))
    const after = graphOf(document)
    expect(warnings).toEqual([])
    expect(after.size).toBe(before.size)
    expect(edgeKeys(after)).toEqual(edgeKeys(before))
    expect(neighbourSets(after)).toEqual(neighbourSets(before))
  })

  it('round trips a directed graph', () => {
    const before = graphOf(directedSample())
    const { document } = parseEdgeListCsv(toEdgeListCsv(before), { directed: true })
    const after = graphOf(document)
    expect(after.directed).toBe(true)
    expect(after.size).toBe(before.size)
    expect(edgeKeys(after)).toEqual(edgeKeys(before))
    expect(neighbourSets(after)).toEqual(neighbourSets(before))
  })

  it('round trips a weighted graph', () => {
    const before = graphOf(weightedSample())
    const { document } = parseEdgeListCsv(toEdgeListCsv(before))
    const after = graphOf(document)
    expect(after.weighted).toBe(true)
    expect(after.size).toBe(before.size)
    expect(edgeKeys(after)).toEqual(edgeKeys(before))
    expect(weightMap(after)).toEqual(weightMap(before))
  })

  it('keeps isolated vertices through the round trip', () => {
    const before = graphOf(docFromEdges(['A-B', 'Z']))
    const text = toEdgeListCsv(before)
    expect(text).toContain('Z,')
    const after = graphOf(parseEdgeListCsv(text).document)
    expect(after.order).toBe(3)
    expect(after.size).toBe(1)
    expect(after.degree(after.vertices[2].id)).toBe(0)
  })

  it('accepts a file with no header row', () => {
    const g = graphOf(parseEdgeListCsv('A,B\nB,C').document)
    expect(g.order).toBe(3)
    expect(edgeKeys(g)).toEqual(['A-B', 'B-C'])
  })

  it('warns about a repeated edge rather than duplicating it', () => {
    const { document, warnings } = parseEdgeListCsv('source,target\nA,B\nA,B')
    expect(graphOf(document).size).toBe(1)
    expect(warnings).toEqual(['Duplicate edge A-B was ignored.'])
  })

  it('warns about a weight that is not a number and keeps the edge', () => {
    const { document, warnings } = parseEdgeListCsv('source,target,weight\nA,B,heavy')
    expect(graphOf(document).size).toBe(1)
    expect(warnings[0]).toMatch(/weight "heavy" that is not a number/)
  })
})

describe('DOT', () => {
  it('writes undirected and directed graphs with the right keyword and operator', () => {
    expect(toDot(graphOf(docFromEdges(['A-B'])), 'Sample')).toBe(
      ['graph "Sample" {', '  "A";', '  "B";', '  "A" -- "B";', '}'].join('\n'),
    )
    expect(toDot(graphOf(docFromEdges(['A->B'], { directed: true })))).toBe(
      ['digraph "G" {', '  "A";', '  "B";', '  "A" -> "B";', '}'].join('\n'),
    )
  })

  it('writes label and weight attributes for a weighted edge', () => {
    const text = toDot(graphOf(docFromEdges(['A-B:3'], { weighted: true })))
    expect(text).toContain('"A" -- "B" [label=3, weight=3];')
  })

  it('round trips an undirected simple graph', () => {
    const before = graphOf(undirectedSimple())
    const { document, warnings } = parseDot(toDot(before))
    const after = graphOf(document)
    expect(warnings).toEqual([])
    expect(after.directed).toBe(false)
    expect(after.size).toBe(before.size)
    expect(edgeKeys(after)).toEqual(edgeKeys(before))
    expect(neighbourSets(after)).toEqual(neighbourSets(before))
  })

  it('round trips a directed graph', () => {
    const before = graphOf(directedSample())
    const { document } = parseDot(toDot(before))
    const after = graphOf(document)
    expect(after.directed).toBe(true)
    expect(after.size).toBe(before.size)
    expect(edgeKeys(after)).toEqual(edgeKeys(before))
    expect(neighbourSets(after)).toEqual(neighbourSets(before))
  })

  it('round trips a weighted graph', () => {
    const before = graphOf(weightedSample())
    const { document } = parseDot(toDot(before))
    const after = graphOf(document)
    expect(after.weighted).toBe(true)
    expect(after.size).toBe(before.size)
    expect(edgeKeys(after)).toEqual(edgeKeys(before))
    expect(weightMap(after)).toEqual(weightMap(before))
  })

  it('expands an edge chain into consecutive edges', () => {
    const { document } = parseDot('digraph { A -> B -> C; }')
    const g = graphOf(document)
    expect(g.size).toBe(2)
    expect(edgeKeys(g)).toEqual(['A->B', 'B->C'])
    expect(g.order).toBe(3)
  })

  it('accepts a strict digraph', () => {
    const { document } = parseDot('strict digraph Tree { A -> B; A -> C }')
    const g = graphOf(document)
    expect(g.directed).toBe(true)
    expect(edgeKeys(g)).toEqual(['A->B', 'A->C'])
  })

  it('ignores comments, attribute lists and optional semicolons', () => {
    const text = [
      '// a leading line comment',
      '/* a block',
      '   comment */',
      'graph Example {',
      '  rankdir = LR;',
      '  node [shape=circle, color="blue"]',
      '  edge [style=dashed]',
      '  # a hash comment',
      '  A [label="Start"]',
      '  B',
      '  A -- B [color=red]',
      '  B -- C',
      '}',
    ].join('\n')
    const { document, warnings } = parseDot(text)
    const g = graphOf(document)
    expect(warnings).toEqual([])
    expect(g.directed).toBe(false)
    expect(g.order).toBe(3)
    expect(g.size).toBe(2)
    expect(g.weighted).toBe(false)
    expect(g.vertices.map((v) => v.label)).toEqual(['Start', 'B', 'C'])
  })

  it('reads a weight from either the weight or the label attribute', () => {
    const g = graphOf(parseDot('graph { A -- B [weight=2.5]; B -- C [label=4] }').document)
    expect(g.weighted).toBe(true)
    expect(weightMap(g)).toEqual({ 'A-B': 2.5, 'B-C': 4 })
  })

  it('skips subgraphs with a warning', () => {
    const { document, warnings } = parseDot(
      'digraph { subgraph cluster_0 { X -> Y } A -> B }',
    )
    const g = graphOf(document)
    expect(warnings).toEqual(['Subgraphs are not supported and were skipped.'])
    expect(edgeKeys(g)).toEqual(['A->B'])
  })

  it('ignores port syntax on an endpoint', () => {
    const g = graphOf(parseDot('digraph { "A":west -> "B":east:n }').document)
    expect(g.order).toBe(2)
    expect(edgeKeys(g)).toEqual(['A->B'])
  })

  it('rejects text that is not DOT at all', () => {
    expect(() => parseDot('A: B, C')).toThrowError(ImportError)
    expect(() => parseDot('A: B, C')).toThrowError(/should begin with "graph", "digraph" or "strict"/)
  })
})

describe('GraphML export', () => {
  it('writes nodes, edges and the edge default', () => {
    const text = toGraphml(graphOf(docFromEdges(['A-B:2'], { weighted: true })))
    expect(text.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true)
    expect(text).toContain('edgedefault="undirected"')
    expect(text).toContain('<data key="label">A</data>')
    expect(text).toContain('<data key="weight">2</data>')
    expect(text.trimEnd().endsWith('</graphml>')).toBe(true)
  })

  it('escapes characters that would break the XML', () => {
    const doc = docFromEdges(['A-B'])
    doc.vertices[0].label = 'a & b <c>'
    expect(toGraphml(graphOf(doc))).toContain('<data key="label">a &amp; b &lt;c&gt;</data>')
  })
})

/* ------------------------------------------------------------------ */
/* Sniffing                                                            */
/* ------------------------------------------------------------------ */

describe('parseAnyGraphText', () => {
  it('recognises a Graphualize JSON file', () => {
    const saved = serializeGraph({ id: 'a', name: 'Sample', graph: undirectedSimple() })
    const result = parseAnyGraphText(toJsonString(saved))
    expect(result.format).toBe('graphualize')
    expect(graphOf(result.document).size).toBe(5)
  })

  it('recognises DOT', () => {
    const result = parseAnyGraphText(toDot(graphOf(directedSample())))
    expect(result.format).toBe('dot')
    expect(graphOf(result.document).directed).toBe(true)
    expect(edgeKeys(graphOf(result.document))).toEqual(edgeKeys(graphOf(directedSample())))
  })

  it('recognises DOT that starts with a comment', () => {
    const result = parseAnyGraphText('// my graph\ngraph { A -- B }')
    expect(result.format).toBe('dot')
  })

  it('recognises an adjacency matrix with and without headers', () => {
    expect(parseAnyGraphText('0 1 0\n1 0 1\n0 1 0').format).toBe('adjacency-matrix')
    expect(parseAnyGraphText(toAdjacencyMatrixText(graphOf(undirectedSimple()))).format).toBe(
      'adjacency-matrix',
    )
  })

  it('recognises a CSV edge list', () => {
    const result = parseAnyGraphText(toEdgeListCsv(graphOf(undirectedSimple())))
    expect(result.format).toBe('edge-list-csv')
    expect(graphOf(result.document).size).toBe(5)
  })

  it('recognises an adjacency list', () => {
    const result = parseAnyGraphText(toAdjacencyList(graphOf(undirectedSimple())))
    expect(result.format).toBe('adjacency-list')
    expect(edgeKeys(graphOf(result.document))).toEqual(edgeKeys(graphOf(undirectedSimple())))
  })

  it('reports empty input rather than guessing', () => {
    expect(() => parseAnyGraphText('   \n\n')).toThrowError(ImportError)
    expect(() => parseAnyGraphText('   \n\n')).toThrowError(/nothing to import/)
  })

  it('explains that GraphML cannot be read back yet', () => {
    const text = toGraphml(graphOf(undirectedSimple()))
    expect(() => parseAnyGraphText(text)).toThrowError(/cannot read it back yet/)
  })

  it('passes a broken Graphualize file straight through to the JSON reader', () => {
    expect(() => parseAnyGraphText('{"format":"gexf"}')).toThrowError(/not a Graphualize graph/)
  })
})
