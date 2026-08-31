import type { Graph } from '../graph/model/graph'
import type {
  EdgeId,
  GraphWitness,
  HighlightMode,
  HighlightRequest,
  VertexId,
} from '../graph/model/types'
import type { AlgorithmStep } from '../graph/algorithms/types'

const assign = <T extends string>(
  target: Record<T, HighlightMode>,
  ids: readonly T[],
  mode: HighlightMode,
) => {
  for (const id of ids) target[id] = mode
}

/**
 * The single place a mathematical witness becomes something the canvas can
 * draw. Components never build Cytoscape classes themselves.
 */
export const witnessToHighlight = (
  witness: GraphWitness,
  graph: Graph,
): HighlightRequest => {
  const vertices: Record<VertexId, HighlightMode> = {}
  const edges: Record<EdgeId, HighlightMode> = {}

  switch (witness.type) {
    case 'vertices':
      assign(vertices, witness.vertexIds, 'witness')
      return { vertices, edges, dimOthers: true, caption: witness.caption }
    case 'edges': {
      assign(edges, witness.edgeIds, 'witness')
      const touched = new Set<VertexId>()
      for (const id of witness.edgeIds) {
        const e = graph.edge(id)
        if (e) {
          touched.add(e.source)
          touched.add(e.target)
        }
      }
      assign(vertices, [...touched], 'witness')
      return { vertices, edges, dimOthers: true, caption: witness.caption }
    }
    case 'path':
      assign(vertices, witness.vertexIds, 'path')
      assign(edges, witness.edgeIds, 'path')
      return { vertices, edges, dimOthers: true, caption: witness.caption }
    case 'cycle':
      assign(vertices, witness.vertexIds, 'cycle')
      assign(edges, witness.edgeIds, 'cycle')
      return { vertices, edges, dimOthers: true, caption: witness.caption }
    case 'trail': {
      assign(vertices, witness.vertexIds, 'path')
      assign(edges, witness.edgeIds, 'path')
      const badges: Record<VertexId, string> = {}
      witness.vertexIds.forEach((id, i) => {
        badges[id] = badges[id] ? `${badges[id]},${i + 1}` : String(i + 1)
      })
      return { vertices, edges, badges, dimOthers: true, caption: witness.caption }
    }
    case 'matching': {
      assign(edges, witness.edgeIds, 'matching')
      const touched = new Set<VertexId>()
      for (const id of witness.edgeIds) {
        const e = graph.edge(id)
        if (e) {
          touched.add(e.source)
          touched.add(e.target)
        }
      }
      assign(vertices, [...touched], 'matching')
      return { vertices, edges, dimOthers: true, caption: witness.caption }
    }
    case 'tree': {
      assign(edges, witness.edgeIds, 'tree')
      const touched = new Set<VertexId>()
      for (const id of witness.edgeIds) {
        const e = graph.edge(id)
        if (e) {
          touched.add(e.source)
          touched.add(e.target)
        }
      }
      assign(vertices, [...touched], 'tree')
      return { vertices, edges, dimOthers: true, caption: witness.caption }
    }
    case 'partition': {
      const colors: Record<VertexId, number> = {}
      witness.groups.forEach((group, gi) => {
        for (const id of group) colors[id] = gi
      })
      // Edges inside a part are the interesting ones for a bipartition.
      for (const e of graph.edges) {
        const a = colors[e.source]
        const b = colors[e.target]
        if (a !== undefined && a === b) edges[e.id] = 'witness'
      }
      return {
        vertices,
        edges,
        colors,
        dimOthers: false,
        caption: witness.captions?.join(' | '),
      }
    }
    case 'coloring':
      return {
        vertices,
        edges,
        colors: witness.colors,
        dimOthers: false,
        caption: `${witness.count} colour${witness.count === 1 ? '' : 's'}`,
      }
  }
}

/** Turns one algorithm frame into canvas highlighting. */
export const stepToHighlight = (step: AlgorithmStep): HighlightRequest => {
  const vertices: Record<VertexId, HighlightMode> = {}
  const edges: Record<EdgeId, HighlightMode> = {}

  assign(vertices, step.visitedVertices ?? [], 'algorithmVisited')
  assign(vertices, step.frontierVertices ?? [], 'algorithmFrontier')
  assign(vertices, step.activeVertices ?? [], 'algorithmCurrent')

  assign(edges, step.rejectedEdges ?? [], 'algorithmRejected')
  assign(edges, step.treeEdges ?? [], 'algorithmAccepted')
  assign(edges, step.activeEdges ?? [], 'algorithmCurrent')

  return {
    vertices,
    edges,
    colors: step.colors,
    badges: step.badges,
    dimOthers: false,
    caption: step.description,
  }
}

export const emptyHighlight = (): HighlightRequest => ({ vertices: {}, edges: {} })
