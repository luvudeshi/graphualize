/**
 * Minimum spanning trees and forests.
 *
 * Kruskal's algorithm on the underlying undirected graph. Edges are sorted by
 * weight with ties broken by document order, so the same document always
 * produces the same tree — an arbitrary tie-break would make the highlighted
 * edges flicker between recomputations for no mathematical reason.
 *
 * A disconnected graph has no spanning tree at all. Rather than returning
 * nothing, we return the minimum spanning *forest* — one minimum tree per
 * component — and say so, with `spansAll: false`.
 */

import type { Graph } from '../model/graph'
import type { EdgeId, PropertyResult } from '../model/types'
import { DisjointSet, connectedComponents } from './traversal'

export interface MstResult {
  edgeIds: EdgeId[]
  totalWeight: number
  /** True only when the result is a spanning tree of the whole graph. */
  spansAll: boolean
  componentCount: number
}

/** At most four decimals, trailing zeros stripped, never "-0". */
const formatWeight = (x: number): string => {
  if (!Number.isFinite(x)) return String(x)
  const rounded = Number(x.toFixed(4))
  return Object.is(rounded, -0) ? '0' : String(rounded)
}

/**
 * Kruskal's minimum spanning forest over the undirected view of the graph.
 *
 * Self-loops are skipped — a loop can never be in a forest. Parallel edges are
 * fine: the cheapest one wins, the rest are rejected as cycles. Negative
 * weights are fine too; Kruskal never assumes weights are positive.
 */
export const minimumSpanningForest = (g: Graph): MstResult => {
  const componentCount = connectedComponents(g).length
  const order = new Map<EdgeId, number>()
  g.edges.forEach((e, i) => order.set(e.id, i))

  const candidates = g.edges
    .filter((e) => e.source !== e.target)
    .map((e) => e.id)
    .sort((a, b) => g.weight(a) - g.weight(b) || order.get(a)! - order.get(b)!)

  const forest = new DisjointSet(g.vertexIds)
  const edgeIds: EdgeId[] = []
  let totalWeight = 0
  for (const id of candidates) {
    const e = g.edge(id)
    if (!e) continue
    if (!forest.union(e.source, e.target)) continue
    edgeIds.push(id)
    totalWeight += g.weight(id)
  }

  return {
    edgeIds,
    totalWeight,
    spansAll: g.order > 0 && componentCount === 1,
    componentCount,
  }
}

/**
 * The minimum spanning tree, or the minimum spanning forest when the graph is
 * disconnected. Kruskal is exact, so this result is never a heuristic.
 */
export const minimumSpanningTree = (g: Graph): PropertyResult<MstResult | null> => {
  if (g.order === 0) {
    return {
      value: null,
      display: '—',
      status: 'neutral',
      exactness: 'not-applicable',
      explanation: 'An empty graph has no vertices to span, so it has no spanning tree.',
    }
  }

  const result = minimumSpanningForest(g)
  const edgeCount = result.edgeIds.length
  const weightText = formatWeight(result.totalWeight)

  const notes: string[] = [
    'Edges are sorted by weight and ties are broken by document order, so the same document always gives the same tree.',
  ]
  if (!g.weighted) {
    notes.push(
      'This graph is unweighted, so every edge counts as 1 and the total is simply the number of edges: V minus the number of components.',
    )
  }
  if (g.weighted && g.edges.some((e) => g.weight(e.id) < 0)) {
    notes.push(
      'Some weights are negative, which is no problem here: Kruskal’s algorithm only ever compares weights, so it never needs them to be positive.',
    )
  }
  if (g.selfLoops().length > 0) {
    notes.push('Self-loops were skipped — a loop can never be part of a tree.')
  }
  if (g.directed) {
    notes.push(
      'Graphualize computes the minimum spanning tree of the underlying undirected graph: edge directions are ignored. The directed analogue is a minimum spanning arborescence (Chu–Liu/Edmonds), which is a different problem and is not implemented here.',
    )
  }

  const witness = {
    type: 'tree' as const,
    edgeIds: result.edgeIds,
    caption: result.spansAll
      ? `Minimum spanning tree, weight ${weightText}`
      : `Minimum spanning forest, ${result.componentCount} trees, weight ${weightText}`,
  }

  if (!result.spansAll) {
    return {
      value: result,
      display: `${weightText} (forest of ${result.componentCount})`,
      status: 'warning',
      exactness: 'exact',
      explanation: `This graph has ${result.componentCount} components, so it has no spanning tree. Shown instead is the minimum spanning forest: one minimum tree per component, ${edgeCount} ${edgeCount === 1 ? 'edge' : 'edges'} of total weight ${weightText}.`,
      detail: notes.join(' '),
      witness,
    }
  }

  return {
    value: result,
    display: weightText,
    status: 'neutral',
    exactness: 'exact',
    explanation: `A minimum spanning tree uses ${edgeCount} ${edgeCount === 1 ? 'edge' : 'edges'} and has total weight ${weightText}. No spanning tree of this graph weighs less — Kruskal's algorithm is exact.`,
    detail: notes.join(' '),
    witness,
  }
}
