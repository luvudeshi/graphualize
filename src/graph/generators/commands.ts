/**
 * Quick-input syntax for the generators.
 *
 * The omnibox accepts the notation people already write on a whiteboard —
 * `K5`, `C8`, `K3,4`, `Q4`, `G(20,0.2)`, `3x4` — and turns it into a generator
 * id plus parameters. Parsing is deliberately total: unrecognised input comes
 * back as `null` rather than an exception, because the caller is typing.
 *
 * Any command may end in a weight suffix: `K6 w2-20` (random whole-number
 * weights from 2 to 20) or `grid(4,5) w=len` (weights from the drawn edge
 * lengths). Either one makes the generated graph weighted.
 */

import type { EdgeWeighting } from './weights'

export interface ParsedGeneratorCommand {
  generatorId: string
  params: Record<string, number>
  /** Normalised echo of the input, e.g. `K3,4` or `K6 w2-20`. */
  canonical: string
  /** Present only when the command carried a weight suffix. */
  weights?: EdgeWeighting
}

/** Trims trailing zeros so `0.20` echoes back as `0.2`. */
const formatNumber = (value: number): string =>
  Number.isInteger(value) ? String(value) : String(Number(value.toFixed(4)))

interface Rule {
  pattern: RegExp
  /** Capture groups in order; alternations leave the unused ones `undefined`. */
  build: (groups: Array<string | undefined>) => ParsedGeneratorCommand | null
}

/** One-letter families: `K5`, `C8`, `P12`, `S6`, `W7`, `Q4`. */
const singleLetter = (
  letter: string,
  generatorId: string,
  canonicalLetter: string,
): Rule => ({
  pattern: new RegExp(`^${letter}(\\d+)$`),
  build: (g) => {
    const n = Number(g[0])
    return {
      generatorId,
      params: { n },
      canonical: `${canonicalLetter}${formatNumber(n)}`,
    }
  },
})

const RULES: Rule[] = [
  // Km,n has to be tried before Kn so the comma form wins.
  {
    pattern: /^k(\d+),(\d+)$/,
    build: (g) => {
      const m = Number(g[0])
      const n = Number(g[1])
      return {
        generatorId: 'completeBipartite',
        params: { m, n },
        canonical: `K${formatNumber(m)},${formatNumber(n)}`,
      }
    },
  },
  singleLetter('k', 'complete', 'K'),
  singleLetter('c', 'cycle', 'C'),
  singleLetter('p', 'path', 'P'),
  singleLetter('s', 'star', 'S'),
  singleLetter('w', 'wheel', 'W'),
  singleLetter('q', 'hypercube', 'Q'),

  // G(n, p) — the probability may be omitted, and may be written `.2`.
  {
    pattern: /^g\((\d+)(?:,(\d*\.?\d+))?\)$/,
    build: (g) => {
      const n = Number(g[0])
      const p = g[1] === undefined ? 0.25 : Number(g[1])
      if (!Number.isFinite(p)) return null
      return {
        generatorId: 'erdosRenyi',
        params: { n, p },
        canonical: `G(${formatNumber(n)},${formatNumber(p)})`,
      }
    },
  },

  // grid(3,4) and the shorthand 3x4.
  {
    pattern: /^(?:grid\((\d+),(\d+)\)|(\d+)[x×](\d+))$/,
    build: (g) => {
      const rows = Number(g[0] ?? g[2])
      const cols = Number(g[1] ?? g[3])
      return {
        generatorId: 'grid',
        params: { rows, cols },
        canonical: `grid(${formatNumber(rows)},${formatNumber(cols)})`,
      }
    },
  },

  { pattern: /^petersen$/, build: () => ({ generatorId: 'petersen', params: {}, canonical: 'petersen' }) },

  // tree(n) is a uniform random tree; tree(r,h) is the complete r-ary tree.
  {
    pattern: /^tree\((\d+)\)$/,
    build: (g) => {
      const n = Number(g[0])
      return {
        generatorId: 'randomTree',
        params: { n },
        canonical: `tree(${formatNumber(n)})`,
      }
    },
  },
  {
    pattern: /^tree\((\d+),(\d+)\)$/,
    build: (g) => {
      const r = Number(g[0])
      const h = Number(g[1])
      return {
        generatorId: 'completeTree',
        params: { r, h },
        canonical: `tree(${formatNumber(r)},${formatNumber(h)})`,
      }
    },
  },

  // random(n, d) — a random d-regular graph. `regular(...)` reads better to some.
  {
    pattern: /^(?:random|regular)\((\d+),(\d+)\)$/,
    build: (g) => {
      const n = Number(g[0])
      const d = Number(g[1])
      return {
        generatorId: 'randomRegular',
        params: { n, d },
        canonical: `random(${formatNumber(n)},${formatNumber(d)})`,
      }
    },
  },
]

/**
 * The optional weight suffix, matched against the compacted input, so
 * `K6 w2-20` arrives here as `k6w2-20`. Random ranges may be written `w2-20`
 * or `w=2-20`, and either end may be negative (`w-3-9`), which is how a
 * Bellman–Ford exercise starts. Nothing in the base vocabulary contains `-`
 * or `=` or ends in `len`, so stripping a suffix can never change how an
 * existing command reads.
 */
const WEIGHT_SUFFIX = /w(?:=?(-?\d+)-(-?\d+)|=?(len|length))$/

interface WeightSuffix {
  weights: EdgeWeighting
  /** Normalised spelling, appended to the canonical echo. */
  canonical: string
}

const splitWeightSuffix = (compact: string): { base: string; suffix: WeightSuffix | null } => {
  const match = WEIGHT_SUFFIX.exec(compact)
  if (!match) return { base: compact, suffix: null }
  const base = compact.slice(0, match.index)
  if (match[3] !== undefined) {
    return { base, suffix: { weights: { kind: 'length' }, canonical: 'w=len' } }
  }
  const min = Number(match[1])
  const max = Number(match[2])
  return {
    base,
    suffix: {
      weights: { kind: 'random', min, max },
      canonical: `w${formatNumber(min)}-${formatNumber(max)}`,
    },
  }
}

/**
 * Parses one quick-input command. Case-insensitive, and every space is
 * ignored, so `k 3 , 4` and `K3,4` mean the same thing. Returns `null` for
 * anything the vocabulary does not cover — including syntactically valid but
 * mathematically impossible requests, which are rejected later by the
 * generator itself with a message worth showing. A weight range the wrong way
 * round (`w9-1`) is one of those: it parses, and the generator explains.
 */
export const parseGraphCommand = (input: string): ParsedGeneratorCommand | null => {
  if (typeof input !== 'string') return null
  const compact = input.replace(/\s+/g, '').toLowerCase()
  if (!compact) return null

  const { base, suffix } = splitWeightSuffix(compact)
  if (!base) return null
  for (const rule of RULES) {
    const match = rule.pattern.exec(base)
    if (!match) continue
    const parsed = rule.build(match.slice(1))
    if (!parsed || !suffix) return parsed
    return {
      ...parsed,
      canonical: `${parsed.canonical} ${suffix.canonical}`,
      weights: suffix.weights,
    }
  }
  return null
}
