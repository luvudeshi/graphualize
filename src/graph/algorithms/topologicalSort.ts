/**
 * Kahn's topological sort, as a sequence of player frames.
 *
 * Badges show the *remaining* indegree, which is the number Kahn's algorithm
 * actually drives to zero. Directed graphs only — on an undirected document
 * the question has no meaning, so `precondition` refuses.
 */

import type { Graph } from '../model/graph'
import type { EdgeId, VertexId } from '../model/types'
import type { AlgorithmDefinition, AlgorithmRun } from './types'
import { emptyRun, formatList } from './types'
import { StepRecorder, edgeLabelFrom, labelsInOrder } from './shared'

const ID = 'topological-sort'
const TITLE = 'Topological sort'

const undirectedRefusal = (graph: Graph): string | null =>
  graph.directed
    ? null
    : 'Topological sort needs a directed graph: an undirected edge gives no order to its ends. Switch the document to directed mode first.'

const run = (graph: Graph): AlgorithmRun => {
  const refusal = undirectedRefusal(graph)
  if (refusal) return emptyRun(ID, TITLE, refusal)
  if (graph.order === 0) {
    return emptyRun(ID, TITLE, `${TITLE} needs at least one vertex, and this graph is empty.`)
  }

  const rec = new StepRecorder()
  const indegree = new Map<VertexId, number>()
  for (const id of graph.vertexIds) {
    indegree.set(id, graph.inDegree(id))
    rec.badges[id] = String(graph.inDegree(id))
  }

  const output: VertexId[] = []
  const ready: VertexId[] = graph.vertexIds.filter((id) => (indegree.get(id) ?? 0) === 0)
  let head = 0

  const panels = () => ({
    Ready: formatList(graph, ready.slice(head)),
    Output: formatList(graph, output),
  })

  rec.frontier = ready.slice(head)
  rec.emit({
    type: 'start',
    description: ready.length
      ? `Start with every vertex of indegree 0`
      : 'No vertex has indegree 0',
    detail: ready.length
      ? `${labelsInOrder(graph, ready).join(', ')} ${ready.length === 1 ? 'has' : 'have'} nothing pointing at ${ready.length === 1 ? 'it' : 'them'}, so ${ready.length === 1 ? 'it' : 'they'} can go first.`
      : 'Every vertex has an incoming edge, so a cycle blocks the ordering before it starts.',
    activeVertices: ready.slice(head),
    state: panels(),
  })

  while (head < ready.length) {
    const v = ready[head++]
    output.push(v)
    rec.visited.push(v)
    rec.frontier = ready.slice(head)
    rec.emit({
      type: 'output',
      description: `Output ${graph.label(v)}`,
      detail: `Nothing is left pointing at ${graph.label(v)}, so it takes position ${output.length}.`,
      activeVertices: [v],
      state: panels(),
    })

    for (const inc of graph.successors(v)) {
      const before = indegree.get(inc.to) ?? 0
      const after = Math.max(before - 1, 0)
      indegree.set(inc.to, after)
      rec.badges[inc.to] = String(after)
      rec.treeEdges.push(inc.edgeId)

      if (after === 0) {
        ready.push(inc.to)
        rec.frontier = ready.slice(head)
        rec.emit({
          type: 'ready',
          description: `${graph.label(inc.to)} is ready`,
          detail: `Removing ${edgeLabelFrom(graph, inc.edgeId, v)} takes indegree(${graph.label(inc.to)}) from ${before} to 0, so it joins Ready.`,
          activeVertices: [inc.to, v],
          activeEdges: [inc.edgeId],
          state: panels(),
        })
      } else {
        rec.frontier = ready.slice(head)
        rec.emit({
          type: 'decrement',
          description: `Remove ${edgeLabelFrom(graph, inc.edgeId, v)}`,
          detail: `indegree(${graph.label(inc.to)}): ${before} → ${after}.`,
          activeVertices: [inc.to, v],
          activeEdges: [inc.edgeId],
          state: panels(),
        })
      }
    }
  }

  const stuck = graph.vertexIds.filter((id) => (indegree.get(id) ?? 0) > 0)
  rec.frontier = []
  if (stuck.length) {
    const stuckSet = new Set(stuck)
    const cycleEdges: EdgeId[] = graph.edges
      .filter((e) => stuckSet.has(e.source) && stuckSet.has(e.target))
      .map((e) => e.id)
    rec.emit({
      type: 'cycle',
      description: `Stuck: ${stuck.length} ${stuck.length === 1 ? 'vertex' : 'vertices'} still have incoming edges`,
      detail: `${labelsInOrder(graph, stuck).join(', ')} cannot be placed because a cycle among them keeps every indegree above 0. A graph with a cycle has no topological order.`,
      activeVertices: stuck,
      activeEdges: cycleEdges,
      state: panels(),
    })
  } else {
    rec.emit({
      type: 'done',
      description: `Done: ${graph.labels(output).join(' → ')}`,
      detail: `Every edge runs left to right in this order.`,
      activeVertices: output,
      state: panels(),
    })
  }

  const result = [
    {
      label: 'Order',
      value: output.length ? graph.labels(output).join(' → ') : 'none',
    },
    { label: 'Placed', value: `${output.length} of ${graph.order}` },
    {
      label: 'Cycle',
      value: stuck.length
        ? `yes — ${labelsInOrder(graph, stuck).join(', ')} are caught in one`
        : 'no, the graph is a DAG',
    },
  ]

  return { algorithmId: ID, title: TITLE, steps: rec.steps, result }
}

export const topologicalSortAlgorithm: AlgorithmDefinition = {
  id: ID,
  name: TITLE,
  category: 'ordering',
  description:
    'Repeatedly outputs a vertex with nothing left pointing at it, producing an order where every edge runs forwards — or proving a cycle blocks one.',
  needsSource: false,
  precondition: (graph) => undirectedRefusal(graph),
  run,
}
