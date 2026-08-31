/**
 * Prim's minimum spanning tree, as a sequence of player frames.
 *
 * Direction is ignored: the tree is grown over the undirected view.
 *
 * The candidate list is kept as an explicit array sorted by weight (ties on
 * document order) rather than a heap, because the `Candidate edges` panel has
 * to show the very list the next pick comes off — a student should never see
 * the algorithm take the second-cheapest entry on screen.
 */

import type { Graph } from '../model/graph'
import type { EdgeId, VertexId } from '../model/types'
import type { AlgorithmDefinition, AlgorithmOptions, AlgorithmRun } from './types'
import { emptyRun, formatList, formatNumber } from './types'
import {
  StepRecorder,
  edgeOrderIndex,
  labelsInOrder,
  resolveSource,
  undirectedEdgeLabel,
  weightedEdgeLabel,
} from './shared'

const ID = 'prim'
const TITLE = "Prim's algorithm"

interface Candidate {
  edgeId: EdgeId
  from: VertexId
  to: VertexId
  weight: number
  order: number
}

const run = (graph: Graph, options: AlgorithmOptions): AlgorithmRun => {
  const resolved = resolveSource(graph, options, TITLE)
  if (!resolved.ok) return emptyRun(ID, TITLE, resolved.error)
  const source = resolved.source

  const rec = new StepRecorder()
  const edgeOrder = edgeOrderIndex(graph)
  const inTree = new Set<VertexId>([source])
  const treeVertices: VertexId[] = [source]
  const treeEdges: EdgeId[] = []
  let candidates: Candidate[] = []

  const cheapestFirst = (a: Candidate, b: Candidate): number =>
    a.weight - b.weight || a.order - b.order

  const offer = (v: VertexId): void => {
    for (const inc of graph.neighbors(v)) {
      if (inTree.has(inc.to)) continue
      candidates.push({
        edgeId: inc.edgeId,
        from: v,
        to: inc.to,
        weight: graph.weight(inc.edgeId),
        order: edgeOrder.get(inc.edgeId) ?? 0,
      })
    }
    candidates.sort(cheapestFirst)
  }

  /** Textbook `key[v]`: cheapest known edge joining v to the tree. */
  const refreshBadges = (): void => {
    for (const id of graph.vertexIds) {
      if (inTree.has(id)) continue
      rec.badges[id] = '∞'
    }
    for (const c of candidates) {
      if (inTree.has(c.to)) continue // stale candidate; the frozen badge stands
      const current = rec.badges[c.to]
      if (current === '∞' || Number(current) > c.weight) rec.badges[c.to] = formatNumber(c.weight)
    }
    rec.frontier = graph.vertexIds.filter((id) => !inTree.has(id) && rec.badges[id] !== '∞')
  }

  const panels = () => ({
    Tree: formatList(graph, treeVertices),
    'Candidate edges': candidates.length
      ? `[${candidates.map((c) => weightedEdgeLabel(graph, c.edgeId)).join(', ')}]`
      : '[ ]',
  })

  for (const id of graph.vertexIds) rec.badges[id] = '∞'
  rec.badges[source] = '0'
  rec.visited.push(source)
  offer(source)
  refreshBadges()
  rec.emit({
    type: 'start',
    description: `Start the tree at ${graph.label(source)}`,
    detail: candidates.length
      ? `${graph.label(source)} offers ${candidates.length === 1 ? '1 edge' : `${candidates.length} edges`} to choose from.`
      : `${graph.label(source)} has no edges, so the tree cannot grow.`,
    activeVertices: [source],
    state: panels(),
  })

  while (candidates.length) {
    const pick = candidates[0]
    candidates = candidates.slice(1)

    if (inTree.has(pick.to)) {
      rec.rejectedEdges.push(pick.edgeId)
      refreshBadges()
      rec.emit({
        type: 'reject',
        description: `Reject ${undirectedEdgeLabel(graph, pick.edgeId)}: both ends are already in the tree`,
        detail: `${graph.label(pick.to)} joined by a cheaper route, so this edge would close a cycle.`,
        activeVertices: [pick.to, pick.from],
        activeEdges: [pick.edgeId],
        state: panels(),
      })
      continue
    }

    inTree.add(pick.to)
    treeVertices.push(pick.to)
    treeEdges.push(pick.edgeId)
    rec.treeEdges.push(pick.edgeId)
    rec.visited.push(pick.to)
    rec.badges[pick.to] = formatNumber(pick.weight)
    offer(pick.to)
    refreshBadges()
    rec.emit({
      type: 'accept',
      description: `Add ${undirectedEdgeLabel(graph, pick.edgeId)} (${formatNumber(pick.weight)}) to the tree`,
      detail: `It is the cheapest edge leaving the tree, and it brings in ${graph.label(pick.to)}.`,
      activeVertices: [pick.to, pick.from],
      activeEdges: [pick.edgeId],
      state: panels(),
    })
  }

  const total = treeEdges.reduce((sum, id) => sum + graph.weight(id), 0)
  const outside = graph.vertexIds.filter((id) => !inTree.has(id))
  rec.frontier = []
  rec.emit({
    type: 'done',
    description: outside.length
      ? `Done: spanning tree of ${graph.label(source)}'s component, weight ${formatNumber(total)}`
      : `Done: minimum spanning tree, weight ${formatNumber(total)}`,
    detail: outside.length
      ? `The graph is disconnected, so this spans only the ${treeVertices.length} of ${graph.order} vertices reachable from ${graph.label(source)}.`
      : `${treeEdges.length} ${treeEdges.length === 1 ? 'edge' : 'edges'} join all ${graph.order} vertices.`,
    activeVertices: outside,
    state: panels(),
  })

  const result = [
    { label: 'Source', value: graph.label(source) },
    { label: 'Total weight', value: formatNumber(total) },
    {
      label: 'Tree edges',
      value: treeEdges.length ? treeEdges.map((id) => weightedEdgeLabel(graph, id)).join(', ') : 'none',
    },
    { label: 'Vertices reached', value: `${treeVertices.length} of ${graph.order}` },
  ]
  if (outside.length) {
    result.push({
      label: 'Note',
      value: `The graph is disconnected: this is a spanning tree of ${graph.label(source)}'s component only, covering ${treeVertices.length} of ${graph.order} vertices. Outside it: ${labelsInOrder(graph, outside).join(', ')}.`,
    })
  }

  return { algorithmId: ID, title: TITLE, steps: rec.steps, result }
}

export const primAlgorithm: AlgorithmDefinition = {
  id: ID,
  name: TITLE,
  category: 'spanning',
  description:
    'Grows one tree from a start vertex, always taking the cheapest edge that reaches a vertex not yet in it. Edge direction is ignored.',
  needsSource: true,
  prefersWeighted: true,
  run,
}
