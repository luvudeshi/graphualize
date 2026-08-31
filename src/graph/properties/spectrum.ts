/**
 * The graph spectrum: eigenvalues of the adjacency and Laplacian matrices, the
 * algebraic connectivity, and the exact spanning tree count.
 *
 * Everything here is deliberately careful about what it claims:
 *
 *  - Eigenvalues come from a floating point eigensolver. They are labelled
 *    `heuristic`, and an eigenvalue that *looks* like -2 is never described as
 *    exactly -2. Multiplicities are inferred by grouping values that agree to
 *    within a tolerance, which is stated in the result's `note`.
 *  - The spanning tree count is computed with `bigint` Bareiss elimination on an
 *    integer minor of the Laplacian. It is the only result in this module
 *    labelled `exact`.
 *  - A directed graph's adjacency matrix is usually not symmetric and can have
 *    genuinely complex eigenvalues. Rather than showing the real parts, or the
 *    spectrum of the symmetrised matrix, we decline and say why.
 */

import type { Graph } from '../model/graph'
import type { Exactness, PropertyResult, PropertyStatus } from '../model/types'
import { adjacencyMatrix, laplacianMatrix } from './matrices'
import { integerDeterminant, isSymmetric, symmetricEigenvalues } from './linalg'

export interface SpectrumResult {
  /** Ascending eigenvalues, full precision. */
  values: number[]
  /** Values grouped into multiplicities after rounding to `tolerance`. */
  grouped: { value: number; multiplicity: number }[]
  matrix: 'adjacency' | 'laplacian'
  /** True only when the underlying matrix was genuinely symmetric. */
  symmetric: boolean
  /** e.g. 'Computed with a cyclic Jacobi eigensolver; values are accurate to about 1e-9.' */
  note: string
}

/** Above this order we decline to build a dense n x n matrix and diagonalise it. */
export const SPECTRUM_VERTEX_LIMIT = 150

/** The Matrix-Tree minor is exact but O(n^3) on big integers, so it needs its own gate. */
export const SPANNING_TREE_VERTEX_LIMIT = 400

/** Eigenvalues closer than this are reported as one value with a multiplicity. */
export const EIGENVALUE_GROUPING_TOLERANCE = 1e-7

const SPECTRUM_NOTE =
  'Computed with a cyclic Jacobi eigensolver. These are floating-point approximations — accurate to roughly 1e-9, not exact algebraic numbers — and multiplicities are inferred by grouping eigenvalues that agree to within 1e-7.'

/* ------------------------------------------------------------------ */
/* Formatting                                                          */
/* ------------------------------------------------------------------ */

/**
 * At most four decimal places, trailing zeros stripped, no negative zero. Used
 * for the spectrum listings, where a tidy column of values matters more than
 * the last digit — the accompanying note says they are approximations.
 */
const formatEigenvalue = (x: number): string => {
  if (!Number.isFinite(x)) return String(x)
  const rounded = Number(x.toFixed(4))
  return Object.is(rounded, -0) ? '0' : String(rounded)
}

/**
 * Four *significant* digits, so a genuinely tiny value keeps its magnitude
 * instead of being flattened to "0" or "0.0004". Used for the algebraic
 * connectivity, where the difference between 4.33e-4 and 1.11e-16 is the whole
 * question being asked.
 */
const formatSignificant = (x: number): string => {
  if (!Number.isFinite(x)) return String(x)
  if (x === 0) return '0'
  const rounded = Number(x.toPrecision(4))
  return Object.is(rounded, -0) ? '0' : String(rounded)
}

const formatGroups = (
  groups: { value: number; multiplicity: number }[],
): string[] =>
  groups.map((g) =>
    g.multiplicity === 1
      ? formatEigenvalue(g.value)
      : `${formatEigenvalue(g.value)} (x${g.multiplicity})`,
  )

const MAX_DISPLAY_GROUPS = 8

const groupsToDisplay = (groups: { value: number; multiplicity: number }[]): string => {
  if (groups.length === 0) return '—'
  const parts = formatGroups(groups)
  if (parts.length <= MAX_DISPLAY_GROUPS) return parts.join(', ')
  return `${parts.slice(0, MAX_DISPLAY_GROUPS).join(', ')}, … (${parts.length} distinct values)`
}

/** Digit grouping so a count like 262144 stays readable at a glance. */
const formatBigInt = (n: bigint): string => {
  const text = n < 0n ? (-n).toString() : n.toString()
  const grouped = text.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return n < 0n ? `-${grouped}` : grouped
}

/* ------------------------------------------------------------------ */
/* Grouping                                                            */
/* ------------------------------------------------------------------ */

/**
 * Collapses an ascending list into (value, multiplicity) pairs. A run continues
 * while the next value stays within `tolerance` of the run's first member, and
 * the reported value is the run's mean — which is a better estimate of the true
 * eigenvalue than any single member of the run.
 */
const groupValues = (
  values: readonly number[],
  tolerance = EIGENVALUE_GROUPING_TOLERANCE,
): { value: number; multiplicity: number }[] => {
  const groups: { value: number; multiplicity: number }[] = []
  let start = 0
  while (start < values.length) {
    let end = start + 1
    while (end < values.length && Math.abs(values[end] - values[start]) <= tolerance) end++
    let sum = 0
    for (let i = start; i < end; i++) sum += values[i]
    groups.push({ value: sum / (end - start), multiplicity: end - start })
    start = end
  }
  return groups
}

/* ------------------------------------------------------------------ */
/* Guards                                                              */
/* ------------------------------------------------------------------ */

const declined = <T>(
  value: T,
  display: string,
  exactness: Exactness,
  explanation: string,
  status: PropertyStatus = 'warning',
): PropertyResult<T> => ({ value, display, status, explanation, exactness })

/**
 * Whether a digraph's adjacency matrix happens to be symmetric, decided from the
 * edge list in O(m) so we never allocate an n x n grid just to find out.
 */
const directedAdjacencyIsSymmetric = (g: Graph): boolean => {
  const totals = new Map<string, number>()
  for (const e of g.edges) {
    if (e.source === e.target) continue
    const key = `${e.source}\u0000${e.target}`
    totals.set(key, (totals.get(key) ?? 0) + g.weight(e.id))
  }
  for (const [key, total] of totals) {
    const [a, b] = key.split('\u0000')
    const reverse = totals.get(`${b}\u0000${a}`) ?? 0
    if (Math.abs(total - reverse) > 1e-12) return false
  }
  return true
}

const overLimitExplanation = (g: Graph, limit: number, what: string): string =>
  `This graph has ${g.order} vertices; Graphualize computes ${what} only up to ${limit} vertices, because the calculation builds a dense ${g.order} x ${g.order} matrix and costs roughly O(n^3).`

const DIRECTED_ADJACENCY_EXPLANATION =
  'The spectrum Graphualize reports is defined for undirected graphs, whose adjacency matrix is symmetric and therefore has real eigenvalues. This digraph’s adjacency matrix is not symmetric, so its eigenvalues may be complex, and the real eigensolver used here would give a misleading answer. Convert the graph to undirected to see a spectrum.'

const DIRECTED_LAPLACIAN_EXPLANATION =
  'The Laplacian spectrum Graphualize reports is defined for undirected graphs, where L = D − A is symmetric and positive semidefinite. The out-degree Laplacian of this digraph is not symmetric, so its eigenvalues may be complex and the real eigensolver used here does not apply. Convert the graph to undirected to see a Laplacian spectrum.'

/* ------------------------------------------------------------------ */
/* Spectra                                                             */
/* ------------------------------------------------------------------ */

const buildSpectrum = (
  values: number[],
  matrix: 'adjacency' | 'laplacian',
): SpectrumResult => ({
  values,
  grouped: groupValues(values),
  matrix,
  symmetric: true,
  note: SPECTRUM_NOTE,
})

const spectrumDetail = (result: SpectrumResult, extra?: string): string => {
  const full = formatGroups(result.grouped).join(', ')
  return [extra, `Eigenvalues (ascending): ${full || '—'}`, result.note]
    .filter((part): part is string => Boolean(part))
    .join(' ')
}

export const adjacencySpectrum = (g: Graph): PropertyResult<SpectrumResult | null> => {
  if (g.directed && !directedAdjacencyIsSymmetric(g)) {
    return declined(null, 'Not defined for digraphs', 'not-applicable', DIRECTED_ADJACENCY_EXPLANATION)
  }
  if (g.order > SPECTRUM_VERTEX_LIMIT) {
    return declined(
      null,
      `Not computed (> ${SPECTRUM_VERTEX_LIMIT} vertices)`,
      'not-computed',
      overLimitExplanation(g, SPECTRUM_VERTEX_LIMIT, 'graph spectra'),
    )
  }

  const matrix = adjacencyMatrix(g).values
  if (!isSymmetric(matrix)) {
    return declined(null, 'Not defined for digraphs', 'not-applicable', DIRECTED_ADJACENCY_EXPLANATION)
  }

  const values = symmetricEigenvalues(matrix)
  const result = buildSpectrum(values, 'adjacency')
  const symmetricDigraph = g.directed
    ? 'Although this graph is directed, its adjacency matrix happens to be symmetric, so the spectrum is real and well defined. '
    : ''
  const radius = values.length
    ? Math.max(...values.map((v) => Math.abs(v)))
    : 0
  return {
    value: result,
    display: groupsToDisplay(result.grouped),
    status: 'neutral',
    exactness: 'heuristic',
    explanation: values.length
      ? `${symmetricDigraph}The adjacency matrix is symmetric, so all ${values.length} eigenvalues are real; the spectral radius is about ${formatEigenvalue(radius)}.`
      : 'The graph has no vertices, so its adjacency matrix is 0 x 0 and has no eigenvalues.',
    detail: spectrumDetail(result),
  }
}

/**
 * The Laplacian is only guaranteed positive semidefinite, and its zero
 * multiplicity only counts components, when every weight is non-negative. A
 * weighted graph with a negative or zero weight breaks both, so the prose has
 * to stop making those claims.
 */
const hasOnlyPositiveWeights = (g: Graph): boolean =>
  !g.weighted || g.edges.every((e) => g.weight(e.id) > 0)

export const laplacianSpectrum = (g: Graph): PropertyResult<SpectrumResult | null> => {
  if (g.directed && !directedAdjacencyIsSymmetric(g)) {
    return declined(null, 'Not defined for digraphs', 'not-applicable', DIRECTED_LAPLACIAN_EXPLANATION)
  }
  if (g.order > SPECTRUM_VERTEX_LIMIT) {
    return declined(
      null,
      `Not computed (> ${SPECTRUM_VERTEX_LIMIT} vertices)`,
      'not-computed',
      overLimitExplanation(g, SPECTRUM_VERTEX_LIMIT, 'graph spectra'),
    )
  }

  const matrix = laplacianMatrix(g).values
  if (!isSymmetric(matrix)) {
    return declined(null, 'Not defined for digraphs', 'not-applicable', DIRECTED_LAPLACIAN_EXPLANATION)
  }

  const values = symmetricEigenvalues(matrix)
  const result = buildSpectrum(values, 'laplacian')
  const components = values.filter(
    (v) => Math.abs(v) <= EIGENVALUE_GROUPING_TOLERANCE,
  ).length
  return {
    value: result,
    display: groupsToDisplay(result.grouped),
    status: 'neutral',
    exactness: 'heuristic',
    explanation: !values.length
      ? 'The graph has no vertices, so its Laplacian is 0 x 0 and has no eigenvalues.'
      : hasOnlyPositiveWeights(g)
        ? `L = D − A is symmetric and positive semidefinite, so every eigenvalue is real and at least 0. ${components} eigenvalue${components === 1 ? '' : 's'} came out within 1e-7 of zero, which corresponds to ${components} connected component${components === 1 ? '' : 's'}.`
        : `L = D − A is symmetric, so its eigenvalues are real. This graph has a weight that is not positive, so the usual guarantees do not apply: L need not be positive semidefinite, and the multiplicity of 0 need not count connected components.`,
    detail: spectrumDetail(
      result,
      hasOnlyPositiveWeights(g)
        ? 'The number of eigenvalues equal to 0 is the number of connected components; because the solver is numerical, "equal to 0" here means "within 1e-7 of 0".'
        : 'With a non-positive weight present, neither the sign of the eigenvalues nor the multiplicity of 0 carries its usual meaning.',
    ),
  }
}

/* ------------------------------------------------------------------ */
/* Algebraic connectivity                                              */
/* ------------------------------------------------------------------ */

export const algebraicConnectivity = (g: Graph): PropertyResult<number | null> => {
  if (g.directed && !directedAdjacencyIsSymmetric(g)) {
    return declined(
      null,
      'Not defined for digraphs',
      'not-applicable',
      'Algebraic connectivity is the second smallest eigenvalue of the symmetric Laplacian, which is only defined for undirected graphs. This digraph’s out-degree Laplacian is not symmetric. Convert the graph to undirected to see this value.',
    )
  }
  if (g.order < 2) {
    return declined(
      null,
      'Not defined',
      'not-applicable',
      'Algebraic connectivity is the second smallest Laplacian eigenvalue, so it needs at least two vertices.',
      'neutral',
    )
  }
  if (g.order > SPECTRUM_VERTEX_LIMIT) {
    return declined(
      null,
      `Not computed (> ${SPECTRUM_VERTEX_LIMIT} vertices)`,
      'not-computed',
      overLimitExplanation(g, SPECTRUM_VERTEX_LIMIT, 'Laplacian eigenvalues'),
    )
  }

  const matrix = laplacianMatrix(g).values
  if (!isSymmetric(matrix)) {
    return declined(
      null,
      'Not defined for digraphs',
      'not-applicable',
      'Algebraic connectivity requires a symmetric Laplacian; this graph’s is not symmetric.',
    )
  }

  const values = symmetricEigenvalues(matrix)
  const value = values[1]
  const disconnected = Math.abs(value) <= EIGENVALUE_GROUPING_TOLERANCE
  return {
    value,
    display: formatSignificant(value),
    status: disconnected ? 'warning' : 'success',
    exactness: 'heuristic',
    explanation: !hasOnlyPositiveWeights(g)
      ? `The second smallest Laplacian eigenvalue is about ${formatSignificant(value)}. This graph has a weight that is not positive, so the usual reading — positive exactly when the graph is connected — does not apply.`
      : disconnected
        ? `The second smallest Laplacian eigenvalue came out within 1e-7 of zero (${formatSignificant(value)}), which means the graph is disconnected. That printed number is a floating-point residual, not an exact zero.`
        : `The second smallest Laplacian eigenvalue (the Fiedler value) is about ${formatSignificant(value)}; it is positive exactly when the graph is connected, and larger values mean the graph is harder to cut in two.`,
    detail: `${SPECTRUM_NOTE} Do not read this number as exact: a graph whose true algebraic connectivity is 0 will typically show a tiny nonzero residual here, and one whose true value is an integer will show something a few ulps away from it.`,
  }
}

/* ------------------------------------------------------------------ */
/* Spanning tree count (Matrix-Tree theorem)                           */
/* ------------------------------------------------------------------ */

const DIRECTED_TREE_EXPLANATION =
  'Kirchhoff’s Matrix-Tree theorem counts spanning trees of an undirected graph. The directed analogue — Tutte’s theorem, which counts spanning arborescences rooted at a chosen vertex — answers a different question and is out of scope here. Convert the graph to undirected to count spanning trees.'

/** Connectivity read straight off the loopless multiplicity matrix. */
const isConnectedByIndex = (adjacency: number[][], n: number): boolean => {
  if (n === 0) return false
  const seen = new Array<boolean>(n).fill(false)
  seen[0] = true
  const stack = [0]
  let count = 1
  while (stack.length > 0) {
    const v = stack.pop() as number
    for (let w = 0; w < n; w++) {
      if (seen[w] || adjacency[v][w] === 0) continue
      seen[w] = true
      count++
      stack.push(w)
    }
  }
  return count === n
}

export const spanningTreeCount = (g: Graph): PropertyResult<bigint | null> => {
  if (g.directed) {
    return declined(null, 'Not applicable', 'not-applicable', DIRECTED_TREE_EXPLANATION)
  }
  const n = g.order
  if (n === 0) {
    return {
      value: 0n,
      display: '0',
      status: 'neutral',
      exactness: 'exact',
      explanation:
        'A spanning tree has to contain every vertex and be a tree, and the empty graph has no vertices to span, so we report 0 rather than counting the empty forest.',
    }
  }
  if (n > SPANNING_TREE_VERTEX_LIMIT) {
    return declined(
      null,
      `Not computed (> ${SPANNING_TREE_VERTEX_LIMIT} vertices)`,
      'not-computed',
      overLimitExplanation(g, SPANNING_TREE_VERTEX_LIMIT, 'spanning tree counts'),
    )
  }

  const weightsNote = g.weighted
    ? ' Edge weights are ignored: this is a count of distinct spanning trees, not a weighted sum.'
    : ''
  const loops = g.selfLoops().length
  const loopNote = loops > 0
    ? ` ${loops} self-loop${loops === 1 ? '' : 's'} ${loops === 1 ? 'was' : 'were'} ignored, since a loop can never lie on a tree.`
    : ''

  if (n === 1) {
    return {
      value: 1n,
      display: '1',
      status: 'success',
      exactness: 'exact',
      explanation: `A single vertex spans itself with the empty edge set, so there is exactly one spanning tree.${loopNote}`,
    }
  }

  // Integer multiplicity matrix: parallel edges add up, self-loops are dropped.
  const index = new Map(g.vertexIds.map((id, i) => [id, i] as const))
  const multiplicity: number[][] = Array.from({ length: n }, () =>
    Array.from({ length: n }, () => 0),
  )
  for (const e of g.edges) {
    const i = index.get(e.source)
    const j = index.get(e.target)
    if (i === undefined || j === undefined || i === j) continue
    multiplicity[i][j] += 1
    multiplicity[j][i] += 1
  }

  if (!isConnectedByIndex(multiplicity, n)) {
    return {
      value: 0n,
      display: '0',
      status: 'warning',
      exactness: 'exact',
      explanation: `A spanning tree has to reach every vertex, and this graph is disconnected, so it has none.${loopNote}${weightsNote}`,
    }
  }

  // Kirchhoff: delete any one row and column of L and take the determinant.
  const minor: bigint[][] = []
  for (let i = 1; i < n; i++) {
    const row: bigint[] = []
    for (let j = 1; j < n; j++) {
      if (i === j) {
        let degree = 0
        for (let k = 0; k < n; k++) degree += multiplicity[i][k]
        row.push(BigInt(degree))
      } else {
        row.push(-BigInt(multiplicity[i][j]))
      }
    }
    minor.push(row)
  }
  const determinant = integerDeterminant(minor)
  // Every cofactor of L is the same non-negative integer; abs() is belt and braces.
  const count = determinant < 0n ? -determinant : determinant

  return {
    value: count,
    display: formatBigInt(count),
    status: count > 0n ? 'success' : 'warning',
    exactness: 'exact',
    explanation: `Kirchhoff’s Matrix-Tree theorem: deleting one row and column from the Laplacian and taking the determinant gives ${formatBigInt(count)} spanning tree${count === 1n ? '' : 's'}. The determinant is evaluated with fraction-free BigInt elimination, so this integer is exact rather than a rounded float.${loopNote}${weightsNote}`,
  }
}
