/**
 * Dijkstra's shortest paths, as a sequence of player frames.
 *
 * Badges carry the tentative distance (`∞` until a vertex is discovered), the
 * `Priority queue` panel shows what is still open with its current key, and
 * every examined edge produces one frame with the arithmetic written out.
 *
 * The run always finishes the whole graph even when a target is given, so the
 * summary can report every final distance; the target only adds an extra
 * highlight on the path.
 */

import type { Graph } from '../model/graph'
import type { EdgeId, VertexId } from '../model/types'
import { MinHeap } from '../properties/traversal'
import type { AlgorithmDefinition, AlgorithmOptions, AlgorithmRun } from './types'
import { emptyRun, formatList, formatNumber } from './types'
import {
  StepRecorder,
  edgeLabelFrom,
  edgesInDocumentOrder,
  formatDistances,
  formatPath,
  labelsInOrder,
  resolveSource,
} from './shared'

const ID = 'dijkstra'
const TITLE = "Dijkstra's algorithm"

/** The refusal sentence, shared by `precondition` and `run`. */
const negativeWeightRefusal = (graph: Graph): string | null => {
  for (const e of graph.edges) {
    const w = graph.weight(e.id)
    if (w < 0) {
      return `Dijkstra can't run because this graph has a negative edge weight (${graph.label(e.source)} to ${graph.label(e.target)} is ${formatNumber(w)}). Use Bellman-Ford instead.`
    }
  }
  return null
}

const run = (graph: Graph, options: AlgorithmOptions): AlgorithmRun => {
  const refusal = negativeWeightRefusal(graph)
  if (refusal) return emptyRun(ID, TITLE, refusal)

  const resolved = resolveSource(graph, options, TITLE)
  if (!resolved.ok) return emptyRun(ID, TITLE, resolved.error)
  const source = resolved.source
  const target =
    options.target !== undefined && graph.hasVertex(options.target) ? options.target : null

  const rec = new StepRecorder()
  const dist = new Map<VertexId, number>([[source, 0]])
  const parent = new Map<VertexId, VertexId>()
  const parentEdge = new Map<VertexId, EdgeId>()
  const finalized = new Set<VertexId>()
  const examined = new Set<EdgeId>()
  const settledOrder: VertexId[] = []

  for (const id of graph.vertexIds) rec.badges[id] = '∞'
  rec.badges[source] = '0'

  /** Open vertices with a finite key, cheapest first, ties on document order. */
  const openVertices = (): VertexId[] =>
    graph.vertexIds
      .filter((id) => dist.has(id) && !finalized.has(id))
      .sort((a, b) => (dist.get(a) as number) - (dist.get(b) as number) || graph.index(a) - graph.index(b))

  const queuePanel = (): string => {
    const open = openVertices()
    if (!open.length) return '[ ]'
    return `[${open.map((id) => `${graph.label(id)}(${formatNumber(dist.get(id) as number)})`).join(', ')}]`
  }

  const panels = () => ({
    'Priority queue': queuePanel(),
    Finalized: formatList(graph, settledOrder),
  })

  /** Tree edges are the current parent pointers; everything else examined is rejected. */
  const syncEdges = (): void => {
    const tree = new Set<EdgeId>(parentEdge.values())
    rec.treeEdges = edgesInDocumentOrder(graph, tree)
    rec.rejectedEdges = graph.edgeIds.filter((id) => examined.has(id) && !tree.has(id))
  }

  rec.frontier = openVertices()
  rec.emit({
    type: 'start',
    description: `Start at ${graph.label(source)}`,
    detail: `d(${graph.label(source)}) = 0; every other distance starts at ∞.`,
    activeVertices: [source],
    state: panels(),
  })

  const heap = new MinHeap<VertexId>()
  heap.push(0, source)

  for (;;) {
    const top = heap.pop()
    if (!top) break
    const v = top.value
    if (finalized.has(v)) continue
    if (top.key > (dist.get(v) ?? Infinity)) continue // stale entry

    finalized.add(v)
    settledOrder.push(v)
    rec.visited.push(v)
    rec.frontier = openVertices()
    const dv = dist.get(v) as number
    rec.emit({
      type: 'visit',
      description: `Finalize ${graph.label(v)}`,
      detail:
        target === v
          ? `d(${graph.label(v)}) = ${formatNumber(dv)} is final — this is the target.`
          : `d(${graph.label(v)}) = ${formatNumber(dv)} is final; nothing still open can beat it.`,
      activeVertices: [v],
      state: panels(),
    })

    for (const inc of graph.successors(v)) {
      const w = graph.weight(inc.edgeId)
      const to = inc.to
      const before = dist.get(to) ?? Infinity
      const candidate = dv + w
      examined.add(inc.edgeId)
      const arithmetic = `d(${graph.label(to)}) = min(${formatNumber(before)}, ${formatNumber(dv)} + ${formatNumber(w)}) = ${formatNumber(Math.min(before, candidate))}`

      if (candidate < before) {
        dist.set(to, candidate)
        parent.set(to, v)
        parentEdge.set(to, inc.edgeId)
        rec.badges[to] = formatNumber(candidate)
        heap.push(candidate, to)
        syncEdges()
        rec.frontier = openVertices()
        rec.emit({
          type: 'relax',
          description: `Relax ${edgeLabelFrom(graph, inc.edgeId, v)}`,
          detail: arithmetic,
          activeVertices: [to, v],
          activeEdges: [inc.edgeId],
          state: panels(),
        })
      } else {
        syncEdges()
        rec.frontier = openVertices()
        rec.emit({
          type: 'no-improvement',
          description: `No improvement for ${graph.label(to)}`,
          detail: arithmetic,
          activeVertices: [to, v],
          activeEdges: [inc.edgeId],
          state: panels(),
        })
      }
    }
  }

  const unreached = graph.vertexIds.filter((id) => !dist.has(id))
  let pathVertices: VertexId[] = []
  let pathEdges: EdgeId[] = []
  if (target && dist.has(target)) {
    let cursor: VertexId | undefined = target
    const guard = new Set<VertexId>()
    while (cursor !== undefined && !guard.has(cursor)) {
      guard.add(cursor)
      pathVertices.push(cursor)
      const e = parentEdge.get(cursor)
      if (e) pathEdges.push(e)
      cursor = parent.get(cursor)
    }
    pathVertices = pathVertices.reverse()
    pathEdges = pathEdges.reverse()
  }

  rec.frontier = []
  if (target && !dist.has(target)) {
    rec.emit({
      type: 'done',
      description: `Done: ${graph.label(target)} is unreachable`,
      detail: `No route leads from ${graph.label(source)} to ${graph.label(target)}.`,
      activeVertices: [target],
      state: panels(),
    })
  } else if (target) {
    rec.emit({
      type: 'done',
      description: `Shortest path ${formatPath(graph, pathVertices)} = ${formatNumber(dist.get(target) as number)}`,
      detail: `Every finalized distance is now settled.`,
      activeVertices: pathVertices,
      activeEdges: pathEdges,
      state: panels(),
    })
  } else {
    rec.emit({
      type: 'done',
      description: unreached.length
        ? `Done: ${settledOrder.length} of ${graph.order} vertices reached`
        : 'Done: every vertex has a final distance',
      detail: unreached.length
        ? `${labelsInOrder(graph, unreached).join(', ')} ${unreached.length === 1 ? 'is' : 'are'} not reachable from ${graph.label(source)}.`
        : `Tree edges show one shortest route to each vertex.`,
      activeVertices: unreached,
      state: panels(),
    })
  }

  const result = [
    { label: 'Source', value: graph.label(source) },
    { label: 'Distances', value: formatDistances(graph, dist) },
  ]
  if (target) {
    result.push({
      label: `Path to ${graph.label(target)}`,
      value: dist.has(target) ? formatPath(graph, pathVertices) : 'unreachable',
    })
    result.push({
      label: `Distance to ${graph.label(target)}`,
      value: formatNumber(dist.get(target) ?? Infinity),
    })
  }
  result.push({
    label: 'Unreached',
    value: unreached.length ? labelsInOrder(graph, unreached).join(', ') : 'none',
  })

  return { algorithmId: ID, title: TITLE, steps: rec.steps, result }
}

export const dijkstraAlgorithm: AlgorithmDefinition = {
  id: ID,
  name: TITLE,
  category: 'shortest-path',
  description:
    'Settles vertices in order of distance from the source, so the cheapest route to each one is fixed the moment it is reached. Needs non-negative weights.',
  needsSource: true,
  prefersWeighted: true,
  precondition: (graph) => negativeWeightRefusal(graph),
  run,
}
