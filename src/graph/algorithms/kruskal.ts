/**
 * Kruskal's minimum spanning forest, as a sequence of player frames.
 *
 * Direction is ignored: edges are treated as undirected.
 *
 * Edges are sorted by weight with ties broken by document position, so two
 * runs over the same document always accept the same edges in the same order.
 * Every edge is examined — the rejections are half the lesson — and the
 * `Sorted edges` panel carries a ▸ cursor on the edge under consideration.
 */

import type { Graph } from '../model/graph'
import type { EdgeId, VertexId } from '../model/types'
import { DisjointSet } from '../properties/traversal'
import type { AlgorithmDefinition, AlgorithmRun } from './types'
import { emptyRun, formatNumber } from './types'
import { StepRecorder, edgeOrderIndex, undirectedEdgeLabel, weightedEdgeLabel } from './shared'

const ID = 'kruskal'
const TITLE = "Kruskal's algorithm"

/** How many entries either side of the cursor the `Sorted edges` panel shows. */
const WINDOW = 3

const run = (graph: Graph): AlgorithmRun => {
  if (graph.order === 0) {
    return emptyRun(ID, TITLE, `${TITLE} needs at least one vertex, and this graph is empty.`)
  }

  const rec = new StepRecorder()
  const edgeOrder = edgeOrderIndex(graph)
  const sorted = graph.edgeIds
    .slice()
    .sort(
      (a, b) =>
        graph.weight(a) - graph.weight(b) || (edgeOrder.get(a) ?? 0) - (edgeOrder.get(b) ?? 0),
    )

  const forest = new DisjointSet(graph.vertexIds)
  const accepted: EdgeId[] = []
  const inForest = new Set<VertexId>()

  const sortedPanel = (cursor: number): string => {
    if (!sorted.length) return '[ ]'
    const from = Math.max(0, Math.min(cursor - WINDOW, sorted.length - (WINDOW * 2 + 1)))
    const to = Math.min(sorted.length, Math.max(cursor + WINDOW + 1, WINDOW * 2 + 1))
    const parts = sorted
      .slice(from, to)
      .map((id, i) =>
        from + i === cursor ? `▸${weightedEdgeLabel(graph, id)}` : weightedEdgeLabel(graph, id),
      )
    if (from > 0) parts.unshift('…')
    if (to < sorted.length) parts.push('…')
    return `[${parts.join(', ')}]`
  }

  const componentsPanel = (): string => {
    const groups = new Map<VertexId, VertexId[]>()
    for (const id of graph.vertexIds) {
      const root = forest.find(id)
      const bucket = groups.get(root)
      if (bucket) bucket.push(id)
      else groups.set(root, [id])
    }
    return [...groups.values()]
      .map((members) => `{${members.map((id) => graph.label(id)).join(', ')}}`)
      .join(' ')
  }

  const panels = (cursor: number) => ({
    'Sorted edges': sortedPanel(cursor),
    Components: componentsPanel(),
  })

  rec.emit({
    type: 'start',
    description: sorted.length
      ? 'Sort every edge by weight, cheapest first'
      : 'No edges to sort',
    detail: sorted.length
      ? `Ties keep document order, so the run is reproducible. Each vertex starts as its own component.`
      : `Every vertex is its own component and nothing can join them.`,
    state: panels(0),
  })

  sorted.forEach((edgeId, cursor) => {
    const e = graph.edge(edgeId)
    if (!e) return
    const weight = graph.weight(edgeId)
    const joins = forest.union(e.source, e.target)

    if (joins) {
      accepted.push(edgeId)
      rec.treeEdges.push(edgeId)
      if (!inForest.has(e.source)) {
        inForest.add(e.source)
        rec.visited.push(e.source)
      }
      if (!inForest.has(e.target)) {
        inForest.add(e.target)
        rec.visited.push(e.target)
      }
      rec.emit({
        type: 'accept',
        description: `Add ${undirectedEdgeLabel(graph, edgeId)} (${formatNumber(weight)}) to the forest`,
        detail: `${graph.label(e.source)} and ${graph.label(e.target)} were in different components, so this edge merges them.`,
        activeVertices: [e.source, e.target],
        activeEdges: [edgeId],
        state: panels(cursor),
      })
      return
    }

    rec.rejectedEdges.push(edgeId)
    rec.emit({
      type: 'reject',
      description: `Reject ${undirectedEdgeLabel(graph, edgeId)}: would form a cycle`,
      detail:
        e.source === e.target
          ? `${graph.label(e.source)} is joined to itself, which can never help a tree.`
          : `${graph.label(e.source)} and ${graph.label(e.target)} are already in the same component.`,
      activeVertices: [e.source, e.target],
      activeEdges: [edgeId],
      state: panels(cursor),
    })
  })

  const roots = new Set(graph.vertexIds.map((id) => forest.find(id)))
  const componentCount = roots.size
  const total = accepted.reduce((sum, id) => sum + graph.weight(id), 0)
  const spans = componentCount === 1

  rec.emit({
    type: 'done',
    description: spans
      ? `Done: minimum spanning tree, weight ${formatNumber(total)}`
      : `Done: spanning forest of ${componentCount} components, weight ${formatNumber(total)}`,
    detail: spans
      ? `${accepted.length} of ${graph.size} edges join all ${graph.order} vertices.`
      : `The graph is disconnected, so no single tree can reach every vertex; each component gets its own.`,
    state: panels(sorted.length - 1),
  })

  const result = [
    { label: 'Total weight', value: formatNumber(total) },
    { label: 'Edges accepted', value: `${accepted.length} of ${graph.size}` },
    {
      label: 'Forest edges',
      value: accepted.length ? accepted.map((id) => weightedEdgeLabel(graph, id)).join(', ') : 'none',
    },
    {
      label: 'Result',
      value: spans
        ? `spanning tree of all ${graph.order} vertices`
        : `spanning forest with ${componentCount} components`,
    },
  ]

  return { algorithmId: ID, title: TITLE, steps: rec.steps, result }
}

export const kruskalAlgorithm: AlgorithmDefinition = {
  id: ID,
  name: TITLE,
  category: 'spanning',
  description:
    'Takes edges cheapest first and keeps each one that joins two separate components, building the whole forest at once. Edge direction is ignored.',
  needsSource: false,
  prefersWeighted: true,
  run,
}
