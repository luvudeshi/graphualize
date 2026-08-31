import { describe, expect, it } from 'vitest'
import { Graph } from './graph'
import { docFromEdges, GraphBuilder } from './builder'
import { absorbIds, nextVertexId, resetIdCounter } from './ids'

describe('structure and display keys', () => {
  it('ignores positions', () => {
    const doc = docFromEdges(['A-B', 'B-C'])
    const before = new Graph(doc).structureKey()
    const moved = { ...doc, vertices: doc.vertices.map((v) => ({ ...v, x: v.x + 500 })) }
    expect(new Graph(moved).structureKey()).toBe(before)
    expect(new Graph(moved).displayKey()).toBe(new Graph(doc).displayKey())
  })

  it('separates graphs that are structurally alike but built on other vertices', () => {
    // Two paths on three vertices. Nothing about the shape distinguishes them,
    // but their witnesses name different ids, so they must not share a cache
    // entry.
    const first = docFromEdges(['A-B', 'B-C'])
    const second = docFromEdges(['D-E', 'E-F'])
    expect(new Graph(first).structureKey()).not.toBe(new Graph(second).structureKey())
  })

  it('changes when the mathematics changes', () => {
    const base = new Graph(docFromEdges(['A-B', 'B-C'])).structureKey()
    expect(new Graph(docFromEdges(['A-B', 'B-C', 'C-A'])).structureKey()).not.toBe(base)
    expect(new Graph(docFromEdges(['A-B', 'B-C'], { directed: true })).structureKey()).not.toBe(base)
    expect(new Graph(docFromEdges(['A-B:2', 'B-C'], { weighted: true })).structureKey()).not.toBe(
      base,
    )
  })

  it('separates label changes only in the display key', () => {
    const doc = docFromEdges(['A-B'])
    const renamed = {
      ...doc,
      vertices: doc.vertices.map((v, i) => (i === 0 ? { ...v, label: 'Root' } : v)),
    }
    expect(new Graph(renamed).structureKey()).toBe(new Graph(doc).structureKey())
    expect(new Graph(renamed).displayKey()).not.toBe(new Graph(doc).displayKey())
  })
})

describe('id absorption', () => {
  it('never reissues an id already present in a restored document', () => {
    // Session one: ids come from a fresh counter.
    resetIdCounter(0)
    const builder = new GraphBuilder()
    builder.addEdgeByLabel('A', 'B')
    const saved = builder.build()

    // Session two: the module is reloaded, so the counter starts over.
    resetIdCounter(0)
    absorbIds(saved)

    const fresh = Array.from({ length: 5 }, () => nextVertexId())
    const existing = new Set([
      ...saved.vertices.map((v) => v.id),
      ...saved.edges.map((e) => e.id),
    ])
    for (const id of fresh) expect(existing.has(id)).toBe(false)
    expect(new Set(fresh).size).toBe(fresh.length)
  })

  it('tolerates ids it does not recognise', () => {
    resetIdCounter(7)
    expect(() =>
      absorbIds({ vertices: [{ id: 'imported-1' }], edges: [{ id: 'x' }] }),
    ).not.toThrow()
    expect(nextVertexId()).toBe(`v${(7).toString(36)}`)
  })
})
