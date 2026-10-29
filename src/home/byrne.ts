import type { StylesheetJson } from 'cytoscape'
import { canvasTheme, type CanvasTheme } from '../canvas/theme'
import type { GraphWitness } from '../graph/model/types'

/**
 * The home page is set like Oliver Byrne's 1847 Euclid: warm paper, black ink
 * and three flat primaries, and nothing else. These are the colours the
 * canvas and the SVG figures need as values; home.css holds the same ones as
 * `--gz-home-*` properties for everything drawn with CSS. Keep the two in step
 * (a test reads home.css and checks that they are).
 */
export type Ink = 'red' | 'blue' | 'yellow' | 'ink'

export interface ByrnePalette {
  paper: string
  ink: string
  red: string
  blue: string
  yellow: string
  /** What is not part of the property on show: still legible, at least 3:1. */
  dim: string
  /** The letters of those vertices, which are text: at least 4.5:1. */
  dimText: string
}

const DAY: ByrnePalette = {
  paper: '#f3ead3',
  ink: '#1d1a14',
  red: '#c9381d',
  blue: '#24519f',
  yellow: '#e6a915',
  dim: '#857b6a',
  dimText: '#5f5544',
}

/**
 * The night edition is printed, not inverted: cream ink and the same three
 * primaries on a deep indigo board, each primary lifted until it holds its
 * own against the board (red 5.4:1, blue 4.4:1, yellow 9.5:1).
 */
const NIGHT: ByrnePalette = {
  paper: '#1a1d3d',
  ink: '#ece2c6',
  red: '#f2694a',
  blue: '#4f7fee',
  yellow: '#f3be33',
  dim: '#7b82a4',
  dimText: '#a3a9c6',
}

export const byrnePalette = (dark: boolean): ByrnePalette => (dark ? NIGHT : DAY)

/** The order colours are handed out in, wherever a figure needs several. */
export const INK_ORDER: readonly Ink[] = ['red', 'blue', 'yellow', 'ink']

/**
 * The inks an edge of a figure can be drawn in: the three primaries and black,
 * then, only when a figure cannot be coloured with four, Byrne's dotted black
 * line, and after that a dashed one.
 */
export const EDGE_INKS = ['red', 'blue', 'yellow', 'ink', 'dotted', 'dashed'] as const
export type EdgeInk = (typeof EDGE_INKS)[number]

/** The demo's tour gives each property its own primary, in turn. */
export const tourInk = (index: number): Ink => INK_ORDER[index % 3]!

/**
 * Byrne's point was to replace letters with coloured shapes, so each property
 * is named by the shape its witness takes on the figure: a triangle for a
 * cycle, a bar for edges and paths, a disc for vertices.
 */
export type Glyph = 'triangle' | 'bar' | 'disc' | 'square'

export const witnessGlyph = (witness: GraphWitness | undefined): Glyph => {
  switch (witness?.type) {
    case 'cycle':
      return 'triangle'
    case 'edges':
    case 'path':
    case 'trail':
    case 'matching':
    case 'tree':
      return 'bar'
    case 'vertices':
      return 'disc'
    default:
      return 'square'
  }
}

/** The canvas theme the demo starts from, re-inked for the page. */
export const byrneCanvasTheme = (dark: boolean): CanvasTheme => {
  const p = byrnePalette(dark)
  return {
    ...canvasTheme(dark),
    background: p.paper,
    vertexFill: p.ink,
    vertexBorder: p.ink,
    vertexText: p.ink,
    vertexHover: p.ink,
    selected: p.blue,
    edge: p.ink,
    edgeLabel: p.ink,
    edgeLabelBg: p.paper,
    dim: p.dim,
    witness: p.yellow,
    cycle: p.red,
    path: p.blue,
  }
}

/** The demo's vertex, drawn as a solid point, and the same point when it is part of a witness. */
export const DEMO_POINT = 15
export const DEMO_WITNESS_POINT = 26
/** A witness edge is laid on as a flat bar of colour this wide. */
export const DEMO_WITNESS_STROKE = 10

/**
 * Drawn after the workbench's own stylesheet, so these win: vertices become
 * solid ink points lettered in italic beside them, the way a Euclid figure is
 * lettered, and a witness is laid on in a thick flat stroke of colour.
 *
 * What is not part of the witness is not faded out, which made the letters
 * unreadable: it is drawn in a lighter ink of its own, at 3:1 or better for
 * the lines and points and 4.5:1 or better for the letters.
 */
export const byrneCanvasOverrides = (dark: boolean): StylesheetJson => {
  const p = byrnePalette(dark)
  return [
    {
      selector: 'node',
      style: {
        width: DEMO_POINT,
        height: DEMO_POINT,
        'background-color': p.ink,
        'border-width': 0,
        color: p.ink,
        'font-family': '"EB Garamond", "Iowan Old Style", Georgia, serif',
        'font-style': 'italic',
        'font-weight': 500,
        'font-size': 22,
        'text-valign': 'top',
        'text-halign': 'right',
      },
    },
    {
      selector: 'node[labelH]',
      style: {
        'text-halign': 'data(labelH)',
        'text-valign': 'data(labelV)',
        // A hair of space between a point and its letter.
        'text-margin-x': 'data(labelMX)',
        'text-margin-y': 'data(labelMY)',
      },
    },
    {
      selector: 'node.hovered',
      style: { 'border-width': 0, 'background-color': p.blue },
    },
    {
      selector: 'node[hlColor]',
      style: {
        width: DEMO_WITNESS_POINT,
        height: DEMO_WITNESS_POINT,
        // A hairline of ink round the point, as round every face of the
        // frontispiece: it is what lets a yellow point stand on cream.
        'border-width': 1.5,
        'border-color': p.ink,
        'background-color': 'data(hlColor)',
      },
    },
    {
      selector: 'edge',
      style: { width: 2.5, 'line-color': p.ink, 'line-cap': 'round' },
    },
    {
      selector: 'edge[hlColor]',
      style: { width: DEMO_WITNESS_STROKE, 'line-color': 'data(hlColor)', 'line-cap': 'butt' },
    },
    { selector: '.dimmed', style: { opacity: 1 } },
    { selector: 'node.dimmed', style: { 'background-color': p.dim, color: p.dimText, 'text-opacity': 1 } },
    { selector: 'edge.dimmed', style: { 'line-color': p.dim, width: 2 } },
  ] as StylesheetJson
}

/* ------------------------------------------------------------------ */
/* Edge colouring                                                      */
/* ------------------------------------------------------------------ */

interface EdgeEnds {
  id: string
  source: string
  target: string
}

/**
 * Whether no two edges that share an endpoint carry the same ink. Parallel
 * edges share both of theirs, and a loop meets every other edge at its vertex.
 */
export const isProperEdgeColouring = (
  edges: readonly EdgeEnds[],
  inkOf: (id: string) => number | undefined,
): boolean => {
  const seen = new Map<string, Set<number>>()
  for (const edge of edges) {
    const ink = inkOf(edge.id)
    if (ink === undefined) return false
    for (const end of new Set([edge.source, edge.target])) {
      const at = seen.get(end) ?? new Set<number>()
      if (at.has(ink)) return false
      at.add(ink)
      seen.set(end, at)
    }
  }
  return true
}

/** How long the exact search may run before the figure settles for a greedy colouring. */
const SEARCH_BUDGET = 200_000

/**
 * Tries to colour the edges with `k` inks so that edges meeting at a vertex
 * all differ, by an exact backtracking search. The figures on the page are
 * tiny, so this is instant; it gives up (returns null) past a budget rather
 * than ever hang on something larger.
 *
 * Inks are interchangeable, so an edge is only ever offered the inks already
 * in use and the next new one. That is what makes proving "four will not do"
 * for K5 cheap, and it also means a figure that needs three inks uses the
 * first three, red, blue and yellow.
 */
const colourWith = (edges: readonly EdgeEnds[], k: number): number[] | null => {
  const degree = new Map<string, number>()
  for (const { source, target } of edges) {
    for (const end of new Set([source, target])) degree.set(end, (degree.get(end) ?? 0) + 1)
  }
  // The most crowded edges first: they have the fewest inks to choose from.
  const order = edges
    .map((edge, index) => ({ edge, index }))
    .sort(
      (a, b) =>
        (degree.get(b.edge.source) ?? 0) +
        (degree.get(b.edge.target) ?? 0) -
        ((degree.get(a.edge.source) ?? 0) + (degree.get(a.edge.target) ?? 0)) || a.index - b.index,
    )
  const used = new Map<string, Set<number>>()
  const at = (vertex: string) => {
    let entry = used.get(vertex)
    if (!entry) {
      entry = new Set()
      used.set(vertex, entry)
    }
    return entry
  }
  const inks = new Array<number>(edges.length).fill(-1)
  let steps = 0

  const assign = (position: number, highest: number): boolean | null => {
    if (position === order.length) return true
    if (++steps > SEARCH_BUDGET) return null
    const { edge, index } = order[position]!
    const a = at(edge.source)
    const b = at(edge.target)
    for (let ink = 0; ink <= Math.min(k - 1, highest + 1); ink++) {
      if (a.has(ink) || b.has(ink)) continue
      a.add(ink)
      b.add(ink)
      inks[index] = ink
      const done = assign(position + 1, Math.max(highest, ink))
      if (done !== false) return done
      a.delete(ink)
      b.delete(ink)
    }
    return false
  }
  return assign(0, -1) === true ? inks : null
}

/**
 * Gives every edge of a figure one of the page's edge inks so that no two
 * edges meeting at a vertex share one — a proper edge colouring, found
 * exactly, with as few inks as the figure allows. Four is enough for most;
 * K5 and Königsberg, with five edges at a vertex or an odd complete graph,
 * take Byrne's dotted line as a fifth. Returns an index into EDGE_INKS per
 * edge id.
 *
 * A figure that would need more than six inks (none on the page does) is
 * coloured greedily and wraps round the six.
 */
export const edgeInks = (doc: { edges: readonly EdgeEnds[] }): Map<string, number> => {
  const edges = doc.edges
  const degree = new Map<string, number>()
  for (const { source, target } of edges) {
    for (const end of new Set([source, target])) degree.set(end, (degree.get(end) ?? 0) + 1)
  }
  const most = Math.max(1, ...degree.values())
  for (let k = most; k <= EDGE_INKS.length; k++) {
    const inks = colourWith(edges, k)
    if (inks) return new Map(edges.map((edge, i) => [edge.id, inks[i]!]))
  }
  const result = new Map<string, number>()
  const used = new Map<string, Set<number>>()
  for (const edge of edges) {
    const a = used.get(edge.source) ?? new Set<number>()
    const b = used.get(edge.target) ?? new Set<number>()
    let ink = 0
    while (a.has(ink) || b.has(ink)) ink++
    a.add(ink)
    b.add(ink)
    used.set(edge.source, a)
    used.set(edge.target, b)
    result.set(edge.id, ink % EDGE_INKS.length)
  }
  return result
}

/* ------------------------------------------------------------------ */
/* Lettering                                                           */
/* ------------------------------------------------------------------ */

export interface LabelSide {
  halign: 'left' | 'center' | 'right'
  valign: 'top' | 'center' | 'bottom'
}

/** How far a letter is set off its point, in canvas units, on the side it is on. */
export const labelMargin = ({ halign, valign }: LabelSide) => ({
  x: halign === 'right' ? 3 : halign === 'left' ? -3 : 0,
  y: valign === 'bottom' ? 1 : valign === 'top' ? -1 : 0,
})

/* The eight places a letter can sit round its point, best first when tied:
   above and to the right is where a Euclid figure usually letters a point. */
const SIDES: { angle: number; side: LabelSide }[] = [
  { angle: 45, side: { halign: 'right', valign: 'top' } },
  { angle: 90, side: { halign: 'center', valign: 'top' } },
  { angle: 135, side: { halign: 'left', valign: 'top' } },
  { angle: 0, side: { halign: 'right', valign: 'center' } },
  { angle: 180, side: { halign: 'left', valign: 'center' } },
  { angle: 315, side: { halign: 'right', valign: 'bottom' } },
  { angle: 270, side: { halign: 'center', valign: 'bottom' } },
  { angle: 225, side: { halign: 'left', valign: 'bottom' } },
]

const turn = (a: number, b: number) => {
  const d = Math.abs(a - b) % 360
  return d > 180 ? 360 - d : d
}

/**
 * Where to letter each vertex so its letter does not sit on one of its own
 * edges: of the eight sides, the one furthest in angle from every edge that
 * leaves the vertex. Positions are in screen space, y pointing down.
 */
export const labelSides = (
  positions: ReadonlyMap<string, { x: number; y: number }>,
  edges: readonly { source: string; target: string }[],
): Map<string, LabelSide> => {
  const leaving = new Map<string, number[]>()
  const add = (from: string, to: string) => {
    const p = positions.get(from)
    const q = positions.get(to)
    if (!p || !q || from === to) return
    const angle = (Math.atan2(-(q.y - p.y), q.x - p.x) * 180) / Math.PI
    leaving.set(from, [...(leaving.get(from) ?? []), (angle + 360) % 360])
  }
  for (const { source, target } of edges) {
    add(source, target)
    add(target, source)
  }
  const sides = new Map<string, LabelSide>()
  for (const id of positions.keys()) {
    const angles = leaving.get(id) ?? []
    let best = SIDES[0]!
    let room = -1
    for (const candidate of SIDES) {
      const nearest = Math.min(360, ...angles.map((a) => turn(a, candidate.angle)))
      // A few degrees either way is a tie, so the preferred order decides.
      if (nearest > room + 5) {
        room = nearest
        best = candidate
      }
    }
    sides.set(id, best.side)
  }
  return sides
}
