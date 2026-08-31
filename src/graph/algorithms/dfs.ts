/**
 * Depth-first search, as a sequence of player frames.
 *
 * The `Stack` panel shows the *recursion path* — the route from the source
 * down to the vertex being explored — rather than the raw stack of pending
 * candidates. That is the picture students are taught, and it is what makes
 * a backtrack step legible.
 *
 * Vertices on that path count as frontier (grey); a vertex becomes visited
 * (black) only when the search finishes with it and backtracks.
 */

import type { Graph } from '../model/graph'
import type { EdgeId, Incidence, VertexId } from '../model/types'
import type { AlgorithmDefinition, AlgorithmOptions, AlgorithmRun } from './types'
import { emptyRun, formatList } from './types'
import { StepRecorder, edgeLabelFrom, labelsInOrder, resolveSource } from './shared'

const ID = 'dfs'
const TITLE = 'Depth-first search'

interface Frame {
  vertex: VertexId
  incidences: Incidence[]
  cursor: number
}

const run = (graph: Graph, options: AlgorithmOptions): AlgorithmRun => {
  const resolved = resolveSource(graph, options, TITLE)
  if (!resolved.ok) return emptyRun(ID, TITLE, resolved.error)
  const source = resolved.source

  const rec = new StepRecorder()
  const seen = new Set<VertexId>([source])
  const order: VertexId[] = [source]
  const treeSet = new Set<EdgeId>()
  const rejectedSet = new Set<EdgeId>()

  const stack: Frame[] = [{ vertex: source, incidences: graph.successors(source), cursor: 0 }]
  const path = () => stack.map((f) => f.vertex)
  const panel = () => ({ Stack: formatList(graph, path()) })

  rec.badges[source] = '1'
  rec.frontier = path()
  rec.emit({
    type: 'start',
    description: `Start at ${graph.label(source)}`,
    detail: 'Discovery order 1.',
    activeVertices: [source],
    state: panel(),
  })

  while (stack.length) {
    const frame = stack[stack.length - 1]
    const v = frame.vertex

    if (frame.cursor < frame.incidences.length) {
      const inc = frame.incidences[frame.cursor]
      frame.cursor += 1

      if (seen.has(inc.to)) {
        if (!treeSet.has(inc.edgeId) && !rejectedSet.has(inc.edgeId)) {
          rejectedSet.add(inc.edgeId)
          rec.rejectedEdges.push(inc.edgeId)
        }
        rec.emit({
          type: 'skip',
          description: `Skip ${graph.label(inc.to)}: already visited`,
          detail: `${edgeLabelFrom(graph, inc.edgeId, v)} leads back into the part of the graph the search has already entered.`,
          activeVertices: [inc.to, v],
          activeEdges: [inc.edgeId],
          state: panel(),
        })
        continue
      }

      seen.add(inc.to)
      order.push(inc.to)
      treeSet.add(inc.edgeId)
      rec.treeEdges.push(inc.edgeId)
      rec.badges[inc.to] = String(order.length)
      stack.push({ vertex: inc.to, incidences: graph.successors(inc.to), cursor: 0 })
      rec.frontier = path()
      rec.emit({
        type: 'discover',
        description: `Discover ${graph.label(inc.to)} via ${edgeLabelFrom(graph, inc.edgeId, v)}`,
        detail: `Discovery order ${order.length}. The search goes deeper from ${graph.label(inc.to)}.`,
        activeVertices: [inc.to, v],
        activeEdges: [inc.edgeId],
        state: panel(),
      })
      continue
    }

    stack.pop()
    rec.visited.push(v)
    rec.frontier = path()
    const parent = stack.length ? stack[stack.length - 1].vertex : null
    rec.emit({
      type: 'backtrack',
      description: parent
        ? `Backtrack from ${graph.label(v)} to ${graph.label(parent)}`
        : `Finish ${graph.label(v)}`,
      detail: parent
        ? `${graph.label(v)} has no unvisited neighbours left.`
        : 'The search is back at the source with nothing left to explore.',
      activeVertices: parent ? [v, parent] : [v],
      state: panel(),
    })
  }

  const unreached = graph.vertexIds.filter((id) => !seen.has(id))
  rec.emit({
    type: 'done',
    description: unreached.length
      ? `Done: ${order.length} of ${graph.order} vertices reached`
      : `Done: every vertex reached from ${graph.label(source)}`,
    detail: unreached.length
      ? `${labelsInOrder(graph, unreached).join(', ')} ${unreached.length === 1 ? 'is' : 'are'} not reachable from ${graph.label(source)}.`
      : `Discovery order: ${graph.labels(order).join(', ')}.`,
    activeVertices: unreached,
    state: { Stack: formatList(graph, []) },
  })

  const result = [
    { label: 'Source', value: graph.label(source) },
    { label: 'Discovery order', value: graph.labels(order).join(', ') },
    { label: 'Reached', value: `${order.length} of ${graph.order}` },
    {
      label: 'Unreached',
      value: unreached.length ? labelsInOrder(graph, unreached).join(', ') : 'none',
    },
  ]

  return { algorithmId: ID, title: TITLE, steps: rec.steps, result }
}

export const dfsAlgorithm: AlgorithmDefinition = {
  id: ID,
  name: TITLE,
  category: 'traversal',
  description:
    'Follows one branch as deep as it goes before backtracking, numbering vertices in the order it first reaches them.',
  needsSource: true,
  run,
}
