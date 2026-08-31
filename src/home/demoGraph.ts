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

/** The inspector rows the tour steps through, in order. */
export const DEMO_ROW_IDS = [
  'bipartite',
  'bridges',
  'articulation',
  'diameter',
  'eulerCircuit',
] as const
