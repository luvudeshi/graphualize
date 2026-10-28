/**
 * Graph generators.
 *
 * Every generator is a pure function from a bag of numeric parameters to a
 * fully laid-out {@link GraphDocument}. Nothing here touches React, Cytoscape,
 * or `Math.random`: the random families take their entropy from a seeded
 * mulberry32 stream so the same seed always rebuilds the same graph.
 *
 * Edge weights are a separate concern (see `./weights`): {@link generate}
 * applies the requested weighting after layout, so every family gets unit,
 * random or length weights without knowing about any of them.
 */

import { Graph } from '../model/graph'
import { GraphBuilder } from '../model/builder'
import { labelForIndex, labelSeries } from '../model/ids'
import type { GraphDocument, VertexId } from '../model/types'
import type { Positions } from '../layout'
import {
  bipartiteLayout,
  breadthFirstLayout,
  circleLayout,
  forceLayout,
  gridLayout,
} from '../layout'
import { mulberry32, randomBelow, type Rng } from './random'
import { weighEdges, weightingProblem, type EdgeWeighting } from './weights'

export type { Rng } from './random'
export type { EdgeWeighting } from './weights'

/* ------------------------------------------------------------------ */
/* Public types                                                        */
/* ------------------------------------------------------------------ */

export interface GeneratorParam {
  key: string
  label: string
  kind: 'int' | 'float'
  min: number
  max: number
  step?: number
  default: number
  description?: string
}

export interface GenerateOptions {
  seed?: number
  directed?: boolean
  weighted?: boolean
  /**
   * How to weigh the edges. Setting it makes the result weighted whatever
   * `weighted` says. Applied by {@link generate} once the graph is laid out,
   * because Length reads the final positions; random weights use `seed`.
   */
  weights?: EdgeWeighting
}

export interface GeneratorDefinition {
  id: string
  name: string
  shortName: string
  category: 'classic' | 'random'
  description: string
  params: GeneratorParam[]
  /** Returns a laid-out document, or throws GeneratorError with a human message. */
  generate: (params: Record<string, number>, options?: GenerateOptions) => GraphDocument
  /** Approximate vertex+edge cost so the UI can refuse to freeze itself. */
  estimateSize?: (params: Record<string, number>) => { vertices: number; edges: number }
}

/** Raised for any parameter a human could reasonably have got wrong. */
export class GeneratorError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GeneratorError'
    // Keeps `instanceof` honest however the class is transpiled.
    Object.setPrototypeOf(this, GeneratorError.prototype)
  }
}

/* ------------------------------------------------------------------ */
/* Randomness                                                          */
/* ------------------------------------------------------------------ */

const DEFAULT_SEED = 20240817

const seedOf = (options?: GenerateOptions): number =>
  Number.isFinite(options?.seed) ? (options?.seed as number) : DEFAULT_SEED

const rngFor = (options?: GenerateOptions): Rng => mulberry32(seedOf(options))

/* ------------------------------------------------------------------ */
/* Parameter plumbing                                                  */
/* ------------------------------------------------------------------ */

const param = (
  key: string,
  label: string,
  kind: 'int' | 'float',
  min: number,
  max: number,
  fallback: number,
  extra: { step?: number; description?: string } = {},
): GeneratorParam => ({ key, label, kind, min, max, default: fallback, ...extra })

/**
 * Reads one parameter, applying its default, and rejecting anything outside
 * the declared range. Callers may override the two range messages so each
 * family can speak in its own vocabulary ("Cn needs at least 3 vertices.").
 */
const readParam = (
  params: Record<string, number>,
  spec: GeneratorParam,
  who: string,
  messages: { min?: string; max?: string } = {},
): number => {
  const raw: number | undefined = params[spec.key]
  const value = raw === undefined ? spec.default : raw
  if (!Number.isFinite(value)) {
    throw new GeneratorError(`${who}: ${spec.label} must be a number.`)
  }
  if (spec.kind === 'int' && !Number.isInteger(value)) {
    throw new GeneratorError(`${who}: ${spec.label} must be a whole number.`)
  }
  if (value < spec.min) {
    throw new GeneratorError(
      messages.min ?? `${who} needs ${spec.label} to be at least ${spec.min}.`,
    )
  }
  if (value > spec.max) {
    throw new GeneratorError(
      messages.max ?? `${who} accepts ${spec.label} up to ${spec.max}.`,
    )
  }
  return value
}

/** Lenient read used by `estimateSize`, which must never throw. */
const peek = (params: Record<string, number>, spec: GeneratorParam): number => {
  const raw: number | undefined = params[spec.key]
  const value = raw === undefined || !Number.isFinite(raw) ? spec.default : raw
  return Math.max(spec.min, value)
}

/* ------------------------------------------------------------------ */
/* Document plumbing                                                   */
/* ------------------------------------------------------------------ */

const builderFor = (options?: GenerateOptions): GraphBuilder =>
  new GraphBuilder({
    directed: options?.directed ?? false,
    weighted: options?.weighted ?? false,
  })

/**
 * Weighted documents get an explicit unit weight so the UI has something to
 * show. Any other weighting is applied afterwards by {@link generate}.
 */
const unitWeight = (options?: GenerateOptions): number | undefined =>
  options?.weighted ? 1 : undefined

const place = (doc: GraphDocument, positions: Positions): GraphDocument => {
  for (const v of doc.vertices) {
    const p = positions[v.id]
    if (p) {
      v.x = p.x
      v.y = p.y
    }
  }
  return doc
}

/** Above this order the force layout stops being worth its quadratic cost. */
const FORCE_LIMIT = 80

/** Force-directed for graphs small enough to benefit, a circle otherwise. */
const organicLayout = (doc: GraphDocument, seed: number): Positions => {
  const ids = doc.vertices.map((v) => v.id)
  if (ids.length > FORCE_LIMIT) return circleLayout(ids)
  if (ids.length <= 1) return circleLayout(ids)
  return forceLayout(new Graph(doc), { seed })
}

/**
 * Builds `count` labelled vertices (A, B, C, ...) in index order.
 * Returns the ids so generators can address them positionally.
 */
const addLabelled = (b: GraphBuilder, count: number, offset = 0): VertexId[] =>
  labelSeries(count, offset).map((label) => b.addVertex(label))

/* ================================================================== */
/* Classic families                                                    */
/* ================================================================== */

/* ---- Path Pn ----------------------------------------------------- */

const PATH_N = param('n', 'vertices', 'int', 1, 500, 8, {
  description: 'Number of vertices in the chain.',
})

const pathGenerator: GeneratorDefinition = {
  id: 'path',
  name: 'Path Pn',
  shortName: 'Pn',
  category: 'classic',
  description:
    'An open chain on n vertices with n − 1 edges: the two ends have degree 1 and every interior vertex has degree 2.',
  params: [PATH_N],
  generate(params, options) {
    const n = readParam(params, PATH_N, 'Pn', { min: 'Pn needs at least 1 vertex.' })
    const b = builderFor(options)
    const ids = addLabelled(b, n)
    for (let i = 0; i + 1 < n; i++) b.addEdge(ids[i], ids[i + 1], unitWeight(options))
    const doc = b.build()
    return place(doc, gridLayout(ids, { columns: n, spacing: 100 }))
  },
  estimateSize(params) {
    const n = peek(params, PATH_N)
    return { vertices: n, edges: Math.max(0, n - 1) }
  },
}

/* ---- Cycle Cn ---------------------------------------------------- */

const CYCLE_N = param('n', 'vertices', 'int', 3, 500, 6, {
  description: 'Length of the cycle.',
})

const cycleGenerator: GeneratorDefinition = {
  id: 'cycle',
  name: 'Cycle Cn',
  shortName: 'Cn',
  category: 'classic',
  description:
    'A closed ring on n vertices with n edges; it is 2-regular, and bipartite exactly when n is even.',
  params: [CYCLE_N],
  generate(params, options) {
    const n = readParam(params, CYCLE_N, 'Cn', { min: 'Cn needs at least 3 vertices.' })
    const b = builderFor(options)
    const ids = addLabelled(b, n)
    for (let i = 0; i < n; i++) {
      b.addEdge(ids[i], ids[(i + 1) % n], unitWeight(options))
    }
    const doc = b.build()
    return place(doc, circleLayout(ids))
  },
  estimateSize(params) {
    const n = peek(params, CYCLE_N)
    return { vertices: n, edges: n }
  },
}

/* ---- Complete Kn ------------------------------------------------- */

const COMPLETE_N = param('n', 'vertices', 'int', 1, 200, 5, {
  description: 'Number of mutually adjacent vertices.',
})

const completeGenerator: GeneratorDefinition = {
  id: 'complete',
  name: 'Complete graph Kn',
  shortName: 'Kn',
  category: 'classic',
  description:
    'Every pair of the n vertices is joined, giving n(n − 1)/2 edges and a graph that is (n − 1)-regular.',
  params: [COMPLETE_N],
  generate(params, options) {
    const n = readParam(params, COMPLETE_N, 'Kn', { min: 'Kn needs at least 1 vertex.' })
    const b = builderFor(options)
    const ids = addLabelled(b, n)
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) b.addEdge(ids[i], ids[j], unitWeight(options))
    }
    const doc = b.build()
    return place(doc, circleLayout(ids))
  },
  estimateSize(params) {
    const n = peek(params, COMPLETE_N)
    return { vertices: n, edges: (n * (n - 1)) / 2 }
  },
}

/* ---- Complete bipartite Km,n ------------------------------------- */

const BIPARTITE_M = param('m', 'left vertices', 'int', 1, 100, 3, {
  description: 'Size of the left part.',
})
const BIPARTITE_N = param('n', 'right vertices', 'int', 1, 100, 3, {
  description: 'Size of the right part.',
})

const completeBipartiteGenerator: GeneratorDefinition = {
  id: 'completeBipartite',
  name: 'Complete bipartite graph Km,n',
  shortName: 'Km,n',
  category: 'classic',
  description:
    'Two independent parts of sizes m and n with every cross pair joined: m + n vertices, m·n edges, and no odd cycle.',
  params: [BIPARTITE_M, BIPARTITE_N],
  generate(params, options) {
    const m = readParam(params, BIPARTITE_M, 'Km,n', {
      min: 'Km,n needs at least 1 vertex on the left.',
    })
    const n = readParam(params, BIPARTITE_N, 'Km,n', {
      min: 'Km,n needs at least 1 vertex on the right.',
    })
    const b = builderFor(options)
    const left = addLabelled(b, m)
    const right = addLabelled(b, n, m)
    for (const a of left) {
      for (const c of right) b.addEdge(a, c, unitWeight(options))
    }
    const doc = b.build()
    const span = Math.max(m, n)
    return place(
      doc,
      bipartiteLayout([left, right], {
        spacing: 90,
        radius: Math.max(260, span * 26),
      }),
    )
  },
  estimateSize(params) {
    const m = peek(params, BIPARTITE_M)
    const n = peek(params, BIPARTITE_N)
    return { vertices: m + n, edges: m * n }
  },
}

/* ---- Star Sn ----------------------------------------------------- */

const STAR_N = param('n', 'leaves', 'int', 1, 300, 6, {
  description: 'Number of leaves hanging off the centre.',
})

const starGenerator: GeneratorDefinition = {
  id: 'star',
  name: 'Star Sn',
  shortName: 'Sn',
  category: 'classic',
  description:
    'Convention: Sn has n leaves plus one centre, so n + 1 vertices and n edges — the tree K1,n of diameter 2.',
  params: [STAR_N],
  generate(params, options) {
    const n = readParam(params, STAR_N, 'Sn', { min: 'Sn needs at least 1 leaf.' })
    const b = builderFor(options)
    const hub = b.addVertex(labelForIndex(0))
    const leaves = addLabelled(b, n, 1)
    for (const leaf of leaves) b.addEdge(hub, leaf, unitWeight(options))
    const doc = b.build()
    const positions = circleLayout(leaves, { spacing: 90 })
    positions[hub] = { x: 0, y: 0 }
    return place(doc, positions)
  },
  estimateSize(params) {
    const n = peek(params, STAR_N)
    return { vertices: n + 1, edges: n }
  },
}

/* ---- Wheel Wn ---------------------------------------------------- */

const WHEEL_N = param('n', 'rim vertices', 'int', 3, 300, 6, {
  description: 'Length of the rim cycle.',
})

const wheelGenerator: GeneratorDefinition = {
  id: 'wheel',
  name: 'Wheel Wn',
  shortName: 'Wn',
  category: 'classic',
  description:
    'Convention: Wn is the rim cycle Cn plus one hub joined to all of it, so n + 1 vertices and 2n edges.',
  params: [WHEEL_N],
  generate(params, options) {
    const n = readParam(params, WHEEL_N, 'Wn', {
      min: 'Wn needs a rim of at least 3 vertices.',
    })
    const b = builderFor(options)
    const hub = b.addVertex(labelForIndex(0))
    const rim = addLabelled(b, n, 1)
    for (let i = 0; i < n; i++) b.addEdge(rim[i], rim[(i + 1) % n], unitWeight(options))
    for (const v of rim) b.addEdge(hub, v, unitWeight(options))
    const doc = b.build()
    const positions = circleLayout(rim, { spacing: 90 })
    positions[hub] = { x: 0, y: 0 }
    return place(doc, positions)
  },
  estimateSize(params) {
    const n = peek(params, WHEEL_N)
    return { vertices: n + 1, edges: 2 * n }
  },
}

/* ---- Grid / lattice ---------------------------------------------- */

const GRID_ROWS = param('rows', 'rows', 'int', 1, 50, 3, { description: 'Number of rows.' })
const GRID_COLS = param('cols', 'columns', 'int', 1, 50, 4, {
  description: 'Number of columns.',
})

const gridGenerator: GeneratorDefinition = {
  id: 'grid',
  name: 'Grid Pr × Pc',
  shortName: 'grid',
  category: 'classic',
  description:
    'The rook-free lattice Pr □ Pc: r·c vertices joined to their orthogonal neighbours, r(c − 1) + c(r − 1) edges, always bipartite.',
  params: [GRID_ROWS, GRID_COLS],
  generate(params, options) {
    const rows = readParam(params, GRID_ROWS, 'The grid', {
      min: 'A grid needs at least 1 row.',
    })
    const cols = readParam(params, GRID_COLS, 'The grid', {
      min: 'A grid needs at least 1 column.',
    })
    const b = builderFor(options)
    const ids = addLabelled(b, rows * cols)
    const at = (r: number, c: number): VertexId => ids[r * cols + c]
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (c + 1 < cols) b.addEdge(at(r, c), at(r, c + 1), unitWeight(options))
        if (r + 1 < rows) b.addEdge(at(r, c), at(r + 1, c), unitWeight(options))
      }
    }
    const doc = b.build()
    return place(doc, gridLayout(ids, { columns: cols, spacing: 110 }))
  },
  estimateSize(params) {
    const rows = peek(params, GRID_ROWS)
    const cols = peek(params, GRID_COLS)
    return { vertices: rows * cols, edges: rows * (cols - 1) + cols * (rows - 1) }
  },
}

/* ---- Hypercube Qn ------------------------------------------------ */

const HYPERCUBE_N = param('n', 'dimension', 'int', 0, 7, 3, {
  description: 'Dimension; the graph has 2^n vertices.',
})

/**
 * Binary-reflected projection: Q(k+1) is two copies of Q(k) offset by a vector
 * chosen per dimension. The first three offsets reproduce the familiar square
 * and "cube drawn in perspective" pictures; from the fourth dimension on the
 * copies are pushed clear of the current bounding box, alternating horizontal
 * and vertical, which keeps every vertex at a distinct point.
 */
const hypercubePositions = (
  n: number,
  unit: number,
): Array<{ x: number; y: number }> => {
  let pts: Array<{ x: number; y: number }> = [{ x: 0, y: 0 }]
  for (let k = 0; k < n; k++) {
    let dx = 0
    let dy = 0
    if (k === 0) {
      dx = unit
    } else if (k === 1) {
      dy = unit
    } else if (k === 2) {
      dx = unit * 0.45
      dy = unit * 0.45
    } else {
      let minX = Infinity
      let maxX = -Infinity
      let minY = Infinity
      let maxY = -Infinity
      for (const p of pts) {
        if (p.x < minX) minX = p.x
        if (p.x > maxX) maxX = p.x
        if (p.y < minY) minY = p.y
        if (p.y > maxY) maxY = p.y
      }
      const gap = unit * 0.8
      if (k % 2 === 1) dx = maxX - minX + gap
      else dy = maxY - minY + gap
    }
    // Index i keeps its coordinates; index i + 2^k is the shifted copy, so an
    // array position is exactly the integer whose bits label the vertex.
    pts = pts.concat(pts.map((p) => ({ x: p.x + dx, y: p.y + dy })))
  }
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (const p of pts) {
    if (p.x < minX) minX = p.x
    if (p.x > maxX) maxX = p.x
    if (p.y < minY) minY = p.y
    if (p.y > maxY) maxY = p.y
  }
  const cx = (minX + maxX) / 2
  const cy = (minY + maxY) / 2
  return pts.map((p) => ({ x: p.x - cx, y: p.y - cy }))
}

const hypercubeGenerator: GeneratorDefinition = {
  id: 'hypercube',
  name: 'Hypercube Qn',
  shortName: 'Qn',
  category: 'classic',
  description:
    'Vertices are the 2^n binary strings of length n, joined when they differ in one bit: n-regular with n·2^(n−1) edges, bipartite by parity of weight.',
  params: [HYPERCUBE_N],
  generate(params, options) {
    const n = readParam(params, HYPERCUBE_N, 'Qn', {
      min: 'Qn needs a dimension of 0 or more.',
      max: 'Qn is capped at dimension 7 (128 vertices).',
    })
    const count = 1 << n
    const b = builderFor(options)
    const ids = addLabelled(b, count)
    for (let i = 0; i < count; i++) {
      for (let k = 0; k < n; k++) {
        const j = i ^ (1 << k)
        if (j > i) b.addEdge(ids[i], ids[j], unitWeight(options))
      }
    }
    const doc = b.build()
    const pts = hypercubePositions(n, 110)
    const positions: Positions = {}
    ids.forEach((id, i) => {
      positions[id] = pts[i]
    })
    return place(doc, positions)
  },
  estimateSize(params) {
    const n = Math.min(24, peek(params, HYPERCUBE_N))
    const count = 2 ** n
    return { vertices: count, edges: (n * count) / 2 }
  },
}

/* ---- Petersen ---------------------------------------------------- */

const petersenGenerator: GeneratorDefinition = {
  id: 'petersen',
  name: 'Petersen graph',
  shortName: 'Petersen',
  category: 'classic',
  description:
    'The 3-regular graph on 10 vertices and 15 edges with girth 5: an outer pentagon, an inner pentagram, and five spokes.',
  params: [],
  generate(_params, options) {
    const b = builderFor(options)
    const outer = addLabelled(b, 5)
    const inner = addLabelled(b, 5, 5)
    for (let i = 0; i < 5; i++) {
      b.addEdge(outer[i], outer[(i + 1) % 5], unitWeight(options))
      b.addEdge(outer[i], inner[i], unitWeight(options))
      b.addEdge(inner[i], inner[(i + 2) % 5], unitWeight(options))
    }
    const doc = b.build()
    const positions: Positions = {
      ...circleLayout(outer, { radius: 210 }),
      ...circleLayout(inner, { radius: 95 }),
    }
    return place(doc, positions)
  },
  estimateSize: () => ({ vertices: 10, edges: 15 }),
}

/* ---- Complete r-ary tree ----------------------------------------- */

const TREE_BRANCHING = param('r', 'branching factor', 'int', 1, 6, 2, {
  description: 'Children per internal vertex.',
})
const TREE_DEPTH = param('h', 'depth', 'int', 0, 6, 3, {
  description: 'Number of levels below the root.',
})

const completeTreeSize = (r: number, h: number): number =>
  r === 1 ? h + 1 : Math.round((r ** (h + 1) - 1) / (r - 1))

const completeTreeGenerator: GeneratorDefinition = {
  id: 'completeTree',
  name: 'Complete r-ary tree',
  shortName: 'tree(r,h)',
  category: 'classic',
  description:
    'Every internal vertex has exactly r children down to depth h: (r^(h+1) − 1)/(r − 1) vertices and one fewer edge, acyclic and connected.',
  params: [TREE_BRANCHING, TREE_DEPTH],
  generate(params, options) {
    const r = readParam(params, TREE_BRANCHING, 'The tree', {
      min: 'A tree needs a branching factor of at least 1.',
    })
    const h = readParam(params, TREE_DEPTH, 'The tree', {
      min: 'A tree needs a depth of 0 or more.',
    })
    const total = completeTreeSize(r, h)
    const b = builderFor(options)
    const ids = addLabelled(b, total)
    // Breadth-first numbering: vertex `cursor` receives the next r children.
    let next = 1
    for (let cursor = 0; cursor < total && next < total; cursor++) {
      for (let c = 0; c < r && next < total; c++) {
        b.addEdge(ids[cursor], ids[next], unitWeight(options))
        next += 1
      }
    }
    const doc = b.build()
    return place(
      doc,
      breadthFirstLayout(new Graph(doc), { roots: [ids[0]], spacing: 110 }),
    )
  },
  estimateSize(params) {
    const r = peek(params, TREE_BRANCHING)
    const h = peek(params, TREE_DEPTH)
    const total = completeTreeSize(r, h)
    return { vertices: total, edges: Math.max(0, total - 1) }
  },
}

/* ================================================================== */
/* Random families                                                     */
/* ================================================================== */

/* ---- Erdos-Renyi G(n, p) ----------------------------------------- */

const ER_N = param('n', 'vertices', 'int', 1, 200, 12, {
  description: 'Number of vertices.',
})
const ER_P = param('p', 'edge probability', 'float', 0, 1, 0.25, {
  step: 0.01,
  description: 'Each of the n(n − 1)/2 pairs is joined independently with this probability.',
})

const erdosRenyiGenerator: GeneratorDefinition = {
  id: 'erdosRenyi',
  name: 'Random graph G(n, p)',
  shortName: 'G(n,p)',
  category: 'random',
  description:
    'The Erdős–Rényi–Gilbert model: each of the n(n − 1)/2 pairs becomes an edge independently with probability p, so the expected size is p·n(n − 1)/2.',
  params: [ER_N, ER_P],
  generate(params, options) {
    const n = readParam(params, ER_N, 'G(n, p)', {
      min: 'G(n, p) needs at least 1 vertex.',
    })
    const p = readParam(params, ER_P, 'G(n, p)', {
      min: 'The edge probability p cannot be negative.',
      max: 'The edge probability p cannot exceed 1.',
    })
    const rand = rngFor(options)
    const b = builderFor(options)
    const ids = addLabelled(b, n)
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        // Always draw, so the stream stays aligned whatever p happens to be.
        if (rand() < p) b.addEdge(ids[i], ids[j], unitWeight(options))
      }
    }
    const doc = b.build()
    return place(doc, organicLayout(doc, options?.seed ?? DEFAULT_SEED))
  },
  estimateSize(params) {
    const n = peek(params, ER_N)
    const p = Math.min(1, Math.max(0, peek(params, ER_P)))
    return { vertices: n, edges: Math.round((p * n * (n - 1)) / 2) }
  },
}

/* ---- Uniform random tree (Prüfer) -------------------------------- */

const TREE_N = param('n', 'vertices', 'int', 1, 200, 10, {
  description: 'Number of vertices in the tree.',
})

/**
 * Decodes a Prüfer sequence back into the edge list of a labelled tree.
 * Because Prüfer sequences and labelled trees on n vertices are in bijection,
 * a uniform sequence gives a *uniform* tree — which is not at all the same as
 * the "attach each new vertex to a random earlier one" shortcut.
 */
const decodePrufer = (seq: readonly number[], n: number): Array<[number, number]> => {
  const degree = new Array<number>(n).fill(1)
  for (const v of seq) degree[v] += 1

  let ptr = 0
  while (ptr < n && degree[ptr] !== 1) ptr += 1
  let leaf = ptr

  const edges: Array<[number, number]> = []
  for (const v of seq) {
    edges.push([leaf, v])
    degree[v] -= 1
    if (degree[v] === 1 && v < ptr) {
      leaf = v
    } else {
      ptr += 1
      while (ptr < n && degree[ptr] !== 1) ptr += 1
      leaf = ptr
    }
  }
  edges.push([leaf, n - 1])
  return edges
}

const randomTreeGenerator: GeneratorDefinition = {
  id: 'randomTree',
  name: 'Random tree',
  shortName: 'tree(n)',
  category: 'random',
  description:
    'A tree drawn uniformly from all n^(n−2) labelled trees on n vertices by sampling a random Prüfer sequence: n vertices, n − 1 edges, connected and acyclic.',
  params: [TREE_N],
  generate(params, options) {
    const n = readParam(params, TREE_N, 'A random tree', {
      min: 'A random tree needs at least 1 vertex.',
    })
    const rand = rngFor(options)
    const b = builderFor(options)
    const ids = addLabelled(b, n)

    if (n >= 2) {
      const seq: number[] = []
      for (let i = 0; i < n - 2; i++) seq.push(randomBelow(rand, n))
      for (const [a, c] of decodePrufer(seq, n)) {
        b.addEdge(ids[a], ids[c], unitWeight(options))
      }
    }
    const doc = b.build()
    return place(doc, organicLayout(doc, options?.seed ?? DEFAULT_SEED))
  },
  estimateSize(params) {
    const n = peek(params, TREE_N)
    return { vertices: n, edges: Math.max(0, n - 1) }
  },
}

/* ---- Random d-regular graph -------------------------------------- */

const REGULAR_N = param('n', 'vertices', 'int', 1, 200, 10, {
  description: 'Number of vertices.',
})
const REGULAR_D = param('d', 'degree', 'int', 0, 20, 3, {
  description: 'Degree of every vertex; n · d must be even.',
})

const PAIRING_ATTEMPTS = 80

/**
 * One run of the pairing (configuration) model with rejection: d stubs per
 * vertex, repeatedly join two random free stubs, and abandon the attempt as
 * soon as the remaining stubs can only make a loop or a parallel edge.
 * Returns null so the caller can simply try again with fresh randomness.
 */
const pairingAttempt = (
  n: number,
  d: number,
  rand: Rng,
): Array<[number, number]> | null => {
  const stubs: number[] = []
  for (let v = 0; v < n; v++) for (let k = 0; k < d; k++) stubs.push(v)

  const used = new Set<number>()
  const edges: Array<[number, number]> = []
  const budget = stubs.length * 8 + 64
  let spent = 0

  while (stubs.length >= 2) {
    if (spent > budget) return null
    spent += 1
    const i = randomBelow(rand, stubs.length)
    let j = randomBelow(rand, stubs.length - 1)
    if (j >= i) j += 1
    const u = stubs[i]
    const v = stubs[j]
    if (u === v) continue
    const key = u < v ? u * n + v : v * n + u
    if (used.has(key)) continue

    used.add(key)
    edges.push([u, v])
    // Swap-pop both stubs, larger index first so the other stays valid.
    const hi = Math.max(i, j)
    const lo = Math.min(i, j)
    stubs[hi] = stubs[stubs.length - 1]
    stubs.pop()
    stubs[lo] = stubs[stubs.length - 1]
    stubs.pop()
  }
  return edges
}

const randomRegularGenerator: GeneratorDefinition = {
  id: 'randomRegular',
  name: 'Random d-regular graph',
  shortName: 'random(n,d)',
  category: 'random',
  description:
    'A simple graph on n vertices in which every vertex has degree exactly d, sampled with the pairing (configuration) model; it exists only when d < n and n · d is even.',
  params: [REGULAR_N, REGULAR_D],
  generate(params, options) {
    const n = readParam(params, REGULAR_N, 'A random regular graph', {
      min: 'A random regular graph needs at least 1 vertex.',
    })
    const d = readParam(params, REGULAR_D, 'A random regular graph', {
      min: 'The degree d cannot be negative.',
    })
    if (d > n - 1) {
      throw new GeneratorError(
        `A simple ${d}-regular graph needs more than ${d} vertices, but n = ${n}.`,
      )
    }
    if ((n * d) % 2 !== 0) {
      throw new GeneratorError(
        `No ${d}-regular graph exists on ${n} vertices: n × d = ${n * d} is odd, and every graph has an even degree sum.`,
      )
    }

    const rand = rngFor(options)
    const b = builderFor(options)
    const ids = addLabelled(b, n)

    if (d > 0) {
      let edges: Array<[number, number]> | null = null
      for (let attempt = 0; attempt < PAIRING_ATTEMPTS && edges === null; attempt++) {
        edges = pairingAttempt(n, d, rand)
      }
      if (edges === null) {
        throw new GeneratorError(
          `Could not build a simple ${d}-regular graph on ${n} vertices after ${PAIRING_ATTEMPTS} attempts. Try a different seed, a smaller degree, or more vertices.`,
        )
      }
      for (const [a, c] of edges) b.addEdge(ids[a], ids[c], unitWeight(options))
    }

    const doc = b.build()
    return place(doc, circleLayout(ids))
  },
  estimateSize(params) {
    const n = peek(params, REGULAR_N)
    const d = peek(params, REGULAR_D)
    return { vertices: n, edges: Math.floor((n * d) / 2) }
  },
}

/* ================================================================== */
/* Registry                                                            */
/* ================================================================== */

export const GENERATORS: GeneratorDefinition[] = [
  pathGenerator,
  cycleGenerator,
  completeGenerator,
  completeBipartiteGenerator,
  starGenerator,
  wheelGenerator,
  gridGenerator,
  hypercubeGenerator,
  petersenGenerator,
  completeTreeGenerator,
  erdosRenyiGenerator,
  randomTreeGenerator,
  randomRegularGenerator,
]

const BY_ID = new Map(GENERATORS.map((g) => [g.id, g] as const))

export const generatorById = (id: string): GeneratorDefinition | undefined =>
  BY_ID.get(id)

export const generate = (
  id: string,
  params: Record<string, number>,
  options?: GenerateOptions,
): GraphDocument => {
  const def = BY_ID.get(id)
  if (!def) throw new GeneratorError(`There is no generator called "${id}".`)
  const weighting = options?.weights
  if (!weighting) return def.generate(params, options)
  // Checked before building, so a bad range fails fast and in plain words.
  const problem = weightingProblem(weighting)
  if (problem) throw new GeneratorError(problem)
  const doc = def.generate(params, { ...options, weighted: true })
  return weighEdges(doc, weighting, seedOf(options))
}

/** Convenience for a UI that wants to warn before building something huge. */
export const estimateSize = (
  id: string,
  params: Record<string, number>,
): { vertices: number; edges: number } | undefined => BY_ID.get(id)?.estimateSize?.(params)

/** The defaults a form should start from. */
export const defaultParams = (def: GeneratorDefinition): Record<string, number> => {
  const out: Record<string, number> = {}
  for (const p of def.params) out[p.key] = p.default
  return out
}
