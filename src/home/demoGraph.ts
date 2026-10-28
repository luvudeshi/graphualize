import { GraphBuilder } from '../graph/model/builder'
import { Graph } from '../graph/model/graph'
import type { GraphDocument } from '../graph/model/types'

interface Placed {
  label: string
  x: number
  y: number
}

const LAYOUT: Placed[] = [
  { label: 'A', x: -250, y: -72 },
  { label: 'B', x: -250, y: 72 },
  { label: 'C', x: -142, y: 0 },
  { label: 'D', x: -18, y: 0 },
  { label: 'E', x: 82, y: -74 },
  { label: 'F', x: 82, y: 74 },
  { label: 'G', x: 202, y: 112 },
  { label: 'H', x: 302, y: 44 },
]

const EDGES: [string, string][] = [
  ['A', 'B'],
  ['B', 'C'],
  ['C', 'A'],
  ['C', 'D'],
  ['D', 'E'],
  ['E', 'F'],
  ['F', 'D'],
  ['F', 'G'],
  ['G', 'H'],
]

/**
 * The graph on the homepage. Chosen so that a short tour of its properties
 * shows off several different kinds of witness: a triangle (an odd cycle), a
 * bridge, cut vertices, a long diameter and odd-degree vertices.
 */
export const buildDemoDocument = (): GraphDocument => {
  const builder = new GraphBuilder()
  for (const vertex of LAYOUT) {
    builder.position(builder.addVertex(vertex.label), vertex.x, vertex.y)
  }
  for (const [a, b] of EDGES) builder.addEdgeByLabel(a, b)
  return builder.build()
}

export const buildDemoGraph = (): Graph => new Graph(buildDemoDocument())

export type DemoLayout = 'wide' | 'compact'

/**
 * A second drawing of the same graph, folded so the tail hooks back under the
 * two triangles. The long left-to-right chain above is roughly three times as
 * wide as it is tall, which on a phone-width stage shrinks every vertex to a
 * dot; this one is close to 4:3 and stays legible. Only positions differ — the
 * vertices and edges, and so every property the page names, are the same.
 */
const COMPACT_LAYOUT: Placed[] = [
  { label: 'A', x: -140, y: -90 },
  { label: 'B', x: -140, y: 42 },
  { label: 'C', x: -44, y: -24 },
  { label: 'D', x: 52, y: -24 },
  { label: 'E', x: 148, y: -90 },
  { label: 'F', x: 148, y: 42 },
  { label: 'G', x: 84, y: 126 },
  { label: 'H', x: -20, y: 126 },
]

/** Where each vertex goes in the given drawing, keyed by label. */
export const demoPositions = (layout: DemoLayout): Map<string, { x: number; y: number }> =>
  new Map(
    (layout === 'compact' ? COMPACT_LAYOUT : LAYOUT).map(({ label, x, y }) => [label, { x, y }]),
  )

/**
 * Which drawing suits a stage of this size. The wide one needs a landscape
 * stage with room to spare; anything narrower or squarer gets the compact one.
 */
export const demoLayoutFor = (width: number, height: number): DemoLayout =>
  width >= 560 && width >= height * 1.45 ? 'wide' : 'compact'

/** The inspector rows the tour steps through, in order. */
export const DEMO_ROW_IDS = [
  'bipartite',
  'bridges',
  'articulation',
  'diameter',
  'eulerCircuit',
] as const
