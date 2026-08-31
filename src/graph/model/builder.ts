import { nextEdgeId, nextVertexId } from './ids'
import type { Edge, GraphDocument, Vertex, VertexId } from './types'

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
