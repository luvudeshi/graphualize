import type {
  Edge,
  EdgeId,
  GraphDocument,
  Incidence,
  Vertex,
  VertexId,
} from './types'

const DEFAULT_WEIGHT = 1

/**
 * An immutable, indexed view over a {@link GraphDocument}.
 *
 * Construction is O(V + E) and builds every adjacency structure the analysis
 * layer needs, so individual algorithms stay short. Instances are never
 * mutated; the store creates a new `Graph` whenever the document changes.
 */
export class Graph {
  readonly directed: boolean
  readonly weighted: boolean
  readonly vertices: readonly Vertex[]
  readonly edges: readonly Edge[]

  private readonly vertexById: Map<VertexId, Vertex>
  private readonly edgeById: Map<EdgeId, Edge>
  /** Undirected adjacency (both endpoints), used for most structural work. */
  private readonly adj: Map<VertexId, Incidence[]>
  private readonly out: Map<VertexId, Incidence[]>
  private readonly inc: Map<VertexId, Incidence[]>
  private readonly incident: Map<VertexId, EdgeId[]>
  private readonly degreeMap: Map<VertexId, number>
  private readonly outDegreeMap: Map<VertexId, number>
  private readonly inDegreeMap: Map<VertexId, number>
  private readonly indexById: Map<VertexId, number>
  private readonly pairKeys: Map<string, EdgeId[]>

  private structureKeyCache: string | null = null
  private displayKeyCache: string | null = null

  constructor(doc: GraphDocument) {
    this.directed = doc.directed
    this.weighted = doc.weighted
    this.vertices = doc.vertices
    this.vertexById = new Map()
    this.edgeById = new Map()
    this.adj = new Map()
    this.out = new Map()
    this.inc = new Map()
    this.incident = new Map()
    this.degreeMap = new Map()
    this.outDegreeMap = new Map()
    this.inDegreeMap = new Map()
    this.indexById = new Map()
    this.pairKeys = new Map()

    doc.vertices.forEach((v, i) => {
      this.vertexById.set(v.id, v)
      this.indexById.set(v.id, i)
      this.adj.set(v.id, [])
      this.out.set(v.id, [])
      this.inc.set(v.id, [])
      this.incident.set(v.id, [])
      this.degreeMap.set(v.id, 0)
      this.outDegreeMap.set(v.id, 0)
      this.inDegreeMap.set(v.id, 0)
    })

    // Edges referencing missing vertices are dropped rather than throwing:
    // imports and restored undo states should degrade gracefully.
    const validEdges: Edge[] = []
    for (const e of doc.edges) {
      if (!this.vertexById.has(e.source) || !this.vertexById.has(e.target)) continue
      validEdges.push(e)
      this.edgeById.set(e.id, e)
      const w = e.weight ?? DEFAULT_WEIGHT

      this.incident.get(e.source)!.push(e.id)
      if (e.target !== e.source) this.incident.get(e.target)!.push(e.id)

      this.adj.get(e.source)!.push({ to: e.target, edgeId: e.id, weight: w, forward: true })
      this.adj.get(e.target)!.push({ to: e.source, edgeId: e.id, weight: w, forward: false })

      this.out.get(e.source)!.push({ to: e.target, edgeId: e.id, weight: w, forward: true })
      this.inc.get(e.target)!.push({ to: e.source, edgeId: e.id, weight: w, forward: false })

      // A self-loop adds 2 to the undirected degree, and 1 to both in and out.
      this.degreeMap.set(e.source, this.degreeMap.get(e.source)! + 1)
      this.degreeMap.set(e.target, this.degreeMap.get(e.target)! + 1)
      this.outDegreeMap.set(e.source, this.outDegreeMap.get(e.source)! + 1)
      this.inDegreeMap.set(e.target, this.inDegreeMap.get(e.target)! + 1)

      const key = this.pairKey(e.source, e.target)
      const bucket = this.pairKeys.get(key)
      if (bucket) bucket.push(e.id)
      else this.pairKeys.set(key, [e.id])
    }
    this.edges = validEdges
  }

  /* -------------------------------------------------------------- */
  /* Basics                                                          */
  /* -------------------------------------------------------------- */

  get order(): number {
    return this.vertices.length
  }

  get size(): number {
    return this.edges.length
  }

  get vertexIds(): VertexId[] {
    return this.vertices.map((v) => v.id)
  }

  get edgeIds(): EdgeId[] {
    return this.edges.map((e) => e.id)
  }

  hasVertex(id: VertexId): boolean {
    return this.vertexById.has(id)
  }

  vertex(id: VertexId): Vertex | undefined {
    return this.vertexById.get(id)
  }

  edge(id: EdgeId): Edge | undefined {
    return this.edgeById.get(id)
  }

  /** Stable 0-based position of a vertex, used for matrix rows and columns. */
  index(id: VertexId): number {
    return this.indexById.get(id) ?? -1
  }

  label(id: VertexId): string {
    return this.vertexById.get(id)?.label ?? id
  }

  labels(ids: readonly VertexId[]): string[] {
    return ids.map((id) => this.label(id))
  }

  weight(id: EdgeId): number {
    const e = this.edgeById.get(id)
    if (!e) return DEFAULT_WEIGHT
    return this.weighted ? (e.weight ?? DEFAULT_WEIGHT) : DEFAULT_WEIGHT
  }

  /* -------------------------------------------------------------- */
  /* Adjacency                                                       */
  /* -------------------------------------------------------------- */

  /** Neighbours ignoring edge direction. */
  neighbors(id: VertexId): Incidence[] {
    return this.adj.get(id) ?? []
  }

  /** Neighbours reachable in one step, honouring direction when directed. */
  successors(id: VertexId): Incidence[] {
    return this.directed ? (this.out.get(id) ?? []) : this.neighbors(id)
  }

  /** Neighbours that reach this vertex in one step. */
  predecessors(id: VertexId): Incidence[] {
    return this.directed ? (this.inc.get(id) ?? []) : this.neighbors(id)
  }

  incidentEdges(id: VertexId): EdgeId[] {
    return this.incident.get(id) ?? []
  }

  /** Undirected degree; a self-loop counts twice. */
  degree(id: VertexId): number {
    return this.degreeMap.get(id) ?? 0
  }

  outDegree(id: VertexId): number {
    return this.outDegreeMap.get(id) ?? 0
  }

  inDegree(id: VertexId): number {
    return this.inDegreeMap.get(id) ?? 0
  }

  degreeSequence(): number[] {
    return this.vertices.map((v) => this.degree(v.id)).sort((a, b) => b - a)
  }

  outDegreeSequence(): number[] {
    return this.vertices.map((v) => this.outDegree(v.id)).sort((a, b) => b - a)
  }

  inDegreeSequence(): number[] {
    return this.vertices.map((v) => this.inDegree(v.id)).sort((a, b) => b - a)
  }

  /* -------------------------------------------------------------- */
  /* Edge lookup                                                     */
  /* -------------------------------------------------------------- */

  private pairKey(a: VertexId, b: VertexId): string {
    if (this.directed) return `${a} ${b}`
    return a <= b ? `${a} ${b}` : `${b} ${a}`
  }

  /** All edges joining a and b (respecting direction when directed). */
  edgesBetween(a: VertexId, b: VertexId): EdgeId[] {
    return this.pairKeys.get(this.pairKey(a, b)) ?? []
  }

  findEdge(a: VertexId, b: VertexId): EdgeId | undefined {
    return this.edgesBetween(a, b)[0]
  }

  hasEdge(a: VertexId, b: VertexId): boolean {
    return this.edgesBetween(a, b).length > 0
  }

  /** Edge ids for a walk given as a vertex sequence; skips missing links. */
  edgesAlong(path: readonly VertexId[]): EdgeId[] {
    const ids: EdgeId[] = []
    for (let i = 0; i + 1 < path.length; i++) {
      const id = this.findEdge(path[i]!, path[i + 1]!)
      if (id) ids.push(id)
    }
    return ids
  }

  selfLoops(): EdgeId[] {
    return this.edges.filter((e) => e.source === e.target).map((e) => e.id)
  }

  /** Groups of parallel edges with more than one member. */
  parallelEdgeGroups(): EdgeId[][] {
    const groups: EdgeId[][] = []
    for (const ids of this.pairKeys.values()) if (ids.length > 1) groups.push(ids)
    return groups
  }

  isSimple(): boolean {
    return this.selfLoops().length === 0 && this.parallelEdgeGroups().length === 0
  }

  /* -------------------------------------------------------------- */
  /* Identity                                                        */
  /* -------------------------------------------------------------- */

  /**
   * A key that changes exactly when the mathematics of the graph changes.
   * Vertex positions and labels are deliberately excluded, so dragging a
   * vertex never invalidates a cached analysis.
   */
  structureKey(): string {
    if (this.structureKeyCache !== null) return this.structureKeyCache
    const verts = this.vertices.map((v) => v.id).slice().sort()
    const idx = new Map(verts.map((id, i) => [id, i] as const))
    const edges = this.edges
      .map((e) => {
        const a = idx.get(e.source)!
        const b = idx.get(e.target)!
        const w = this.weighted ? (e.weight ?? DEFAULT_WEIGHT) : 1
        return this.directed || a <= b ? `${a}>${b}:${w}` : `${b}>${a}:${w}`
      })
      .sort()
    const mode = `${this.directed ? 'D' : 'U'}${this.weighted ? 'W' : ''}`
    // The vertex *ids* are part of the key, not just how many there are:
    // witnesses name ids, so two structurally identical graphs on different
    // vertices must not share a cache entry.
    this.structureKeyCache = `${mode}|${verts.join(',')}|${edges.join(',')}`
    return this.structureKeyCache
  }

  /**
   * The structure key plus the labels. Analyses that put labels into prose are
   * cached on this; anything purely numeric can use {@link structureKey}.
   * Positions are excluded from both, so dragging never invalidates anything.
   */
  displayKey(): string {
    if (this.displayKeyCache !== null) return this.displayKeyCache
    const labels = this.vertices.map((v) => `${v.id}=${v.label}`).join('\u0001')
    this.displayKeyCache = `${this.structureKey()}#${labels}`
    return this.displayKeyCache
  }

  toDocument(): GraphDocument {
    return {
      vertices: this.vertices.map((v) => ({ ...v })),
      edges: this.edges.map((e) => ({ ...e })),
      directed: this.directed,
      weighted: this.weighted,
    }
  }
}

export const emptyDocument = (): GraphDocument => ({
  vertices: [],
  edges: [],
  directed: false,
  weighted: false,
})

