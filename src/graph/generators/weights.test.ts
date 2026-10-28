import { describe, expect, it } from 'vitest'

import { GraphBuilder } from '../model/builder'
import type { GraphDocument } from '../model/types'
import { GeneratorError, generate } from './index'
import { parseGraphCommand } from './commands'
import {
  DEFAULT_WEIGHT_RANGE,
  LENGTH_SCALE,
  MAX_GENERATED_WEIGHT,
  describeWeighting,
  edgeWeights,
  weighEdges,
  weightingProblem,
} from './weights'

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const weightsOf = (doc: GraphDocument): number[] => doc.edges.map((e) => e.weight ?? NaN)

/** Structure fingerprint in terms of labels, so ids may differ between runs. */
const signature = (doc: GraphDocument): string => {
  const label = new Map(doc.vertices.map((v) => [v.id, v.label]))
  return doc.edges
    .map((e) => {
      const a = label.get(e.source)!
      const b = label.get(e.target)!
      return a <= b ? `${a}-${b}` : `${b}-${a}`
    })
    .sort()
    .join(' ')
}

/** Vertices at the given points, joined by the given index pairs. */
const drawn = (
  points: Array<[number, number]>,
  edges: Array<[number, number]>,
  options: { directed?: boolean } = {},
): GraphDocument => {
  const b = new GraphBuilder(options)
  const ids = points.map(([x, y], i) => b.addVertex(String.fromCharCode(65 + i), x, y))
  for (const [s, t] of edges) b.addEdge(ids[s]!, ids[t]!)
  return b.build()
}

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

describe('weightingProblem', () => {
  it('accepts every scheme with a sensible range', () => {
    expect(weightingProblem({ kind: 'unit' })).toBeNull()
    expect(weightingProblem({ kind: 'length' })).toBeNull()
    expect(weightingProblem({ kind: 'random', min: 1, max: 9 })).toBeNull()
    expect(weightingProblem({ kind: 'random', min: -5, max: 5 })).toBeNull()
    expect(weightingProblem({ kind: 'random', min: 4, max: 4 })).toBeNull()
  })

  it('refuses fractions, blanks, huge numbers and a backwards range in plain words', () => {
    expect(weightingProblem({ kind: 'random', min: 1.5, max: 9 })).toMatch(/whole numbers/)
    expect(weightingProblem({ kind: 'random', min: NaN, max: 9 })).toMatch(/whole numbers/)
    expect(
      weightingProblem({ kind: 'random', min: 1, max: MAX_GENERATED_WEIGHT + 1 }),
    ).toMatch(/readable/)
    expect(weightingProblem({ kind: 'random', min: 9, max: 1 })).toBe(
      'The smallest weight (9) cannot be larger than the largest (1).',
    )
  })

  it('makes edgeWeights throw rather than invent numbers for a bad range', () => {
    const doc = drawn([[0, 0], [100, 0]], [[0, 1]])
    expect(() => edgeWeights(doc, { kind: 'random', min: 9, max: 1 }, 1)).toThrow(RangeError)
  })
})

/* ------------------------------------------------------------------ */
/* The three schemes                                                   */
/* ------------------------------------------------------------------ */

describe('edgeWeights', () => {
  const k10 = () => generate('complete', { n: 10 })

  it('gives every edge 1 under unit weights', () => {
    expect(edgeWeights(k10(), { kind: 'unit' }, 1)).toEqual(Array(45).fill(1))
  })

  it('draws whole numbers inside the range, and uses all of it', () => {
    const weights = edgeWeights(k10(), { kind: 'random', min: 1, max: 3 }, 7)
    expect(weights).toHaveLength(45)
    for (const w of weights) {
      expect(Number.isInteger(w)).toBe(true)
      expect(w).toBeGreaterThanOrEqual(1)
      expect(w).toBeLessThanOrEqual(3)
    }
    expect(new Set(weights)).toEqual(new Set([1, 2, 3]))
  })

  it('is reproducible from the seed, and a different seed gives different numbers', () => {
    const range = { kind: 'random', min: 1, max: 9 } as const
    expect(edgeWeights(k10(), range, 42)).toEqual(edgeWeights(k10(), range, 42))
    expect(edgeWeights(k10(), range, 42)).not.toEqual(edgeWeights(k10(), range, 43))
  })

  it('pins the stream, so a seed means the same weights in every release', () => {
    const doc = drawn([[0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [5, 0]], [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 4],
      [4, 5],
    ])
    // A saved exercise ("K6 w1-9, seed 1") must keep meaning the same numbers.
    expect(edgeWeights(doc, { kind: 'random', ...DEFAULT_WEIGHT_RANGE }, 1)).toEqual([
      2, 3, 8, 5, 8,
    ])
  })

  it('handles negative ranges and a single-value range', () => {
    const negative = edgeWeights(k10(), { kind: 'random', min: -3, max: -1 }, 5)
    expect(negative.every((w) => w >= -3 && w <= -1)).toBe(true)
    expect(edgeWeights(k10(), { kind: 'random', min: 4, max: 4 }, 5)).toEqual(Array(45).fill(4))
  })

  it('measures drawn length, scaled so the median edge weighs 10', () => {
    // A-B is 100 long, B-C 200 and C-D 300: the median is 200.
    const doc = drawn(
      [
        [0, 0],
        [100, 0],
        [100, 200],
        [400, 200],
      ],
      [
        [0, 1],
        [1, 2],
        [2, 3],
      ],
    )
    expect(edgeWeights(doc, { kind: 'length' }, 0)).toEqual([5, LENGTH_SCALE, 15])
  })

  it('does not care how far apart the layout spaced things', () => {
    const points: Array<[number, number]> = [
      [0, 0],
      [130, 40],
      [70, 210],
      [-90, 120],
    ]
    const edges: Array<[number, number]> = [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 0],
      [0, 2],
    ]
    const small = drawn(points, edges)
    const large = drawn(
      points.map(([x, y]) => [x * 3.5 + 40, y * 3.5 - 70]),
      edges,
    )
    expect(edgeWeights(large, { kind: 'length' }, 0)).toEqual(
      edgeWeights(small, { kind: 'length' }, 0),
    )
  })

  it('weighs a self-loop, stacked vertices and an all-zero drawing as 1', () => {
    const withLoop = drawn(
      [
        [0, 0],
        [100, 0],
        [100, 0],
      ],
      [
        [0, 1],
        [1, 1],
        [1, 2],
      ],
    )
    expect(edgeWeights(withLoop, { kind: 'length' }, 0)).toEqual([10, 1, 1])
    const collapsed = drawn(
      [
        [5, 5],
        [5, 5],
      ],
      [[0, 1]],
    )
    expect(edgeWeights(collapsed, { kind: 'length' }, 0)).toEqual([1])
  })

  it('is empty for a graph with no edges', () => {
    const lonely = drawn([[0, 0]], [])
    expect(edgeWeights(lonely, { kind: 'length' }, 0)).toEqual([])
    expect(edgeWeights(lonely, { kind: 'random', min: 1, max: 9 }, 0)).toEqual([])
  })
})

describe('weighEdges', () => {
  it('returns a weighted copy and leaves its input alone', () => {
    const doc = drawn(
      [
        [0, 0],
        [100, 0],
        [0, 100],
      ],
      [
        [0, 1],
        [1, 2],
      ],
      { directed: true },
    )
    const before = JSON.stringify(doc)
    const out = weighEdges(doc, { kind: 'random', min: 2, max: 20 }, 3)
    expect(JSON.stringify(doc)).toBe(before)
    expect(out.weighted).toBe(true)
    expect(out.directed).toBe(true)
    expect(out.edges.map((e) => e.id)).toEqual(doc.edges.map((e) => e.id))
    expect(out.vertices).toEqual(doc.vertices)
    expect(out.vertices[0]).not.toBe(doc.vertices[0])
    expect(weightsOf(out).every((w) => w >= 2 && w <= 20)).toBe(true)
  })

  it('describes itself for the status bar', () => {
    expect(describeWeighting({ kind: 'unit' })).toBe('unit weights')
    expect(describeWeighting({ kind: 'random', min: 2, max: 20 })).toBe('random weights 2–20')
    expect(describeWeighting({ kind: 'random', min: 3, max: 3 })).toBe('weight 3 on every edge')
    expect(describeWeighting({ kind: 'length' })).toBe('weights from edge lengths')
  })
})

/* ------------------------------------------------------------------ */
/* Through generate()                                                  */
/* ------------------------------------------------------------------ */

describe('generate with weights', () => {
  it('still gives a weighted graph weight 1 everywhere when no scheme is asked for', () => {
    const doc = generate('complete', { n: 6 }, { weighted: true })
    expect(doc.weighted).toBe(true)
    expect(weightsOf(doc)).toEqual(Array(15).fill(1))
    expect(generate('complete', { n: 6 }).weighted).toBe(false)
  })

  it('weighs K6 randomly within the range, reproducibly, and makes it weighted', () => {
    const options = { seed: 11, weights: { kind: 'random', min: 2, max: 20 } as const }
    const doc = generate('complete', { n: 6 }, options)
    expect(doc.weighted).toBe(true)
    expect(doc.edges).toHaveLength(15)
    expect(weightsOf(doc).every((w) => Number.isInteger(w) && w >= 2 && w <= 20)).toBe(true)
    expect(weightsOf(generate('complete', { n: 6 }, options))).toEqual(weightsOf(doc))
    expect(
      weightsOf(generate('complete', { n: 6 }, { ...options, seed: 12 })),
    ).not.toEqual(weightsOf(doc))
  })

  it('never disturbs the structure a random family draws from the same seed', () => {
    const plain = generate('erdosRenyi', { n: 14, p: 0.3 }, { seed: 5 })
    const weighted = generate(
      'erdosRenyi',
      { n: 14, p: 0.3 },
      { seed: 5, weights: { kind: 'random', min: 1, max: 9 } },
    )
    expect(signature(weighted)).toBe(signature(plain))
    expect(weighted.vertices.map((v) => [v.x, v.y])).toEqual(plain.vertices.map((v) => [v.x, v.y]))
  })

  it('weighs a grid by length: every edge is the same length, so the same weight', () => {
    const doc = generate('grid', { rows: 4, cols: 5 }, { weights: { kind: 'length' } })
    expect(doc.weighted).toBe(true)
    expect(new Set(weightsOf(doc))).toEqual(new Set([LENGTH_SCALE]))
  })

  it('weighs the Petersen graph by length: spokes, pentagram and pentagon differ', () => {
    const doc = generate('petersen', {}, { weights: { kind: 'length' } })
    // Spokes ≈ 115, pentagram chords ≈ 181, pentagon sides ≈ 247; the median is a chord.
    expect([...new Set(weightsOf(doc))].sort((a, b) => a - b)).toEqual([6, 10, 14])
  })

  it('applies unit weights to an otherwise unweighted request', () => {
    const doc = generate('cycle', { n: 5 }, { weights: { kind: 'unit' } })
    expect(doc.weighted).toBe(true)
    expect(weightsOf(doc)).toEqual([1, 1, 1, 1, 1])
  })

  it('refuses a bad range with a GeneratorError before building anything', () => {
    expect(() =>
      generate('complete', { n: 6 }, { weights: { kind: 'random', min: 9, max: 1 } }),
    ).toThrow(GeneratorError)
    expect(() =>
      generate('complete', { n: 6 }, { weights: { kind: 'random', min: 9, max: 1 } }),
    ).toThrow('The smallest weight (9) cannot be larger than the largest (1).')
  })
})

/* ------------------------------------------------------------------ */
/* Quick-command suffix                                                */
/* ------------------------------------------------------------------ */

describe('parseGraphCommand weight suffix', () => {
  const rnd = (min: number, max: number) => ({ kind: 'random', min, max })
  const len = { kind: 'length' }
  const cases: Array<[string, string, Record<string, number>, string, unknown]> = [
    ['K6 w2-20', 'complete', { n: 6 }, 'K6 w2-20', rnd(2, 20)],
    ['grid(4,5) w1-9', 'grid', { rows: 4, cols: 5 }, 'grid(4,5) w1-9', rnd(1, 9)],
    ['grid(4,5) w=len', 'grid', { rows: 4, cols: 5 }, 'grid(4,5) w=len', len],
    ['K6 w=length', 'complete', { n: 6 }, 'K6 w=len', len],
    ['K6 wlen', 'complete', { n: 6 }, 'K6 w=len', len],
    ['K6 w=2-20', 'complete', { n: 6 }, 'K6 w2-20', rnd(2, 20)],
    ['W7 w1-9', 'wheel', { n: 7 }, 'W7 w1-9', rnd(1, 9)],
    ['k3,4w-3-9', 'completeBipartite', { m: 3, n: 4 }, 'K3,4 w-3-9', rnd(-3, 9)],
    ['G(20,0.2) W1-9', 'erdosRenyi', { n: 20, p: 0.2 }, 'G(20,0.2) w1-9', rnd(1, 9)],
    ['3x4 w = len', 'grid', { rows: 3, cols: 4 }, 'grid(3,4) w=len', len],
    ['petersen w5-5', 'petersen', {}, 'petersen w5-5', rnd(5, 5)],
    ['tree(12) w1-99', 'randomTree', { n: 12 }, 'tree(12) w1-99', rnd(1, 99)],
  ]

  it.each(cases)('parses %s', (input, generatorId, params, canonical, weights) => {
    expect(parseGraphCommand(input)).toEqual({ generatorId, params, canonical, weights })
  })

  it('echoes a canonical form that parses back to the same command', () => {
    for (const [input] of cases) {
      const parsed = parseGraphCommand(input)!
      expect(parseGraphCommand(parsed.canonical), input).toEqual(parsed)
    }
  })

  it('leaves every existing command exactly as it was, with no weights key', () => {
    const old: Array<[string, string, Record<string, number>, string]> = [
      ['K5', 'complete', { n: 5 }, 'K5'],
      ['W7', 'wheel', { n: 7 }, 'W7'],
      ['w12', 'wheel', { n: 12 }, 'W12'],
      ['K3,4', 'completeBipartite', { m: 3, n: 4 }, 'K3,4'],
      ['G(20,0.2)', 'erdosRenyi', { n: 20, p: 0.2 }, 'G(20,0.2)'],
      ['3x4', 'grid', { rows: 3, cols: 4 }, 'grid(3,4)'],
      ['petersen', 'petersen', {}, 'petersen'],
      ['random(10,3)', 'randomRegular', { n: 10, d: 3 }, 'random(10,3)'],
    ]
    for (const [input, generatorId, params, canonical] of old) {
      expect(parseGraphCommand(input), input).toStrictEqual({ generatorId, params, canonical })
    }
  })

  it('returns null for a suffix with nothing to weigh, or a malformed one', () => {
    for (const junk of [
      'w1-9',
      'w=len',
      ' w2-20 ',
      'K6 w',
      'K6 w1',
      'K6 w1-',
      'K6 w=',
      'K6 w=foo',
      'K6 w1-9-3',
      'K6 w1.5-9',
      'K6 1-9',
      'K6 w1-9 w2-3',
      'hello w1-9',
    ]) {
      expect(parseGraphCommand(junk), junk).toBeNull()
    }
  })

  it('parses a backwards range and leaves the generator to explain it', () => {
    const parsed = parseGraphCommand('K6 w9-1')!
    expect(parsed.weights).toEqual({ kind: 'random', min: 9, max: 1 })
    expect(() =>
      generate(parsed.generatorId, parsed.params, { weights: parsed.weights }),
    ).toThrow(GeneratorError)
  })

  it('feeds straight into generate()', () => {
    const parsed = parseGraphCommand('grid(4,5) w1-9')!
    const doc = generate(parsed.generatorId, parsed.params, { seed: 1, weights: parsed.weights })
    expect(doc.weighted).toBe(true)
    expect(doc.edges).toHaveLength(31)
    expect(weightsOf(doc).every((w) => w >= 1 && w <= 9)).toBe(true)
  })
})
