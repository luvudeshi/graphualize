import type { GraphDocument, VertexId } from './types'

let counter = 0

/** Monotonic, collision-free ids. Deterministic within a session. */
export const nextVertexId = (): VertexId => `v${(counter++).toString(36)}`
export const nextEdgeId = (): string => `e${(counter++).toString(36)}`

/** Test hook so id sequences are reproducible. */
export const resetIdCounter = (value = 0): void => {
  counter = value
}

/**
 * Advances the counter past every id in a document.
 *
 * Ids are only unique within one run of the module, so a document restored
 * from storage, opened from the document list or parsed from a file can carry
 * ids the counter would otherwise hand out again. That produced silently
 * corrupt graphs: a duplicate id collapses two vertices into one everywhere the
 * model is keyed by id.
 */
export const absorbIds = (doc: {
  vertices: readonly { id: string }[]
  edges: readonly { id: string }[]
}): void => {
  let next = counter
  const consider = (id: string) => {
    const match = /^[ve]([0-9a-z]+)$/.exec(id)
    if (!match) return
    const value = Number.parseInt(match[1]!, 36)
    if (Number.isFinite(value) && value >= next) next = value + 1
  }
  for (const vertex of doc.vertices) consider(vertex.id)
  for (const edge of doc.edges) consider(edge.id)
  counter = next
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

/**
 * Spreadsheet-style names: A..Z, AA..AZ, BA.. and so on. `index` is 0-based.
 */
export const labelForIndex = (index: number): string => {
  let n = index
  let out = ''
  do {
    out = ALPHABET[n % 26] + out
    n = Math.floor(n / 26) - 1
  } while (n >= 0)
  return out
}

/**
 * The next unused canonical label for a document. Skips names already in use
 * so deleting "B" and adding a vertex gives you "B" back rather than "D".
 */
export const nextVertexLabel = (doc: Pick<GraphDocument, 'vertices'>): string => {
  const used = new Set(doc.vertices.map((v) => v.label))
  for (let i = 0; i < used.size + 1; i++) {
    const candidate = labelForIndex(i)
    if (!used.has(candidate)) return candidate
  }
  return labelForIndex(used.size)
}

/** Generates a run of distinct labels, used by the generators. */
export const labelSeries = (count: number, offset = 0): string[] =>
  Array.from({ length: count }, (_, i) => labelForIndex(i + offset))
