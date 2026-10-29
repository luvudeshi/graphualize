/**
 * The title page's figure: Euclid I.47, Byrne's most famous plate, drawn as a
 * plane graph. A 3-4-5 right triangle with a square on each side has nine
 * vertices and twelve edges; with the paper round it, five faces. Its caption
 * states Euler's formula for exactly this graph, and the unit tests check the
 * count, so the caption can never be wrong about the figure above it.
 */

export type Point = readonly [number, number]

/* Laid out in units with the hypotenuse along the bottom of the triangle and
   y pointing up, then scaled into the viewBox below. */
export const FRONTISPIECE_POINTS: Record<string, Point> = {
  A: [0, 0],
  B: [5, 0],
  C: [3.2, 2.4],
  D: [5, -5],
  E: [0, -5],
  F: [-2.4, 3.2],
  G: [0.8, 5.6],
  H: [5.6, 4.2],
  I: [7.4, 1.8],
}

/** The bounded faces, each a run of vertices round its boundary, and the ink it is laid in. */
export const FRONTISPIECE_FACES: readonly { ids: string; ink: 'red' | 'blue' | 'yellow' | 'ink' }[] = [
  { ids: 'ABDE', ink: 'blue' },
  { ids: 'ACGF', ink: 'red' },
  { ids: 'CBIH', ink: 'yellow' },
  { ids: 'ABC', ink: 'ink' },
]

export const FRONTISPIECE_EDGES = [
  'AB',
  'BC',
  'CA',
  'AE',
  'ED',
  'DB',
  'AF',
  'FG',
  'GC',
  'CH',
  'HI',
  'IB',
] as const

/** The sides of a face, each written with its letters in order, so "CA" and "AC" match. */
export const faceSides = (ids: string): string[] =>
  ids.split('').map((id, i) => [id, ids[(i + 1) % ids.length]!].sort().join(''))

/** The caption's arithmetic: vertices − edges + faces, the outer face included. */
export const FRONTISPIECE_EULER = {
  vertices: Object.keys(FRONTISPIECE_POINTS).length,
  edges: FRONTISPIECE_EDGES.length,
  faces: FRONTISPIECE_FACES.length + 1,
}
