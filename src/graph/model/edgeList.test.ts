import { describe, expect, it } from 'vitest'
import {
  applyEdgeListPlan,
  docFromEdges,
  parseEdgeList,
  planEdgeList,
  PLACEMENT_CLEARANCE,
  type EdgeListPlan,
} from './builder'
import { Graph } from './graph'
import { parseGraphCommand } from '../generators/commands'
import type { GraphDocument } from './types'

/** The typed edges as `source-target[:weight]`, which is easier to read in a failure. */
const edgesOf = (input: string) =>
  parseEdgeList(input)?.edges.map(
    (e) => `${e.source}-${e.target}${e.weight === undefined ? '' : `:${e.weight}`}`,
  )

const plan = (doc: GraphDocument, input: string): EdgeListPlan => {
  const parsed = parseEdgeList(input)
  if (!parsed) throw new Error(`"${input}" did not parse`)
  return planEdgeList(doc, parsed)
}

const add = (doc: GraphDocument, input: string, anchor?: { x: number; y: number }) =>
  applyEdgeListPlan(doc, plan(doc, input), { anchor })

/** Every edge of a document as labels, `A-B` or `A>B` when directed, sorted. */
const labelledEdges = (doc: GraphDocument): string[] => {
  const label = new Map(doc.vertices.map((v) => [v.id, v.label]))
  return doc.edges
    .map((e) => `${label.get(e.source)}${doc.directed ? '>' : '-'}${label.get(e.target)}`)
    .sort()
}

const closestPair = (doc: GraphDocument): number => {
  let best = Infinity
  for (let i = 0; i < doc.vertices.length; i++) {
    for (let j = i + 1; j < doc.vertices.length; j++) {
      const a = doc.vertices[i]!
      const b = doc.vertices[j]!
      best = Math.min(best, Math.hypot(a.x - b.x, a.y - b.y))
    }
  }
  return best
}

const empty = (): GraphDocument => ({ vertices: [], edges: [], directed: false, weighted: false })

describe('parsing a typed edge list', () => {
  it('reads edges separated by commas, semicolons, new lines or spaces', () => {
    expect(edgesOf('A-B, B-C, C-A')).toEqual(['A-B', 'B-C', 'C-A'])
    expect(edgesOf('A-B B-C')).toEqual(['A-B', 'B-C'])
    expect(edgesOf('A-B; B-C\nC-D')).toEqual(['A-B', 'B-C', 'C-D'])
    expect(edgesOf('  A - B ,B -C  ')).toEqual(['A-B', 'B-C'])
  })

  it('reads a chain as a path, one edge per connector', () => {
    expect(edgesOf('a->b->c')).toEqual(['a-b', 'b-c'])
    expect(edgesOf('a-b-c-d')).toEqual(['a-b', 'b-c', 'c-d'])
  })

  it('accepts the connectors people write, and notes arrows', () => {
    for (const plain of ['A-B', 'A--B', 'A–B', 'A—B']) {
      expect(parseEdgeList(plain)).toMatchObject({ edges: [{ source: 'A', target: 'B' }], arrows: false })
    }
    for (const arrow of ['A->B', 'A-->B', 'A→B', 'A -> B']) {
      expect(parseEdgeList(arrow)).toMatchObject({ edges: [{ source: 'A', target: 'B' }], arrows: true })
    }
    expect(parseEdgeList('A-B, B->C')?.arrows).toBe(true)
  })

  it('reads weights, including negative and fractional ones', () => {
    expect(edgesOf('A-B:4')).toEqual(['A-B:4'])
    expect(edgesOf('A-B:-2, B-C: 1.5, C-D:.5')).toEqual(['A-B:-2', 'B-C:1.5', 'C-D:0.5'])
    expect(edgesOf('A-B:4 B-C')).toEqual(['A-B:4', 'B-C'])
  })

  it('gives a chain weight to every edge of the chain', () => {
    expect(edgesOf('a-b-c:2')).toEqual(['a-b:2', 'b-c:2'])
  })

  it('keeps bare labels alongside edges as vertices, in order of first mention', () => {
    const parsed = parseEdgeList('B-A, C, A-D')
    expect(parsed?.labels).toEqual(['B', 'A', 'C', 'D'])
    expect(parsed?.edges).toHaveLength(2)
  })

  it('takes labels in any script, with digits, underscores and primes', () => {
    expect(edgesOf("v1-v2, x_1-x_2, A'-B'")).toEqual(['v1-v2', 'x_1-x_2', "A'-B'"])
    expect(edgesOf('Ä-ß')).toEqual(['Ä-ß'])
  })

  it('tolerates empty entries between separators', () => {
    expect(edgesOf('A-B,, B-C,')).toEqual(['A-B', 'B-C'])
  })

  it.each([
    '',
    '   ',
    'A',
    'A B C',
    'A, B',
    'A-',
    '-B',
    'A->',
    'A-B-',
    'A-, B',
    'A-B:',
    'A-B:x',
    'A-B:4x',
    'A-B:4-C',
    'A-B:1:2',
    'A:4',
    'A-B:1e999',
    'tree(3-4)',
    'A-B!',
    'A+B',
  ])('refuses %j rather than guessing', (input) => {
    expect(parseEdgeList(input)).toBeNull()
  })

  it('never reads a graph command as an edge list', () => {
    for (const command of [
      'K5',
      'C8',
      'P12',
      'K3,4',
      'k 3 , 4',
      'Q4',
      'S6',
      'W7',
      'grid(3,4)',
      '3x4',
      'G(20,0.2)',
      'tree(12)',
      'tree(2,3)',
      'random(10,3)',
      'petersen',
    ]) {
      expect(parseGraphCommand(command), command).not.toBeNull()
      expect(parseEdgeList(command), command).toBeNull()
    }
  })
})

describe('matching typed labels to vertices', () => {
  it('uses the vertex with exactly that label', () => {
    const doc = docFromEdges(['A-B', 'b'])
    const p = plan(doc, 'A-b')
    expect(p.newVertices).toEqual([])
    expect(p.newEdges).toEqual([{ source: doc.vertices[0]!.id, target: doc.vertices[2]!.id }])
  })

  it('falls back to a case-insensitive match when only one label fits', () => {
    const doc = docFromEdges(['A-B'])
    const p = plan(doc, 'a-c, b-c')
    expect(p.newVertices).toEqual(['c'])
    expect(p.newEdges[0]).toEqual({ source: doc.vertices[0]!.id, target: 0 })
    expect(p.newEdges[1]).toEqual({ source: doc.vertices[1]!.id, target: 0 })
    expect(p.ambiguous).toEqual([])
  })

  it('creates a new vertex rather than guess between labels that differ only in case', () => {
    const doc = docFromEdges(['AB-Ab'])
    const p = plan(doc, 'ab-AB')
    expect(p.newVertices).toEqual(['ab'])
    expect(p.ambiguous).toEqual(['ab'])
    expect(p.newEdges).toEqual([{ source: 0, target: doc.vertices[0]!.id }])
  })

  it('treats two vertices with the same label as one name, and picks the first', () => {
    const doc = docFromEdges(['A-B'])
    doc.vertices[1]!.label = 'A'
    const p = plan(doc, 'a-C')
    expect(p.ambiguous).toEqual([])
    expect(p.newEdges[0]!.source).toBe(doc.vertices[0]!.id)
  })

  it('resolves later labels against the vertices the same input creates', () => {
    const p = plan(empty(), 'x-y, X-z')
    expect(p.newVertices).toEqual(['x', 'y', 'z'])
    expect(p.newEdges).toEqual([
      { source: 0, target: 1 },
      { source: 0, target: 2 },
    ])
  })
})

describe('arrows, weights and duplicates', () => {
  it('switches an edgeless undirected graph to directed for an arrow', () => {
    const p = plan(empty(), 'a->b->c')
    expect(p).toMatchObject({ directed: true, switchedToDirected: true, arrowsIgnored: false })
    const { document } = applyEdgeListPlan(empty(), p)
    expect(labelledEdges(document)).toEqual(['a>b', 'b>c'])
  })

  it('also switches a graph that has vertices but no edges yet', () => {
    expect(plan(docFromEdges(['A', 'B']), 'A->B').switchedToDirected).toBe(true)
  })

  it('reads an arrow as a plain edge once an undirected graph has edges', () => {
    const doc = docFromEdges(['A-B'])
    const p = plan(doc, 'B->C')
    expect(p).toMatchObject({ directed: false, switchedToDirected: false, arrowsIgnored: true })
    expect(applyEdgeListPlan(doc, p).document.directed).toBe(false)
  })

  it('adds arcs from left to right in a directed graph, whichever connector is used', () => {
    const doc = docFromEdges(['A-B'], { directed: true })
    const p = plan(doc, 'B-C, C->A')
    expect(p.arrowsIgnored).toBe(false)
    expect(labelledEdges(applyEdgeListPlan(doc, p).document)).toEqual(['A>B', 'B>C', 'C>A'])
  })

  it('turns weights on for a typed weight, giving existing edges weight 1', () => {
    const doc = docFromEdges(['A-B'])
    const p = plan(doc, 'B-C:4, C-A')
    expect(p).toMatchObject({ weighted: true, enabledWeights: true })
    const { document } = applyEdgeListPlan(doc, p)
    expect(document.weighted).toBe(true)
    expect(document.edges.map((e) => e.weight)).toEqual([1, 4, 1])
  })

  it('gives untyped edges weight 1 in a weighted graph, and leaves existing weights alone', () => {
    const doc = docFromEdges(['A-B:7'], { weighted: true })
    const p = plan(doc, 'B-C, C-A:-3')
    expect(p.enabledWeights).toBe(false)
    expect(applyEdgeListPlan(doc, p).document.edges.map((e) => e.weight)).toEqual([7, 1, -3])
  })

  it('leaves an unweighted graph unweighted when no weight is typed', () => {
    const { document } = add(docFromEdges(['A-B']), 'B-C')
    expect(document.weighted).toBe(false)
    expect(document.edges.every((e) => e.weight === undefined)).toBe(true)
  })

  it('skips an edge the graph already has, either way round when undirected', () => {
    const doc = docFromEdges(['A-B', 'B-C'])
    const p = plan(doc, 'B-A, C-B, C-A')
    expect(p.newEdges).toHaveLength(1)
    expect(p.duplicates).toEqual(['B–A', 'C–B'])
  })

  it('counts the reverse of an arc as a different edge when directed', () => {
    const doc = docFromEdges(['A-B'], { directed: true })
    const p = plan(doc, 'B->A, A->B')
    expect(p.newEdges).toEqual([{ source: doc.vertices[1]!.id, target: doc.vertices[0]!.id }])
    expect(p.duplicates).toEqual(['A→B'])
  })

  it('skips an edge typed twice, naming it once', () => {
    const p = plan(empty(), 'A-B, B-A, A-B')
    expect(p.newEdges).toHaveLength(1)
    expect(p.duplicates).toEqual(['B–A', 'A–B'])
    expect(plan(empty(), 'A-B, A-B, A-B').duplicates).toEqual(['A–B'])
  })

  it('ignores the weight of a skipped duplicate, so it cannot turn weights on', () => {
    const p = plan(docFromEdges(['A-B']), 'A-B:5')
    expect(p.newEdges).toEqual([])
    expect(p).toMatchObject({ enabledWeights: false, weighted: false })
  })

  it('allows a self-loop, and skips a repeated one', () => {
    const doc = docFromEdges(['A-B'])
    const p = plan(doc, 'A-A, a-A')
    expect(p.newEdges).toEqual([{ source: doc.vertices[0]!.id, target: doc.vertices[0]!.id }])
    expect(p.duplicates).toEqual(['A–A'])
  })
})

describe('building the new document', () => {
  it('appends to a copy, leaving the original untouched', () => {
    const doc = docFromEdges(['A-B', 'B-C'])
    const before = structuredClone(doc)
    const { document, vertexIds, edgeIds } = add(doc, 'C-D, D-A')
    expect(doc).toEqual(before)
    expect(document.vertices.slice(0, 3)).toEqual(before.vertices)
    expect(document.edges.slice(0, 2)).toEqual(before.edges)
    expect(document.vertices.map((v) => v.label)).toEqual(['A', 'B', 'C', 'D'])
    expect(vertexIds).toEqual([document.vertices[3]!.id])
    expect(edgeIds).toEqual(document.edges.slice(2).map((e) => e.id))
    expect(labelledEdges(document)).toEqual(['A-B', 'B-C', 'C-D', 'D-A'])
  })

  it('hands out ids no vertex or edge already has', () => {
    const doc = docFromEdges(['A-B', 'B-C'])
    const { document } = add(doc, 'C-D, D-E, E-A')
    const ids = [...document.vertices.map((v) => v.id), ...document.edges.map((e) => e.id)]
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('produces a graph the analysis layer reads as the edges typed', () => {
    const { document } = add(empty(), 'A-B, B-C, C-A')
    const graph = new Graph(document)
    expect(graph.order).toBe(3)
    expect(graph.size).toBe(3)
    expect(graph.edgeIds).toHaveLength(3)
  })
})

describe('placing new vertices', () => {
  it('lays out a graph typed from nothing around the anchor, without overlaps', () => {
    const { document } = add(empty(), 'A-B, B-C, C-A, C-D', { x: 400, y: -200 })
    const xs = document.vertices.map((v) => v.x)
    const ys = document.vertices.map((v) => v.y)
    expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeCloseTo(400, -1)
    expect((Math.min(...ys) + Math.max(...ys)) / 2).toBeCloseTo(-200, -1)
    expect(closestPair(document)).toBeGreaterThanOrEqual(PLACEMENT_CLEARANCE - 1)
  })

  it('puts a new neighbour of an existing vertex beside it, outside the graph', () => {
    // A square centred on the origin; E hangs off A at the top-left corner.
    const doc = docFromEdges(['A-B', 'B-C', 'C-D', 'D-A'])
    const corners = [
      [-100, -100],
      [100, -100],
      [100, 100],
      [-100, 100],
    ]
    doc.vertices.forEach((v, i) => Object.assign(v, { x: corners[i]![0], y: corners[i]![1] }))
    const { document } = add(doc, 'A-E')
    const e = document.vertices.find((v) => v.label === 'E')!
    expect(Math.hypot(e.x + 100, e.y + 100)).toBeLessThan(110)
    expect(e.x).toBeLessThan(-100)
    expect(e.y).toBeLessThan(-100)
  })

  it('fans several new neighbours of one vertex out instead of stacking them', () => {
    const doc = docFromEdges(['A-B'])
    Object.assign(doc.vertices[1]!, { x: 120, y: 0 })
    const { document } = add(doc, 'A-x, A-y, A-z, A-w')
    expect(closestPair(document)).toBeGreaterThanOrEqual(PLACEMENT_CLEARANCE - 1)
    const a = document.vertices[0]!
    for (const v of document.vertices.slice(2)) {
      expect(Math.hypot(v.x - a.x, v.y - a.y)).toBeLessThan(200)
    }
  })

  it('grows a new path outward from where it joins the graph', () => {
    const doc = docFromEdges(['A-B'])
    Object.assign(doc.vertices[1]!, { x: 120, y: 0 })
    const { document } = add(doc, 'B-p-q-r')
    const byLabel = (label: string) => document.vertices.find((v) => v.label === label)!
    expect(byLabel('p').x).toBeGreaterThan(120)
    expect(byLabel('r').x).toBeGreaterThan(byLabel('p').x)
    expect(closestPair(document)).toBeGreaterThanOrEqual(PLACEMENT_CLEARANCE - 1)
  })

  it('sets a separate new piece beside the graph when the anchor is on top of it', () => {
    const doc = docFromEdges(['A-B', 'B-C', 'C-A'])
    const ring = [
      [0, -100],
      [87, 50],
      [-87, 50],
    ]
    doc.vertices.forEach((v, i) => Object.assign(v, { x: ring[i]![0], y: ring[i]![1] }))
    const { document } = add(doc, 'X-Y, Y-Z', { x: 0, y: 0 })
    for (const label of ['X', 'Y', 'Z']) {
      expect(document.vertices.find((v) => v.label === label)!.x).toBeGreaterThan(87)
    }
    expect(closestPair(document)).toBeGreaterThanOrEqual(PLACEMENT_CLEARANCE - 1)
  })

  it('uses the anchor for a separate piece when that spot is clear', () => {
    const doc = docFromEdges(['A-B'])
    Object.assign(doc.vertices[1]!, { x: 120, y: 0 })
    const { document } = add(doc, 'X-Y', { x: 0, y: 900 })
    const added = document.vertices.slice(2)
    const middleY = (added[0]!.y + added[1]!.y) / 2
    expect(middleY).toBeCloseTo(900, -1)
  })

  it('places the same input the same way every time', () => {
    const doc = docFromEdges(['A-B', 'B-C'])
    const first = add(doc, 'C-D, D-E, X-Y, Y-Z', { x: 10, y: 10 }).document.vertices
    const second = add(doc, 'C-D, D-E, X-Y, Y-Z', { x: 10, y: 10 }).document.vertices
    expect(second.map(({ x, y }) => ({ x, y }))).toEqual(first.map(({ x, y }) => ({ x, y })))
  })
})
