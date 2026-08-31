/**
 * The algorithm registry.
 *
 * Every entry is a pure function from a {@link Graph} plus options to a run of
 * complete snapshots; nothing here touches React, Cytoscape or the DOM.
 * `ALGORITHMS` is in display order: traversals, then shortest paths, then
 * spanning trees, then ordering and colouring.
 */

import type { AlgorithmDefinition } from './types'

import { bfsAlgorithm } from './bfs'
import { dfsAlgorithm } from './dfs'
import { dijkstraAlgorithm } from './dijkstra'
import { bellmanFordAlgorithm } from './bellmanFord'
import { primAlgorithm } from './prim'
import { kruskalAlgorithm } from './kruskal'
import { topologicalSortAlgorithm } from './topologicalSort'
import { greedyColoringAlgorithm } from './greedyColoring'

export { bfsAlgorithm } from './bfs'
export { dfsAlgorithm } from './dfs'
export { dijkstraAlgorithm } from './dijkstra'
export { bellmanFordAlgorithm } from './bellmanFord'
export { primAlgorithm } from './prim'
export { kruskalAlgorithm } from './kruskal'
export { topologicalSortAlgorithm } from './topologicalSort'
export { greedyColoringAlgorithm } from './greedyColoring'

export const ALGORITHMS: AlgorithmDefinition[] = [
  bfsAlgorithm,
  dfsAlgorithm,
  dijkstraAlgorithm,
  bellmanFordAlgorithm,
  primAlgorithm,
  kruskalAlgorithm,
  topologicalSortAlgorithm,
  greedyColoringAlgorithm,
]

const BY_ID = new Map(ALGORITHMS.map((a) => [a.id, a] as const))

export const algorithmById = (id: string): AlgorithmDefinition | undefined => BY_ID.get(id)
