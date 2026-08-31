/**
 * Self-contained numerical and exact linear algebra used by the spectrum and
 * matrix inspectors.
 *
 * Nothing here knows about graphs, React or Cytoscape — it is plain arithmetic
 * on `number[][]` and `bigint`, so it can be unit tested in isolation and
 * reused by any future property module.
 *
 * Two very different kinds of arithmetic live side by side:
 *
 *  - {@link symmetricEigenvalues} / {@link symmetricEigen} are *floating point*.
 *    They return approximations, never exact algebraic numbers. Callers that
 *    surface these to a user must label them as approximate.
 *  - {@link integerDeterminant} / {@link characteristicPolynomialIntegers} are
 *    *exact*, using `bigint` throughout, and are safe to present as proofs.
 */

export interface JacobiOptions {
  /** Hard cap on cyclic sweeps. Default 100 — convergence is quadratic. */
  maxSweeps?: number
  /** Relative off-diagonal Frobenius norm at which we stop. Default 1e-12. */
  tolerance?: number
}

export interface SymmetricEigenResult {
  /** Eigenvalues in ascending order. */
  values: number[]
  /** Orthonormal eigenvectors as *columns*: `vectors[i][j]` is component i of eigenvector j. */
  vectors: number[][]
}

const DEFAULT_MAX_SWEEPS = 100
const DEFAULT_TOLERANCE = 1e-12

/* ------------------------------------------------------------------ */
/* Shape helpers                                                       */
/* ------------------------------------------------------------------ */

const isSquare = (m: readonly (readonly number[])[]): boolean =>
  m.every((row) => row.length === m.length)

const maxAbsEntry = (m: readonly (readonly number[])[]): number => {
  let max = 0
  for (const row of m) {
    for (const x of row) {
      const a = Math.abs(x)
      if (a > max) max = a
    }
  }
  return max
}

/**
 * True when `m` is square and equal to its own transpose.
 *
 * The tolerance is *relative* to the largest entry (with a floor of 1), so a
 * matrix built by summing floating point weights still counts as symmetric.
 */
export const isSymmetric = (m: number[][], tolerance = 1e-9): boolean => {
  const n = m.length
  if (!isSquare(m)) return false
  const scale = Math.max(1, maxAbsEntry(m))
  const bound = tolerance * scale
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = m[i][j]
      const b = m[j][i]
      if (!Number.isFinite(a) || !Number.isFinite(b)) return false
      if (Math.abs(a - b) > bound) return false
    }
  }
  return true
}

/* ------------------------------------------------------------------ */
/* Cyclic Jacobi eigensolver                                           */
/* ------------------------------------------------------------------ */

/**
 * Eigenvalues *and* orthonormal eigenvectors of a real symmetric matrix,
 * ascending by eigenvalue, via the cyclic Jacobi rotation method.
 *
 * Jacobi is chosen over QR because it is short, has no shift heuristics to get
 * wrong, and is unusually accurate on the small, highly structured matrices
 * graph theory produces (many repeated eigenvalues). It is O(n^3) per sweep and
 * converges quadratically, so a handful of sweeps is normal.
 *
 * Throws when the input is not square or not symmetric — an asymmetric matrix
 * can have complex eigenvalues, and silently returning real numbers for it
 * would be a lie.
 */
export const symmetricEigen = (
  m: number[][],
  opts: JacobiOptions = {},
): SymmetricEigenResult => {
  const n = m.length
  if (n === 0) return { values: [], vectors: [] }
  if (!isSquare(m)) throw new Error('symmetricEigen: matrix must be square')
  if (!isSymmetric(m)) throw new Error('symmetricEigen: matrix must be symmetric')
  if (n === 1) return { values: [m[0][0]], vectors: [[1]] }

  const maxSweeps = opts.maxSweeps ?? DEFAULT_MAX_SWEEPS
  const tolerance = opts.tolerance ?? DEFAULT_TOLERANCE

  // Working copy; `a` is driven towards a diagonal matrix, `v` accumulates the
  // product of the rotations and therefore ends up holding the eigenvectors.
  const a = m.map((row) => row.slice())
  const v: number[][] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)),
  )

  let frobeniusSquared = 0
  for (const row of a) for (const x of row) frobeniusSquared += x * x
  const target = tolerance * Math.max(Math.sqrt(frobeniusSquared), 1)

  for (let sweep = 0; sweep < maxSweeps; sweep++) {
    let offSquared = 0
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) offSquared += a[i][j] * a[i][j]
    }
    // Frobenius norm of the strictly off-diagonal part (both triangles).
    if (Math.sqrt(2 * offSquared) <= target) break

    for (let p = 0; p < n - 1; p++) {
      for (let q = p + 1; q < n; q++) {
        const apq = a[p][q]
        if (apq === 0) continue

        // After a few sweeps, rotations that are numerically invisible next to
        // the diagonal can be replaced by an exact zero (Numerical Recipes).
        const g = 100 * Math.abs(apq)
        if (
          sweep > 3 &&
          Math.abs(a[p][p]) + g === Math.abs(a[p][p]) &&
          Math.abs(a[q][q]) + g === Math.abs(a[q][q])
        ) {
          a[p][q] = 0
          a[q][p] = 0
          continue
        }

        // theta = (a_qq - a_pp) / (2 a_pq); the branch-free root
        //   t = sign(theta) / (|theta| + sqrt(theta^2 + 1))
        // always picks the *smaller* root, which is what keeps Jacobi stable.
        const theta = (a[q][q] - a[p][p]) / (2 * apq)
        const sign = theta >= 0 ? 1 : -1
        const denom = Math.abs(theta) + Math.sqrt(theta * theta + 1)
        const t = Number.isFinite(denom) && denom !== 0 ? sign / denom : 0
        if (t === 0) {
          a[p][q] = 0
          a[q][p] = 0
          continue
        }
        const c = 1 / Math.sqrt(t * t + 1)
        const s = t * c
        const tau = s / (1 + c)
        const h = t * apq

        a[p][p] -= h
        a[q][q] += h
        a[p][q] = 0
        a[q][p] = 0

        for (let k = 0; k < n; k++) {
          if (k === p || k === q) continue
          const akp = a[k][p]
          const akq = a[k][q]
          const newKp = akp - s * (akq + tau * akp)
          const newKq = akq + s * (akp - tau * akq)
          a[k][p] = newKp
          a[p][k] = newKp
          a[k][q] = newKq
          a[q][k] = newKq
        }
        for (let k = 0; k < n; k++) {
          const vkp = v[k][p]
          const vkq = v[k][q]
          v[k][p] = vkp - s * (vkq + tau * vkp)
          v[k][q] = vkq + s * (vkp - tau * vkq)
        }
      }
    }
  }

  const order = Array.from({ length: n }, (_, i) => i).sort(
    (x, y) => a[x][x] - a[y][y],
  )
  const values = order.map((i) => a[i][i])
  const vectors = Array.from({ length: n }, (_, row) =>
    order.map((col) => v[row][col]),
  )
  return { values, vectors }
}

/** Eigenvalues of a real symmetric matrix, ascending. See {@link symmetricEigen}. */
export const symmetricEigenvalues = (
  m: number[][],
  opts: JacobiOptions = {},
): number[] => symmetricEigen(m, opts).values

/* ------------------------------------------------------------------ */
/* Exact integer arithmetic                                            */
/* ------------------------------------------------------------------ */

const asBigInt = (x: number | bigint): bigint => {
  if (typeof x === 'bigint') return x
  if (!Number.isFinite(x) || !Number.isInteger(x)) {
    throw new Error(`integerDeterminant: entry ${String(x)} is not an integer`)
  }
  return BigInt(x)
}

/**
 * Exact determinant of an integer matrix via fraction-free Bareiss elimination
 * on `bigint`.
 *
 * Every intermediate division in Bareiss is provably exact, so the result is
 * the true determinant with no rounding whatsoever — this is what makes the
 * Matrix-Tree spanning tree count trustworthy for graphs where the answer
 * overflows float64.
 *
 * @throws if the matrix is ragged, non-square, or contains a non-integer.
 */
export const integerDeterminant = (m: (number | bigint)[][]): bigint => {
  const n = m.length
  if (n === 0) return 1n
  const a: bigint[][] = []
  for (let i = 0; i < n; i++) {
    const row = m[i]
    if (!row || row.length !== n) {
      throw new Error('integerDeterminant: matrix must be square')
    }
    a.push(row.map(asBigInt))
  }

  let sign = 1n
  let previousPivot = 1n
  for (let k = 0; k < n - 1; k++) {
    if (a[k][k] === 0n) {
      let swapWith = -1
      for (let r = k + 1; r < n; r++) {
        if (a[r][k] !== 0n) {
          swapWith = r
          break
        }
      }
      // A zero column below the pivot means the columns are dependent.
      if (swapWith < 0) return 0n
      const tmp = a[k]
      a[k] = a[swapWith]
      a[swapWith] = tmp
      sign = -sign
    }
    const pivot = a[k][k]
    for (let i = k + 1; i < n; i++) {
      for (let j = k + 1; j < n; j++) {
        a[i][j] = (a[i][j] * pivot - a[i][k] * a[k][j]) / previousPivot
      }
      a[i][k] = 0n
    }
    previousPivot = pivot
  }
  return sign * a[n - 1][n - 1]
}

/**
 * Coefficients of the characteristic polynomial `det(xI - M)` of an integer
 * matrix, highest degree first, computed exactly with Faddeev-LeVerrier.
 *
 * The leading coefficient is always `1n`, so an n x n matrix yields n + 1
 * coefficients (and the empty matrix yields `[1n]`).
 *
 * Returns `null` — rather than lying with a rounded answer — when the matrix is
 * ragged, non-square, or has any non-integer entry.
 */
export const characteristicPolynomialIntegers = (m: number[][]): bigint[] | null => {
  const n = m.length
  if (!isSquare(m)) return null

  const a: bigint[][] = []
  for (const row of m) {
    const converted: bigint[] = []
    for (const x of row) {
      if (!Number.isFinite(x) || !Number.isInteger(x)) return null
      converted.push(BigInt(x))
    }
    a.push(converted)
  }

  const coefficients: bigint[] = [1n]
  // M_0 = 0; M_k = A M_{k-1} + c_{k-1} I; c_k = -tr(A M_k) / k.
  let mk: bigint[][] = Array.from({ length: n }, () =>
    Array.from({ length: n }, () => 0n),
  )
  for (let k = 1; k <= n; k++) {
    const next: bigint[][] = Array.from({ length: n }, () =>
      Array.from({ length: n }, () => 0n),
    )
    for (let i = 0; i < n; i++) {
      for (let t = 0; t < n; t++) {
        const aij = a[i][t]
        if (aij === 0n) continue
        for (let j = 0; j < n; j++) next[i][j] += aij * mk[t][j]
      }
      next[i][i] += coefficients[k - 1]
    }
    mk = next

    // trace(A M_k) without forming the full product.
    let trace = 0n
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) trace += a[i][j] * mk[j][i]
    }
    const divisor = BigInt(k)
    // Always exact for an integer matrix; guard anyway rather than truncate.
    if (trace % divisor !== 0n) return null
    coefficients.push(-(trace / divisor))
  }
  return coefficients
}
