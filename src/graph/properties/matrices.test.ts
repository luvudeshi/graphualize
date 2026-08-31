import { describe, expect, it } from 'vitest'

import { Graph } from '../model/graph'
import { docFromEdges } from '../model/builder'
import type { BuildOptions } from '../model/builder'
import {
  adjacencyMatrix,
  allMatrices,
  degreeMatrix,
  distanceMatrix,
  incidenceMatrix,
  laplacianMatrix,
  matrixToCsv,
  matrixToLatex,
  matrixToText,
  signlessLaplacianMatrix,
} from './matrices'
import {
  characteristicPolynomialIntegers,
  integerDeterminant,
  isSymmetric,
  symmetricEigen,
  symmetricEigenvalues,
} from './linalg'
import {
  SPECTRUM_VERTEX_LIMIT,
  adjacencySpectrum,
  algebraicConnectivity,
  laplacianSpectrum,
  spanningTreeCount,
} from './spectrum'

/* ------------------------------------------------------------------ */
/* Fixtures — every graph is built by hand so this file never depends  */
/* on the generators module.                                           */
/* ------------------------------------------------------------------ */

const g = (spec: readonly string[], options: BuildOptions = {}): Graph =>
  new Graph(docFromEdges(spec, options))

/** Vertex labels A, B, C, ... then v26, v27, ... Never contains '-' or ':'. */
const name = (i: number): string => (i < 26 ? String.fromCharCode(65 + i) : `v${i}`)

/** Complete graph on n vertices. */
const completeSpec = (n: number): string[] => {
  const spec: string[] = []
  if (n === 1) return ['A']
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) spec.push(`${name(i)}-${name(j)}`)
  return spec
}

/** Cycle on n >= 3 vertices. */
const cycleSpec = (n: number): string[] =>
  Array.from({ length: n }, (_, i) => `${name(i)}-${name((i + 1) % n)}`)

/** Path on n vertices. */
const pathSpec = (n: number): string[] =>
  Array.from({ length: n - 1 }, (_, i) => `${name(i)}-${name(i + 1)}`)

/** Complete bipartite K_{m,n} with parts L0.. and R0.. */
const bipartiteSpec = (m: number, n: number): string[] => {
  const spec: string[] = []
  for (let i = 0; i < m; i++) for (let j = 0; j < n; j++) spec.push(`L${i}-R${j}`)
  return spec
}

/** The Petersen graph: outer 5-cycle, inner pentagram, matching spokes. */
const petersenSpec = (): string[] => {
  const spec: string[] = []
  for (let i = 0; i < 5; i++) spec.push(`O${i}-O${(i + 1) % 5}`)
  for (let i = 0; i < 5; i++) spec.push(`O${i}-I${i}`)
  for (let i = 0; i < 5; i++) spec.push(`I${i}-I${(i + 2) % 5}`)
  return spec
}

/** The 3-cube Q3 on binary strings, one edge per bit flip. */
const cubeSpec = (): string[] => {
  const label = (v: number) => `Q${v.toString(2).padStart(3, '0')}`
  const spec: string[] = []
  for (let v = 0; v < 8; v++) {
    for (let bit = 0; bit < 3; bit++) {
      const w = v ^ (1 << bit)
      if (w > v) spec.push(`${label(v)}-${label(w)}`)
    }
  }
  return spec
}

const rowSums = (values: number[][]): number[] =>
  values.map((row) => row.reduce((a, b) => a + b, 0))

const colSums = (values: number[][]): number[] => {
  const cols = values[0]?.length ?? 0
  return Array.from({ length: cols }, (_, j) =>
    values.reduce((acc, row) => acc + row[j], 0),
  )
}

const expectSpectrum = (actual: number[], expected: number[]): void => {
  expect(actual).toHaveLength(expected.length)
  const sorted = [...expected].sort((a, b) => a - b)
  actual.forEach((v, i) => expect(v).toBeCloseTo(sorted[i], 6))
}

/* ================================================================== */
/* Matrices                                                            */
/* ================================================================== */

describe('adjacency matrix', () => {
  it('is symmetric with a zero diagonal for a triangle', () => {
    const m = adjacencyMatrix(g(cycleSpec(3)))
    expect(m.kind).toBe('adjacency')
    expect(m.rowLabels).toEqual(['A', 'B', 'C'])
    expect(m.colLabels).toEqual(['A', 'B', 'C'])
    expect(m.values).toEqual([
      [0, 1, 1],
      [1, 0, 1],
      [1, 1, 0],
    ])
    expect(m.integral).toBe(true)
    expect(isSymmetric(m.values)).toBe(true)
    expect(m.convention).toContain('symmetric')
  })

  it('matches degrees on a path P3 and a star', () => {
    expect(adjacencyMatrix(g(pathSpec(3))).values).toEqual([
      [0, 1, 0],
      [1, 0, 1],
      [0, 1, 0],
    ])
    // Star K_{1,3} centred at A.
    expect(adjacencyMatrix(g(['A-B', 'A-C', 'A-D'])).values).toEqual([
      [0, 1, 1, 1],
      [1, 0, 0, 0],
      [1, 0, 0, 0],
      [1, 0, 0, 0],
    ])
  })

  it('uses rows-as-sources for a directed 3-cycle', () => {
    const m = adjacencyMatrix(g(['A->B', 'B->C', 'C->A'], { directed: true }))
    expect(m.values).toEqual([
      [0, 1, 0],
      [0, 0, 1],
      [1, 0, 0],
    ])
    expect(isSymmetric(m.values)).toBe(false)
    expect(m.convention).toContain('rows are sources')
  })

  it('stores weights rather than counts when the document is weighted', () => {
    const m = adjacencyMatrix(g(['A-B:4', 'B-C:2.5'], { weighted: true }))
    expect(m.values).toEqual([
      [0, 4, 0],
      [4, 0, 2.5],
      [0, 2.5, 0],
    ])
    expect(m.integral).toBe(false)
    expect(m.convention).toContain('weights')
  })

  it('gives an undirected self-loop a diagonal entry of 2 and a directed one 1', () => {
    expect(adjacencyMatrix(g(['A-A', 'A-B'])).values).toEqual([
      [2, 1],
      [1, 0],
    ])
    expect(adjacencyMatrix(g(['A->A', 'A->B'], { directed: true })).values).toEqual([
      [1, 1],
      [0, 0],
    ])
  })

  it('counts parallel edges with multiplicity', () => {
    expect(adjacencyMatrix(g(['A-B', 'A-B', 'A-B'])).values).toEqual([
      [0, 3],
      [3, 0],
    ])
  })

  it('is 0 x 0 for the empty graph', () => {
    const m = adjacencyMatrix(g([]))
    expect(m.values).toEqual([])
    expect(m.rowLabels).toEqual([])
    expect(m.colLabels).toEqual([])
    expect(m.integral).toBe(true)
  })
})

describe('incidence matrix', () => {
  it('puts a 1 at each endpoint for an undirected triangle', () => {
    const m = incidenceMatrix(g(cycleSpec(3)))
    expect(m.rowLabels).toEqual(['A', 'B', 'C'])
    expect(m.colLabels).toEqual(['A-B', 'B-C', 'C-A'])
    expect(m.values).toEqual([
      [1, 0, 1],
      [1, 1, 0],
      [0, 1, 1],
    ])
    // Every column has exactly two 1s, every row sums to the degree.
    expect(colSums(m.values)).toEqual([2, 2, 2])
    expect(rowSums(m.values)).toEqual([2, 2, 2])
  })

  it('uses -1 at the tail and +1 at the head for a digraph', () => {
    const m = incidenceMatrix(g(['A->B', 'B->C', 'C->A'], { directed: true }))
    expect(m.colLabels).toEqual(['A->B', 'B->C', 'C->A'])
    expect(m.values).toEqual([
      [-1, 0, 1],
      [1, -1, 0],
      [0, 1, -1],
    ])
    expect(colSums(m.values)).toEqual([0, 0, 0])
  })

  it('gives an undirected self-loop a 2 and a directed self-loop an all-zero column', () => {
    expect(incidenceMatrix(g(['A-A', 'A-B'])).values).toEqual([
      [2, 1],
      [0, 1],
    ])
    expect(incidenceMatrix(g(['A->A', 'A->B'], { directed: true })).values).toEqual([
      [0, -1],
      [0, 1],
    ])
  })

  it('gives parallel edges distinct columns', () => {
    const m = incidenceMatrix(g(['A-B', 'A-B']))
    expect(m.colLabels).toEqual(['A-B', 'A-B'])
    expect(m.values).toEqual([
      [1, 1],
      [1, 1],
    ])
  })

  it('has no columns for an edgeless graph and is 0 x 0 when empty', () => {
    expect(incidenceMatrix(g(['A', 'B'])).values).toEqual([[], []])
    expect(incidenceMatrix(g([])).values).toEqual([])
  })
})

describe('degree, Laplacian and signless Laplacian', () => {
  it('is the diagonal of degrees for a star', () => {
    const m = degreeMatrix(g(['A-B', 'A-C', 'A-D']))
    expect(m.values).toEqual([
      [3, 0, 0, 0],
      [0, 1, 0, 0],
      [0, 0, 1, 0],
      [0, 0, 0, 1],
    ])
  })

  it('uses out-degrees for a directed 3-cycle and says so', () => {
    const m = degreeMatrix(g(['A->B', 'B->C', 'C->A'], { directed: true }))
    expect(m.values).toEqual([
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ])
    expect(m.convention).toContain('out-degree')
    expect(laplacianMatrix(g(['A->B', 'B->C', 'C->A'], { directed: true })).convention).toContain(
      'out-degree',
    )
  })

  it('is D - A on a triangle, a path and a star', () => {
    expect(laplacianMatrix(g(cycleSpec(3))).values).toEqual([
      [2, -1, -1],
      [-1, 2, -1],
      [-1, -1, 2],
    ])
    expect(laplacianMatrix(g(pathSpec(3))).values).toEqual([
      [1, -1, 0],
      [-1, 2, -1],
      [0, -1, 1],
    ])
    expect(laplacianMatrix(g(['A-B', 'A-C', 'A-D'])).values).toEqual([
      [3, -1, -1, -1],
      [-1, 1, 0, 0],
      [-1, 0, 1, 0],
      [-1, 0, 0, 1],
    ])
  })

  it('handles weights, self-loops and parallel edges', () => {
    expect(laplacianMatrix(g(['A-B:4', 'B-C:2.5'], { weighted: true })).values).toEqual([
      [4, -4, 0],
      [-4, 6.5, -2.5],
      [0, -2.5, 2.5],
    ])
    // A self-loop adds 2 to both D and A, so it cancels out of L entirely.
    expect(laplacianMatrix(g(['A-A', 'A-B'])).values).toEqual([
      [1, -1],
      [-1, 1],
    ])
    expect(laplacianMatrix(g(['A-B', 'A-B', 'A-B'])).values).toEqual([
      [3, -3],
      [-3, 3],
    ])
  })

  it('has zero row sums on every undirected fixture', () => {
    const fixtures = [
      cycleSpec(3),
      pathSpec(4),
      ['A-B', 'A-C', 'A-D'],
      ['A-A', 'A-B', 'B-C'],
      ['A-B', 'A-B', 'C-D'],
      completeSpec(5),
      petersenSpec(),
    ]
    for (const spec of fixtures) {
      const graph = g(spec)
      const l = laplacianMatrix(graph)
      for (const sum of rowSums(l.values)) expect(sum).toBeCloseTo(0, 12)
      expect(isSymmetric(adjacencyMatrix(graph).values)).toBe(true)
    }
    const weighted = laplacianMatrix(g(['A-B:4', 'B-C:2.5'], { weighted: true }))
    for (const sum of rowSums(weighted.values)) expect(sum).toBeCloseTo(0, 12)
  })

  it('gives Q = D + A and B B^T for an undirected graph', () => {
    const graph = g(pathSpec(3))
    const q = signlessLaplacianMatrix(graph)
    expect(q.values).toEqual([
      [1, 1, 0],
      [1, 2, 1],
      [0, 1, 1],
    ])
    const b = incidenceMatrix(graph).values
    const bbt = b.map((rowI) => b.map((rowJ) => rowI.reduce((acc, x, k) => acc + x * rowJ[k], 0)))
    expect(bbt).toEqual(q.values)
  })

  it('is 0 x 0 for the empty graph', () => {
    expect(degreeMatrix(g([])).values).toEqual([])
    expect(laplacianMatrix(g([])).values).toEqual([])
    expect(signlessLaplacianMatrix(g([])).values).toEqual([])
  })
})

describe('distance matrix', () => {
  it('gives hop counts on a path', () => {
    expect(distanceMatrix(g(pathSpec(3))).values).toEqual([
      [0, 1, 2],
      [1, 0, 1],
      [2, 1, 0],
    ])
  })

  it('marks unreachable pairs as Infinity', () => {
    const m = distanceMatrix(g(['A-B', 'C-D']))
    expect(m.values).toEqual([
      [0, 1, Infinity, Infinity],
      [1, 0, Infinity, Infinity],
      [Infinity, Infinity, 0, 1],
      [Infinity, Infinity, 1, 0],
    ])
    // Infinities do not make the matrix non-integral.
    expect(m.integral).toBe(true)
  })

  it('respects direction', () => {
    const m = distanceMatrix(g(['A->B', 'B->C'], { directed: true }))
    expect(m.values).toEqual([
      [0, 1, 2],
      [Infinity, 0, 1],
      [Infinity, Infinity, 0],
    ])
  })

  it('ignores weights (hop counts only) and is 0 x 0 when empty', () => {
    expect(distanceMatrix(g(['A-B:9', 'B-C:9'], { weighted: true })).values).toEqual([
      [0, 1, 2],
      [1, 0, 1],
      [2, 1, 0],
    ])
    expect(distanceMatrix(g([])).values).toEqual([])
  })
})

describe('allMatrices', () => {
  it('returns every kind exactly once and never throws on the empty graph', () => {
    const kinds = allMatrices(g(cycleSpec(3))).map((m) => m.kind)
    expect(kinds).toEqual([
      'adjacency',
      'degree',
      'laplacian',
      'signless-laplacian',
      'incidence',
      'distance',
    ])
    for (const m of allMatrices(g([]))) {
      expect(m.values).toEqual([])
      expect(m.convention.length).toBeGreaterThan(20)
    }
  })
})

/* ================================================================== */
/* Exporters                                                           */
/* ================================================================== */

describe('exporters', () => {
  const p3 = adjacencyMatrix(g(pathSpec(3)))

  it('renders right-aligned text with headers', () => {
    expect(matrixToText(p3)).toBe(['   A  B  C', 'A  0  1  0', 'B  1  0  1', 'C  0  1  0'].join('\n'))
  })

  it('renders text without headers and with a custom delimiter', () => {
    expect(matrixToText(p3, { headers: false })).toBe(['0  1  0', '1  0  1', '0  1  0'].join('\n'))
    expect(matrixToText(p3, { headers: false, delimiter: ' ' })).toBe(
      ['0 1 0', '1 0 1', '0 1 0'].join('\n'),
    )
  })

  it('right-aligns wider columns', () => {
    const l = laplacianMatrix(g(['A-B', 'A-C', 'A-D']))
    expect(matrixToText(l)).toBe(
      [
        '    A   B   C   D',
        'A   3  -1  -1  -1',
        'B  -1   1   0   0',
        'C  -1   0   1   0',
        'D  -1   0   0   1',
      ].join('\n'),
    )
  })

  it('renders CSV', () => {
    expect(matrixToCsv(p3)).toBe([',A,B,C', 'A,0,1,0', 'B,1,0,1', 'C,0,1,0'].join('\n'))
  })

  it('renders LaTeX with and without labels', () => {
    expect(matrixToLatex(p3)).toBe(
      [
        '\\begin{pmatrix}',
        '0 & 1 & 0 \\\\',
        '1 & 0 & 1 \\\\',
        '0 & 1 & 0',
        '\\end{pmatrix}',
      ].join('\n'),
    )
    expect(matrixToLatex(p3, { environment: 'bmatrix' })).toBe(
      [
        '\\begin{bmatrix}',
        '0 & 1 & 0 \\\\',
        '1 & 0 & 1 \\\\',
        '0 & 1 & 0',
        '\\end{bmatrix}',
      ].join('\n'),
    )
    expect(matrixToLatex(p3, { withLabels: true })).toBe(
      [
        '\\begin{array}{c|ccc}',
        ' & A & B & C \\\\',
        '\\hline',
        'A & 0 & 1 & 0 \\\\',
        'B & 1 & 0 & 1 \\\\',
        'C & 0 & 1 & 0',
        '\\end{array}',
      ].join('\n'),
    )
  })

  it('renders infinities as a glyph in text and \\infty in LaTeX', () => {
    const d = distanceMatrix(g(['A-B', 'C']))
    expect(matrixToText(d)).toBe(
      ['   A  B  C', 'A  0  1  ∞', 'B  1  0  ∞', 'C  ∞  ∞  0'].join('\n'),
    )
    expect(matrixToLatex(d)).toBe(
      [
        '\\begin{pmatrix}',
        '0 & 1 & \\infty \\\\',
        '1 & 0 & \\infty \\\\',
        '\\infty & \\infty & 0',
        '\\end{pmatrix}',
      ].join('\n'),
    )
  })

  it('trims non-integer entries and exports nothing for an empty matrix', () => {
    const weighted = adjacencyMatrix(g(['A-B:2.5'], { weighted: true }))
    expect(matrixToCsv(weighted)).toBe([',A,B', 'A,0,2.5', 'B,2.5,0'].join('\n'))
    const empty = adjacencyMatrix(g([]))
    expect(matrixToText(empty)).toBe('')
    expect(matrixToCsv(empty)).toBe('')
    expect(matrixToLatex(empty)).toBe('\\begin{pmatrix}\n\\end{pmatrix}')
  })
})

/* ================================================================== */
/* linalg                                                              */
/* ================================================================== */

describe('integerDeterminant', () => {
  it('handles the degenerate sizes', () => {
    expect(integerDeterminant([])).toBe(1n)
    expect(integerDeterminant([[7]])).toBe(7n)
    expect(integerDeterminant([[0]])).toBe(0n)
  })

  it('matches hand-computed 2x2 and 3x3 determinants', () => {
    expect(integerDeterminant([
      [1, 2],
      [3, 4],
    ])).toBe(-2n)
    expect(integerDeterminant([
      [6, 1, 1],
      [4, -2, 5],
      [2, 8, 7],
    ])).toBe(-306n)
    // Singular: the third row is the sum of the first two.
    expect(integerDeterminant([
      [1, 2, 3],
      [4, 5, 6],
      [5, 7, 9],
    ])).toBe(0n)
  })

  it('pivots when a leading entry is zero', () => {
    expect(integerDeterminant([
      [0, 1],
      [1, 0],
    ])).toBe(-1n)
    expect(integerDeterminant([
      [0, 0, 1],
      [0, 1, 0],
      [1, 0, 0],
    ])).toBe(-1n)
  })

  it('is exact well past the float64 integer range', () => {
    // L is lower triangular, U upper triangular, so det(LU) = det(L)det(U)
    // exactly — an independent check that does not reuse the algorithm.
    const lower = [
      [3, 0, 0, 0],
      [5, 7, 0, 0],
      [-2, 4, 11, 0],
      [6, -3, 8, 13],
    ]
    const upper = [
      [9991, 17, -23, 5],
      [0, 9973, 31, -7],
      [0, 0, 9967, 19],
      [0, 0, 0, 9949],
    ]
    const product = lower.map((row) =>
      upper[0].map((_, j) => row.reduce((acc, x, k) => acc + x * upper[k][j], 0)),
    )
    const expected = 3n * 7n * 11n * 13n * 9991n * 9973n * 9967n * 9949n
    expect(expected > 2n ** 53n).toBe(true)
    expect(integerDeterminant(product)).toBe(expected)
  })

  it('accepts bigint input and rejects non-integers', () => {
    expect(integerDeterminant([
      [10n ** 30n, 0n],
      [0n, 10n ** 30n],
    ])).toBe(10n ** 60n)
    expect(() => integerDeterminant([[1.5]])).toThrow(/not an integer/)
    expect(() => integerDeterminant([[1, 2]])).toThrow(/square/)
  })
})

describe('characteristicPolynomialIntegers', () => {
  it('matches det(xI - A) for the triangle and the path', () => {
    // K3 adjacency has eigenvalues 2, -1, -1 => (x-2)(x+1)^2 = x^3 - 3x - 2.
    expect(characteristicPolynomialIntegers(adjacencyMatrix(g(cycleSpec(3))).values)).toEqual([
      1n,
      0n,
      -3n,
      -2n,
    ])
    // P3 adjacency has eigenvalues sqrt2, 0, -sqrt2 => x^3 - 2x.
    expect(characteristicPolynomialIntegers(adjacencyMatrix(g(pathSpec(3))).values)).toEqual([
      1n,
      0n,
      -2n,
      0n,
    ])
  })

  it('handles the empty matrix and rejects non-integral input', () => {
    expect(characteristicPolynomialIntegers([])).toEqual([1n])
    expect(characteristicPolynomialIntegers([[2.5]])).toBeNull()
    expect(characteristicPolynomialIntegers([[1, 2]])).toBeNull()
  })

  it('agrees with integerDeterminant on the constant term', () => {
    const a = [
      [0, 1, 1, 0],
      [1, 0, 1, 1],
      [1, 1, 0, 0],
      [0, 1, 0, 0],
    ]
    const coefficients = characteristicPolynomialIntegers(a)
    expect(coefficients).not.toBeNull()
    // p(0) = det(-A) = (-1)^n det(A) with n = 4.
    expect(coefficients?.[4]).toBe(integerDeterminant(a))
  })
})

describe('symmetric eigensolver', () => {
  it('handles 0x0 and 1x1 matrices', () => {
    expect(symmetricEigenvalues([])).toEqual([])
    expect(symmetricEigen([]).vectors).toEqual([])
    expect(symmetricEigenvalues([[5]])).toEqual([5])
    expect(symmetricEigen([[5]]).vectors).toEqual([[1]])
  })

  it('returns a diagonal matrix ascending and untouched', () => {
    expect(symmetricEigenvalues([
      [3, 0, 0],
      [0, -1, 0],
      [0, 0, 2],
    ])).toEqual([-1, 2, 3])
  })

  it('produces orthonormal eigenvectors satisfying A v = lambda v', () => {
    const a = laplacianMatrix(g(cycleSpec(4))).values
    const { values, vectors } = symmetricEigen(a)
    const n = values.length
    for (let col = 0; col < n; col++) {
      let norm = 0
      for (let i = 0; i < n; i++) norm += vectors[i][col] ** 2
      expect(norm).toBeCloseTo(1, 9)
      for (let i = 0; i < n; i++) {
        const av = a[i].reduce((acc, x, k) => acc + x * vectors[k][col], 0)
        expect(av).toBeCloseTo(values[col] * vectors[i][col], 8)
      }
    }
    // Columns are mutually orthogonal.
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        let dot = 0
        for (let i = 0; i < n; i++) dot += vectors[i][p] * vectors[i][q]
        expect(dot).toBeCloseTo(0, 9)
      }
    }
  })

  it('refuses a non-symmetric matrix rather than inventing real eigenvalues', () => {
    expect(isSymmetric([
      [0, 1],
      [0, 0],
    ])).toBe(false)
    expect(() => symmetricEigenvalues([
      [0, 1],
      [0, 0],
    ])).toThrow(/symmetric/)
  })
})

/* ================================================================== */
/* Known spectra                                                       */
/* ================================================================== */

describe('adjacency spectrum', () => {
  it('gives {n-1, (-1)^(n-1)} for K_n', () => {
    for (let n = 2; n <= 7; n++) {
      const result = adjacencySpectrum(g(completeSpec(n)))
      expect(result.value).not.toBeNull()
      const expected = [n - 1, ...Array.from({ length: n - 1 }, () => -1)]
      expectSpectrum(result.value?.values ?? [], expected)
      const grouped = result.value?.grouped ?? []
      expect(grouped).toHaveLength(2)
      expect(grouped[0].multiplicity).toBe(n - 1)
      expect(grouped[0].value).toBeCloseTo(-1, 9)
      expect(grouped[1].multiplicity).toBe(1)
      expect(grouped[1].value).toBeCloseTo(n - 1, 9)
    }
  })

  it('gives 2cos(2 pi k / n) for C_n', () => {
    for (const n of [3, 4, 5, 6, 7, 8]) {
      const result = adjacencySpectrum(g(cycleSpec(n)))
      const expected = Array.from({ length: n }, (_, k) => 2 * Math.cos((2 * Math.PI * k) / n))
      expectSpectrum(result.value?.values ?? [], expected)
    }
  })

  it('gives {+-sqrt(mn), 0^(m+n-2)} for K_{m,n}', () => {
    for (const [m, n] of [
      [2, 3],
      [3, 3],
      [1, 4],
      [2, 5],
    ]) {
      const result = adjacencySpectrum(g(bipartiteSpec(m, n)))
      const root = Math.sqrt(m * n)
      const expected = [-root, root, ...Array.from({ length: m + n - 2 }, () => 0)]
      expectSpectrum(result.value?.values ?? [], expected)
    }
  })

  it('gives {3, 1^5, -2^4} for the Petersen graph', () => {
    const result = adjacencySpectrum(g(petersenSpec()))
    const expected = [
      3,
      ...Array.from({ length: 5 }, () => 1),
      ...Array.from({ length: 4 }, () => -2),
    ]
    expectSpectrum(result.value?.values ?? [], expected)
    expect(result.value?.grouped).toHaveLength(3)
    expect(result.value?.grouped.map((x) => x.multiplicity)).toEqual([4, 5, 1])
    expect(result.display).toBe('-2 (x4), 1 (x5), 3')
  })

  it('labels floating point results as heuristic and never claims exactness', () => {
    const result = adjacencySpectrum(g(petersenSpec()))
    expect(result.exactness).toBe('heuristic')
    expect(result.value?.symmetric).toBe(true)
    expect(result.value?.note).toMatch(/approximation/i)
    expect(result.value?.note).toMatch(/grouping/i)
  })

  it('returns an empty spectrum for the empty graph', () => {
    const result = adjacencySpectrum(g([]))
    expect(result.value?.values).toEqual([])
    expect(result.value?.grouped).toEqual([])
  })
})

describe('Laplacian spectrum', () => {
  it('always has a smallest eigenvalue of 0', () => {
    for (const spec of [cycleSpec(5), pathSpec(6), completeSpec(4), petersenSpec()]) {
      const values = laplacianSpectrum(g(spec)).value?.values ?? []
      expect(values[0]).toBeCloseTo(0, 9)
      for (const v of values) expect(v).toBeGreaterThan(-1e-9)
    }
  })

  it('has zero-multiplicity equal to the number of connected components', () => {
    const cases: [string[], number][] = [
      [cycleSpec(5), 1],
      [['A-B', 'C-D'], 2],
      [['A-B', 'C-D', 'E'], 3],
      [['A', 'B', 'C', 'D'], 4],
      [[...pathSpec(3), 'D-E', 'F-G', 'H'], 4],
    ]
    for (const [spec, components] of cases) {
      const result = laplacianSpectrum(g(spec))
      const values = result.value?.values ?? []
      const zeros = values.filter((v) => Math.abs(v) < 1e-7).length
      expect(zeros).toBe(components)
      expect(result.value?.grouped[0].multiplicity).toBe(components)
    }
  })

  it('gives {0, n^(n-1)} for K_n', () => {
    for (let n = 2; n <= 6; n++) {
      const values = laplacianSpectrum(g(completeSpec(n))).value?.values ?? []
      expectSpectrum(values, [0, ...Array.from({ length: n - 1 }, () => n)])
    }
  })
})

describe('algebraic connectivity', () => {
  it('is n for K_n and 2 - 2cos(2 pi / n) for C_n', () => {
    for (let n = 3; n <= 6; n++) {
      expect(algebraicConnectivity(g(completeSpec(n))).value).toBeCloseTo(n, 6)
      expect(algebraicConnectivity(g(cycleSpec(n))).value).toBeCloseTo(
        2 - 2 * Math.cos((2 * Math.PI) / n),
        6,
      )
    }
  })

  it('is (numerically) zero for a disconnected graph, and says the value is a residual', () => {
    const result = algebraicConnectivity(g(['A-B', 'C-D']))
    expect(Math.abs(result.value ?? 1)).toBeLessThan(1e-9)
    expect(result.status).toBe('warning')
    expect(result.exactness).toBe('heuristic')
    expect(result.explanation).toMatch(/not an exact zero/i)
  })

  it('keeps four significant digits for a very small Fiedler value', () => {
    const result = algebraicConnectivity(g(pathSpec(100)))
    const expected = 2 - 2 * Math.cos(Math.PI / 100)
    expect(result.value).toBeCloseTo(expected, 9)
    // Four decimal places would round this to "0.001" and hide two digits.
    expect(Number(result.display)).toBeCloseTo(expected, 7)
  })

  it('is not defined below two vertices', () => {
    expect(algebraicConnectivity(g(['A'])).value).toBeNull()
    expect(algebraicConnectivity(g(['A'])).exactness).toBe('not-applicable')
    expect(algebraicConnectivity(g([])).value).toBeNull()
  })
})

/* ================================================================== */
/* Spanning trees                                                      */
/* ================================================================== */

describe('spanningTreeCount', () => {
  it('gives n^(n-2) for K_n', () => {
    for (let n = 2; n <= 8; n++) {
      const expected = BigInt(n) ** BigInt(n - 2)
      expect(spanningTreeCount(g(completeSpec(n))).value).toBe(expected)
    }
  })

  it('gives n for C_n', () => {
    for (let n = 3; n <= 9; n++) {
      expect(spanningTreeCount(g(cycleSpec(n))).value).toBe(BigInt(n))
    }
  })

  it('gives 1 for any tree and for a single vertex', () => {
    expect(spanningTreeCount(g(['A'])).value).toBe(1n)
    expect(spanningTreeCount(g(pathSpec(6))).value).toBe(1n)
    expect(spanningTreeCount(g(['A-B', 'A-C', 'A-D', 'D-E', 'D-F'])).value).toBe(1n)
  })

  it('gives 0 for a disconnected graph and for the empty graph', () => {
    const result = spanningTreeCount(g(['A-B', 'C-D']))
    expect(result.value).toBe(0n)
    expect(result.explanation).toMatch(/disconnected/)
    expect(spanningTreeCount(g(['A-B', 'C'])).value).toBe(0n)
    expect(spanningTreeCount(g([])).value).toBe(0n)
  })

  it('gives 81 for K_{3,3} and 384 for the 3-cube', () => {
    expect(spanningTreeCount(g(bipartiteSpec(3, 3))).value).toBe(81n)
    expect(spanningTreeCount(g(cubeSpec())).value).toBe(384n)
    expect(spanningTreeCount(g(petersenSpec())).value).toBe(2000n)
  })

  it('ignores self-loops and counts parallel edges with multiplicity', () => {
    // Loops can never lie on a tree, so they do not change the count.
    expect(spanningTreeCount(g([...cycleSpec(4), 'A-A', 'B-B'])).value).toBe(4n)
    // Three parallel edges give three distinct spanning trees of K2.
    expect(spanningTreeCount(g(['A-B', 'A-B', 'A-B'])).value).toBe(3n)
    // A triangle with one doubled edge: 3 trees per choice of doubled edge.
    expect(spanningTreeCount(g([...cycleSpec(3), 'A-B'])).value).toBe(5n)
  })

  it('is labelled exact and stays exact past float64', () => {
    const result = spanningTreeCount(g(completeSpec(8)))
    expect(result.exactness).toBe('exact')
    expect(result.explanation).toMatch(/Matrix-Tree/)
    // K_30 has 30^28 spanning trees, far beyond float64's exact integers.
    const big = spanningTreeCount(g(completeSpec(30)))
    expect(big.value).toBe(30n ** 28n)
    expect(big.value! > 2n ** 53n).toBe(true)
  })

  it('ignores weights and says so', () => {
    const result = spanningTreeCount(g(['A-B:7', 'B-C:9', 'C-A:2'], { weighted: true }))
    expect(result.value).toBe(3n)
    expect(result.explanation).toMatch(/weights are ignored/i)
  })
})

/* ================================================================== */
/* Honesty guards                                                      */
/* ================================================================== */

describe('directed graphs are declined rather than approximated', () => {
  const digraph = g(['A->B', 'B->C', 'C->A'], { directed: true })

  it('returns null with not-applicable for the adjacency spectrum', () => {
    const result = adjacencySpectrum(digraph)
    expect(result.value).toBeNull()
    expect(result.exactness).toBe('not-applicable')
    expect(result.explanation).toMatch(/undirected/)
    expect(result.explanation).toMatch(/complex/)
  })

  it('returns null with not-applicable for the Laplacian spectrum and Fiedler value', () => {
    expect(laplacianSpectrum(digraph).value).toBeNull()
    expect(laplacianSpectrum(digraph).exactness).toBe('not-applicable')
    expect(algebraicConnectivity(digraph).value).toBeNull()
    expect(algebraicConnectivity(digraph).exactness).toBe('not-applicable')
  })

  it('returns not-applicable for spanningTreeCount, citing Tutte', () => {
    const result = spanningTreeCount(digraph)
    expect(result.value).toBeNull()
    expect(result.exactness).toBe('not-applicable')
    expect(result.explanation).toMatch(/Tutte/)
  })

  it('does compute the spectrum when a digraph happens to be symmetric', () => {
    const symmetric = g(['A->B', 'B->A', 'B->C', 'C->B'], { directed: true })
    const result = adjacencySpectrum(symmetric)
    expect(result.value).not.toBeNull()
    expectSpectrum(result.value?.values ?? [], [-Math.SQRT2, 0, Math.SQRT2])
    expect(result.explanation).toMatch(/happens to be symmetric/)
  })
})

describe('size gates', () => {
  // A path on SPECTRUM_VERTEX_LIMIT + 1 vertices: one vertex over the line.
  const bigSpec = Array.from(
    { length: SPECTRUM_VERTEX_LIMIT },
    (_, i) => `p${i}-p${i + 1}`,
  )

  it('declines to diagonalise above the vertex limit', () => {
    const big = g(bigSpec)
    expect(big.order).toBe(SPECTRUM_VERTEX_LIMIT + 1)
    for (const result of [
      adjacencySpectrum(big),
      laplacianSpectrum(big),
      algebraicConnectivity(big),
    ]) {
      expect(result.value).toBeNull()
      expect(result.exactness).toBe('not-computed')
      expect(result.explanation).toContain(String(SPECTRUM_VERTEX_LIMIT))
    }
  })

  it('still counts spanning trees above the spectrum limit', () => {
    const big = g(bigSpec)
    expect(spanningTreeCount(big).value).toBe(1n)
  })
})
