import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { EXAMPLES, exampleById } from '../graph/examples'
import { GraphBuilder } from '../graph/model/builder'
import { byrnePalette, EDGE_INKS, edgeInks, isProperEdgeColouring, tourInk, witnessGlyph } from './byrne'
import {
  faceSides,
  FRONTISPIECE_EDGES,
  FRONTISPIECE_EULER,
  FRONTISPIECE_FACES,
  FRONTISPIECE_POINTS,
} from './euclid47'
import { buildDemoGraph, DEMO_ROW_IDS } from './demoGraph'
import { analyzeCore, analyzeMetrics } from '../graph/analysis'

/**
 * Checked here without the helper under test: for every vertex, the inks of
 * the edges that meet there are all different. A parallel edge meets its twin
 * at both ends; a loop meets everything at its one vertex.
 */
const clashes = (edges: { id: string; source: string; target: string }[], inks: Map<string, number>) => {
  const found: string[] = []
  const byVertex = new Map<string, { id: string; ink: number }[]>()
  for (const edge of edges) {
    for (const end of new Set([edge.source, edge.target])) {
      const list = byVertex.get(end) ?? []
      list.push({ id: edge.id, ink: inks.get(edge.id)! })
      byVertex.set(end, list)
    }
  }
  for (const [vertex, list] of byVertex) {
    const seen = new Map<number, string>()
    for (const { id, ink } of list) {
      if (seen.has(ink)) found.push(`${vertex}: ${seen.get(ink)} and ${id} are both ${EDGE_INKS[ink]}`)
      seen.set(ink, id)
    }
  }
  return found
}

const maxDegree = (edges: { source: string; target: string }[]) => {
  const degree = new Map<string, number>()
  for (const { source, target } of edges) {
    for (const end of new Set([source, target])) degree.set(end, (degree.get(end) ?? 0) + 1)
  }
  return Math.max(0, ...degree.values())
}

const inksUsed = (inks: Map<string, number>) => new Set(inks.values()).size

describe('the edge colouring of the plate of figures', () => {
  it('gives every built-in example a proper edge colouring', () => {
    for (const example of EXAMPLES) {
      const doc = example.build()
      const inks = edgeInks(doc)
      expect(inks.size, example.id).toBe(doc.edges.length)
      expect(clashes(doc.edges, inks), example.id).toEqual([])
      expect(isProperEdgeColouring(doc.edges, (id) => inks.get(id))).toBe(true)
    }
  })

  it('needs no sixth ink for any of them', () => {
    for (const example of EXAMPLES) {
      const inks = edgeInks(example.build())
      expect(Math.max(...inks.values()), example.id).toBeLessThanOrEqual(4)
    }
  })

  it('takes Byrne’s dotted line as a fifth ink for K5, which four cannot colour', () => {
    const inks = edgeInks(exampleById('k5')!.build())
    expect(EDGE_INKS[4]).toBe('dotted')
    expect([...inks.values()]).toContain(4)
    expect(inksUsed(inks)).toBe(5)
  })

  it('gives Königsberg’s parallel bridges different inks, five at the island', () => {
    const doc = exampleById('konigsberg')!.build()
    const inks = edgeInks(doc)
    expect(maxDegree(doc.edges)).toBe(5)
    expect(inksUsed(inks)).toBe(5)
    const island = doc.vertices.find((v) => v.label === 'Island')!.id
    const atIsland = doc.edges.filter((e) => e.source === island || e.target === island)
    expect(new Set(atIsland.map((e) => inks.get(e.id))).size).toBe(atIsland.length)
  })

  it('uses as few inks as the figure allows', () => {
    for (const example of EXAMPLES) {
      const doc = example.build()
      const used = inksUsed(edgeInks(doc))
      const delta = maxDegree(doc.edges)
      // Vizing: a simple graph needs Δ or Δ + 1, and never fewer than Δ.
      expect(used, example.id).toBeGreaterThanOrEqual(delta)
      if (example.id !== 'konigsberg') expect(used, example.id).toBeLessThanOrEqual(delta + 1)
    }
    // König: a bipartite graph needs exactly Δ.
    for (const id of ['square', 'tree', 'bipartite', 'k33']) {
      const doc = exampleById(id)!.build()
      expect(inksUsed(edgeInks(doc)), id).toBe(maxDegree(doc.edges))
    }
    // The Petersen graph is a snark: cubic, yet three inks will not do.
    expect(inksUsed(edgeInks(exampleById('petersen')!.build()))).toBe(4)
    // An odd cycle needs a third.
    expect(inksUsed(edgeInks(exampleById('triangle')!.build()))).toBe(3)
  })

  it('keeps a loop clear of every other edge at its vertex', () => {
    const b = new GraphBuilder()
    b.addVertex('A', 0, 0)
    b.addVertex('B', 100, 0)
    b.addEdgeByLabel('A', 'A')
    b.addEdgeByLabel('A', 'B')
    b.addEdgeByLabel('A', 'B')
    const doc = b.build()
    const inks = edgeInks(doc)
    expect(clashes(doc.edges, inks)).toEqual([])
    expect(inksUsed(inks)).toBe(3)
  })

  it('colours the 5-cycle beside the matrices figure with three inks', () => {
    const edges = Array.from({ length: 5 }, (_, i) => ({
      id: String(i),
      source: String(i),
      target: String((i + 1) % 5),
    }))
    const inks = edgeInks({ edges })
    expect(clashes(edges, inks)).toEqual([])
    expect(inksUsed(inks)).toBe(3)
  })

  it('gives up its search on a large graph rather than hang, and stays proper', () => {
    // K12 has 66 edges and needs 11 inks, more than the page has.
    const b = new GraphBuilder()
    const ids = Array.from({ length: 12 }, (_, i) => b.addVertex(`v${i}`, i * 10, 0))
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) b.addEdgeByLabel(`v${i}`, `v${j}`)
    }
    const doc = b.build()
    const started = performance.now()
    const inks = edgeInks(doc)
    expect(performance.now() - started).toBeLessThan(2000)
    expect(inks.size).toBe(doc.edges.length)
    for (const ink of inks.values()) expect(ink).toBeLessThan(EDGE_INKS.length)
  })
})

describe('the frontispiece', () => {
  it('lays neighbouring faces in different inks', () => {
    for (const a of FRONTISPIECE_FACES) {
      for (const b of FRONTISPIECE_FACES) {
        if (a === b) continue
        const shared = faceSides(a.ids).filter((side) => faceSides(b.ids).includes(side))
        if (shared.length) expect(a.ink, `${a.ids} and ${b.ids} share ${shared}`).not.toBe(b.ink)
      }
    }
  })

  it('is the plane graph its caption counts: V − E + F = 2', () => {
    const edges = new Set(FRONTISPIECE_EDGES.map((e) => [...e].sort().join('')))
    // Every side of every face is an edge, and every edge bounds a face.
    const sides = new Set(FRONTISPIECE_FACES.flatMap((face) => faceSides(face.ids)))
    expect([...sides].sort()).toEqual([...edges].sort())
    for (const edge of edges) {
      for (const end of edge) expect(FRONTISPIECE_POINTS[end]).toBeDefined()
    }
    const { vertices, edges: e, faces } = FRONTISPIECE_EULER
    expect([vertices, e, faces]).toEqual([9, 12, 5])
    expect(vertices - e + faces).toBe(2)
  })
})

describe('the demo’s key', () => {
  const rows = (() => {
    const graph = buildDemoGraph()
    return [
      ...analyzeCore(graph).sections.flatMap((s) => s.rows),
      ...analyzeMetrics(graph).sections.flatMap((s) => s.rows),
    ]
  })()

  it('names each property by its witness’s shape and gives it a primary of its own in turn', () => {
    const key = DEMO_ROW_IDS.map((id, i) => {
      const row = rows.find((r) => r.id === id)!
      return [id, witnessGlyph(row.witness), tourInk(i)]
    })
    expect(key).toEqual([
      ['bipartite', 'triangle', 'red'],
      ['bridges', 'bar', 'blue'],
      ['articulation', 'disc', 'yellow'],
      ['diameter', 'bar', 'red'],
      ['eulerCircuit', 'disc', 'blue'],
    ])
  })
})

/* ------------------------------------------------------------------ */
/* The colours the canvas reads against the ones home.css sets          */
/* ------------------------------------------------------------------ */

// Read from disk: an imported stylesheet is emptied under test.
const css = readFileSync(resolve(process.cwd(), 'src/home/home.css'), 'utf8')


/** The value of a custom property inside the first block that opens with `selector {`. */
const token = (selector: string, name: string) => {
  const start = css.indexOf(`${selector} {`)
  const block = css.slice(start, css.indexOf('\n}', start))
  return block.match(new RegExp(`${name}:\\s*(#[0-9a-f]{6})`, 'i'))?.[1]?.toLowerCase()
}

const luminance = (hex: string) => {
  const n = parseInt(hex.slice(1), 16)
  const [r, g, b] = [n >> 16, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi! + 0.05) / (lo! + 0.05)
}

describe('the two editions’ inks', () => {
  for (const [edition, selector, dark] of [
    ['day', '.gz-home', false],
    ['night', '.dark .gz-home', true],
  ] as const) {
    const palette = byrnePalette(dark)

    it(`are the same on the ${edition} canvas as in its stylesheet, so the list keys the canvas`, () => {
      expect(token(selector, '--gz-home-paper')).toBe(palette.paper)
      expect(token(selector, '--gz-home-ink')).toBe(palette.ink)
      expect(token(selector, '--gz-home-red')).toBe(palette.red)
      expect(token(selector, '--gz-home-blue')).toBe(palette.blue)
      expect(token(selector, '--gz-home-yellow')).toBe(palette.yellow)
    })

    it(`keep the ${edition} edition’s dimmed figure and small print legible`, () => {
      // The parts of the demo that are not on show: graphics at 3:1, letters at AA.
      expect(contrast(palette.dim, palette.paper)).toBeGreaterThanOrEqual(3)
      expect(contrast(palette.dimText, palette.paper)).toBeGreaterThanOrEqual(4.5)
      // Captions and metadata are set in the muted ink, comfortably past AA.
      expect(contrast(token(selector, '--gz-home-muted')!, palette.paper)).toBeGreaterThanOrEqual(7)
      // The primaries hold up as shapes on the paper they are printed on. Chrome
      // yellow on cream is the exception Byrne made, so a thin yellow line is
      // drawn in its ochre, and a yellow point gets an ink ring.
      for (const ink of [palette.red, palette.blue]) expect(contrast(ink, palette.paper)).toBeGreaterThanOrEqual(3)
      expect(contrast(token(selector, '--gz-home-yellow-line')!, palette.paper)).toBeGreaterThanOrEqual(3)
      // Small text in red or blue passes AA.
      for (const name of ['--gz-home-red-text', '--gz-home-blue-text']) {
        expect(contrast(token(selector, name)!, palette.paper), name).toBeGreaterThanOrEqual(4.5)
      }
    })
  }
})
