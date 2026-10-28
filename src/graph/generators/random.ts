/**
 * Seeded randomness for the generators and the weight schemes.
 *
 * Nothing in the graph library calls `Math.random`. Every random choice comes
 * from one of these streams, so a seed (or, for a transformation, the graph
 * itself) always reproduces the same result.
 */

export type Rng = () => number

/**
 * mulberry32: 32 bits of state, excellent distribution for our sizes, and
 * trivially reproducible. Returns values in [0, 1).
 */
export const mulberry32 = (seed: number): Rng => {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Uniform integer in [0, bound). */
export const randomBelow = (rand: Rng, bound: number): number => {
  const i = Math.floor(rand() * bound)
  return i >= bound ? bound - 1 : i
}

/**
 * FNV-1a over a string, as an unsigned 32-bit seed. Used where the only
 * reproducible input is the graph itself — a transformation has no seed
 * field, but it does have the graph's structure key.
 */
export const seedFromText = (text: string): number => {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}
