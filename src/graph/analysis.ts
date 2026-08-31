import type { Graph } from './model/graph'
import type {
  Exactness,
  GraphWitness,
  PropertyResult,
  PropertyStatus,
  VertexId,
} from './model/types'
import {
  analyzeDistances,
  shortestWalkBetween,
  type DistanceMetrics,
} from './properties/distance'
import {
  CONNECTIVITY_VERTEX_LIMIT,
  biconnectivity,
  edgeConnectivity,
  stronglyConnectedComponents,
  vertexConnectivity,
} from './properties/connectivity'
import { connectedComponents } from './properties/traversal'
import {
  analyzeBipartite,
  analyzeCompleteBipartite,
  analyzeCompleteness,
  analyzeRegularity,
  analyzeTree,
  density,
  findCycle,
  topologicalOrder,
} from './properties/structure'
import { analyzeEulerian, girth } from './properties/cycles'
import { analyzePlanarity } from './properties/planarity'
import {
  CHROMATIC_POLYNOMIAL_VERTEX_LIMIT,
  chromaticNumber,
  chromaticPolynomialSmall,
  greedyColoring,
} from './properties/coloring'
import { maximumClique, maximumIndependentSet } from './properties/cliques'
import { maximalMatching, maximumMatching } from './properties/matching'
import { minimumSpanningTree } from './properties/spanning'
import { hamiltonian } from './properties/hamiltonian'
import {
  adjacencySpectrum,
  algebraicConnectivity,
  laplacianSpectrum,
  spanningTreeCount,
} from './properties/spectrum'

export type SectionTier = 'core' | 'metrics' | 'hard'

export interface InspectorRow {
  id: string
  label: string
  value: string
  status?: PropertyStatus
  explanation?: string
  detail?: string
  witness?: GraphWitness
  exactness?: Exactness
}

export interface InspectorSection {
  id: string
  title: string
  tier: SectionTier
  rows: InspectorRow[]
  note?: string
}

const YES = 'Yes'
const NO = 'No'

const fromResult = <T,>(
  id: string,
  label: string,
  result: PropertyResult<T>,
): InspectorRow => ({
  id,
  label,
  value: result.display,
  status: result.status,
  explanation: result.explanation,
  detail: result.detail,
  witness: result.witness,
  exactness: result.exactness,
})

const row = (
  id: string,
  label: string,
  value: string,
  extra: Partial<InspectorRow> = {},
): InspectorRow => ({ id, label, value, ...extra })

const round = (x: number, places = 3): string => {
  if (!Number.isFinite(x)) return x > 0 ? '∞' : '-∞'
  const r = Number(x.toFixed(places))
  return Object.is(r, -0) ? '0' : String(r)
}

const listLabels = (graph: Graph, ids: readonly VertexId[], max = 8): string => {
  if (ids.length === 0) return 'none'
  const shown = graph.labels(ids.slice(0, max)).join(', ')
  return ids.length > max ? `${shown}, +${ids.length - max} more` : shown
}

/**
 * Degree sequences get long fast, so repeated values collapse into the usual
 * exponent-style shorthand: [3x10] rather than ten threes.
 */
const compactSequence = (seq: readonly number[], max = 10): string => {
  if (seq.length === 0) return '[ ]'
  if (seq.length <= max) return `[${seq.join(', ')}]`
  const runs: { value: number; count: number }[] = []
  for (const value of seq) {
    const last = runs[runs.length - 1]
    if (last && last.value === value) last.count += 1
    else runs.push({ value, count: 1 })
  }
  const rendered = runs.map((run) => (run.count > 1 ? `${run.value}x${run.count}` : `${run.value}`))
  if (rendered.length <= max) return `[${rendered.join(', ')}]`
  return `[${rendered.slice(0, max).join(', ')}, ...] (${seq.length} values)`
}

const cycleWitness = (
  graph: Graph,
  cycle: { vertexIds: VertexId[]; edgeIds: string[] },
): GraphWitness => ({
  type: 'cycle',
  vertexIds: cycle.vertexIds,
  edgeIds: cycle.edgeIds,
  caption: `${graph.labels(cycle.vertexIds).join(' → ')} → ${graph.label(cycle.vertexIds[0]!)}`,
})

/* ------------------------------------------------------------------ */
/* Core: recomputed on every structural change                         */
/* ------------------------------------------------------------------ */

export interface CoreAnalysis {
  structureKey: string
  sections: InspectorSection[]
  components: VertexId[][]
  bipartitePartition: [VertexId[], VertexId[]] | null
}

export const analyzeCore = (graph: Graph): CoreAnalysis => {
  const n = graph.order
  const m = graph.size
  const components = connectedComponents(graph)
  const bipartite = analyzeBipartite(graph)
  const regularity = analyzeRegularity(graph)
  const completeness = analyzeCompleteness(graph)
  const tree = analyzeTree(graph)
  const { bridges, articulationPoints } = biconnectivity(graph)
  const euler = analyzeEulerian(graph)
  const loops = graph.selfLoops()
  const parallel = graph.parallelEdgeGroups()

  /* Overview -------------------------------------------------------- */
  const degrees = graph.vertices.map((v) => graph.degree(v.id))
  const avgDegree = n === 0 ? 0 : degrees.reduce((a, b) => a + b, 0) / n
  const overview: InspectorRow[] = [
    row('vertices', 'Vertices', String(n), {
      witness: n ? { type: 'vertices', vertexIds: graph.vertexIds } : undefined,
    }),
    row('edges', 'Edges', String(m), {
      witness: m ? { type: 'edges', edgeIds: graph.edgeIds } : undefined,
    }),
    row('density', 'Density', n < 2 ? '—' : round(density(graph)), {
      explanation: graph.directed
        ? 'Edges divided by n(n-1), the number of ordered pairs.'
        : 'Edges divided by n(n-1)/2, the number of unordered pairs.',
    }),
    row('degreeSequence', 'Degree sequence', compactSequence(graph.degreeSequence())),
    row('minDegree', 'Minimum degree', n ? String(regularity.min) : '—', {
      witness: n
        ? {
            type: 'vertices',
            vertexIds: graph.vertexIds.filter((id) => graph.degree(id) === regularity.min),
            caption: `Degree ${regularity.min}`,
          }
        : undefined,
    }),
    row('maxDegree', 'Maximum degree', n ? String(regularity.max) : '—', {
      witness: n
        ? {
            type: 'vertices',
            vertexIds: graph.vertexIds.filter((id) => graph.degree(id) === regularity.max),
            caption: `Degree ${regularity.max}`,
          }
        : undefined,
    }),
    row('avgDegree', 'Average degree', n ? round(avgDegree) : '—', {
      explanation: n ? `2m/n = 2 × ${m} / ${n}` : undefined,
    }),
  ]
  if (graph.directed) {
    overview.push(
      row('indegSeq', 'Indegree sequence', compactSequence(graph.inDegreeSequence())),
      row('outdegSeq', 'Outdegree sequence', compactSequence(graph.outDegreeSequence())),
      row(
        'sources',
        'Sources',
        String(graph.vertexIds.filter((id) => graph.inDegree(id) === 0).length),
        {
          explanation: 'Vertices with no incoming arcs.',
          witness: {
            type: 'vertices',
            vertexIds: graph.vertexIds.filter((id) => graph.inDegree(id) === 0),
          },
        },
      ),
      row(
        'sinks',
        'Sinks',
        String(graph.vertexIds.filter((id) => graph.outDegree(id) === 0).length),
        {
          explanation: 'Vertices with no outgoing arcs.',
          witness: {
            type: 'vertices',
            vertexIds: graph.vertexIds.filter((id) => graph.outDegree(id) === 0),
          },
        },
      ),
    )
  }
  overview.push(
    row('simple', 'Simple', graph.isSimple() ? YES : NO, {
      status: graph.isSimple() ? 'success' : 'neutral',
      explanation: graph.isSimple()
        ? 'No self-loops and no repeated edges.'
        : `${loops.length} self-loop${loops.length === 1 ? '' : 's'} and ${parallel.length} repeated connection${parallel.length === 1 ? '' : 's'}.`,
      witness: graph.isSimple()
        ? undefined
        : { type: 'edges', edgeIds: [...loops, ...parallel.flat()] },
    }),
  )

  /* Connectivity ---------------------------------------------------- */
  const connectivity: InspectorRow[] = []
  const connected = n > 0 && components.length === 1
  connectivity.push(
    row(
      'connected',
      graph.directed ? 'Weakly connected' : 'Connected',
      n === 0 ? '—' : connected ? YES : NO,
      {
        status: connected ? 'success' : 'warning',
        explanation: connected
          ? 'Every vertex can reach every other vertex when direction is ignored.'
          : `The graph splits into ${components.length} components.`,
        witness: connected
          ? undefined
          : { type: 'partition', groups: components, captions: components.map((_, i) => `Component ${i + 1}`) },
      },
    ),
    row('components', 'Components', String(components.length), {
      explanation:
        components.length > 1
          ? `Sizes ${components.map((c) => c.length).join(', ')}.`
          : undefined,
      witness:
        components.length > 0
          ? {
              type: 'partition',
              groups: components,
              captions: components.map((_, i) => `Component ${i + 1}`),
            }
          : undefined,
    }),
  )

  if (graph.directed) {
    const sccs = stronglyConnectedComponents(graph)
    const strong = n > 0 && sccs.length === 1
    connectivity.push(
      row('stronglyConnected', 'Strongly connected', n === 0 ? '—' : strong ? YES : NO, {
        status: strong ? 'success' : 'warning',
        explanation: strong
          ? 'Every vertex reaches every other vertex following the arrows.'
          : `Following the arrows the graph breaks into ${sccs.length} strongly connected components.`,
        witness: {
          type: 'partition',
          groups: sccs,
          captions: sccs.map((_, i) => `SCC ${i + 1}`),
        },
      }),
      row('sccCount', 'Strong components', String(sccs.length), {
        witness: {
          type: 'partition',
          groups: sccs,
          captions: sccs.map((_, i) => `SCC ${i + 1}`),
        },
      }),
    )
  }

  connectivity.push(
    row('bridges', 'Bridges', String(bridges.length), {
      status: bridges.length ? 'warning' : 'neutral',
      explanation: bridges.length
        ? 'Removing any one of these edges increases the number of components.'
        : 'No single edge disconnects the graph.',
      witness: bridges.length ? { type: 'edges', edgeIds: bridges } : undefined,
    }),
    row('articulation', 'Articulation vertices', String(articulationPoints.length), {
      status: articulationPoints.length ? 'warning' : 'neutral',
      explanation: articulationPoints.length
        ? `Removing ${listLabels(graph, articulationPoints)} disconnects the graph.`
        : 'No single vertex disconnects the graph.',
      witness: articulationPoints.length
        ? { type: 'vertices', vertexIds: articulationPoints }
        : undefined,
    }),
  )

  /* Structure ------------------------------------------------------- */
  const structure: InspectorRow[] = []
  structure.push(
    row('complete', 'Complete', completeness.isComplete ? YES : NO, {
      status: completeness.isComplete ? 'success' : 'neutral',
      explanation: completeness.isComplete
        ? graph.directed
          ? 'Every ordered pair of distinct vertices has an arc.'
          : `Every pair of distinct vertices is joined: this is K${n}.`
        : n < 2
          ? undefined
          : `Missing ${completeness.missing.length > 400 ? 'more than 400' : completeness.missing.length} of the ${graph.directed ? n * (n - 1) : (n * (n - 1)) / 2} possible edges.`,
      witness:
        !completeness.isComplete && completeness.missing.length && completeness.missing.length <= 400
          ? {
              type: 'vertices',
              vertexIds: [...new Set(completeness.missing.flat())],
              caption: 'Vertices with a missing connection',
            }
          : undefined,
    }),
    row(
      'regular',
      'Regular',
      regularity.regular && n > 0 ? `Yes, ${regularity.degree}-regular` : NO,
      {
        status: regularity.regular && n > 0 ? 'success' : 'neutral',
        explanation: regularity.regular
          ? n > 0
            ? `Every vertex has degree ${regularity.degree}.`
            : undefined
          : `Degrees range from ${regularity.min} to ${regularity.max}.`,
        witness: regularity.regular
          ? undefined
          : {
              type: 'vertices',
              vertexIds: graph.vertexIds.filter(
                (id) => graph.degree(id) === regularity.min || graph.degree(id) === regularity.max,
              ),
              caption: 'Lowest and highest degree',
            },
      },
    ),
    row('tree', 'Tree', tree.isTree ? YES : NO, {
      status: tree.isTree ? 'success' : 'neutral',
      explanation: tree.reason,
      witness: tree.cycle
        ? cycleWitness(graph, tree.cycle)
        : tree.componentCount > 1
          ? { type: 'partition', groups: components }
          : undefined,
    }),
    row('forest', 'Forest', tree.isForest && n > 0 ? YES : NO, {
      status: tree.isForest && n > 0 ? 'success' : 'neutral',
      explanation: tree.isForest
        ? `Acyclic, with ${tree.componentCount} component${tree.componentCount === 1 ? '' : 's'}.`
        : 'The graph contains a cycle.',
      witness: tree.cycle ? cycleWitness(graph, tree.cycle) : undefined,
    }),
    row('bipartite', 'Bipartite', bipartite.isBipartite ? YES : NO, {
      status: bipartite.isBipartite ? 'success' : 'neutral',
      explanation: bipartite.isBipartite
        ? bipartite.partition
          ? `The vertices split into groups of ${bipartite.partition[0].length} and ${bipartite.partition[1].length} with every edge crossing between them.`
          : undefined
        : bipartite.oddCycle
          ? `${graph.labels(bipartite.oddCycle.vertexIds).join(' → ')} → ${graph.label(bipartite.oddCycle.vertexIds[0]!)} is a cycle of odd length ${bipartite.oddCycle.edgeIds.length}, and no odd cycle fits in two parts.`
          : undefined,
      witness: bipartite.isBipartite
        ? bipartite.partition
          ? {
              type: 'partition',
              groups: bipartite.partition,
              captions: ['Part 1', 'Part 2'],
            }
          : undefined
        : bipartite.oddCycle
          ? cycleWitness(graph, bipartite.oddCycle)
          : undefined,
    }),
  )

  const kmn = analyzeCompleteBipartite(graph)
  if (kmn.isCompleteBipartite && kmn.sizes && kmn.partition) {
    structure.push(
      row('completeBipartite', 'Complete bipartite', `K${kmn.sizes[0]},${kmn.sizes[1]}`, {
        status: 'success',
        explanation: 'Every vertex on one side is joined to every vertex on the other.',
        witness: {
          type: 'partition',
          groups: kmn.partition,
          captions: [`Part of size ${kmn.sizes[0]}`, `Part of size ${kmn.sizes[1]}`],
        },
      }),
    )
  }

  if (graph.directed) {
    const topo = topologicalOrder(graph)
    structure.push(
      row('dag', 'Acyclic (DAG)', topo.order ? YES : NO, {
        status: topo.order ? 'success' : 'neutral',
        explanation: topo.order
          ? 'The arcs admit a topological order, so there is no directed cycle.'
          : topo.cycle
            ? `Directed cycle ${graph.labels(topo.cycle.vertexIds).join(' → ')} → ${graph.label(topo.cycle.vertexIds[0]!)}.`
            : undefined,
        witness: topo.order
          ? { type: 'vertices', vertexIds: topo.order, caption: 'Topological order' }
          : topo.cycle
            ? cycleWitness(graph, topo.cycle)
            : undefined,
      }),
    )
    if (topo.order) {
      structure.push(
        row('topoOrder', 'Topological order', listLabels(graph, topo.order, 10), {
          witness: { type: 'vertices', vertexIds: topo.order, caption: 'Topological order' },
        }),
      )
    }
  }

  const planarity = analyzePlanarity(graph)
  structure.push(
    row(
      'planar',
      'Planar',
      planarity.planar === null ? 'Not computed' : planarity.planar ? YES : NO,
      {
        status:
          planarity.planar === null ? 'neutral' : planarity.planar ? 'success' : 'neutral',
        explanation: planarity.reason,
        exactness: planarity.planar === null ? 'not-computed' : 'exact',
      },
    ),
  )

  /* Cycles ---------------------------------------------------------- */
  const anyCycle = findCycle(graph)
  const g = girth(graph)
  const cycles: InspectorRow[] = [
    row('hasCycle', graph.directed ? 'Contains directed cycle' : 'Contains cycle', anyCycle ? YES : NO, {
      status: anyCycle ? 'neutral' : 'success',
      explanation: anyCycle
        ? `${graph.labels(anyCycle.vertexIds).join(' → ')} → ${graph.label(anyCycle.vertexIds[0]!)}`
        : graph.directed
          ? 'No directed cycle: the graph is a DAG.'
          : 'The graph is acyclic.',
      witness: anyCycle ? cycleWitness(graph, anyCycle) : undefined,
    }),
    row('girth', 'Girth', Number.isFinite(g.value) ? String(g.value) : '∞', {
      explanation: Number.isFinite(g.value)
        ? `Length of the shortest cycle${g.cycle ? `: ${graph.labels(g.cycle.vertexIds).join(' → ')} → ${graph.label(g.cycle.vertexIds[0]!)}` : ''}.`
        : 'The graph has no cycle, so its girth is infinite by convention.',
      witness: g.cycle ? cycleWitness(graph, g.cycle) : undefined,
    }),
    row('eulerCircuit', 'Eulerian circuit', euler.hasCircuit ? YES : NO, {
      status: euler.hasCircuit ? 'success' : 'neutral',
      explanation: euler.reason,
      witness: euler.hasCircuit && euler.walk
        ? { type: 'trail', vertexIds: euler.walk.vertexIds, edgeIds: euler.walk.edgeIds, caption: 'Eulerian circuit' }
        : euler.oddVertices.length
          ? { type: 'vertices', vertexIds: euler.oddVertices, caption: 'Odd degree' }
          : euler.unbalanced.length
            ? { type: 'vertices', vertexIds: euler.unbalanced.map((u) => u.id), caption: 'Unbalanced' }
            : undefined,
    }),
    row('eulerTrail', 'Eulerian trail', euler.hasTrail ? YES : NO, {
      status: euler.hasTrail ? 'success' : 'neutral',
      explanation: euler.hasCircuit
        ? 'Every Eulerian circuit is also a trail.'
        : euler.reason,
      witness:
        euler.hasTrail && euler.walk
          ? { type: 'trail', vertexIds: euler.walk.vertexIds, edgeIds: euler.walk.edgeIds, caption: 'Eulerian trail' }
          : undefined,
    }),
  ]
  if (!graph.directed) {
    const odd = graph.vertexIds.filter((id) => graph.degree(id) % 2 === 1)
    cycles.push(
      row('oddDegree', 'Odd-degree vertices', String(odd.length), {
        explanation: odd.length ? listLabels(graph, odd) : 'Every vertex has even degree.',
        witness: odd.length ? { type: 'vertices', vertexIds: odd } : undefined,
      }),
    )
  }

  const sections: InspectorSection[] = [
    { id: 'overview', title: 'Overview', tier: 'core', rows: overview },
    { id: 'connectivity', title: 'Connectivity', tier: 'core', rows: connectivity },
    { id: 'structure', title: 'Structure', tier: 'core', rows: structure },
    { id: 'cycles', title: 'Cycles', tier: 'core', rows: cycles },
  ]

  return {
    structureKey: graph.structureKey(),
    components,
    bipartitePartition: bipartite.partition,
    sections: n === 0 ? sections.map(blankForEmptyGraph) : sections,
  }
}

/**
 * Almost every classification is vacuously true of the empty graph, which is
 * mathematically fine and completely useless to read. Those rows show a dash
 * instead of a confident "Yes".
 */
const VACUOUS_ROW_IDS = new Set([
  'complete',
  'regular',
  'tree',
  'forest',
  'bipartite',
  'completeBipartite',
  'planar',
  'dag',
  'topoOrder',
  'hasCycle',
  'girth',
  'eulerCircuit',
  'eulerTrail',
  'oddDegree',
  'connected',
  'stronglyConnected',
  'simple',
  'bridges',
  'articulation',
])

const blankForEmptyGraph = (section: InspectorSection): InspectorSection => ({
  ...section,
  rows: section.rows.map((row) =>
    VACUOUS_ROW_IDS.has(row.id)
      ? {
          id: row.id,
          label: row.label,
          value: '—',
          explanation: 'The graph has no vertices yet.',
        }
      : row,
  ),
})

/* ------------------------------------------------------------------ */
/* Metrics: debounced                                                  */
/* ------------------------------------------------------------------ */

export interface MetricAnalysis {
  structureKey: string
  sections: InspectorSection[]
  distances: DistanceMetrics
}

export const analyzeMetrics = (graph: Graph): MetricAnalysis => {
  const distances = analyzeDistances(graph)
  const rows: InspectorRow[] = []
  const semantics = distances.weighted
    ? 'Distances use edge weights.'
    : graph.weighted
      ? 'Distances count edges, ignoring weights.'
      : 'Distances count edges.'

  if (!distances.computed) {
    rows.push(
      row('distanceSkipped', 'Distance metrics', 'Not computed', {
        exactness: 'not-computed',
        explanation: 'All-pairs distances are skipped above 400 vertices.',
      }),
    )
  } else if (graph.order === 0) {
    rows.push(row('diameter', 'Diameter', '—', { explanation: 'The graph is empty.' }))
  } else if (distances.negativeCycle) {
    // Shortest distances do not exist, so neither do any of the metrics built
    // on them. Showing numbers here would be worse than showing nothing.
    rows.push(
      row('negativeCycle', 'Negative cycle', YES, {
        status: 'danger',
        explanation: graph.directed
          ? 'Some directed cycle has negative total weight, so a shortest walk can always be made shorter.'
          : 'An undirected negative edge can be walked back and forth forever, so a shortest walk can always be made shorter.',
        exactness: 'exact',
      }),
      row('distanceUndefined', 'Diameter, radius, centre', 'Not defined', {
        exactness: 'not-applicable',
        explanation:
          'Shortest distances are undefined while a negative cycle exists, so none of the distance metrics can be computed.',
      }),
    )
  } else {
    const finite = Number.isFinite(distances.diameter)
    const pair = finite && distances.diameter > 0 ? distances.diameterPair : null
    const witnessPath = pair
      ? (() => {
          const walk = shortestWalkBetween(graph, pair[0], pair[1], distances.weighted)
          return walk
            ? {
                type: 'path' as const,
                vertexIds: walk.vertexIds,
                edgeIds: walk.edgeIds,
                caption: `${graph.label(pair[0])} to ${graph.label(pair[1])}`,
              }
            : undefined
        })()
      : undefined

    rows.push(
      row('diameter', 'Diameter', finite ? round(distances.diameter) : '∞', {
        status: finite ? 'neutral' : 'warning',
        explanation: finite
          ? pair
            ? `The furthest pair is ${graph.label(pair[0])} and ${graph.label(pair[1])}. ${semantics}`
            : semantics
          : distances.largestComponentDiameter !== null
            ? `Infinite: some pairs are unreachable. The largest component has diameter ${distances.largestComponentDiameter}.`
            : 'Infinite: some pairs are unreachable.',
        witness: witnessPath,
        exactness: 'exact',
      }),
      row('radius', 'Radius', Number.isFinite(distances.radius) ? round(distances.radius) : '∞', {
        explanation: distances.stronglyReachable
          ? 'The smallest eccentricity in the graph.'
          : 'Every vertex has infinite eccentricity while some pairs are unreachable.',
        witness: distances.stronglyReachable && distances.center.length
          ? { type: 'vertices', vertexIds: distances.center, caption: 'Centre' }
          : undefined,
      }),
    )

    if (distances.stronglyReachable) {
      rows.push(
        row('center', 'Centre', listLabels(graph, distances.center), {
          explanation: 'Vertices whose eccentricity equals the radius.',
          witness: distances.center.length
            ? { type: 'vertices', vertexIds: distances.center, caption: 'Centre' }
            : undefined,
        }),
        row('periphery', 'Periphery', listLabels(graph, distances.periphery), {
          explanation: 'Vertices whose eccentricity equals the diameter.',
          witness: distances.periphery.length
            ? { type: 'vertices', vertexIds: distances.periphery, caption: 'Periphery' }
            : undefined,
        }),
      )
    } else {
      // With unreachable pairs every eccentricity is infinite, so "the vertices
      // achieving the minimum" would be all of them, which says nothing.
      rows.push(
        row('center', 'Centre', '—', {
          exactness: 'not-applicable',
          explanation: graph.directed
            ? 'The centre is defined for graphs where every vertex reaches every other; this one has unreachable pairs.'
            : 'The centre is defined for connected graphs; this one has more than one component.',
        }),
        row('periphery', 'Periphery', '—', {
          exactness: 'not-applicable',
          explanation: 'Undefined while some pairs are unreachable.',
        }),
      )
    }
  }

  const colouring = greedyColoring(graph, 'dsatur')
  const colourRows: InspectorRow[] = [
    row('greedyColoring', 'Greedy colouring', `${colouring.count} colours`, {
      explanation: 'DSATUR ordering. This is an upper bound on the chromatic number.',
      exactness: 'upper-bound',
      witness: { type: 'coloring', colors: colouring.colors, count: colouring.count },
    }),
  ]

  const matchRows: InspectorRow[] = []
  const maxMatch = maximumMatching(graph)
  matchRows.push(fromResult('maximumMatching', 'Maximum matching', maxMatch))
  const maximal = maximalMatching(graph)
  matchRows.push(
    row('maximalMatching', 'Maximal matching (greedy)', String(maximal.size), {
      explanation:
        'A matching no edge can be added to. Greedy, so it can be smaller than the maximum.',
      exactness: 'heuristic',
      witness: maximal.edgeIds.length ? { type: 'matching', edgeIds: maximal.edgeIds } : undefined,
    }),
  )
  matchRows.push(
    row(
      'perfectMatching',
      'Perfect matching',
      maxMatch.value.isMaximum ? (maxMatch.value.isPerfect ? YES : NO) : 'Unknown',
      {
        status: maxMatch.value.isPerfect ? 'success' : 'neutral',
        explanation: maxMatch.value.isMaximum
          ? maxMatch.value.isPerfect
            ? 'Every vertex is covered exactly once.'
            : graph.order % 2 === 1
              ? `${graph.order} is odd, so some vertex is always left out.`
              : `A perfect matching would need ${graph.order / 2} edges; the maximum is ${maxMatch.value.size}.`
          : 'The maximum matching was not computed, so this cannot be decided.',
        exactness: maxMatch.value.isMaximum ? 'exact' : 'not-computed',
        witness: maxMatch.value.isPerfect
          ? { type: 'matching', edgeIds: maxMatch.value.edgeIds }
          : undefined,
      },
    ),
  )

  const spanningRows: InspectorRow[] = [
    fromResult('mst', 'Minimum spanning tree', minimumSpanningTree(graph)),
    fromResult('spanningTreeCount', 'Spanning trees', spanningTreeCount(graph)),
  ]

  const spectrumRows: InspectorRow[] = [
    fromResult('adjacencySpectrum', 'Adjacency spectrum', adjacencySpectrum(graph)),
    fromResult('laplacianSpectrum', 'Laplacian spectrum', laplacianSpectrum(graph)),
    fromResult('algebraicConnectivity', 'Algebraic connectivity', algebraicConnectivity(graph)),
  ]

  return {
    structureKey: graph.structureKey(),
    distances,
    sections: [
      { id: 'distance', title: 'Distance', tier: 'metrics', rows, note: semantics },
      { id: 'coloring', title: 'Colouring', tier: 'metrics', rows: colourRows },
      { id: 'matching', title: 'Matching', tier: 'metrics', rows: matchRows },
      { id: 'spanning', title: 'Spanning trees', tier: 'metrics', rows: spanningRows },
      { id: 'spectrum', title: 'Spectrum', tier: 'metrics', rows: spectrumRows },
    ],
  }
}

/* ------------------------------------------------------------------ */
/* Hard: NP-hard invariants, run on demand                             */
/* ------------------------------------------------------------------ */

export interface HardAnalysis {
  structureKey: string
  sections: InspectorSection[]
}

export const analyzeHard = (graph: Graph): HardAnalysis => {
  const chromatic = chromaticNumber(graph)
  const clique = maximumClique(graph)
  const independent = maximumIndependentSet(graph)
  const ham = hamiltonian(graph)

  const polynomial = chromaticPolynomialSmall(graph)
  const rows: InspectorRow[] = [
    fromResult('chromaticNumber', 'Chromatic number', chromatic),
    row(
      'chromaticPolynomial',
      'Chromatic polynomial',
      polynomial ? polynomial.text : 'Not computed',
      {
        exactness: polynomial ? 'exact' : 'not-computed',
        explanation: polynomial
          ? 'P(G, k) counts the proper colourings with k colours. Its smallest positive integer root is the chromatic number.'
          : `The chromatic polynomial needs a sum over subsets, so it is computed only up to ${CHROMATIC_POLYNOMIAL_VERTEX_LIMIT} vertices.`,
        detail: polynomial
          ? 'Exact integer coefficients, from a subset dynamic program over independent sets.'
          : undefined,
      },
    ),
    fromResult('cliqueNumber', 'Maximum clique', clique),
    fromResult('independenceNumber', 'Maximum independent set', independent),
    fromResult('hamiltonian', 'Hamiltonian', ham),
  ]

  const connectivityRows: InspectorRow[] = []
  const ec = edgeConnectivity(graph)
  const vc = vertexConnectivity(graph)
  connectivityRows.push(
    row('edgeConnectivity', 'Edge connectivity', ec ? String(ec.value) : 'Not computed', {
      exactness: ec ? 'exact' : 'not-computed',
      explanation: ec
        ? (ec.reason ??
          `Removing ${ec.value} edge${ec.value === 1 ? '' : 's'} disconnects the graph, and no smaller set does.`)
        : `Exact edge connectivity is skipped above ${CONNECTIVITY_VERTEX_LIMIT} vertices.`,
      witness: ec?.edgeIds?.length ? { type: 'edges', edgeIds: ec.edgeIds, caption: 'Minimum cut' } : undefined,
    }),
    row('vertexConnectivity', 'Vertex connectivity', vc ? String(vc.value) : 'Not computed', {
      exactness: vc ? 'exact' : 'not-computed',
      explanation: vc
        ? (vc.reason ??
          `Removing ${vc.value} vertex${vc.value === 1 ? '' : 'es'} disconnects the graph, and no smaller set does.`)
        : 'Exact vertex connectivity is skipped above 60 vertices.',
      witness: vc?.vertexIds?.length
        ? { type: 'vertices', vertexIds: vc.vertexIds, caption: 'Minimum separator' }
        : undefined,
    }),
  )

  return {
    structureKey: graph.structureKey(),
    sections: [
      { id: 'hard', title: 'Hard invariants', tier: 'hard', rows },
      { id: 'cuts', title: 'Cuts', tier: 'hard', rows: connectivityRows },
    ],
  }
}
