/**
 * The classical matrices of a graph, each carrying the convention it was built
 * with.
 *
 * Textbooks disagree about self-loops, digraph orientation and weights, so a
 * bare grid of numbers is ambiguous. Every matrix Graphualize produces states
 * its convention in one sentence, and the exporters below carry that grid into
 * plain text, CSV and LaTeX without changing it.
 *
 * This module deliberately depends on nothing but the graph model — the
 * distance matrix runs its own small BFS rather than importing the traversal
 * module, so matrices stay usable no matter what else is in flight.
 */

import type { Graph } from '../model/graph'
import type { VertexId } from '../model/types'

export interface LabeledMatrix {
  kind: 'adjacency' | 'incidence' | 'degree' | 'laplacian' | 'signless-laplacian' | 'distance'
  title: string
  /** One sentence stating the convention used (rows = sources for digraphs, etc.). */
  convention: string
  rowLabels: string[]
  colLabels: string[]
  values: number[][]
  /**
   * True when every entry is an integer, so exports can skip decimals.
   * Infinite entries (unreachable pairs in a distance matrix) do not count
   * against this — they never render as a decimal either way.
   */
  integral: boolean
}

/* ------------------------------------------------------------------ */
/* Shared helpers                                                      */
/* ------------------------------------------------------------------ */

const zeros = (rows: number, cols: number): number[][] =>
  Array.from({ length: rows }, () => Array.from({ length: cols }, () => 0))

const isIntegral = (values: number[][]): boolean =>
  values.every((row) =>
    row.every((x) => Number.isInteger(x) || x === Infinity || x === -Infinity),
  )

/** Vertex id -> row/column position, matching {@link Graph.index}. */
const indexMap = (g: Graph): Map<VertexId, number> =>
  new Map(g.vertexIds.map((id, i) => [id, i] as const))

const weightedLabel = (g: Graph): string => (g.weighted ? 'weighted ' : '')

/* ------------------------------------------------------------------ */
/* Adjacency                                                           */
/* ------------------------------------------------------------------ */

/**
 * Raw adjacency values, shared by the degree, Laplacian and signless Laplacian
 * builders so the four matrices can never drift out of agreement.
 */
const adjacencyValues = (g: Graph): number[][] => {
  const n = g.order
  const index = indexMap(g)
  const values = zeros(n, n)
  for (const e of g.edges) {
    const i = index.get(e.source)
    const j = index.get(e.target)
    if (i === undefined || j === undefined) continue
    const w = g.weight(e.id)
    if (i === j) {
      // Undirected: a loop is traversed from both ends, so it counts twice and
      // the row sum stays equal to the degree. Directed: it is one arc out.
      values[i][i] += g.directed ? w : 2 * w
      continue
    }
    values[i][j] += w
    if (!g.directed) values[j][i] += w
  }
  return values
}

const adjacencyConvention = (g: Graph): string => {
  const verb = g.weighted
    ? 'sums the weights of the edges'
    : 'counts the edges'
  const parallel = g.weighted
    ? ' Parallel edges have their weights added together.'
    : ''
  if (g.directed) {
    return (
      `Entry (i, j) ${verb} directed from vertex i to vertex j: rows are sources, ` +
      `columns are targets. A self-loop contributes 1 to its diagonal entry, so every ` +
      `row sums to that vertex's ${weightedLabel(g)}out-degree.${parallel}`
    )
  }
  return (
    `Entry (i, j) ${verb} joining vertex i and vertex j, so the matrix is symmetric. ` +
    `A self-loop contributes 2 to its diagonal entry, so every row sums to that ` +
    `vertex's ${weightedLabel(g)}degree.${parallel}`
  )
}

export const adjacencyMatrix = (g: Graph): LabeledMatrix => {
  const labels = g.vertexIds.map((id) => g.label(id))
  const values = adjacencyValues(g)
  return {
    kind: 'adjacency',
    title: g.weighted ? 'Weighted adjacency matrix A' : 'Adjacency matrix A',
    convention: adjacencyConvention(g),
    rowLabels: labels,
    colLabels: labels.slice(),
    values,
    integral: isIntegral(values),
  }
}

/* ------------------------------------------------------------------ */
/* Incidence                                                           */
/* ------------------------------------------------------------------ */

/** Readable column names: `A-B` for an undirected edge, `A->B` for an arc. */
const edgeColumnLabels = (g: Graph): string[] =>
  g.edges.map((e) => `${g.label(e.source)}${g.directed ? '->' : '-'}${g.label(e.target)}`)

export const incidenceMatrix = (g: Graph): LabeledMatrix => {
  const index = indexMap(g)
  const values = zeros(g.order, g.size)
  g.edges.forEach((e, col) => {
    const i = index.get(e.source)
    const j = index.get(e.target)
    if (i === undefined || j === undefined) return
    if (g.directed) {
      // A loop leaves and enters the same vertex, so -1 and +1 cancel: the
      // column is all zeros, which is exactly why incidence matrices of
      // digraphs are usually quoted for loopless graphs.
      if (i === j) return
      values[i][col] = -1
      values[j][col] = 1
      return
    }
    if (i === j) {
      values[i][col] = 2
      return
    }
    values[i][col] = 1
    values[j][col] = 1
  })
  const convention = g.directed
    ? 'Rows are vertices and columns are edges. Entry (v, e) is -1 when v is the tail of arc e and +1 when v is its head; a self-loop gives an all-zero column because its tail and head coincide.'
    : 'Rows are vertices and columns are edges. Entry (v, e) is 1 when v is an endpoint of e and 2 when e is a self-loop at v, so every column sums to 2 and every row sums to the degree of v.'
  return {
    kind: 'incidence',
    title: 'Incidence matrix B',
    convention,
    rowLabels: g.vertexIds.map((id) => g.label(id)),
    colLabels: edgeColumnLabels(g),
    values,
    integral: isIntegral(values),
  }
}

/* ------------------------------------------------------------------ */
/* Degree, Laplacian, signless Laplacian                               */
/* ------------------------------------------------------------------ */

const degreeValuesFrom = (adjacency: number[][]): number[][] => {
  const n = adjacency.length
  const values = zeros(n, n)
  for (let i = 0; i < n; i++) {
    let sum = 0
    for (let j = 0; j < n; j++) sum += adjacency[i][j]
    values[i][i] = sum
  }
  return values
}

const degreeConvention = (g: Graph): string => {
  const kind = g.directed ? 'out-degree' : 'degree'
  const loops = g.directed
    ? 'A self-loop counts once towards the out-degree.'
    : 'A self-loop counts twice, matching the handshake convention.'
  const weights = g.weighted
    ? ` Because the document is weighted, the ${kind} shown is the sum of the incident edge weights rather than a plain count, which is what keeps L = D - A row-summing to zero.`
    : ''
  return `A diagonal matrix whose (i, i) entry is the ${kind} of vertex i; every off-diagonal entry is 0. ${loops}${weights}`
}

export const degreeMatrix = (g: Graph): LabeledMatrix => {
  const labels = g.vertexIds.map((id) => g.label(id))
  const values = degreeValuesFrom(adjacencyValues(g))
  return {
    kind: 'degree',
    title: g.directed ? 'Out-degree matrix D' : 'Degree matrix D',
    convention: degreeConvention(g),
    rowLabels: labels,
    colLabels: labels.slice(),
    values,
    integral: isIntegral(values),
  }
}

const combine = (a: number[][], b: number[][], sign: 1 | -1): number[][] =>
  a.map((row, i) => row.map((x, j) => x + sign * b[i][j]))

export const laplacianMatrix = (g: Graph): LabeledMatrix => {
  const labels = g.vertexIds.map((id) => g.label(id))
  const adjacency = adjacencyValues(g)
  const values = combine(degreeValuesFrom(adjacency), adjacency, -1)
  const convention = g.directed
    ? 'L = D - A using the out-degree matrix D, i.e. the out-degree Laplacian of the digraph. Rows are sources, every row sums to 0, and unlike the undirected case L is generally not symmetric, so its eigenvalues may be complex.'
    : `L = D - A. Every row and column sums to 0 and L is symmetric.${
        g.weighted && g.edges.some((e) => g.weight(e.id) <= 0)
          ? ' Weights enter through both D and A. Because a weight here is not positive, L need not be positive semidefinite and the multiplicity of the eigenvalue 0 need not count connected components.'
          : ` It is positive semidefinite, and the multiplicity of the eigenvalue 0 is the number of connected components.${
              g.weighted ? ' Weights enter through both D and A, giving the weighted Laplacian.' : ''
            }`
      }`
  return {
    kind: 'laplacian',
    title: g.directed ? 'Out-degree Laplacian L = D - A' : 'Laplacian matrix L = D - A',
    convention,
    rowLabels: labels,
    colLabels: labels.slice(),
    values,
    integral: isIntegral(values),
  }
}

export const signlessLaplacianMatrix = (g: Graph): LabeledMatrix => {
  const labels = g.vertexIds.map((id) => g.label(id))
  const adjacency = adjacencyValues(g)
  const values = combine(degreeValuesFrom(adjacency), adjacency, 1)
  return {
    kind: 'signless-laplacian',
    title: 'Signless Laplacian Q = D + A',
    convention: g.directed
      ? 'Q = D + A with the same out-degree D and rows-as-sources A used by the Laplacian, so like the directed Laplacian it is generally not symmetric.'
      : g.weighted && g.edges.some((e) => g.weight(e.id) <= 0)
        ? 'Q = D + A with the same D and A used by the Laplacian. Q = B B^T only holds for non-negative weights, so with a non-positive weight present the usual positive-semidefiniteness and bipartiteness readings do not apply.'
        : 'Q = D + A with the same D and A used by the Laplacian. For an undirected graph Q = B B^T with B the incidence matrix, so Q is symmetric and positive semidefinite, and its smallest eigenvalue is 0 exactly when some connected component is bipartite.',
    rowLabels: labels,
    colLabels: labels.slice(),
    values,
    integral: isIntegral(values),
  }
}

/* ------------------------------------------------------------------ */
/* Distance                                                            */
/* ------------------------------------------------------------------ */

/** Index-space adjacency lists, honouring direction only when the graph is directed. */
const successorIndices = (g: Graph): number[][] => {
  const index = indexMap(g)
  const adj: number[][] = Array.from({ length: g.order }, () => [])
  for (const e of g.edges) {
    const i = index.get(e.source)
    const j = index.get(e.target)
    if (i === undefined || j === undefined) continue
    adj[i].push(j)
    if (!g.directed && i !== j) adj[j].push(i)
  }
  return adj
}

export const distanceMatrix = (g: Graph): LabeledMatrix => {
  const n = g.order
  const labels = g.vertexIds.map((id) => g.label(id))
  const adj = successorIndices(g)
  const values = Array.from({ length: n }, () =>
    Array.from({ length: n }, () => Infinity),
  )
  // Repeated breadth-first search: O(V * (V + E)), and correct precisely
  // because every hop has the same cost of 1.
  for (let s = 0; s < n; s++) {
    const row = values[s]
    row[s] = 0
    const queue: number[] = [s]
    for (let head = 0; head < queue.length; head++) {
      const v = queue[head]
      const d = row[v]
      for (const w of adj[v]) {
        if (row[w] !== Infinity) continue
        row[w] = d + 1
        queue.push(w)
      }
    }
  }
  const convention = g.directed
    ? 'Entry (i, j) is the fewest arcs on a directed walk from i to j, found by breadth-first search from every vertex. Edge weights are ignored, the matrix is generally not symmetric, and an unreachable pair is shown as infinity.'
    : 'Entry (i, j) is the fewest edges on a walk between i and j, found by breadth-first search from every vertex. Edge weights are ignored, the matrix is symmetric with a zero diagonal, and a pair in different components is shown as infinity.'
  return {
    kind: 'distance',
    title: 'Distance matrix (hop counts)',
    convention,
    rowLabels: labels,
    colLabels: labels.slice(),
    values,
    integral: isIntegral(values),
  }
}

/** Every matrix Graphualize knows how to build, in inspector order. */
export const allMatrices = (g: Graph): LabeledMatrix[] => [
  adjacencyMatrix(g),
  degreeMatrix(g),
  laplacianMatrix(g),
  signlessLaplacianMatrix(g),
  incidenceMatrix(g),
  distanceMatrix(g),
]

/* ------------------------------------------------------------------ */
/* Exporters                                                           */
/* ------------------------------------------------------------------ */

/**
 * Entries are printed as integers when they are integers, otherwise rounded to
 * 6 decimals with trailing zeros stripped. Infinities become the glyph so a
 * distance matrix stays readable.
 */
const formatEntry = (x: number): string => {
  if (x === Infinity) return '∞'
  if (x === -Infinity) return '-∞'
  if (Number.isNaN(x)) return 'NaN'
  if (Object.is(x, -0)) return '0'
  if (Number.isInteger(x)) return String(x)
  const rounded = Number(x.toFixed(6))
  return Object.is(rounded, -0) ? '0' : String(rounded)
}

const padLeft = (text: string, width: number): string =>
  text.length >= width ? text : ' '.repeat(width - text.length) + text

/**
 * A monospaced grid with right-aligned columns, suitable for a `<pre>` block or
 * the clipboard. Row and column labels are included unless `headers` is false.
 */
export const matrixToText = (
  m: LabeledMatrix,
  opts: { headers?: boolean; delimiter?: string } = {},
): string => {
  const headers = opts.headers ?? true
  const delimiter = opts.delimiter ?? '  '
  const rows = m.values.length
  const cols = m.colLabels.length
  if (rows === 0 && cols === 0) return ''

  const grid: string[][] = []
  // A header row would be a lone empty cell when there are no columns at all.
  if (headers && cols > 0) grid.push(['', ...m.colLabels])
  m.values.forEach((row, i) => {
    const cells = row.map(formatEntry)
    grid.push(headers ? [m.rowLabels[i] ?? '', ...cells] : cells)
  })

  const width = grid.reduce((acc, row) => Math.max(acc, row.length), 0)
  const widths = Array.from({ length: width }, (_, c) =>
    grid.reduce((acc, row) => Math.max(acc, (row[c] ?? '').length), 0),
  )
  return grid
    .map((row) =>
      row
        .map((cell, c) => padLeft(cell, widths[c]))
        .join(delimiter)
        .replace(/\s+$/, ''),
    )
    .join('\n')
}

const csvCell = (text: string): string =>
  /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text

/** RFC 4180 style CSV with a blank corner cell, row labels and column labels. */
export const matrixToCsv = (m: LabeledMatrix): string => {
  const rows = m.values.length
  const cols = m.colLabels.length
  if (rows === 0 && cols === 0) return ''
  const lines: string[] = [['', ...m.colLabels].map(csvCell).join(',')]
  m.values.forEach((row, i) => {
    lines.push(
      [m.rowLabels[i] ?? '', ...row.map(formatEntry)].map(csvCell).join(','),
    )
  })
  return lines.join('\n')
}

const LATEX_ESCAPES: Record<string, string> = {
  '\\': '\\textbackslash{}',
  '&': '\\&',
  '%': '\\%',
  $: '\\$',
  '#': '\\#',
  _: '\\_',
  '{': '\\{',
  '}': '\\}',
  '~': '\\textasciitilde{}',
  '^': '\\textasciicircum{}',
}

const latexLabel = (text: string): string =>
  text.replace(/[\\&%$#_{}~^]/g, (ch) => LATEX_ESCAPES[ch] ?? ch)

const latexEntry = (x: number): string => {
  if (x === Infinity) return '\\infty'
  if (x === -Infinity) return '-\\infty'
  return formatEntry(x)
}

/**
 * LaTeX source for the grid. By default a bare `pmatrix`/`bmatrix`; with
 * `withLabels` a bordered `array` whose first row and column carry the labels
 * (the `environment` option does not apply in that case, since `array` is the
 * only standard environment that can be ruled).
 */
export const matrixToLatex = (
  m: LabeledMatrix,
  opts: { environment?: 'pmatrix' | 'bmatrix'; withLabels?: boolean } = {},
): string => {
  const environment = opts.environment ?? 'pmatrix'
  const body = m.values.map((row) => row.map(latexEntry).join(' & '))

  if (!opts.withLabels) {
    if (body.length === 0) return `\\begin{${environment}}\n\\end{${environment}}`
    return `\\begin{${environment}}\n${body.join(' \\\\\n')}\n\\end{${environment}}`
  }

  const cols = m.colLabels.length
  const spec = `c|${'c'.repeat(cols)}`
  const header = ['', ...m.colLabels.map(latexLabel)].join(' & ')
  const labelled = m.values.map(
    (row, i) => `${latexLabel(m.rowLabels[i] ?? '')} & ${row.map(latexEntry).join(' & ')}`,
  )
  if (labelled.length === 0) {
    return `\\begin{array}{${spec}}\n${header}\n\\end{array}`
  }
  return `\\begin{array}{${spec}}\n${header} \\\\\n\\hline\n${labelled.join(' \\\\\n')}\n\\end{array}`
}
