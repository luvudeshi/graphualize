/**
 * Seeded randomness for the generators and the weight schemes.
 *
 * Nothing in the graph library calls `Math.random`. Every random choice comes
 * from one of these streams, so a seed (or, for a transformation, the graph
 * itself) always reproduces the same result. The app is what makes them
 * random: it draws a {@link freshSeed} for every press of Generate, so the
 * same parameters give a new graph each time.
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
 * A new unsigned 32-bit seed from the platform's entropy. The one place
 * randomness enters; everything downstream stays a pure function of it.
 */
export const freshSeed = (): number => crypto.getRandomValues(new Uint32Array(1))[0]!

/**
 * FNV-1a over a string, as an unsigned 32-bit seed. The fallback when a
 * transformation runs without `ctx.seed`, as tests do: the graph's structure
 * key keeps the result a pure function of its input.
 */
export const seedFromText = (text: string): number => {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}
