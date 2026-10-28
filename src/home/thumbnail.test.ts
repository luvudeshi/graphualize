import { describe, expect, it } from 'vitest'
import { thumbnailGeometry } from './thumbnail'
import { EXAMPLES, exampleById } from '../graph/examples'
import { GraphBuilder } from '../graph/model/builder'
import type { GraphDocument } from '../graph/model/types'

const BOX = { width: 240, height: 150, padding: 20, radius: 5 }

/** Every number in a path, as [x, y] pairs: start, control points and end. */
const points = (d: string): [number, number][] => {
  const numbers = d.match(/-?\d+(\.\d+)?/g)!.map(Number)
  const pairs: [number, number][] = []
  for (let i = 0; i + 1 < numbers.length; i += 2) pairs.push([numbers[i]!, numbers[i + 1]!])
  return pairs
}

const build = (spec: (b: GraphBuilder) => void, directed = false): GraphDocument => {
  const b = new GraphBuilder({ directed })
  spec(b)
  return b.build()
}

describe('thumbnailGeometry', () => {
  it('keeps every vertex of every example inside the box, clear of the padding', () => {
    for (const example of EXAMPLES) {
      const { vertices } = thumbnailGeometry(example.build(), BOX)
      for (const v of vertices) {
        expect(v.x, example.id).toBeGreaterThanOrEqual(BOX.padding - 0.1)
        expect(v.x, example.id).toBeLessThanOrEqual(BOX.width - BOX.padding + 0.1)
        expect(v.y, example.id).toBeGreaterThanOrEqual(BOX.padding - 0.1)
        expect(v.y, example.id).toBeLessThanOrEqual(BOX.height - BOX.padding + 0.1)
      }
    }
  })

  it('scales both axes alike, so a drawing keeps its shape', () => {
    const doc = build((b) => {
      b.addVertex('A', 0, 0)
      b.addVertex('B', 400, 0)
      b.addVertex('C', 400, 100)
    })
    const [a, b, c] = thumbnailGeometry(doc, BOX).vertices
    const ratio = (b!.x - a!.x) / (c!.y - b!.y)
    expect(ratio).toBeCloseTo(4, 1)
  })

  it('fills the box along its tighter axis and centres the other', () => {
    const { vertices } = thumbnailGeometry(exampleById('k5')!.build(), BOX)
    const ys = vertices.map((v) => v.y)
    const xs = vertices.map((v) => v.x)
    // K5 is drawn taller than the box is, relatively, so height is the limit.
    expect(Math.min(...ys)).toBeCloseTo(BOX.padding, 0)
    expect(Math.max(...ys)).toBeCloseTo(BOX.height - BOX.padding, 0)
    expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeCloseTo(BOX.width / 2, 0)
  })

  it('never enlarges a drawing past its own size', () => {
    const doc = build((b) => {
      b.addEdgeByLabel('A', 'B')
      b.position(b.vertexId('A')!, 0, 0)
      b.position(b.vertexId('B')!, 30, 0)
    })
    const [a, b] = thumbnailGeometry(doc, BOX).vertices
    expect(b!.x - a!.x).toBeCloseTo(30)
    expect((a!.x + b!.x) / 2).toBeCloseTo(BOX.width / 2)
    expect(a!.y).toBeCloseTo(BOX.height / 2)
  })

  it('copes with nothing at all and with a single vertex', () => {
    expect(thumbnailGeometry({ vertices: [], edges: [], directed: false, weighted: false }, BOX)).toEqual({
      vertices: [],
      edges: [],
    })
    const one = build((b) => void b.addVertex('A', 77, -12))
    expect(thumbnailGeometry(one, BOX).vertices[0]).toMatchObject({
      x: BOX.width / 2,
      y: BOX.height / 2,
    })
  })

  it('fans parallel edges into distinct curves, the middle one straight', () => {
    // Königsberg: four landmasses and seven bridges, five of them in pairs.
    const doc = exampleById('konigsberg')!.build()
    const { edges } = thumbnailGeometry(doc, BOX)
    expect(edges).toHaveLength(7)
    expect(new Set(edges.map((edge) => edge.d)).size).toBe(7)

    const triple = build((b) => {
      b.addVertex('A', 0, 0)
      b.addVertex('B', 200, 0)
      for (let i = 0; i < 3; i += 1) b.addEdgeByLabel('A', 'B')
    })
    const [first, middle, last] = thumbnailGeometry(triple, BOX).edges.map((edge) => edge.d)
    expect(middle).toMatch(/L/)
    expect(first).toMatch(/Q/)
    expect(last).toMatch(/Q/)
    // Bent to opposite sides of the straight one.
    const bend = (d: string) => points(d)[1]![1] - BOX.height / 2
    expect(Math.sign(bend(first!))).toBe(-Math.sign(bend(last!)))
  })

  it('bends an edge each way between two vertices apart rather than on top of each other', () => {
    const doc = build((b) => {
      b.addVertex('A', 0, 0)
      b.addVertex('B', 200, 0)
      b.addEdgeByLabel('A', 'B')
      b.addEdgeByLabel('B', 'A')
    }, true)
    const [there, back] = thumbnailGeometry(doc, BOX).edges.map((edge) => points(edge.d)[1]!)
    expect(Math.sign(there![1] - BOX.height / 2)).toBe(-Math.sign(back![1] - BOX.height / 2))
  })

  it('draws a self-loop as a closed curve on its vertex', () => {
    const doc = build((b) => {
      b.addVertex('A', 0, 0)
      b.addVertex('B', 100, 0)
      b.addEdgeByLabel('A', 'A')
    })
    const geometry = thumbnailGeometry(doc, BOX)
    const a = geometry.vertices[0]!
    const loop = points(geometry.edges[0]!.d)
    expect(loop[0]).toEqual([a.x, a.y])
    expect(loop.at(-1)).toEqual([a.x, a.y])
    // It rises above the vertex rather than hiding under it.
    expect(Math.min(...loop.map(([, y]) => y))).toBeLessThan(a.y - BOX.radius)
  })

  it('stops a directed edge at the rim of its target, where the arrowhead sits', () => {
    const doc = build((b) => {
      b.addVertex('A', 0, 0)
      b.addVertex('B', 200, 0)
      b.addEdgeByLabel('A', 'B')
    }, true)
    const geometry = thumbnailGeometry(doc, BOX)
    const target = geometry.vertices[1]!
    const end = points(geometry.edges[0]!.d).at(-1)!
    expect(Math.hypot(target.x - end[0], target.y - end[1])).toBeCloseTo(BOX.radius + 1.5, 0)
  })
})
