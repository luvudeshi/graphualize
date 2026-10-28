/**
 * Edge weights for a graph that has already been built.
 *
 * A generator decides which edges exist; a weighting decides the numbers on
 * them. It is a separate pass that runs after layout, for two reasons: one of
 * the schemes reads the final positions, and the same pass also serves the
 * "Assign random weights" transformation on a graph the user drew by hand.
 *
 *   * **Unit** — every edge weighs 1. Correct, but Dijkstra, Prim and Kruskal
 *     then make the same choices as BFS, so it teaches nothing about weights.
 *   * **Random** — whole numbers drawn uniformly from [min, max], one draw per
 *     edge in document order, from a seeded stream. The same graph and the
 *     same seed always give the same numbers.
 *   * **Length** — the straight-line distance between the drawn endpoints,
 *     scaled so the median edge weighs {@link LENGTH_SCALE} and rounded to a
 *     whole number, never below 1. Scaling by the median rather than by pixels
 *     keeps the numbers readable whatever spacing the layout used, while an
 *     edge drawn twice as long still weighs about twice as much.
 */

import type { GraphDocument } from '../model/types'
import { mulberry32, randomBelow } from './random'

export type EdgeWeighting =
  | { kind: 'unit' }
  | { kind: 'random'; min: number; max: number }
  | { kind: 'length' }

/** The range the dialog starts from and the transformation always uses. */
export const DEFAULT_WEIGHT_RANGE = { min: 1, max: 9 } as const

/** Generated weights stay within ±this, so an edge label never swamps the drawing. */
export const MAX_GENERATED_WEIGHT = 999

/** Under Length, the median edge gets this weight. */
export const LENGTH_SCALE = 10

/**
 * Keeps the weight stream independent of the structural one when both are
 * seeded with the same number: G(n, p) with seed 7 must not have its weights
 * correlated with which pairs it happened to join.
 */
const WEIGHT_SALT = 0x9e3779b9

/** Below this an edge has no length worth measuring (a self-loop, or stacked vertices). */
const LENGTH_EPSILON = 1e-9

/**
 * null when the weighting can be applied, otherwise the sentence to show.
 * Only a random range can be wrong; the other schemes have no parameters.
 */
export const weightingProblem = (weighting: EdgeWeighting): string | null => {
  if (weighting.kind !== 'random') return null
  const { min, max } = weighting
  if (!Number.isInteger(min) || !Number.isInteger(max)) {
    return 'Random weights need whole numbers at both ends of the range.'
  }
  if (Math.abs(min) > MAX_GENERATED_WEIGHT || Math.abs(max) > MAX_GENERATED_WEIGHT) {
    return `Random weights are kept between −${MAX_GENERATED_WEIGHT} and ${MAX_GENERATED_WEIGHT} so the labels stay readable.`
  }
  if (min > max) {
    return `The smallest weight (${min}) cannot be larger than the largest (${max}).`
  }
  return null
}

/** Lower median, so the reference length is always one that is really drawn. */
const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor((sorted.length - 1) / 2)]!
}

const lengthWeights = (doc: GraphDocument): number[] => {
  const at = new Map(doc.vertices.map((v) => [v.id, v] as const))
  const lengths = doc.edges.map((e) => {
    const a = at.get(e.source)
    const b = at.get(e.target)
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0
  })
  const measured = lengths.filter((length) => length > LENGTH_EPSILON)
  if (measured.length === 0) return lengths.map(() => 1)
  const unit = median(measured) / LENGTH_SCALE
  return lengths.map((length) =>
    Math.min(MAX_GENERATED_WEIGHT, Math.max(1, Math.round(length / unit))),
  )
}

const randomWeights = (count: number, min: number, max: number, seed: number): number[] => {
  const rand = mulberry32((seed ^ WEIGHT_SALT) >>> 0)
  const span = max - min + 1
  const out: number[] = []
  for (let i = 0; i < count; i++) out.push(min + randomBelow(rand, span))
  return out
}

/**
 * The weight each edge of `doc` receives, in document order. Throws on an
 * invalid range; callers that take a range from a person check
 * {@link weightingProblem} first and raise their own kind of error.
 */
export const edgeWeights = (
  doc: GraphDocument,
  weighting: EdgeWeighting,
  seed: number,
): number[] => {
  const problem = weightingProblem(weighting)
  if (problem) throw new RangeError(problem)
  switch (weighting.kind) {
    case 'unit':
      return doc.edges.map(() => 1)
    case 'random':
      return randomWeights(doc.edges.length, weighting.min, weighting.max, seed)
    case 'length':
      return lengthWeights(doc)
  }
}

/**
 * A weighted copy of `doc`: same vertices, same edge ids, new weights, and the
 * weighted flag on. The input is never mutated.
 */
export const weighEdges = (
  doc: GraphDocument,
  weighting: EdgeWeighting,
  seed: number,
): GraphDocument => {
  const weights = edgeWeights(doc, weighting, seed)
  return {
    vertices: doc.vertices.map((v) => ({ ...v })),
    edges: doc.edges.map((e, i) => ({ ...e, weight: weights[i]! })),
    directed: doc.directed,
    weighted: true,
  }
}

/** "random weights 1–9", for the status bar and the undo entry. */
export const describeWeighting = (weighting: EdgeWeighting): string => {
  switch (weighting.kind) {
    case 'unit':
      return 'unit weights'
    case 'random':
      return weighting.min === weighting.max
        ? `weight ${weighting.min} on every edge`
        : `random weights ${weighting.min}–${weighting.max}`
    case 'length':
      return 'weights from edge lengths'
  }
}
