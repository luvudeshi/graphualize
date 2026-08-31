/**
 * Breadth-first search, as a sequence of player frames.
 *
 * The queue is the whole story, so it gets its own state panel and the badge
 * on each vertex is its distance in edges from the source.
 */

import type { Graph } from '../model/graph'
import type { EdgeId, VertexId } from '../model/types'
import type { AlgorithmDefinition, AlgorithmOptions, AlgorithmRun } from './types'
import { emptyRun, formatList } from './types'
import { StepRecorder, labelsInOrder, edgeLabelFrom, plural, resolveSource } from './shared'

const ID = 'bfs'
const TITLE = 'Breadth-first search'

const run = (graph: Graph, options: AlgorithmOptions): AlgorithmRun => {
  const resolved = resolveSource(graph, options, TITLE)
  if (!resolved.ok) return emptyRun(ID, TITLE, resolved.error)
  const source = resolved.source

  const rec = new StepRecorder()
  const dist = new Map<VertexId, number>([[source, 0]])
  const parentEdge = new Map<VertexId, EdgeId>()
  const treeSet = new Set<EdgeId>()
  const rejectedSet = new Set<EdgeId>()
  const order: VertexId[] = []

  const queue: VertexId[] = [source]
  let head = 0
  const panel = () => ({ Queue: formatList(graph, queue.slice(head)) })

  rec.badges[source] = '0'
  rec.frontier = [source]
  rec.emit({
    type: 'start',
    description: `Start at ${graph.label(source)}`,
    detail: `d(${graph.label(source)}) = 0. Every other vertex is undiscovered.`,
    activeVertices: [source],
    state: panel(),
  })

  while (head < queue.length) {
    const v = queue[head++]
    const d = dist.get(v) ?? 0
    order.push(v)
    rec.visited.push(v)
    rec.frontier = queue.slice(head)
    rec.emit({
      type: 'visit',
      description: `Visit ${graph.label(v)}`,
      detail:
        d === 0
          ? `Dequeue ${graph.label(v)}, the vertex the search started from.`
          : `Dequeue ${graph.label(v)}, ${plural(d, 'edge')} from ${graph.label(source)}.`,
      activeVertices: [v],
      state: panel(),
    })

    for (const inc of graph.successors(v)) {
      if (dist.has(inc.to)) {
        // Not a tree edge — but never demote an edge we already accepted.
        if (!treeSet.has(inc.edgeId) && !rejectedSet.has(inc.edgeId)) {
          rejectedSet.add(inc.edgeId)
          rec.rejectedEdges.push(inc.edgeId)
        }
        rec.emit({
          type: 'skip',
          description: `Skip ${graph.label(inc.to)}: already discovered`,
          detail: `${graph.label(inc.to)} was reached at distance ${dist.get(inc.to)}, so ${edgeLabelFrom(graph, inc.edgeId, v)} adds nothing.`,
          activeVertices: [inc.to, v],
          activeEdges: [inc.edgeId],
          state: panel(),
        })
        continue
      }

      dist.set(inc.to, d + 1)
      parentEdge.set(inc.to, inc.edgeId)
      treeSet.add(inc.edgeId)
      rec.treeEdges.push(inc.edgeId)
      rec.badges[inc.to] = String(d + 1)
      queue.push(inc.to)
      rec.frontier = queue.slice(head)
      rec.emit({
        type: 'discover',
        description: `Discover ${graph.label(inc.to)} via ${edgeLabelFrom(graph, inc.edgeId, v)}`,
        detail: `d(${graph.label(inc.to)}) = ${d + 1}. It joins the back of the queue.`,
        activeVertices: [inc.to, v],
        activeEdges: [inc.edgeId],
        state: panel(),
      })
    }
  }

  const unreached = graph.vertexIds.filter((id) => !dist.has(id))
  rec.frontier = []
  rec.emit({
    type: 'done',
    description: unreached.length
      ? `Done: ${order.length} of ${graph.order} vertices reached`
      : `Done: every vertex reached from ${graph.label(source)}`,
    detail: unreached.length
      ? `${labelsInOrder(graph, unreached).join(', ')} ${unreached.length === 1 ? 'is' : 'are'} not reachable from ${graph.label(source)}.`
      : `The tree edges show a shortest route to every vertex.`,
    activeVertices: unreached,
    state: { Queue: formatList(graph, []) },
  })

  const result = [
    { label: 'Source', value: graph.label(source) },
    { label: 'Visit order', value: graph.labels(order).join(', ') },
    {
      label: 'Distances',
      value: order.map((id) => `${graph.label(id)}=${dist.get(id)}`).join(', ') || '—',
    },
    { label: 'Reached', value: `${order.length} of ${graph.order}` },
    {
      label: 'Unreached',
      value: unreached.length ? labelsInOrder(graph, unreached).join(', ') : 'none',
    },
  ]

  return { algorithmId: ID, title: TITLE, steps: rec.steps, result }
}

export const bfsAlgorithm: AlgorithmDefinition = {
  id: ID,
  name: TITLE,
  category: 'traversal',
  description:
    'Explores outward in waves from the source, so every vertex is reached along a path with as few edges as possible.',
  needsSource: true,
  run,
}
