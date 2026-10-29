import { describe, expect, it } from 'vitest'
import {
  annotate,
  boxesOverlap,
  notebook,
  noteBox,
  segmentHitsBox,
  type Box,
  type Note,
  type Plot,
  type Point,
  type Subject,
} from './notes'
import { buildDemoDocument, DEMO_ROW_IDS, demoPositions, type DemoLayout } from './demoGraph'
import { analyzeCore, analyzeMetrics } from '../graph/analysis'
import { Graph } from '../graph/model/graph'
import { DEMO_POINT, DEMO_WITNESS_POINT, DEMO_WITNESS_STROKE, labelSides } from './byrne'
import { witnessToHighlight } from '../canvas/highlight'

// Ids are minted per build, so the plots and the analysis share one document.
const doc = buildDemoDocument()
const graph = new Graph(doc)
const names = new Map(doc.vertices.map((v) => [v.id, v.label]))
const byLabel = new Map(doc.vertices.map((v) => [v.label, v.id]))

const subjects: Subject[] = (() => {
  const rows = [
    ...analyzeCore(graph).sections.flatMap((s) => s.rows),
    ...analyzeMetrics(graph).sections.flatMap((s) => s.rows),
  ]
  return DEMO_ROW_IDS.map((id) => {
    const row = rows.find((r) => r.id === id)!
    return { id: row.id, value: row.value, witness: row.witness }
  })
})()
const subject = (id: string) => subjects.find((s) => s.id === id)!

/**
 * The demo drawn the way the page draws it: fitted and centred in screen
 * pixels, a witness's points larger, and each letter in a box on the side
 * `labelSides` picks, about the size the page sets them.
 */
const plotFor = (
  layout: DemoLayout,
  width: number,
  height: number,
  zoom: number,
  on: Subject | null,
  moved: Record<string, Point> = {},
): Plot => {
  const at = demoPositions(layout)
  const model = new Map(
    doc.vertices.map((v) => [v.id, moved[v.label] ?? at.get(v.label)!] as const),
  )
  const xs = [...model.values()].map((p) => p.x)
  const ys = [...model.values()].map((p) => p.y)
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2
  const lit = on?.witness ? witnessToHighlight(on.witness, graph).vertices ?? {} : {}
  const sides = labelSides(model, doc.edges)
  const vertices = new Map<string, { x: number; y: number; r: number }>()
  const letters = new Map<string, Box>()
  for (const [id, p] of model) {
    const x = width / 2 + (p.x - cx) * zoom
    const y = height / 2 + (p.y - cy) * zoom
    const r = ((lit[id] ? DEMO_WITNESS_POINT : DEMO_POINT) / 2) * zoom
    vertices.set(id, { x, y, r })
    const side = sides.get(id)!
    const [w, h] = [13 * zoom, 22 * zoom]
    const x0 = side.halign === 'right' ? x + r : side.halign === 'left' ? x - r - w : x - w / 2
    const y0 = side.valign === 'bottom' ? y + r : side.valign === 'top' ? y - r - h : y - h / 2
    letters.set(id, { x0, y0, x1: x0 + w, y1: y0 + h })
  }
  return {
    width,
    height,
    vertices,
    letters,
    names,
    edges: doc.edges.map(({ id, source, target }) => ({ id, source, target })),
    stroke: DEMO_WITNESS_STROKE * zoom,
  }
}

/** The stages the page gives the demo: a desktop plate, a tablet one and a phone. */
const STAGES: [string, DemoLayout, number, number, number][] = [
  ['desktop', 'wide', 760, 368, 1.15],
  ['tablet', 'compact', 545, 392, 1.15],
  ['phone', 'compact', 356, 330, 0.88],
]

const words = (notes: Note[]) =>
  notes.map((n) => (n.kind === 'mark' ? '(mark)' : n.lettering.text))

const segmentsOf = (note: Note): [Point, Point][] =>
  note.kind === 'leader'
    ? [[note.from, note.to]]
    : note.kind === 'dimension'
      ? [note.line, ...note.ticks, ...note.extensions]
      : []

describe('the notes on the demo plate', () => {
  const desktop = (on: Subject) => plotFor('wide', 760, 368, 1.15, on)

  it('names the odd triangle once, by its letters', () => {
    const on = subject('bipartite')
    expect(words(annotate(on, desktop(on)))).toEqual(['the triangle ABC, of odd length'])
  })

  it('calls out each bridge, each cut vertex and each vertex of odd degree', () => {
    for (const [id, text, count] of [
      ['bridges', 'a bridge', 3],
      ['articulation', 'cut vertex', 4],
      ['eulerCircuit', 'odd degree', 4],
    ] as const) {
      const on = subject(id)
      expect(words(annotate(on, desktop(on))), id).toEqual(Array(count).fill(text))
    }
  })

  it('measures the diameter with a bracket from A to H', () => {
    const on = subject('diameter')
    const plot = desktop(on)
    const [note, ...rest] = annotate(on, plot)
    expect(rest).toEqual([])
    expect(note).toMatchObject({ kind: 'dimension', lettering: { text: 'diameter 5' } })
    if (note?.kind !== 'dimension') return
    const a = plot.vertices.get(byLabel.get('A')!)!
    const h = plot.vertices.get(byLabel.get('H')!)!
    // The bracket spans exactly the two ends of the path, and its dotted
    // extension lines come out of those two points.
    expect([note.line[0].x, note.line[1].x].sort((p, q) => p - q)).toEqual([a.x, h.x].sort((p, q) => p - q))
    const starts = note.extensions.map(([p]) => p)
    expect(Math.min(...starts.map((p) => Math.hypot(p.x - a.x, p.y - a.y)))).toBeLessThan(a.r + 6)
    expect(Math.min(...starts.map((p) => Math.hypot(p.x - h.x, p.y - h.y)))).toBeLessThan(h.r + 6)
  })

  for (const [stage, layout, width, height, zoom] of STAGES) {
    it(`never covers a point, a letter or another note on a ${stage}`, () => {
      for (const on of subjects) {
        const plot = plotFor(layout, width, height, zoom, on)
        const notes = annotate(on, plot)
        expect(notes.length, on.id).toBeGreaterThan(0)
        const boxes = notes.map(noteBox)
        for (const [i, box] of boxes.entries()) {
          // Inside the plate.
          expect(box.x0, on.id).toBeGreaterThanOrEqual(0)
          expect(box.y0, on.id).toBeGreaterThanOrEqual(0)
          expect(box.x1, on.id).toBeLessThanOrEqual(width)
          expect(box.y1, on.id).toBeLessThanOrEqual(height)
          for (const letter of plot.letters.values()) expect(boxesOverlap(box, letter), on.id).toBe(false)
          for (const v of plot.vertices.values()) {
            const nearest = {
              x: Math.max(box.x0, Math.min(v.x, box.x1)),
              y: Math.max(box.y0, Math.min(v.y, box.y1)),
            }
            expect(Math.hypot(v.x - nearest.x, v.y - nearest.y), on.id).toBeGreaterThanOrEqual(v.r)
          }
          for (const other of boxes.slice(i + 1)) expect(boxesOverlap(box, other), on.id).toBe(false)
        }
        // No leader or rule runs through a letter, or through a note's words.
        for (const note of notes) {
          for (const [p, q] of segmentsOf(note)) {
            for (const letter of plot.letters.values()) expect(segmentHitsBox(p, q, letter), on.id).toBe(false)
            for (const other of notes) {
              if (other !== note) expect(segmentHitsBox(p, q, noteBox(other)), on.id).toBe(false)
            }
          }
        }
      }
    })
  }

  it('follows a vertex that is dragged', () => {
    const on = subject('articulation')
    const before = annotate(on, desktop(on))
    const g = byLabel.get('G')!
    // G pulled well down and to the left.
    const plot = plotFor('wide', 760, 368, 1.15, on, { G: { x: 120, y: 150 } })
    const after = annotate(on, plot)
    expect(words(after)).toEqual(Array(4).fill('cut vertex'))
    const at = plot.vertices.get(g)!
    const leaders = after.filter((n): n is Extract<Note, { kind: 'leader' }> => n.kind === 'leader')
    // One leader starts right at G's new position, just off its rim.
    expect(
      leaders.some((n) => Math.abs(Math.hypot(n.from.x - at.x, n.from.y - at.y) - (at.r + 3)) < 0.01),
    ).toBe(true)
    expect(after).not.toEqual(before)
  })

  it('keeps each note to its spot through a drag while it still fits', () => {
    const on = subject('bridges')
    const write = notebook()
    const first = write(on, desktop(on))
    // H nudged a little, frame by frame: every note keeps its side and its
    // leader, and only slides along with what it labels.
    let previous = first
    for (let step = 1; step <= 6; step++) {
      const next = write(on, plotFor('wide', 760, 368, 1.15, on, { H: { x: 302 - step * 4, y: 44 + step * 3 } }))
      expect(next.map((n) => n.kind === 'leader' && [n.key, n.theta, n.leg])).toEqual(
        previous.map((n) => n.kind === 'leader' && [n.key, n.theta, n.leg]),
      )
      previous = next
    }
  })

  it('moves the bracket with the end of the path', () => {
    const on = subject('diameter')
    const plot = plotFor('wide', 760, 368, 1.15, on, { H: { x: 340, y: 20 } })
    const [note] = annotate(on, plot)
    const h = plot.vertices.get(byLabel.get('H')!)!
    expect(note?.kind).toBe('dimension')
    if (note?.kind === 'dimension') expect(Math.max(note.line[0].x, note.line[1].x)).toBeCloseTo(h.x)
  })

  it('shrinks a note to its mark alone where the words will not fit', () => {
    // A phone's plate, with lettering far too wide for it.
    const on = subject('articulation')
    const plot = plotFor('compact', 356, 330, 0.88, on)
    const notes = annotate(on, plot, (text) => text.length * 26)
    expect(notes.map((n) => n.kind)).toContain('mark')
    for (const note of notes) {
      for (const letter of plot.letters.values()) expect(boxesOverlap(noteBox(note), letter)).toBe(false)
    }
  })

  it('brackets the diameter only along an axis the path runs the length of', () => {
    // In the compact drawing A and H are nearly above one another, so a
    // horizontal bracket from A to H would measure a sliver of the figure.
    const on = subject('diameter')
    const [note] = annotate(on, plotFor('compact', 545, 392, 1.15, on))
    expect(note).toMatchObject({ kind: 'dimension', lettering: { text: 'diameter 5', angle: -90 } })
    if (note?.kind === 'dimension') expect(note.line[0].x).toBeCloseTo(note.line[1].x)
  })

  it('names the diameter at its middle when there is no room to measure it', () => {
    const on = subject('diameter')
    const notes = annotate(on, plotFor('wide', 650, 220, 1.1, on))
    expect(notes.every((n) => n.kind !== 'dimension')).toBe(true)
    expect(words(notes)).toEqual(['diameter 5'])
  })

  it('writes nothing for a property with nothing to point at', () => {
    expect(annotate({ id: 'connected', value: 'Yes' }, desktop(subject('bipartite')))).toEqual([])
  })
})
