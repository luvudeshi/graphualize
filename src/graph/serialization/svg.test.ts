import { describe, expect, it } from 'vitest'
import { Graph } from '../model/graph'
import { docFromEdges } from '../model/builder'
import { LIGHT_SVG_THEME, toSvg } from './svg'

const g = (spec: string[], options?: { directed?: boolean; weighted?: boolean }) =>
  new Graph(docFromEdges(spec, options))

const place = (graph: Graph, positions: [number, number][]): Graph => {
  const doc = graph.toDocument()
  doc.vertices.forEach((vertex, index) => {
    const position = positions[index]
    if (position) {
      vertex.x = position[0]
      vertex.y = position[1]
    }
  })
  return new Graph(doc)
}

const parse = (svg: string): Document => {
  const parsed = new DOMParser().parseFromString(svg, 'image/svg+xml')
  const error = parsed.querySelector('parsererror')
  if (error) throw new Error(`Invalid SVG: ${error.textContent}`)
  return parsed
}

const count = (svg: string, selector: string) => parse(svg).querySelectorAll(selector).length

describe('SVG export', () => {
  it('draws one circle and one label per vertex', () => {
    const graph = place(g(['A-B', 'B-C']), [
      [0, 0],
      [100, 0],
      [200, 0],
    ])
    const svg = toSvg(graph)
    expect(count(svg, 'circle')).toBe(3)
    expect(count(svg, 'text')).toBe(3)
    expect(svg).toContain('>A<')
    expect(svg).toContain('>C<')
  })

  it('produces well-formed XML', () => {
    const graph = g(['A-B', 'B-C', 'C-A'])
    expect(() => parse(toSvg(graph))).not.toThrow()
    expect(() => parse(toSvg(graph, { transparent: true }))).not.toThrow()
    expect(() => parse(toSvg(g([])))).not.toThrow()
    expect(() => parse(toSvg(g(['A'])))).not.toThrow()
  })

  it('escapes labels rather than letting them break the document', () => {
    const doc = docFromEdges(['A-B'])
    doc.vertices[0]!.label = '<script>&"x"'
    const svg = toSvg(new Graph(doc), { title: 'a & b' })
    expect(svg).not.toContain('<script>')
    expect(svg).toContain('&lt;script&gt;&amp;&quot;x&quot;')
    expect(() => parse(svg)).not.toThrow()
  })

  it('sizes the viewBox around every vertex', () => {
    const graph = place(g(['A-B']), [
      [-100, -40],
      [100, 40],
    ])
    const root = parse(toSvg(graph, { padding: 20, vertexRadius: 10 })).documentElement
    const [x, y, width, height] = (root.getAttribute('viewBox') ?? '').split(' ').map(Number)
    expect(x).toBe(-130)
    expect(y).toBe(-70)
    expect(width).toBe(260)
    expect(height).toBe(140)
  })

  it('omits the background only when asked', () => {
    const graph = g(['A-B'])
    expect(toSvg(graph)).toContain(LIGHT_SVG_THEME.background)
    expect(count(toSvg(graph), 'rect')).toBe(1)
    expect(count(toSvg(graph, { transparent: true }), 'rect')).toBe(0)
  })

  it('adds an arrowhead per arc for a digraph, and none otherwise', () => {
    const directed = g(['A->B', 'B->C'], { directed: true })
    const undirected = g(['A-B', 'B-C'])
    // Each edge contributes one curve; a digraph adds one filled arrow path.
    expect(count(toSvg(directed), 'path')).toBe(count(toSvg(undirected), 'path') + 2)
  })

  it('labels weights only in weighted mode', () => {
    const weighted = g(['A-B:7'], { weighted: true })
    expect(toSvg(weighted)).toContain('>7<')
    expect(toSvg(g(['A-B:7']))).not.toContain('>7<')
  })

  it('draws parallel edges and self-loops as separate strokes', () => {
    const parallel = g(['A-B', 'A-B', 'A-B'])
    expect(count(toSvg(parallel), 'path')).toBe(3)
    const loops = g(['A-A', 'A-A', 'A-B'])
    expect(count(toSvg(loops), 'path')).toBe(3)
  })

  it('carries the highlight through to the drawing', () => {
    const doc = docFromEdges(['A-B', 'B-C', 'C-A'])
    const graph = new Graph(doc)
    const svg = toSvg(graph, {
      highlightVertices: { [doc.vertices[0]!.id]: '#ff0000' },
      highlightEdges: { [doc.edges[0]!.id]: '#ff0000' },
      dimmed: true,
    })
    expect(svg).toContain('#ff0000')
    // Everything not highlighted is drawn faintly.
    expect(svg).toContain('opacity="0.18"')
  })

  it('fills coloured vertices', () => {
    const doc = docFromEdges(['A-B'])
    const svg = toSvg(new Graph(doc), {
      vertexFills: { [doc.vertices[0]!.id]: '#123456' },
    })
    expect(svg).toContain('#123456')
  })

  it('keeps every stroke inside the viewBox', () => {
    const graph = place(g(['A-B', 'B-C', 'C-A']), [
      [0, 0],
      [120, 0],
      [60, 100],
    ])
    const root = parse(toSvg(graph)).documentElement
    const [x, y, width, height] = (root.getAttribute('viewBox') ?? '').split(' ').map(Number)
    for (const circle of root.querySelectorAll('circle')) {
      const cx = Number(circle.getAttribute('cx'))
      const cy = Number(circle.getAttribute('cy'))
      const r = Number(circle.getAttribute('r'))
      expect(cx - r).toBeGreaterThanOrEqual(x!)
      expect(cy - r).toBeGreaterThanOrEqual(y!)
      expect(cx + r).toBeLessThanOrEqual(x! + width!)
      expect(cy + r).toBeLessThanOrEqual(y! + height!)
    }
  })
})
