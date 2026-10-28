import { forceLayout } from '../layout'
import { Graph } from './graph'
import { nextEdgeId, nextVertexId } from './ids'
import type { Edge, EdgeId, GraphDocument, Vertex, VertexId } from './types'

export interface BuildOptions {
  directed?: boolean
  weighted?: boolean
}

/**
 * Small helper used by generators, transformations and tests to assemble a
 * document without hand-rolling ids everywhere.
 */
export class GraphBuilder {
  private vertices: Vertex[] = []
  private edges: Edge[] = []
  private byLabel = new Map<string, VertexId>()
  readonly directed: boolean
  readonly weighted: boolean

  constructor(options: BuildOptions = {}) {
    this.directed = options.directed ?? false
    this.weighted = options.weighted ?? false
  }

  addVertex(label: string, x = 0, y = 0): VertexId {
    const existing = this.byLabel.get(label)
    if (existing) return existing
    const id = nextVertexId()
    this.vertices.push({ id, label, x, y })
    this.byLabel.set(label, id)
    return id
  }

  vertexId(label: string): VertexId | undefined {
    return this.byLabel.get(label)
  }

  addEdge(source: VertexId, target: VertexId, weight?: number): string {
    const id = nextEdgeId()
    const edge: Edge = { id, source, target }
    if (weight !== undefined) edge.weight = weight
    this.edges.push(edge)
    return id
  }

  addEdgeByLabel(a: string, b: string, weight?: number): string {
    return this.addEdge(this.addVertex(a), this.addVertex(b), weight)
  }

  position(id: VertexId, x: number, y: number): void {
    const v = this.vertices.find((candidate) => candidate.id === id)
    if (v) {
      v.x = x
      v.y = y
    }
  }

  build(): GraphDocument {
    return {
      vertices: this.vertices,
      edges: this.edges,
      directed: this.directed,
      weighted: this.weighted,
    }
  }
}

/**
 * Compact test/document constructor:
 * `docFromEdges(['A-B', 'B-C'])` or `docFromEdges(['A-B:4'], { weighted: true })`.
 * Isolated vertices can be listed as bare labels: `docFromEdges(['A-B', 'C'])`.
 */
export const docFromEdges = (
  spec: readonly string[],
  options: BuildOptions = {},
): GraphDocument => {
  const b = new GraphBuilder(options)
  for (const raw of spec) {
    const [pair, weightText] = raw.split(':')
    const parts = pair!.split(/->|-/)
    if (parts.length === 1) {
      b.addVertex(parts[0]!.trim())
      continue
    }
    const weight = weightText === undefined ? undefined : Number(weightText)
    b.addEdgeByLabel(parts[0]!.trim(), parts[1]!.trim(), weight)
  }
  return b.build()
}

/* -------------------------------------------------------------------------- */
/* Typed edge lists                                                           */
/* -------------------------------------------------------------------------- */

/** One edge as somebody typed it, its endpoints named by label. */
export interface TypedEdge {
  source: string
  target: string
  weight?: number
}

export interface ParsedEdgeList {
  edges: TypedEdge[]
  /** Every label mentioned, in order of first appearance, bare ones included. */
  labels: string[]
  /** True when any connector was an arrow: `->`, `-->` or `→`. */
  arrows: boolean
}

type Token =
  | { kind: 'label'; text: string }
  | { kind: 'connector'; arrow: boolean }
  | { kind: 'weight'; value: number }
  | { kind: 'break' }

/** Letters in any script, digits, `_` and primes, so `v1`, `x_2` and `A'` all work. */
const LABEL_CHAR = /[\p{L}\p{M}\p{N}_'′]/u
const WEIGHT_TEXT = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/i

const tokenize = (input: string): Token[] | null => {
  const tokens: Token[] = []
  let i = 0
  while (i < input.length) {
    const char = input[i]!
    if (char === ',' || char === ';' || char === '\n') {
      tokens.push({ kind: 'break' })
      i++
    } else if (/\s/.test(char)) {
      i++
    } else if (char === '-') {
      // `-`, `--` and longer runs are one connector; a `>` makes it an arrow.
      while (input[i] === '-') i++
      const arrow = input[i] === '>'
      if (arrow) i++
      tokens.push({ kind: 'connector', arrow })
    } else if (char === '–' || char === '—' || char === '→') {
      tokens.push({ kind: 'connector', arrow: char === '→' })
      i++
    } else if (char === ':') {
      i++
      while (input[i] === ' ' || input[i] === '\t') i++
      const match = WEIGHT_TEXT.exec(input.slice(i))
      if (!match) return null
      const value = Number(match[0])
      i += match[0].length
      // `A-B:4x` is a typo, not a weight followed by a vertex called "x".
      const next = input[i]
      if (!Number.isFinite(value) || (next !== undefined && !/[\s,;]/.test(next))) return null
      tokens.push({ kind: 'weight', value })
    } else if (LABEL_CHAR.test(char)) {
      let end = i
      while (end < input.length && LABEL_CHAR.test(input[end]!)) end++
      tokens.push({ kind: 'label', text: input.slice(i, end) })
      i = end
    } else {
      return null
    }
  }
  return tokens
}

/**
 * Parses an edge list as someone would type it into the quick box:
 *
 * - `A-B, B-C, C-A` or `A-B B-C` — edges, separated by commas, semicolons,
 *   new lines or plain spaces. Spaces around a connector are fine: `A - B`.
 * - `a-b-c` or `a->b->c` — a chain, one edge per connector, so a path.
 * - `-`, `--`, `–` and `—` join two vertices; `->`, `-->` and `→` are arrows.
 *   Whether an arrow makes the graph directed is the planner's decision, not
 *   the parser's (see {@link planEdgeList}).
 * - `A-B:4`, `A-B: -2.5` — a weight. After a chain, `a-b-c:2`, it applies to
 *   every edge of the chain.
 * - `A-B, C` — a bare label alongside at least one edge adds an isolated vertex.
 *
 * Labels are runs of letters, digits, `_` and primes. Like
 * `parseGraphCommand`, parsing is total: anything else — no edge at all, a
 * dangling connector, a weight that is not a number, a stray symbol — comes
 * back as `null`, because the caller is typing.
 */
export const parseEdgeList = (input: string): ParsedEdgeList | null => {
  if (typeof input !== 'string') return null
  const tokens = tokenize(input)
  if (!tokens) return null

  const chains: Array<{ labels: string[]; weight?: number }> = []
  let chain: { labels: string[]; weight?: number } | null = null
  let awaitingLabel = false
  let arrows = false

  for (const token of tokens) {
    switch (token.kind) {
      case 'label':
        if (chain && awaitingLabel) chain.labels.push(token.text)
        else {
          // A label straight after another (or after a weight) starts the
          // next edge: that is what makes `A-B B-C` two edges.
          chain = { labels: [token.text] }
          chains.push(chain)
        }
        awaitingLabel = false
        break
      case 'connector':
        if (!chain || awaitingLabel || chain.weight !== undefined) return null
        arrows ||= token.arrow
        awaitingLabel = true
        break
      case 'weight':
        if (!chain || awaitingLabel || chain.labels.length < 2 || chain.weight !== undefined) {
          return null
        }
        chain.weight = token.value
        break
      case 'break':
        if (awaitingLabel) return null
        chain = null
        break
    }
  }
  if (awaitingLabel) return null

  const edges: TypedEdge[] = []
  const labels: string[] = []
  const seen = new Set<string>()
  for (const { labels: names, weight } of chains) {
    for (const name of names) {
      if (!seen.has(name)) {
        seen.add(name)
        labels.push(name)
      }
    }
    for (let k = 0; k + 1 < names.length; k++) {
      const edge: TypedEdge = { source: names[k]!, target: names[k + 1]! }
      if (weight !== undefined) edge.weight = weight
      edges.push(edge)
    }
  }
  return edges.length ? { edges, labels, arrows } : null
}

/**
 * One end of a planned edge: the id of a vertex already in the document, or
 * the index into {@link EdgeListPlan.newVertices} of one the plan creates.
 */
export type PlannedEndpoint = VertexId | number

export interface PlannedEdge {
  source: PlannedEndpoint
  target: PlannedEndpoint
  weight?: number
}

/** What adding a typed edge list to a document would do, before it is done. */
export interface EdgeListPlan {
  /** The document's mode once the edges are in. */
  directed: boolean
  weighted: boolean
  /** Labels of the vertices to create, in order of first mention. */
  newVertices: string[]
  newEdges: PlannedEdge[]
  /** Typed edges that were already there, or typed twice, as `A–B`; skipped. */
  duplicates: string[]
  /** Labels that matched more than one vertex up to case, so became new vertices. */
  ambiguous: string[]
  switchedToDirected: boolean
  enabledWeights: boolean
  /** Arrows were typed, but the graph already has edges and stays undirected. */
  arrowsIgnored: boolean
}

/**
 * Works out what a typed edge list means for a document, without changing it.
 *
 * **Labels.** A typed label names the first vertex with exactly that label.
 * Failing that, it names the vertex whose label matches ignoring case — but
 * only when exactly one label does, because `ab` cannot choose between `AB`
 * and `Ab`, and guessing would be worse than not. Anything unmatched (or
 * ambiguous) becomes a new vertex labelled as typed, and later labels resolve
 * against it the same way, so `x-y, X-z` creates one `x`.
 *
 * **Arrows.** In a directed graph, `-` and `->` both add an arc from left to
 * right. In an undirected graph with no edges yet, an arrow switches the
 * graph to directed: nothing already drawn changes meaning, and the arrow is
 * the only sign of what was wanted. Once an undirected graph has edges, an
 * arrow is read as a plain edge — switching then would silently turn every
 * existing edge into an arc — and `arrowsIgnored` says so.
 *
 * **Weights.** A typed weight turns weights on, giving the edges already there
 * weight 1, exactly as the Weighted switch does. In a weighted graph an edge
 * typed without one gets 1, as a drawn edge would.
 *
 * **Duplicates.** An edge the graph already has — either way round, unless
 * directed — or one typed twice is skipped and listed in `duplicates`. Its
 * weight is ignored rather than written over the existing one.
 */
export const planEdgeList = (doc: GraphDocument, parsed: ParsedEdgeList): EdgeListPlan => {
  const exact = new Map<string, PlannedEndpoint>()
  // Case-folded label → each distinct spelling of it → its first vertex.
  const folded = new Map<string, Map<string, PlannedEndpoint>>()
  const remember = (label: string, end: PlannedEndpoint) => {
    if (!exact.has(label)) exact.set(label, end)
    const key = label.toLowerCase()
    const spellings = folded.get(key) ?? new Map<string, PlannedEndpoint>()
    if (!spellings.has(label)) spellings.set(label, end)
    folded.set(key, spellings)
  }
  for (const v of doc.vertices) remember(v.label, v.id)

  const newVertices: string[] = []
  const ambiguous: string[] = []
  const endpointFor = new Map<string, PlannedEndpoint>()
  for (const label of parsed.labels) {
    let end = exact.get(label)
    if (end === undefined) {
      const spellings = [...(folded.get(label.toLowerCase())?.values() ?? [])]
      if (spellings.length === 1) end = spellings[0]!
      else {
        if (spellings.length > 1) ambiguous.push(label)
        end = newVertices.length
        newVertices.push(label)
        remember(label, end)
      }
    }
    endpointFor.set(label, end)
  }

  const switchedToDirected = parsed.arrows && !doc.directed && doc.edges.length === 0
  const directed = doc.directed || switchedToDirected

  const keyOf = (end: PlannedEndpoint) => (typeof end === 'number' ? `+${end}` : `=${end}`)
  const pairKey = (a: PlannedEndpoint, b: PlannedEndpoint) => {
    const x = keyOf(a)
    const y = keyOf(b)
    return directed || x <= y ? `${x}\u0000${y}` : `${y}\u0000${x}`
  }
  const labelOf = new Map(doc.vertices.map((v) => [v.id, v.label]))
  const nameOf = (end: PlannedEndpoint) =>
    typeof end === 'number' ? newVertices[end]! : (labelOf.get(end) ?? end)

  const present = new Set(doc.edges.map((e) => pairKey(e.source, e.target)))
  const newEdges: PlannedEdge[] = []
  const duplicates: string[] = []
  for (const typed of parsed.edges) {
    const source = endpointFor.get(typed.source)!
    const target = endpointFor.get(typed.target)!
    const key = pairKey(source, target)
    if (present.has(key)) {
      const name = `${nameOf(source)}${directed ? '→' : '–'}${nameOf(target)}`
      if (!duplicates.includes(name)) duplicates.push(name)
      continue
    }
    present.add(key)
    newEdges.push(
      typed.weight === undefined ? { source, target } : { source, target, weight: typed.weight },
    )
  }

  const enabledWeights = !doc.weighted && newEdges.some((e) => e.weight !== undefined)
  return {
    directed,
    weighted: doc.weighted || enabledWeights,
    newVertices,
    newEdges,
    duplicates,
    ambiguous,
    switchedToDirected,
    enabledWeights,
    arrowsIgnored: parsed.arrows && !directed,
  }
}

interface Point {
  x: number
  y: number
}

/** How far a new vertex sits from the neighbours it is placed beside. */
const NEIGHBOUR_GAP = 100
/** The closest two vertex centres may be placed; a vertex is drawn 34 units across. */
export const PLACEMENT_CLEARANCE = 60
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5))

const centroid = (points: readonly Point[]): Point => {
  let x = 0
  let y = 0
  for (const p of points) {
    x += p.x
    y += p.y
  }
  return { x: x / points.length, y: y / points.length }
}

const boundsOf = (points: readonly Point[]) => ({
  minX: Math.min(...points.map((p) => p.x)),
  minY: Math.min(...points.map((p) => p.y)),
  maxX: Math.max(...points.map((p) => p.x)),
  maxY: Math.max(...points.map((p) => p.y)),
})

const isClear = (p: Point, occupied: readonly Point[]) =>
  occupied.every((q) => Math.hypot(q.x - p.x, q.y - p.y) >= PLACEMENT_CLEARANCE)

/**
 * The first clear spot on widening rings around `base`, trying `angle` first
 * and then fanning out to either side of it, so several new neighbours of one
 * vertex spread into a fan instead of stacking up.
 */
const clearSpotNear = (base: Point, angle: number, occupied: readonly Point[]): Point => {
  for (let ring = 0; ring < 6; ring++) {
    const radius = NEIGHBOUR_GAP * (1 + ring * 0.6)
    for (let step = 0; step < 16; step++) {
      const turn = step === 0 ? 0 : (step % 2 === 1 ? 1 : -1) * Math.ceil(step / 2)
      const a = angle + (turn * Math.PI) / 8
      const p = { x: base.x + radius * Math.cos(a), y: base.y + radius * Math.sin(a) }
      if (isClear(p, occupied)) return p
    }
  }
  return { x: base.x + NEIGHBOUR_GAP * Math.cos(angle), y: base.y + NEIGHBOUR_GAP * Math.sin(angle) }
}

/**
 * Positions for a plan's new vertices.
 *
 * A vertex joined to the graph already there — directly, or through other new
 * vertices — is grown outward from it: beside its placed neighbours, on the
 * side facing away from the graph's centre, at the nearest spot that keeps
 * clear of every vertex. The rest form pieces of their own, so they are laid
 * out together as one small picture (the same seeded force layout as the
 * Layout menu) and set down at `anchor` — the middle of the view — or, when
 * that would land on the graph, just to its right.
 */
const placeNewVertices = (
  existing: readonly Vertex[],
  plan: EdgeListPlan,
  anchor?: Point,
): Point[] => {
  const count = plan.newVertices.length
  const placed: Array<Point | undefined> = Array.from({ length: count }, () => undefined)
  const occupied: Point[] = existing.map(({ x, y }) => ({ x, y }))
  const positionOf = new Map<VertexId, Point>(existing.map((v) => [v.id, { x: v.x, y: v.y }]))
  const where = (end: PlannedEndpoint) =>
    typeof end === 'number' ? placed[end] : positionOf.get(end)

  const neighbours: PlannedEndpoint[][] = Array.from({ length: count }, () => [])
  for (const { source, target } of plan.newEdges) {
    if (typeof source === 'number') neighbours[source]!.push(target)
    if (typeof target === 'number' && target !== source) neighbours[target]!.push(source)
  }

  // Breadth-first from the existing graph, so every vertex placed here has at
  // least one neighbour placed before it.
  const centre = existing.length ? centroid(occupied) : { x: 0, y: 0 }
  const queue = neighbours.flatMap((ends, i) =>
    ends.some((end) => typeof end === 'string') ? [i] : [],
  )
  const queued = new Set(queue)
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head]!
    const base = centroid(neighbours[i]!.map(where).filter((p): p is Point => p !== undefined))
    const dx = base.x - centre.x
    const dy = base.y - centre.y
    // At the very centre there is no "outward", so spread by the golden angle.
    const angle = Math.hypot(dx, dy) < 1 ? i * GOLDEN_ANGLE : Math.atan2(dy, dx)
    const spot = clearSpotNear(base, angle, occupied)
    placed[i] = spot
    occupied.push(spot)
    for (const end of neighbours[i]!) {
      if (typeof end === 'number' && !queued.has(end)) {
        queued.add(end)
        queue.push(end)
      }
    }
  }

  const loose = placed.flatMap((p, i) => (p ? [] : [i]))
  if (loose.length) {
    const looseSet = new Set(loose)
    const temp = (i: number) => `n${i}`
    const picture = forceLayout(
      new Graph({
        vertices: loose.map((i) => ({ id: temp(i), label: '', x: 0, y: 0 })),
        edges: plan.newEdges.flatMap((e, k) =>
          typeof e.source === 'number' && typeof e.target === 'number' && looseSet.has(e.source)
            ? [{ id: `t${k}`, source: temp(e.source), target: temp(e.target) }]
            : [],
        ),
        directed: false,
        weighted: false,
      }),
    )
    const points = loose.map((i) => picture[temp(i)]!)
    const box = boundsOf(points)
    const middle = { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 }
    const taken = occupied.length ? boundsOf(occupied) : null
    const target =
      anchor ??
      (taken
        ? { x: (taken.minX + taken.maxX) / 2, y: (taken.minY + taken.maxY) / 2 }
        : { x: 0, y: 0 })
    let shift = { x: target.x - middle.x, y: target.y - middle.y }
    if (
      taken &&
      box.minX + shift.x - PLACEMENT_CLEARANCE < taken.maxX &&
      box.maxX + shift.x + PLACEMENT_CLEARANCE > taken.minX &&
      box.minY + shift.y - PLACEMENT_CLEARANCE < taken.maxY &&
      box.maxY + shift.y + PLACEMENT_CLEARANCE > taken.minY
    ) {
      shift = {
        x: taken.maxX + NEIGHBOUR_GAP - box.minX,
        y: (taken.minY + taken.maxY) / 2 - middle.y,
      }
    }
    loose.forEach((i, k) => {
      placed[i] = { x: points[k]!.x + shift.x, y: points[k]!.y + shift.y }
    })
  }

  return placed.map((p) => ({ x: Math.round(p!.x), y: Math.round(p!.y) }))
}

export interface AppliedEdgeList {
  document: GraphDocument
  /** The vertices the plan created, in plan order. */
  vertexIds: VertexId[]
  edgeIds: EdgeId[]
}

/**
 * Builds the document a plan describes. The result is a new document and the
 * input is left untouched, so the store can commit it as a single undo step.
 * `anchor` is where a new piece not joined to the existing graph should go —
 * normally the middle of the view.
 */
export const applyEdgeListPlan = (
  doc: GraphDocument,
  plan: EdgeListPlan,
  options: { anchor?: Point } = {},
): AppliedEdgeList => {
  const positions = placeNewVertices(doc.vertices, plan, options.anchor)
  const vertexIds = plan.newVertices.map(() => nextVertexId())
  const idOf = (end: PlannedEndpoint) => (typeof end === 'number' ? vertexIds[end]! : end)

  const vertices: Vertex[] = [
    ...doc.vertices.map((v) => ({ ...v })),
    ...plan.newVertices.map((label, i) => ({ id: vertexIds[i]!, label, ...positions[i]! })),
  ]
  const edges: Edge[] = doc.edges.map((e) =>
    plan.enabledWeights ? { ...e, weight: e.weight ?? 1 } : { ...e },
  )
  const edgeIds: EdgeId[] = []
  for (const planned of plan.newEdges) {
    const edge: Edge = {
      id: nextEdgeId(),
      source: idOf(planned.source),
      target: idOf(planned.target),
    }
    if (plan.weighted) edge.weight = planned.weight ?? 1
    edges.push(edge)
    edgeIds.push(edge.id)
  }

  return {
    document: { vertices, edges, directed: plan.directed, weighted: plan.weighted },
    vertexIds,
    edgeIds,
  }
}
