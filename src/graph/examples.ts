/**
 * The built-in examples gallery.
 *
 * Everything here is hand-built: positions are chosen so the picture reads at a
 * glance (no overlapping vertices, as few crossings as we can manage) rather
 * than being handed to a layout engine. Drawings live in roughly a 600x450 box
 * centred on the origin, matching the canvas' default viewport.
 *
 * These are teaching artefacts, so each one is the smallest graph that shows
 * its idea clearly, and `blurb` says what it is good for.
 */

import { GraphBuilder } from './model/builder'
import { bipartiteLayout, circleLayout } from './layout'
import type { GraphDocument, VertexId } from './model/types'

export interface GraphExample {
  id: string
  name: string
  /** One sentence saying what the example is good for. */
  blurb: string
  category: 'basics' | 'named' | 'classic-questions'
  build: () => GraphDocument
}

/* ------------------------------------------------------------------ */
/* Building helpers                                                    */
/* ------------------------------------------------------------------ */

/** Declares labelled vertices at fixed positions, in drawing order. */
const at = (
  b: GraphBuilder,
  spec: readonly (readonly [string, number, number])[],
): VertexId[] => spec.map(([label, x, y]) => b.addVertex(label, x, y))

/**
 * Adds edges written as `'A-B'` or `'A-B:7'` between vertices that already
 * exist. Repeating a pair adds a parallel edge, which is exactly what
 * Königsberg needs.
 */
const connect = (b: GraphBuilder, spec: readonly string[]): void => {
  for (const raw of spec) {
    const [pair, weight] = raw.split(':')
    const [a, c] = pair!.split('-')
    b.addEdgeByLabel(a!.trim(), c!.trim(), weight === undefined ? undefined : Number(weight))
  }
}

/** Puts already-declared vertices on a circle, first one at the top. */
const onCircle = (
  b: GraphBuilder,
  ids: readonly VertexId[],
  radius: number,
): void => {
  const positions = circleLayout(ids, { radius })
  for (const id of ids) {
    const p = positions[id]!
    b.position(id, p.x, p.y)
  }
}

/* ------------------------------------------------------------------ */
/* Basics                                                              */
/* ------------------------------------------------------------------ */

const buildTriangle = (): GraphDocument => {
  const b = new GraphBuilder()
  at(b, [
    ['A', 0, -140],
    ['B', -150, 100],
    ['C', 150, 100],
  ])
  connect(b, ['A-B', 'B-C', 'C-A'])
  return b.build()
}

const buildSquare = (): GraphDocument => {
  const b = new GraphBuilder()
  at(b, [
    ['A', -130, -130],
    ['B', 130, -130],
    ['C', 130, 130],
    ['D', -130, 130],
  ])
  connect(b, ['A-B', 'B-C', 'C-D', 'D-A'])
  return b.build()
}

const buildTree = (): GraphDocument => {
  const b = new GraphBuilder()
  at(b, [
    ['A', 0, -170],
    ['B', -150, -20],
    ['C', 150, -20],
    ['D', -240, 150],
    ['E', -70, 150],
    ['F', 70, 150],
    ['G', 240, 150],
  ])
  connect(b, ['A-B', 'A-C', 'B-D', 'B-E', 'C-F', 'C-G'])
  return b.build()
}

const buildBipartite = (): GraphDocument => {
  const b = new GraphBuilder()
  const left = at(b, [
    ['A', 0, 0],
    ['B', 0, 0],
    ['C', 0, 0],
  ])
  const right = at(b, [
    ['D', 0, 0],
    ['E', 0, 0],
    ['F', 0, 0],
    ['G', 0, 0],
  ])
  const positions = bipartiteLayout([left, right], { radius: 320, spacing: 130 })
  for (const id of [...left, ...right]) {
    const p = positions[id]!
    b.position(id, p.x, p.y)
  }
  connect(b, ['A-D', 'A-E', 'B-E', 'B-F', 'C-F', 'C-G'])
  return b.build()
}

const buildDisconnected = (): GraphDocument => {
  const b = new GraphBuilder()
  at(b, [
    // A triangle, an isolated edge and a square, well clear of each other.
    ['A', -230, -80],
    ['B', -300, 85],
    ['C', -160, 85],
    ['D', 0, -80],
    ['E', 0, 85],
    ['F', 165, -80],
    ['G', 300, -80],
    ['H', 300, 85],
    ['I', 165, 85],
  ])
  connect(b, ['A-B', 'B-C', 'C-A', 'D-E', 'F-G', 'G-H', 'H-I', 'I-F'])
  return b.build()
}

/* ------------------------------------------------------------------ */
/* Named graphs                                                        */
/* ------------------------------------------------------------------ */

const buildK5 = (): GraphDocument => {
  const b = new GraphBuilder()
  const ids = at(b, [
    ['A', 0, 0],
    ['B', 0, 0],
    ['C', 0, 0],
    ['D', 0, 0],
    ['E', 0, 0],
  ])
  onCircle(b, ids, 180)
  connect(b, ['A-B', 'A-C', 'A-D', 'A-E', 'B-C', 'B-D', 'B-E', 'C-D', 'C-E', 'D-E'])
  return b.build()
}

const buildK33 = (): GraphDocument => {
  const b = new GraphBuilder()
  const left = at(b, [
    ['A', 0, 0],
    ['B', 0, 0],
    ['C', 0, 0],
  ])
  const right = at(b, [
    ['D', 0, 0],
    ['E', 0, 0],
    ['F', 0, 0],
  ])
  const positions = bipartiteLayout([left, right], { radius: 340, spacing: 150 })
  for (const id of [...left, ...right]) {
    const p = positions[id]!
    b.position(id, p.x, p.y)
  }
  connect(b, ['A-D', 'A-E', 'A-F', 'B-D', 'B-E', 'B-F', 'C-D', 'C-E', 'C-F'])
  return b.build()
}

const buildPetersen = (): GraphDocument => {
  const b = new GraphBuilder()
  const outer = at(b, [
    ['A', 0, 0],
    ['B', 0, 0],
    ['C', 0, 0],
    ['D', 0, 0],
    ['E', 0, 0],
  ])
  const inner = at(b, [
    ['F', 0, 0],
    ['G', 0, 0],
    ['H', 0, 0],
    ['I', 0, 0],
    ['J', 0, 0],
  ])
  onCircle(b, outer, 205)
  onCircle(b, inner, 95)
  connect(b, [
    // Outer 5-cycle.
    'A-B',
    'B-C',
    'C-D',
    'D-E',
    'E-A',
    // Spokes.
    'A-F',
    'B-G',
    'C-H',
    'D-I',
    'E-J',
    // Inner pentagram: every second inner vertex.
    'F-H',
    'H-J',
    'J-G',
    'G-I',
    'I-F',
  ])
  return b.build()
}

/* ------------------------------------------------------------------ */
/* Classic questions                                                   */
/* ------------------------------------------------------------------ */

const buildEulerian = (): GraphDocument => {
  const b = new GraphBuilder()
  at(b, [
    ['A', -270, -130],
    ['B', -270, 130],
    ['C', 0, 0],
    ['D', 270, -130],
    ['E', 270, 130],
  ])
  connect(b, ['A-B', 'B-C', 'C-A', 'C-D', 'D-E', 'E-C'])
  return b.build()
}

const buildWeightedShortestPath = (): GraphDocument => {
  const b = new GraphBuilder({ weighted: true })
  at(b, [
    ['A', -290, 0],
    ['B', -120, -140],
    ['C', -120, 110],
    ['D', 60, -30],
    ['E', 60, 155],
    ['F', 200, 90],
    ['G', 295, -20],
  ])
  // The cheapest edge out of A is A-B (2), but every route through B is long:
  // the shortest A-G walk is A-C-D-G at 10, against 14 through B.
  connect(b, [
    'A-B:2',
    'A-C:5',
    'B-C:6',
    'B-D:9',
    'C-D:2',
    'C-E:3',
    'D-G:3',
    'E-F:2',
    'F-G:4',
  ])
  return b.build()
}

const buildDag = (): GraphDocument => {
  const b = new GraphBuilder({ directed: true })
  at(b, [
    ['Spec', -285, 0],
    ['Design', -145, -110],
    ['Data', -145, 110],
    ['UI', 0, -110],
    ['API', 0, 110],
    ['Test', 145, 0],
    ['Ship', 285, 0],
  ])
  connect(b, [
    'Spec-Design',
    'Spec-Data',
    'Design-UI',
    'Data-API',
    'UI-Test',
    'API-Test',
    'Test-Ship',
  ])
  return b.build()
}

const buildArticulation = (): GraphDocument => {
  const b = new GraphBuilder()
  at(b, [
    // Two triangles pinched at C and D, with the bridge C-D between them.
    ['A', -290, -120],
    ['B', -290, 120],
    ['C', -130, 0],
    ['D', 130, 0],
    ['E', 290, -120],
    ['F', 290, 120],
  ])
  connect(b, ['A-B', 'B-C', 'C-A', 'C-D', 'D-E', 'E-F', 'F-D'])
  return b.build()
}

const buildKonigsberg = (): GraphDocument => {
  const b = new GraphBuilder()
  at(b, [
    ['North', -20, -170],
    ['Island', -190, 0],
    ['South', -20, 170],
    ['East', 220, 0],
  ])
  connect(b, [
    // Two bridges from each bank to the island, one to the far shore.
    'Island-North',
    'Island-North',
    'Island-South',
    'Island-South',
    'Island-East',
    'North-East',
    'South-East',
  ])
  return b.build()
}

/* ------------------------------------------------------------------ */
/* Registry                                                            */
/* ------------------------------------------------------------------ */

export const EXAMPLES: GraphExample[] = [
  {
    id: 'triangle',
    name: 'Triangle',
    blurb: 'The smallest cycle: three vertices, three edges, every degree 2.',
    category: 'basics',
    build: buildTriangle,
  },
  {
    id: 'square',
    name: 'Square (C4)',
    blurb: 'The four-cycle — the smallest graph that is bipartite yet not a tree.',
    category: 'basics',
    build: buildSquare,
  },
  {
    id: 'tree',
    name: 'Binary tree',
    blurb: 'A rooted tree on 7 vertices for traversals, depth and the n-1 edge rule.',
    category: 'basics',
    build: buildTree,
  },
  {
    id: 'bipartite',
    name: 'Bipartite graph',
    blurb: 'Three vertices against four, sparsely joined — good for 2-colouring and matchings.',
    category: 'basics',
    build: buildBipartite,
  },
  {
    id: 'disconnected',
    name: 'Three components',
    blurb: 'A triangle, a lone edge and a square, for counting connected components.',
    category: 'basics',
    build: buildDisconnected,
  },
  {
    id: 'k5',
    name: 'K5',
    blurb: 'The complete graph on 5 vertices: 10 edges, 4-regular, and not planar.',
    category: 'named',
    build: buildK5,
  },
  {
    id: 'k33',
    name: 'K3,3',
    blurb: 'The utility graph: the other Kuratowski obstruction, bipartite with 9 edges.',
    category: 'named',
    build: buildK33,
  },
  {
    id: 'petersen',
    name: 'Petersen graph',
    blurb: 'The standard counterexample: 3-regular on 10 vertices, non-Hamiltonian, girth 5.',
    category: 'named',
    build: buildPetersen,
  },
  {
    id: 'eulerian',
    name: 'Eulerian bowtie',
    blurb: 'Two triangles sharing a vertex: every degree is even, so an Eulerian circuit exists.',
    category: 'classic-questions',
    build: buildEulerian,
  },
  {
    id: 'weighted-shortest-path',
    name: 'Shortest path trap',
    blurb: 'A weighted graph where the cheapest first hop leads away from the shortest route — the case Dijkstra gets right and greedy walking gets wrong.',
    category: 'classic-questions',
    build: buildWeightedShortestPath,
  },
  {
    id: 'dag',
    name: 'Task dependencies (DAG)',
    blurb: 'A small acyclic pipeline, drawn left to right, for topological order and critical paths.',
    category: 'classic-questions',
    build: buildDag,
  },
  {
    id: 'articulation',
    name: 'Cut vertices and a bridge',
    blurb: 'Two triangles joined by a single edge: C and D are cut vertices and C-D is a bridge.',
    category: 'classic-questions',
    build: buildArticulation,
  },
  {
    id: 'konigsberg',
    name: 'Seven bridges of Königsberg',
    blurb: 'Euler’s 1736 multigraph: four landmasses, seven bridges, and four odd-degree vertices — so no Eulerian trail and no walk crossing every bridge exactly once.',
    category: 'classic-questions',
    build: buildKonigsberg,
  },
]

const BY_ID = new Map(EXAMPLES.map((e) => [e.id, e] as const))

export const exampleById = (id: string): GraphExample | undefined => BY_ID.get(id)
