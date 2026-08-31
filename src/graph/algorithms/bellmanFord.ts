/**
 * Bellman-Ford, as a sequence of player frames.
 *
 * Each round scans every edge in document order (both ways on an undirected
 * document). Only improvements get their own frame — a round of an untouched
 * graph would otherwise emit |E| frames that say nothing — and a round that
 * changes nothing ends the relaxation phase, because no later round could.
 *
 * The detection round is always run, and when an edge can still improve the
 * real negative cycle is extracted from the predecessor pointers and shown.
 */

import type { Graph } from '../model/graph'
import type { EdgeId, VertexId } from '../model/types'
import type { AlgorithmDefinition, AlgorithmOptions, AlgorithmRun } from './types'
import { emptyRun, formatNumber } from './types'
import {
  StepRecorder,
  edgeLabelFrom,
  edgesInDocumentOrder,
  formatAddend,
  formatDistances,
  formatPath,
  labelsInOrder,
  resolveSource,
} from './shared'

const ID = 'bellman-ford'
const TITLE = 'Bellman-Ford'

interface Arc {
  from: VertexId
  to: VertexId
  edgeId: EdgeId
  weight: number
}

/** Every edge as a relaxable arc; an undirected edge relaxes both ways. */
const arcsOf = (graph: Graph): Arc[] => {
  const arcs: Arc[] = []
  for (const e of graph.edges) {
    const weight = graph.weight(e.id)
    arcs.push({ from: e.source, to: e.target, edgeId: e.id, weight })
    if (!graph.directed && e.source !== e.target) {
      arcs.push({ from: e.target, to: e.source, edgeId: e.id, weight })
    }
  }
  return arcs
}

const run = (graph: Graph, options: AlgorithmOptions): AlgorithmRun => {
  const resolved = resolveSource(graph, options, TITLE)
  if (!resolved.ok) return emptyRun(ID, TITLE, resolved.error)
  const source = resolved.source

  const rec = new StepRecorder()
  const arcs = arcsOf(graph)
  const rounds = Math.max(graph.order - 1, 0)
  const dist = new Map<VertexId, number>([[source, 0]])
  const parent = new Map<VertexId, VertexId>()
  const parentEdge = new Map<VertexId, EdgeId>()

  for (const id of graph.vertexIds) rec.badges[id] = '∞'
  rec.badges[source] = '0'

  const syncTree = (): void => {
    rec.treeEdges = edgesInDocumentOrder(graph, new Set<EdgeId>(parentEdge.values()))
  }
  const roundPanel = (label: string) => ({ Round: label })

  rec.visited = [source]
  rec.emit({
    type: 'start',
    description: `Start at ${graph.label(source)}`,
    detail: `d(${graph.label(source)}) = 0; every other distance starts at ∞. ${rounds} ${rounds === 1 ? 'round' : 'rounds'} of relaxation follow.`,
    activeVertices: [source],
    state: roundPanel(`0 of ${rounds}`),
  })

  let stableRound: number | null = null
  for (let round = 1; round <= rounds; round++) {
    const label = `${round} of ${rounds}`
    rec.emit({
      type: 'round',
      description: `Round ${round} of ${rounds}`,
      detail: `Scan every edge once; only improvements are shown.`,
      state: roundPanel(label),
    })

    let improvements = 0
    for (const arc of arcs) {
      const du = dist.get(arc.from)
      if (du === undefined) continue
      const before = dist.get(arc.to) ?? Infinity
      const candidate = du + arc.weight
      if (candidate >= before) continue

      improvements += 1
      dist.set(arc.to, candidate)
      parent.set(arc.to, arc.from)
      parentEdge.set(arc.to, arc.edgeId)
      rec.badges[arc.to] = formatNumber(candidate)
      if (!rec.visited.includes(arc.to)) rec.visited.push(arc.to)
      syncTree()
      rec.emit({
        type: 'relax',
        description: `Relax ${edgeLabelFrom(graph, arc.edgeId, arc.from)}`,
        detail: `d(${graph.label(arc.to)}) = min(${formatNumber(before)}, ${formatNumber(du)} + ${formatAddend(arc.weight)}) = ${formatNumber(candidate)}`,
        activeVertices: [arc.to, arc.from],
        activeEdges: [arc.edgeId],
        state: roundPanel(label),
      })
    }

    if (improvements === 0) {
      stableRound = round
      rec.emit({
        type: 'stable',
        description: `Round ${round} changed nothing`,
        detail: 'The distances have settled, so the remaining rounds are skipped.',
        state: roundPanel(label),
      })
      break
    }
  }

  /* ---------------- detection round ---------------- */

  rec.emit({
    type: 'round',
    description: 'Detection round',
    detail: 'One more scan: any edge that still improves proves a negative cycle.',
    state: roundPanel('detection'),
  })

  let culprit: Arc | null = null
  for (const arc of arcs) {
    const du = dist.get(arc.from)
    if (du === undefined) continue
    const before = dist.get(arc.to) ?? Infinity
    if (du + arc.weight < before) {
      culprit = arc
      break
    }
  }

  let cycleVertices: VertexId[] = []
  let cycleEdges: EdgeId[] = []
  let cycleWeight = 0

  if (culprit) {
    rec.emit({
      type: 'negative-cycle-found',
      description: `${edgeLabelFrom(graph, culprit.edgeId, culprit.from)} still improves`,
      detail: `After ${rounds} ${rounds === 1 ? 'round' : 'rounds'} no distance should be able to fall again, so a negative cycle must be reachable.`,
      activeVertices: [culprit.to, culprit.from],
      activeEdges: [culprit.edgeId],
      state: roundPanel('detection'),
    })

    // Walk |V| predecessor steps to land inside the cycle, then trace it.
    let inside: VertexId | undefined = culprit.to
    for (let i = 0; i < graph.order && inside !== undefined; i++) inside = parent.get(inside)

    if (inside !== undefined) {
      const backwards: VertexId[] = []
      const guard = new Set<VertexId>()
      let cursor: VertexId | undefined = inside
      let closed = false
      while (cursor !== undefined && !guard.has(cursor)) {
        guard.add(cursor)
        backwards.push(cursor)
        cursor = parent.get(cursor)
        if (cursor === inside) {
          closed = true
          break
        }
      }

      if (closed) {
        // `backwards` runs against the arrows; reversing puts it in travel
        // order, and the edge into each vertex is that vertex's parent edge.
        const forward = backwards.slice().reverse()
        const edges: EdgeId[] = []
        for (let i = 0; i < forward.length; i++) {
          const next = forward[(i + 1) % forward.length]
          const edgeId = parentEdge.get(next)
          if (edgeId === undefined) {
            edges.length = 0
            break
          }
          edges.push(edgeId)
        }
        if (edges.length) {
          cycleVertices = forward
          cycleEdges = edges
          cycleWeight = edges.reduce((sum, id) => sum + graph.weight(id), 0)
        }
      }
    }
  }

  if (culprit && cycleEdges.length) {
    const loop = [...cycleVertices, cycleVertices[0]]
    rec.treeEdges = []
    rec.rejectedEdges = []
    rec.emit({
      type: 'negative-cycle',
      description: `Negative cycle: ${formatPath(graph, loop)}`,
      detail: `Its edges total ${formatNumber(cycleWeight)}, so going round it again always costs less. No shortest path exists.`,
      activeVertices: cycleVertices,
      activeEdges: cycleEdges,
      state: roundPanel('detection'),
    })
  } else if (culprit) {
    rec.emit({
      type: 'negative-cycle',
      description: 'A negative cycle is reachable from the source',
      detail: 'Distances can be driven down without limit, so no shortest path exists.',
      activeVertices: [culprit.to, culprit.from],
      activeEdges: [culprit.edgeId],
      state: roundPanel('detection'),
    })
  } else {
    const unreached = graph.vertexIds.filter((id) => !dist.has(id))
    rec.emit({
      type: 'done',
      description: 'Done: no negative cycle, distances are final',
      detail: stableRound
        ? `The distances stopped changing at round ${stableRound}.`
        : `No edge improved in the detection round.`,
      activeVertices: unreached,
      state: roundPanel('detection'),
    })
  }

  const unreached = graph.vertexIds.filter((id) => !dist.has(id))
  const result = [
    { label: 'Source', value: graph.label(source) },
    { label: 'Distances', value: formatDistances(graph, dist) },
    {
      label: 'Negative cycle',
      value: culprit
        ? cycleEdges.length
          ? `yes — ${formatPath(graph, [...cycleVertices, cycleVertices[0]])} totals ${formatNumber(cycleWeight)}`
          : 'yes — reachable from the source'
        : 'no',
    },
    {
      label: 'Unreached',
      value: unreached.length ? labelsInOrder(graph, unreached).join(', ') : 'none',
    },
  ]

  return { algorithmId: ID, title: TITLE, steps: rec.steps, result }
}

export const bellmanFordAlgorithm: AlgorithmDefinition = {
  id: ID,
  name: TITLE,
  category: 'shortest-path',
  description:
    'Relaxes every edge once per round, |V|-1 times, so it copes with negative weights and can prove when a negative cycle makes shortest paths meaningless.',
  needsSource: true,
  prefersWeighted: true,
  run,
}
