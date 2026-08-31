/**
 * Quick-input syntax for the generators.
 *
 * The omnibox accepts the notation people already write on a whiteboard —
 * `K5`, `C8`, `K3,4`, `Q4`, `G(20,0.2)`, `3x4` — and turns it into a generator
 * id plus parameters. Parsing is deliberately total: unrecognised input comes
 * back as `null` rather than an exception, because the caller is typing.
 */

export interface ParsedGeneratorCommand {
  generatorId: string
  params: Record<string, number>
  /** Normalised echo of the input, e.g. `K3,4`. */
  canonical: string
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
 * Parses one quick-input command. Case-insensitive, and every space is
 * ignored, so `k 3 , 4` and `K3,4` mean the same thing. Returns `null` for
 * anything the vocabulary does not cover — including syntactically valid but
 * mathematically impossible requests, which are rejected later by the
 * generator itself with a message worth showing.
 */
export const parseGraphCommand = (input: string): ParsedGeneratorCommand | null => {
  if (typeof input !== 'string') return null
  const compact = input.replace(/\s+/g, '').toLowerCase()
  if (!compact) return null

  for (const rule of RULES) {
    const match = rule.pattern.exec(compact)
    if (match) return rule.build(match.slice(1))
  }
  return null
}
