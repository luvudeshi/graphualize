/**
 * Greedy vertex colouring, as a sequence of player frames.
 *
 * The colouring rule never changes — take the smallest colour no coloured
 * neighbour is using — so the whole lesson is in the *order*. Four orders are
 * offered, including a real smallest-last (degeneracy) ordering.
 *
 * `colors[v]` is a 0-based palette index for the renderer; the prose and the
 * badges count from 1, because "colour 1" reads better than "colour 0".
 * Direction is ignored and self-loops are skipped: colouring is a question
 * about the undirected simple graph.
 */

import type { Graph } from '../model/graph'
import type { VertexId } from '../model/types'
import type { AlgorithmDefinition, AlgorithmOptions, AlgorithmRun, VertexOrdering } from './types'
import { emptyRun, formatList } from './types'
import { StepRecorder } from './shared'

const ID = 'greedy-coloring'
const TITLE = 'Greedy colouring'

type Ordering = VertexOrdering

const DEFAULT_ORDERING: Ordering = 'largest-first'

/** Prose names, for the first frame and the summary. */
const ORDERING_NAMES: Record<Ordering, string> = {
  document: 'document order',
  'largest-first': 'largest first (highest degree first)',
  'smallest-last': 'smallest last (degeneracy order)',
  dsatur: 'DSATUR (most saturated first)',
}

/** Distinct neighbours in document order, self-loops dropped. */
const adjacency = (graph: Graph): Map<VertexId, VertexId[]> => {
  const adj = new Map<VertexId, VertexId[]>()
  for (const id of graph.vertexIds) {
    const set = new Set<VertexId>()
    for (const inc of graph.neighbors(id)) if (inc.to !== id) set.add(inc.to)
    adj.set(id, [...set].sort((a, b) => graph.index(a) - graph.index(b)))
  }
  return adj
}

/**
 * Degeneracy order: strip a vertex of least remaining degree over and over,
 * then colour in the reverse of that removal order.
 */
const smallestLastOrder = (graph: Graph, adj: Map<VertexId, VertexId[]>): VertexId[] => {
  const remaining = new Set<VertexId>(graph.vertexIds)
  const degree = new Map<VertexId, number>()
  for (const id of graph.vertexIds) degree.set(id, (adj.get(id) ?? []).length)

  const removal: VertexId[] = []
  while (remaining.size) {
    let best: VertexId | null = null
    let bestDegree = Infinity
    for (const id of graph.vertexIds) {
      // Document order settles ties, so the ordering is reproducible.
      if (!remaining.has(id)) continue
      const d = degree.get(id) ?? 0
      if (d < bestDegree) {
        bestDegree = d
        best = id
      }
    }
    if (best === null) break
    remaining.delete(best)
    removal.push(best)
    for (const n of adj.get(best) ?? []) {
      if (remaining.has(n)) degree.set(n, (degree.get(n) ?? 1) - 1)
    }
  }
  return removal.reverse()
}

const staticOrder = (
  graph: Graph,
  adj: Map<VertexId, VertexId[]>,
  ordering: Ordering,
): VertexId[] => {
  if (ordering === 'smallest-last') return smallestLastOrder(graph, adj)
  if (ordering === 'largest-first') {
    return graph.vertexIds
      .slice()
      .sort(
        (a, b) =>
          (adj.get(b) ?? []).length - (adj.get(a) ?? []).length || graph.index(a) - graph.index(b),
      )
  }
  return graph.vertexIds
}

const run = (graph: Graph, options: AlgorithmOptions): AlgorithmRun => {
  if (graph.order === 0) {
    return emptyRun(ID, TITLE, `${TITLE} needs at least one vertex, and this graph is empty.`)
  }

  const ordering: Ordering = options.ordering ?? DEFAULT_ORDERING
  const adj = adjacency(graph)
  const planned = ordering === 'dsatur' ? [] : staticOrder(graph, adj, ordering)

  const rec = new StepRecorder()
  const colorOf = new Map<VertexId, number>()
  const coloredOrder: VertexId[] = []

  /** DSATUR: most distinct neighbour colours, then highest degree, then document order. */
  const pickDsatur = (): VertexId | null => {
    let best: VertexId | null = null
    let bestSaturation = -1
    let bestDegree = -1
    for (const id of graph.vertexIds) {
      if (colorOf.has(id)) continue
      const used = new Set<number>()
      for (const n of adj.get(id) ?? []) {
        const c = colorOf.get(n)
        if (c !== undefined) used.add(c)
      }
      const degree = (adj.get(id) ?? []).length
      if (used.size > bestSaturation || (used.size === bestSaturation && degree > bestDegree)) {
        best = id
        bestSaturation = used.size
        bestDegree = degree
      }
    }
    return best
  }

  const remaining = (): VertexId[] => graph.vertexIds.filter((id) => !colorOf.has(id))
  const paletteSize = (): number => (colorOf.size ? Math.max(...colorOf.values()) + 1 : 0)
  const panels = () => ({
    Order: formatList(graph, coloredOrder),
    Remaining: formatList(graph, remaining()),
    Colours: String(paletteSize()),
  })

  rec.frontier = remaining()
  rec.emit({
    type: 'start',
    description: `Colour the vertices in ${ORDERING_NAMES[ordering]}`,
    detail:
      ordering === 'dsatur'
        ? 'The next vertex is chosen each turn: the one whose neighbours already use the most different colours.'
        : `Order: ${graph.labels(planned).join(', ')}.`,
    activeVertices: [],
    state: panels(),
  })

  for (let i = 0; i < graph.order; i++) {
    const v = ordering === 'dsatur' ? pickDsatur() : planned[i]
    if (v === null || v === undefined) break

    const neighbours = adj.get(v) ?? []
    const coloredNeighbours = neighbours.filter((n) => colorOf.has(n))
    const forbidden = new Set<number>(coloredNeighbours.map((n) => colorOf.get(n) as number))
    let choice = 0
    while (forbidden.has(choice)) choice += 1

    colorOf.set(v, choice)
    coloredOrder.push(v)
    rec.colors[v] = choice
    rec.badges[v] = String(choice + 1)
    rec.visited.push(v)
    rec.frontier = remaining()

    const forbiddenList = [...forbidden].sort((a, b) => a - b).map((c) => c + 1)
    rec.emit({
      type: 'color',
      description: `Colour ${graph.label(v)} with colour ${choice + 1}`,
      detail: coloredNeighbours.length
        ? `Coloured ${coloredNeighbours.length === 1 ? 'neighbour' : 'neighbours'} ${coloredNeighbours.map((n) => `${graph.label(n)}(${(colorOf.get(n) as number) + 1})`).join(', ')} ${coloredNeighbours.length === 1 ? 'forbids' : 'forbid'} ${forbiddenList.length === 1 ? 'colour' : 'colours'} ${forbiddenList.join(', ')}, so the smallest free colour is ${choice + 1}.`
        : `No coloured neighbour yet, so colour 1 is free.`,
      activeVertices: [v, ...coloredNeighbours],
      activeEdges: coloredNeighbours
        .map((n) => graph.findEdge(v, n) ?? graph.findEdge(n, v))
        .filter((id): id is string => id !== undefined),
      state: panels(),
    })
  }

  const used = paletteSize()
  const classes: VertexId[][] = []
  for (let c = 0; c < used; c++) {
    classes.push(graph.vertexIds.filter((id) => colorOf.get(id) === c))
  }

  rec.frontier = []
  rec.emit({
    type: 'done',
    description: `Done: ${used} ${used === 1 ? 'colour' : 'colours'} used`,
    detail: `No edge joins two vertices of the same colour. Greedy gives an upper bound on the chromatic number, not always the best one.`,
    state: panels(),
  })

  const result = [
    { label: 'Colours used', value: String(used) },
    { label: 'Ordering', value: ORDERING_NAMES[ordering] },
    { label: 'Order', value: graph.labels(coloredOrder).join(', ') },
    {
      label: 'Colour classes',
      value: classes
        .map((members, i) => `${i + 1}: {${members.map((id) => graph.label(id)).join(', ')}}`)
        .join('  '),
    },
  ]

  return { algorithmId: ID, title: TITLE, steps: rec.steps, result }
}

export const greedyColoringAlgorithm: AlgorithmDefinition = {
  id: ID,
  name: TITLE,
  category: 'coloring',
  description:
    'Walks the vertices in a chosen order and gives each the smallest colour none of its neighbours is already using. Edge direction is ignored.',
  needsSource: false,
  // Short menu labels, in the same order as `ORDERING_NAMES`.
  orderings: [
    { id: 'document', label: 'Document order' },
    { id: 'largest-first', label: 'Largest first' },
    { id: 'smallest-last', label: 'Smallest last' },
    { id: 'dsatur', label: 'DSATUR' },
  ],
  defaultOrdering: DEFAULT_ORDERING,
  run,
}
