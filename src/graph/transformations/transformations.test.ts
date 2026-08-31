import { describe, expect, it } from 'vitest'

import { Graph } from '../model/graph'
import { GraphBuilder, docFromEdges } from '../model/builder'
import type { GraphDocument } from '../model/types'
import { EXAMPLES, exampleById } from '../examples'
import type { TransformContext, TransformResult } from './index'
import { TRANSFORMS, TransformError, applyTransform, transformById } from './index'

/* ------------------------------------------------------------------ */
/* Local helpers — deliberately self-contained so this file never       */
/* depends on the analysis modules.                                     */
/* ------------------------------------------------------------------ */

/** Structural sanity every transform result and every example must satisfy. */
const expectValidDocument = (doc: GraphDocument): void => {
  expect(Array.isArray(doc.vertices)).toBe(true)
  expect(Array.isArray(doc.edges)).toBe(true)
  expect(typeof doc.directed).toBe('boolean')
  expect(typeof doc.weighted).toBe('boolean')

  const vertexIds = new Set<string>()
  for (const v of doc.vertices) {
    expect(vertexIds.has(v.id), `duplicate vertex id ${v.id}`).toBe(false)
    vertexIds.add(v.id)
    expect(typeof v.label).toBe('string')
    expect(v.label.length).toBeGreaterThan(0)
    expect(Number.isFinite(v.x), `x of ${v.label} is finite`).toBe(true)
    expect(Number.isFinite(v.y), `y of ${v.label} is finite`).toBe(true)
  }

  const edgeIds = new Set<string>()
  for (const e of doc.edges) {
    expect(edgeIds.has(e.id), `duplicate edge id ${e.id}`).toBe(false)
    edgeIds.add(e.id)
    expect(vertexIds.has(e.source), `edge ${e.id} source exists`).toBe(true)
    expect(vertexIds.has(e.target), `edge ${e.id} target exists`).toBe(true)
    if (e.weight !== undefined) expect(Number.isFinite(e.weight)).toBe(true)
  }
}

const labelOf = (doc: GraphDocument): Map<string, string> =>
  new Map(doc.vertices.map((v) => [v.id, v.label]))

/** Sorted `A-B` strings; endpoints are sorted too unless `ordered`. */
const labelPairs = (doc: GraphDocument, ordered = false): string[] => {
  const labels = labelOf(doc)
  return doc.edges
    .map((e) => {
      const a = labels.get(e.source) ?? e.source
      const b = labels.get(e.target) ?? e.target
      return ordered || a <= b ? `${a}-${b}` : `${b}-${a}`
    })
    .sort()
}

const labels = (doc: GraphDocument): string[] => doc.vertices.map((v) => v.label).sort()

/** Undirected degree by label; a self-loop counts twice. */
const degrees = (doc: GraphDocument): Map<string, number> => {
  const names = labelOf(doc)
  const out = new Map<string, number>(doc.vertices.map((v) => [v.label, 0]))
  for (const e of doc.edges) {
    const a = names.get(e.source)!
    const b = names.get(e.target)!
    out.set(a, (out.get(a) ?? 0) + 1)
    out.set(b, (out.get(b) ?? 0) + 1)
  }
  return out
}

const degreeList = (doc: GraphDocument): number[] =>
  [...degrees(doc).values()].sort((a, b) => a - b)

/** Connected components over the undirected structure, optionally deleting one element. */
const componentCount = (
  doc: GraphDocument,
  omit: { vertex?: string; edge?: string } = {},
): number => {
  const alive = doc.vertices.map((v) => v.id).filter((id) => id !== omit.vertex)
  const adj = new Map<string, string[]>(alive.map((id) => [id, []]))
  for (const e of doc.edges) {
    if (e.id === omit.edge) continue
    if (!adj.has(e.source) || !adj.has(e.target)) continue
    adj.get(e.source)!.push(e.target)
    adj.get(e.target)!.push(e.source)
  }
  const seen = new Set<string>()
  let count = 0
  for (const start of alive) {
    if (seen.has(start)) continue
    count += 1
    seen.add(start)
    const stack = [start]
    while (stack.length) {
      const v = stack.pop()!
      for (const n of adj.get(v)!) {
        if (seen.has(n)) continue
        seen.add(n)
        stack.push(n)
      }
    }
  }
  return count
}

/** Two-colouring by BFS; false as soon as an edge joins equal colours. */
const isBipartite = (doc: GraphDocument): boolean => {
  const adj = new Map<string, string[]>(doc.vertices.map((v) => [v.id, []]))
  for (const e of doc.edges) {
    if (e.source === e.target) return false
    adj.get(e.source)!.push(e.target)
    adj.get(e.target)!.push(e.source)
  }
  const color = new Map<string, number>()
  for (const v of doc.vertices) {
    if (color.has(v.id)) continue
    color.set(v.id, 0)
    const queue = [v.id]
    while (queue.length) {
      const cur = queue.shift()!
      for (const n of adj.get(cur)!) {
        if (!color.has(n)) {
          color.set(n, 1 - color.get(cur)!)
          queue.push(n)
        } else if (color.get(n) === color.get(cur)) return false
      }
    }
  }
  return true
}

/** Kahn's algorithm, for the DAG example. */
const isAcyclicDirected = (doc: GraphDocument): boolean => {
  const indeg = new Map<string, number>(doc.vertices.map((v) => [v.id, 0]))
  const out = new Map<string, string[]>(doc.vertices.map((v) => [v.id, []]))
  for (const e of doc.edges) {
    out.get(e.source)!.push(e.target)
    indeg.set(e.target, (indeg.get(e.target) ?? 0) + 1)
  }
  const queue = [...indeg.entries()].filter(([, d]) => d === 0).map(([id]) => id)
  let visited = 0
  while (queue.length) {
    const v = queue.shift()!
    visited += 1
    for (const n of out.get(v)!) {
      const next = indeg.get(n)! - 1
      indeg.set(n, next)
      if (next === 0) queue.push(n)
    }
  }
  return visited === doc.vertices.length
}

const articulationLabels = (doc: GraphDocument): string[] => {
  const base = componentCount(doc)
  return doc.vertices
    .filter((v) => componentCount(doc, { vertex: v.id }) > base)
    .map((v) => v.label)
    .sort()
}

const bridgeLabels = (doc: GraphDocument): string[] => {
  const base = componentCount(doc)
  const names = labelOf(doc)
  return doc.edges
    .filter((e) => componentCount(doc, { edge: e.id }) > base)
    .map((e) => {
      const a = names.get(e.source)!
      const b = names.get(e.target)!
      return a <= b ? `${a}-${b}` : `${b}-${a}`
    })
    .sort()
}

/** Textbook O(V^2) Dijkstra returning the label path, for the weighted example. */
const shortestPathLabels = (doc: GraphDocument, from: string, to: string): string[] => {
  const byLabel = new Map(doc.vertices.map((v) => [v.label, v.id]))
  const names = labelOf(doc)
  const source = byLabel.get(from)!
  const dist = new Map<string, number>(doc.vertices.map((v) => [v.id, Infinity]))
  const prev = new Map<string, string>()
  const done = new Set<string>()
  dist.set(source, 0)
  for (;;) {
    let best: string | null = null
    for (const [id, d] of dist) {
      if (done.has(id) || d === Infinity) continue
      if (best === null || d < dist.get(best)!) best = id
    }
    if (best === null) break
    done.add(best)
    for (const e of doc.edges) {
      const ends =
        e.source === best ? e.target : e.target === best ? e.source : null
      if (ends === null || done.has(ends)) continue
      const candidate = dist.get(best)! + (e.weight ?? 1)
      if (candidate < dist.get(ends)!) {
        dist.set(ends, candidate)
        prev.set(ends, best)
      }
    }
  }
  const path: string[] = []
  let cursor: string | undefined = byLabel.get(to)!
  while (cursor !== undefined) {
    path.unshift(names.get(cursor)!)
    cursor = prev.get(cursor)
  }
  return path
}

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

const lab = (i: number): string => String.fromCharCode(65 + i)

const emptyOn = (n: number, options: { directed?: boolean } = {}): GraphDocument => {
  const b = new GraphBuilder(options)
  for (let i = 0; i < n; i++) b.addVertex(lab(i), 80 * i, 0)
  return b.build()
}

const completeOn = (n: number): GraphDocument => {
  const b = new GraphBuilder()
  for (let i = 0; i < n; i++) b.addVertex(lab(i), 80 * i, 40 * (i % 2))
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) b.addEdgeByLabel(lab(i), lab(j))
  return b.build()
}

const cycleOn = (n: number): GraphDocument => {
  const spec: string[] = []
  for (let i = 0; i < n; i++) spec.push(`${lab(i)}-${lab((i + 1) % n)}`)
  return docFromEdges(spec)
}

const pathOn = (n: number): GraphDocument => {
  const spec: string[] = []
  for (let i = 0; i + 1 < n; i++) spec.push(`${lab(i)}-${lab(i + 1)}`)
  return docFromEdges(spec)
}

const starWith = (leaves: number): GraphDocument => {
  const spec: string[] = []
  for (let i = 1; i <= leaves; i++) spec.push(`A-${lab(i)}`)
  return docFromEdges(spec)
}

const edgeIdBetween = (doc: GraphDocument, a: string, b: string): string => {
  const names = labelOf(doc)
  const found = doc.edges.find((e) => {
    const x = names.get(e.source)
    const y = names.get(e.target)
    return (x === a && y === b) || (x === b && y === a)
  })
  expect(found, `edge ${a}-${b} exists`).toBeDefined()
  return found!.id
}

const vertexIdOf = (doc: GraphDocument, label: string): string => {
  const found = doc.vertices.find((v) => v.label === label)
  expect(found, `vertex ${label} exists`).toBeDefined()
  return found!.id
}

/** Runs a transform, asserting its precondition passes and its output is sane. */
const run = (
  id: string,
  doc: GraphDocument,
  ctx: TransformContext = {},
): TransformResult => {
  const def = transformById(id)
  expect(def, `transform "${id}" is registered`).toBeDefined()
  const graph = new Graph(doc)
  expect(def!.precondition?.(graph, ctx) ?? null, `${id} precondition`).toBeNull()
  const result = def!.apply(graph, ctx)
  expectValidDocument(result.document)
  expect(result.summary.length).toBeGreaterThan(0)
  expect(typeof result.relayout).toBe('boolean')
  return result
}

const refusal = (id: string, doc: GraphDocument, ctx: TransformContext = {}): string => {
  const def = transformById(id)!
  const message = def.precondition?.(new Graph(doc), ctx) ?? null
  expect(message, `${id} should refuse`).not.toBeNull()
  return message!
}

/* ------------------------------------------------------------------ */
/* Registry                                                            */
/* ------------------------------------------------------------------ */

describe('transform registry', () => {
  it('exposes unique ids, names and descriptions', () => {
    const ids = TRANSFORMS.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const t of TRANSFORMS) {
      expect(t.name.length).toBeGreaterThan(0)
      expect(t.description.length).toBeGreaterThan(20)
      expect(transformById(t.id)).toBe(t)
    }
    expect(transformById('no-such-transform')).toBeUndefined()
  })

  it('throws TransformError when a precondition is ignored', () => {
    expect(() => applyTransform('transpose', new Graph(pathOn(3)), {})).toThrow(
      TransformError,
    )
    expect(() => applyTransform('nope', new Graph(pathOn(3)), {})).toThrow(TransformError)
  })
})

/* ------------------------------------------------------------------ */
/* Complement                                                          */
/* ------------------------------------------------------------------ */

describe('complement', () => {
  it('turns Kn into the empty graph', () => {
    const result = run('complement', completeOn(5))
    expect(result.document.vertices).toHaveLength(5)
    expect(result.document.edges).toHaveLength(0)
    expect(result.summary).toContain('10 edges became 0')
  })

  it('turns the empty graph on n vertices into Kn', () => {
    const result = run('complement', emptyOn(5))
    expect(result.document.edges).toHaveLength(10)
    expect(labelPairs(result.document)).toEqual(labelPairs(completeOn(5)))
  })

  it('is an involution up to ids', () => {
    const original = docFromEdges(['A-B', 'B-C', 'C-D', 'D-E', 'E-A', 'A-C'])
    const once = run('complement', original).document
    const twice = run('complement', once).document
    expect(labelPairs(twice)).toEqual(labelPairs(original))
    expect(labels(twice)).toEqual(labels(original))
  })

  it('sends C5 to a 2-regular graph on 5 edges (C5 again)', () => {
    const result = run('complement', cycleOn(5))
    expect(result.document.edges).toHaveLength(5)
    expect(degreeList(result.document)).toEqual([2, 2, 2, 2, 2])
    // The complement of C5 is the pentagram: same graph, different drawing.
    expect(labelPairs(result.document)).toEqual(['A-C', 'A-D', 'B-D', 'B-E', 'C-E'])
  })

  it('drops self-loops and collapses parallel edges', () => {
    const doc = docFromEdges(['A-A', 'A-B', 'A-B', 'C'])
    const result = run('complement', doc)
    expect(labelPairs(result.document)).toEqual(['A-C', 'B-C'])
    expect(result.summary).toContain('self-loop')
  })

  it('complements ordered pairs on a directed graph', () => {
    const doc = docFromEdges(['A->B', 'B->C'], { directed: true })
    const result = run('complement', doc)
    expect(result.document.directed).toBe(true)
    expect(labelPairs(result.document, true)).toEqual(
      ['A-C', 'B-A', 'C-A', 'C-B'].sort(),
    )
  })

  it('keeps positions and labels', () => {
    const doc = completeOn(4)
    const result = run('complement', doc)
    expect(result.relayout).toBe(false)
    expect(result.document.vertices.map((v) => [v.id, v.x, v.y])).toEqual(
      doc.vertices.map((v) => [v.id, v.x, v.y]),
    )
  })
})

/* ------------------------------------------------------------------ */
/* Transpose                                                           */
/* ------------------------------------------------------------------ */

describe('transpose', () => {
  const doc = docFromEdges(['A->B', 'B->C', 'A->C'], { directed: true })

  it('reverses every arc', () => {
    const result = run('transpose', doc)
    expect(labelPairs(result.document, true)).toEqual(['B-A', 'C-A', 'C-B'].sort())
    expect(result.document.directed).toBe(true)
  })

  it('is an involution and keeps edge ids and weights', () => {
    const once = run('transpose', doc).document
    const twice = run('transpose', once).document
    expect(labelPairs(twice, true)).toEqual(labelPairs(doc, true))
    expect(twice.edges.map((e) => e.id).sort()).toEqual(doc.edges.map((e) => e.id).sort())
  })

  it('refuses undirected graphs', () => {
    expect(refusal('transpose', pathOn(3))).toMatch(/directed/i)
  })
})

/* ------------------------------------------------------------------ */
/* Induced subgraph and deletions                                      */
/* ------------------------------------------------------------------ */

describe('induced subgraph', () => {
  const doc = docFromEdges(['A-B', 'B-C', 'C-D', 'D-A', 'A-C'])

  it('keeps exactly the internal edges', () => {
    const selected = ['A', 'B', 'C'].map((l) => vertexIdOf(doc, l))
    const result = run('induced-subgraph', doc, { selectedVertices: selected })
    expect(labels(result.document)).toEqual(['A', 'B', 'C'])
    expect(labelPairs(result.document)).toEqual(['A-B', 'A-C', 'B-C'])
    expect(result.document.vertices.map((v) => v.id)).toEqual(selected)
  })

  it('refuses with no selection', () => {
    expect(refusal('induced-subgraph', doc)).toMatch(/select at least one vertex/i)
    expect(refusal('induced-subgraph', doc, { selectedVertices: [] })).toBeTruthy()
    // A selection of ids that are not in the graph is still no selection.
    expect(refusal('induced-subgraph', doc, { selectedVertices: ['ghost'] })).toBeTruthy()
  })

  it('says so when nothing changed', () => {
    const all = doc.vertices.map((v) => v.id)
    const result = run('induced-subgraph', doc, { selectedVertices: all })
    expect(result.summary).toMatch(/unchanged/i)
  })
})

describe('deletions', () => {
  const doc = docFromEdges(['A-B', 'B-C', 'C-D', 'D-A'])

  it('deletes vertices with their incident edges', () => {
    const result = run('delete-vertices', doc, {
      selectedVertices: [vertexIdOf(doc, 'A')],
    })
    expect(labels(result.document)).toEqual(['B', 'C', 'D'])
    expect(labelPairs(result.document)).toEqual(['B-C', 'C-D'])
    expect(result.summary).toContain('2 incident edges')
  })

  it('reports an empty result', () => {
    const result = run('delete-vertices', doc, {
      selectedVertices: doc.vertices.map((v) => v.id),
    })
    expect(result.document.vertices).toHaveLength(0)
    expect(result.document.edges).toHaveLength(0)
    expect(result.summary).toMatch(/empty/i)
  })

  it('deletes edges and leaves the vertices behind', () => {
    const result = run('delete-edges', doc, {
      selectedEdges: [edgeIdBetween(doc, 'A', 'B'), edgeIdBetween(doc, 'C', 'D')],
    })
    expect(result.document.vertices).toHaveLength(4)
    expect(labelPairs(result.document)).toEqual(['A-D', 'B-C'])
    expect(result.summary).toContain('Deleted 2 edges')
  })

  it('refuses with no selection', () => {
    expect(refusal('delete-vertices', doc)).toMatch(/select/i)
    expect(refusal('delete-edges', doc)).toMatch(/select/i)
  })
})

/* ------------------------------------------------------------------ */
/* Contraction                                                         */
/* ------------------------------------------------------------------ */

describe('contract edge', () => {
  it('collapses a triangle to a single edge', () => {
    const doc = docFromEdges(['A-B', 'B-C', 'C-A'])
    const result = run('contract-edge', doc, {
      selectedEdges: [edgeIdBetween(doc, 'A', 'B')],
    })
    expect(result.document.vertices).toHaveLength(2)
    expect(result.document.edges).toHaveLength(1)
    expect(labels(result.document)).toEqual(['AB', 'C'])
    expect(result.summary).toBe('Contracted A-B into AB, removing 1 parallel edge.')
  })

  it('shortens a path', () => {
    const doc = pathOn(4)
    const result = run('contract-edge', doc, {
      selectedEdges: [edgeIdBetween(doc, 'B', 'C')],
    })
    expect(result.document.vertices).toHaveLength(3)
    expect(result.document.edges).toHaveLength(2)
    expect(labelPairs(result.document)).toEqual(['A-BC', 'BC-D'])
    expect(degreeList(result.document)).toEqual([1, 1, 2])
    expect(result.summary).toBe('Contracted B-C into BC.')
  })

  it('places the merged vertex at the midpoint and keeps other ids', () => {
    const b = new GraphBuilder()
    b.addVertex('A', -100, -40)
    b.addVertex('B', 40, 60)
    b.addVertex('C', 200, 0)
    b.addEdgeByLabel('A', 'B')
    const kept = b.addEdgeByLabel('B', 'C')
    const doc = b.build()
    const result = run('contract-edge', doc, {
      selectedEdges: [edgeIdBetween(doc, 'A', 'B')],
    })
    const merged = result.document.vertices.find((v) => v.label === 'AB')!
    expect(merged.x).toBe(-30)
    expect(merged.y).toBe(10)
    expect(result.document.edges.map((e) => e.id)).toEqual([kept])
  })

  it('falls back to a fresh label when the joined name is too long', () => {
    const b = new GraphBuilder()
    b.addVertex('Alpha', 0, 0)
    b.addVertex('Beta', 100, 0)
    b.addEdgeByLabel('Alpha', 'Beta')
    const doc = b.build()
    const result = run('contract-edge', doc, { selectedEdges: [doc.edges[0]!.id] })
    expect(labels(result.document)).toEqual(['A'])
  })

  it('only drops loops the merge itself created', () => {
    const doc = docFromEdges(['A-B', 'A-B', 'B-C', 'C-C'])
    const result = run('contract-edge', doc, {
      selectedEdges: [edgeIdBetween(doc, 'A', 'B')],
    })
    // The spare A-B becomes a loop at AB and goes; C's own loop is untouched.
    expect(labelPairs(result.document)).toEqual(['AB-C', 'C-C'])
    expect(result.summary).toBe('Contracted A-B into AB, dropping 1 self-loop.')
  })

  it('keeps the smallest weight when parallel edges collapse', () => {
    const doc = docFromEdges(['A-B:1', 'B-C:7', 'C-A:3'], { weighted: true })
    const result = run('contract-edge', doc, {
      selectedEdges: [edgeIdBetween(doc, 'A', 'B')],
    })
    expect(result.document.edges).toHaveLength(1)
    expect(result.document.edges[0]!.weight).toBe(3)
  })

  it('refuses unless exactly one non-loop edge is selected', () => {
    const doc = docFromEdges(['A-B', 'B-C', 'A-A'])
    expect(refusal('contract-edge', doc)).toMatch(/exactly one/i)
    expect(
      refusal('contract-edge', doc, {
        selectedEdges: [edgeIdBetween(doc, 'A', 'B'), edgeIdBetween(doc, 'B', 'C')],
      }),
    ).toMatch(/exactly one/i)
    expect(
      refusal('contract-edge', doc, { selectedEdges: [edgeIdBetween(doc, 'A', 'A')] }),
    ).toMatch(/self-loop/i)
  })
})

/* ------------------------------------------------------------------ */
/* Subdivision                                                         */
/* ------------------------------------------------------------------ */

describe('subdivide edge', () => {
  it('turns C3 into C4', () => {
    const doc = cycleOn(3)
    const result = run('subdivide-edge', doc, {
      selectedEdges: [edgeIdBetween(doc, 'A', 'B')],
    })
    expect(result.document.vertices).toHaveLength(4)
    expect(result.document.edges).toHaveLength(4)
    expect(degreeList(result.document)).toEqual([2, 2, 2, 2])
    expect(componentCount(result.document)).toBe(1)
    expect(labelPairs(result.document)).toEqual(['A-D', 'A-C', 'B-C', 'B-D'].sort())
  })

  it('subdivides several edges at once', () => {
    const doc = cycleOn(3)
    const result = run('subdivide-edge', doc, {
      selectedEdges: doc.edges.map((e) => e.id),
    })
    expect(result.document.vertices).toHaveLength(6)
    expect(result.document.edges).toHaveLength(6)
    expect(degreeList(result.document)).toEqual([2, 2, 2, 2, 2, 2])
    expect(result.summary).toContain('Subdivided 3 edges')
  })

  it('splits the weight across the two halves', () => {
    const doc = docFromEdges(['A-B:6'], { weighted: true })
    const result = run('subdivide-edge', doc, { selectedEdges: [doc.edges[0]!.id] })
    expect(result.document.edges.map((e) => e.weight)).toEqual([3, 3])
    expect(result.summary).toMatch(/split/i)
  })

  it('puts the new vertex at the midpoint with the next free label', () => {
    const b = new GraphBuilder()
    b.addVertex('A', -100, 20)
    b.addVertex('C', 100, 60)
    b.addEdgeByLabel('A', 'C')
    const doc = b.build()
    const result = run('subdivide-edge', doc, { selectedEdges: [doc.edges[0]!.id] })
    const fresh = result.document.vertices[2]!
    expect(fresh.label).toBe('B')
    expect(fresh.x).toBe(0)
    expect(fresh.y).toBe(40)
  })

  it('refuses with no selection', () => {
    expect(refusal('subdivide-edge', cycleOn(3))).toMatch(/select/i)
  })
})

/* ------------------------------------------------------------------ */
/* Line graph                                                          */
/* ------------------------------------------------------------------ */

describe('line graph', () => {
  it('sends P4 to P3', () => {
    const result = run('line-graph', pathOn(4))
    expect(labels(result.document)).toEqual(['AB', 'BC', 'CD'])
    expect(labelPairs(result.document)).toEqual(['AB-BC', 'BC-CD'])
    expect(degreeList(result.document)).toEqual([1, 1, 2])
    expect(result.relayout).toBe(true)
  })

  it('sends C5 to C5', () => {
    const result = run('line-graph', cycleOn(5))
    expect(result.document.vertices).toHaveLength(5)
    expect(result.document.edges).toHaveLength(5)
    expect(degreeList(result.document)).toEqual([2, 2, 2, 2, 2])
  })

  it('sends K4 to the 4-regular octahedron on 6 vertices', () => {
    const result = run('line-graph', completeOn(4))
    expect(result.document.vertices).toHaveLength(6)
    expect(result.document.edges).toHaveLength(12)
    expect(degreeList(result.document)).toEqual([4, 4, 4, 4, 4, 4])
    // Midpoints of the two "diagonals" coincide in a square drawing, so the
    // placement must nudge them apart rather than stack them.
    const spots = new Set(result.document.vertices.map((v) => `${v.x},${v.y}`))
    expect(spots.size).toBe(6)
  })

  it('sends a star with n leaves to Kn', () => {
    for (const n of [3, 4, 5]) {
      const result = run('line-graph', starWith(n))
      expect(result.document.vertices).toHaveLength(n)
      expect(result.document.edges).toHaveLength((n * (n - 1)) / 2)
      expect(degreeList(result.document)).toEqual(Array(n).fill(n - 1))
    }
  })

  it('reports an empty L(G)', () => {
    const result = run('line-graph', emptyOn(3))
    expect(result.document.vertices).toHaveLength(0)
    expect(result.summary).toMatch(/no edges/i)
  })

  it('refuses directed graphs and multigraphs', () => {
    expect(
      refusal('line-graph', docFromEdges(['A->B'], { directed: true })),
    ).toMatch(/undirected/i)
    expect(refusal('line-graph', docFromEdges(['A-B', 'A-B']))).toMatch(/simple/i)
    expect(refusal('line-graph', docFromEdges(['A-A', 'A-B']))).toMatch(/self-loop/i)
  })
})

/* ------------------------------------------------------------------ */
/* Square                                                              */
/* ------------------------------------------------------------------ */

describe('square', () => {
  it('adds every distance-2 pair of P5', () => {
    const result = run('square', pathOn(5))
    expect(result.document.edges).toHaveLength(7)
    expect(labelPairs(result.document)).toEqual(
      ['A-B', 'A-C', 'B-C', 'B-D', 'C-D', 'C-E', 'D-E'].sort(),
    )
    expect(result.summary).toContain('4 edges became 7')
  })

  it('completes any graph of diameter at most 2', () => {
    const result = run('square', starWith(4))
    expect(result.document.edges).toHaveLength(10)
    expect(degreeList(result.document)).toEqual([4, 4, 4, 4, 4])
  })

  it('leaves a complete graph alone and says so', () => {
    const result = run('square', completeOn(4))
    expect(result.document.edges).toHaveLength(6)
    expect(result.summary).toMatch(/unchanged/i)
  })

  it('keeps surviving edge ids and reuses positions', () => {
    const doc = pathOn(4)
    const result = run('square', doc)
    const ids = new Set(result.document.edges.map((e) => e.id))
    for (const e of doc.edges) expect(ids.has(e.id)).toBe(true)
    expect(result.relayout).toBe(false)
  })

  it('refuses directed graphs', () => {
    expect(refusal('square', docFromEdges(['A->B'], { directed: true }))).toMatch(
      /undirected/i,
    )
  })
})

/* ------------------------------------------------------------------ */
/* Underlying undirected graph                                         */
/* ------------------------------------------------------------------ */

describe('underlying undirected graph', () => {
  it('merges antiparallel arcs and clears the directed flag', () => {
    const doc = docFromEdges(['A->B', 'B->A', 'B->C', 'A->C'], { directed: true })
    const result = run('to-undirected', doc)
    expect(result.document.directed).toBe(false)
    expect(labelPairs(result.document)).toEqual(['A-B', 'A-C', 'B-C'])
    expect(result.summary).toContain('4 arcs became 3 edges')
    expect(result.summary).toMatch(/merged/i)
  })

  it('keeps the smallest weight of a merged pair', () => {
    const doc = docFromEdges(['A->B:9', 'B->A:2'], { directed: true, weighted: true })
    const result = run('to-undirected', doc)
    expect(result.document.edges).toHaveLength(1)
    expect(result.document.edges[0]!.weight).toBe(2)
  })

  it('refuses undirected graphs', () => {
    expect(refusal('to-undirected', pathOn(3))).toMatch(/already undirected/i)
  })
})

/* ------------------------------------------------------------------ */
/* Cross-cutting guarantees                                            */
/* ------------------------------------------------------------------ */

describe('every transform', () => {
  const scenarios: Array<{ name: string; doc: () => GraphDocument }> = [
    { name: 'undirected simple', doc: () => docFromEdges(['A-B', 'B-C', 'C-D', 'D-A', 'A-C']) },
    {
      name: 'directed',
      doc: () => docFromEdges(['A->B', 'B->C', 'C->A', 'A->C'], { directed: true }),
    },
    {
      name: 'weighted',
      doc: () => docFromEdges(['A-B:2', 'B-C:3', 'C-A:4'], { weighted: true }),
    },
    { name: 'multigraph with a loop', doc: () => docFromEdges(['A-B', 'A-B', 'B-C', 'C-C']) },
    { name: 'empty', doc: () => emptyOn(0) },
    { name: 'empty directed', doc: () => emptyOn(0, { directed: true }) },
    { name: 'single vertex', doc: () => emptyOn(1) },
    { name: 'single vertex directed', doc: () => emptyOn(1, { directed: true }) },
  ]

  const executed = new Set<string>()

  for (const scenario of scenarios) {
    it(`is safe on the ${scenario.name} graph`, () => {
      const doc = scenario.doc()
      const ctx: TransformContext = {
        selectedVertices: doc.vertices.slice(0, 2).map((v) => v.id),
        selectedEdges: doc.edges.slice(0, 1).map((e) => e.id),
      }
      const before = JSON.stringify(doc)
      for (const def of TRANSFORMS) {
        const graph = new Graph(doc)
        const problem = def.precondition?.(graph, ctx) ?? null
        if (problem !== null) {
          // A refusal must be a plain, complete sentence a user can act on.
          expect(problem.length, `${def.id} message`).toBeGreaterThan(12)
          expect(problem.trim().endsWith('.'), `${def.id} message ends in a period`).toBe(
            true,
          )
          expect(() => def.apply(graph, ctx)).toThrow(TransformError)
          continue
        }
        const result = def.apply(graph, ctx)
        expectValidDocument(result.document)
        expect(result.summary.trim().endsWith('.'), `${def.id} summary`).toBe(true)
        executed.add(def.id)
      }
      expect(JSON.stringify(doc), 'input document was not mutated').toBe(before)
    })
  }

  it('was exercised at least once each', () => {
    expect([...executed].sort()).toEqual(TRANSFORMS.map((t) => t.id).sort())
  })

  it('never shares vertex or edge objects with its input', () => {
    const doc = docFromEdges(['A-B', 'B-C', 'C-A'])
    const ctx: TransformContext = {
      selectedVertices: doc.vertices.map((v) => v.id),
      selectedEdges: [doc.edges[0]!.id],
    }
    for (const def of TRANSFORMS) {
      const graph = new Graph(doc)
      if ((def.precondition?.(graph, ctx) ?? null) !== null) continue
      const result = def.apply(graph, ctx)
      for (const v of result.document.vertices)
        expect(doc.vertices.includes(v), `${def.id} copies vertices`).toBe(false)
      for (const e of result.document.edges)
        expect(doc.edges.includes(e), `${def.id} copies edges`).toBe(false)
    }
  })
})

/* ------------------------------------------------------------------ */
/* Examples gallery                                                    */
/* ------------------------------------------------------------------ */

describe('examples gallery', () => {
  const ids = [
    'triangle',
    'square',
    'k5',
    'k33',
    'petersen',
    'tree',
    'bipartite',
    'eulerian',
    'disconnected',
    'weighted-shortest-path',
    'dag',
    'articulation',
    'konigsberg',
  ]

  it('contains every required example, addressable by id', () => {
    for (const id of ids) {
      const example = exampleById(id)
      expect(example, `example "${id}" exists`).toBeDefined()
      expect(example!.blurb.length).toBeGreaterThan(20)
      expect(['basics', 'named', 'classic-questions']).toContain(example!.category)
    }
    expect(new Set(EXAMPLES.map((e) => e.id)).size).toBe(EXAMPLES.length)
    expect(new Set(EXAMPLES.map((e) => e.name)).size).toBe(EXAMPLES.length)
  })

  for (const example of EXAMPLES) {
    it(`${example.id} builds a readable document`, () => {
      const doc = example.build()
      expectValidDocument(doc)
      expect(doc.vertices.length).toBeGreaterThan(0)

      // Unique labels.
      const seen = new Set(doc.vertices.map((v) => v.label))
      expect(seen.size).toBe(doc.vertices.length)

      // Laid out inside roughly a 600x450 box centred on the origin, with no
      // two vertices sitting on top of each other.
      for (const v of doc.vertices) {
        expect(Math.abs(v.x), `${example.id}/${v.label} x`).toBeLessThanOrEqual(320)
        expect(Math.abs(v.y), `${example.id}/${v.label} y`).toBeLessThanOrEqual(240)
      }
      for (let i = 0; i < doc.vertices.length; i++) {
        for (let j = i + 1; j < doc.vertices.length; j++) {
          const a = doc.vertices[i]!
          const b = doc.vertices[j]!
          expect(
            Math.hypot(a.x - b.x, a.y - b.y),
            `${example.id}: ${a.label} and ${b.label} overlap`,
          ).toBeGreaterThan(40)
        }
      }

      // Building twice must give the same picture (fresh ids aside).
      const again = example.build()
      expect(labelPairs(again, doc.directed)).toEqual(labelPairs(doc, doc.directed))
    })
  }

  it('triangle and square are the small cycles', () => {
    const triangle = exampleById('triangle')!.build()
    expect(triangle.vertices).toHaveLength(3)
    expect(triangle.edges).toHaveLength(3)
    expect(degreeList(triangle)).toEqual([2, 2, 2])

    const square = exampleById('square')!.build()
    expect(square.vertices).toHaveLength(4)
    expect(square.edges).toHaveLength(4)
    expect(degreeList(square)).toEqual([2, 2, 2, 2])
    expect(isBipartite(square)).toBe(true)
  })

  it('k5 is complete on 5 vertices', () => {
    const doc = exampleById('k5')!.build()
    expect(doc.vertices).toHaveLength(5)
    expect(doc.edges).toHaveLength(10)
    expect(degreeList(doc)).toEqual([4, 4, 4, 4, 4])
  })

  it('k33 is bipartite with 9 edges', () => {
    const doc = exampleById('k33')!.build()
    expect(doc.vertices).toHaveLength(6)
    expect(doc.edges).toHaveLength(9)
    expect(isBipartite(doc)).toBe(true)
    expect(degreeList(doc)).toEqual([3, 3, 3, 3, 3, 3])
  })

  it('petersen is 3-regular on 10 vertices with 15 edges', () => {
    const doc = exampleById('petersen')!.build()
    expect(doc.vertices).toHaveLength(10)
    expect(doc.edges).toHaveLength(15)
    expect(degreeList(doc)).toEqual(Array(10).fill(3))
    expect(componentCount(doc)).toBe(1)
    expect(isBipartite(doc)).toBe(false)
  })

  it('tree is a connected acyclic graph with n-1 edges', () => {
    const doc = exampleById('tree')!.build()
    expect(doc.edges).toHaveLength(doc.vertices.length - 1)
    expect(componentCount(doc)).toBe(1)
    // A leaf-heavy binary tree: the root has degree 2, internal ones degree 3.
    expect(degreeList(doc)).toEqual([1, 1, 1, 1, 2, 3, 3])
  })

  it('bipartite is 2-colourable but not complete bipartite', () => {
    const doc = exampleById('bipartite')!.build()
    expect(isBipartite(doc)).toBe(true)
    expect(componentCount(doc)).toBe(1)
    expect(doc.edges.length).toBeLessThan(3 * 4)
  })

  it('eulerian is connected with every degree even', () => {
    const doc = exampleById('eulerian')!.build()
    expect(componentCount(doc)).toBe(1)
    for (const [label, degree] of degrees(doc))
      expect(degree % 2, `${label} has even degree`).toBe(0)
  })

  it('disconnected has more than one component', () => {
    const doc = exampleById('disconnected')!.build()
    expect(componentCount(doc)).toBe(3)
  })

  it('weighted-shortest-path punishes the greedy first hop', () => {
    const doc = exampleById('weighted-shortest-path')!.build()
    expect(doc.weighted).toBe(true)
    expect(doc.vertices.length).toBeGreaterThanOrEqual(6)
    expect(doc.vertices.length).toBeLessThanOrEqual(8)
    expect(doc.edges.some((e) => (e.weight ?? 1) !== 1)).toBe(true)
    for (const e of doc.edges) expect(e.weight).toBeGreaterThan(0)

    const names = labelOf(doc)
    const outOfA = doc.edges
      .filter((e) => names.get(e.source) === 'A' || names.get(e.target) === 'A')
      .sort((x, y) => (x.weight ?? 1) - (y.weight ?? 1))
    const cheapestHop =
      names.get(outOfA[0]!.source) === 'A'
        ? names.get(outOfA[0]!.target)!
        : names.get(outOfA[0]!.source)!

    const path = shortestPathLabels(doc, 'A', 'G')
    expect(path[0]).toBe('A')
    expect(path.at(-1)).toBe('G')
    expect(path).toEqual(['A', 'C', 'D', 'G'])
    expect(cheapestHop).toBe('B')
    expect(path[1]).not.toBe(cheapestHop)
  })

  it('dag is directed and acyclic', () => {
    const doc = exampleById('dag')!.build()
    expect(doc.directed).toBe(true)
    expect(isAcyclicDirected(doc)).toBe(true)
    expect(componentCount(doc)).toBe(1)
    // Drawn left to right: sources sit left of sinks.
    const byLabel = new Map(doc.vertices.map((v) => [v.label, v]))
    expect(byLabel.get('Spec')!.x).toBeLessThan(byLabel.get('Ship')!.x)
  })

  it('articulation has two cut vertices and a bridge', () => {
    const doc = exampleById('articulation')!.build()
    expect(componentCount(doc)).toBe(1)
    expect(articulationLabels(doc)).toEqual(['C', 'D'])
    expect(bridgeLabels(doc)).toEqual(['C-D'])
  })

  it('konigsberg is a multigraph with four odd vertices', () => {
    const doc = exampleById('konigsberg')!.build()
    expect(doc.vertices).toHaveLength(4)
    expect(doc.edges).toHaveLength(7)
    const odd = [...degrees(doc).values()].filter((d) => d % 2 === 1)
    expect(odd).toHaveLength(4)
    expect(componentCount(doc)).toBe(1)
    // Four odd vertices means no Eulerian trail, which is the whole point.
    expect(new Graph(doc).parallelEdgeGroups().length).toBeGreaterThan(0)
    expect(exampleById('konigsberg')!.blurb).toMatch(/no eulerian trail/i)
  })
})

/* ------------------------------------------------------------------ */
/* Transforms over the gallery                                         */
/* ------------------------------------------------------------------ */

describe('transforms over the examples gallery', () => {
  for (const example of EXAMPLES) {
    it(`survives every transform on ${example.id}`, () => {
      const doc = example.build()
      const ctx: TransformContext = {
        selectedVertices: doc.vertices.slice(0, 3).map((v) => v.id),
        selectedEdges: doc.edges.slice(0, 1).map((e) => e.id),
      }
      for (const def of TRANSFORMS) {
        const graph = new Graph(doc)
        if ((def.precondition?.(graph, ctx) ?? null) !== null) continue
        const result = def.apply(graph, ctx)
        expectValidDocument(result.document)
        // Nothing may land on top of anything else after a relayout.
        if (result.relayout) {
          const spots = new Set(result.document.vertices.map((v) => `${v.x},${v.y}`))
          expect(spots.size).toBe(result.document.vertices.length)
        }
      }
    })
  }
})
