import type { GraphDocument } from '../graph/model/types'

export interface ThumbnailOptions {
  width: number
  height: number
  /** Space kept clear around the drawing, in viewBox units. */
  padding: number
  /** Vertex radius, in viewBox units. */
  radius: number
}

export interface ThumbnailGeometry {
  vertices: { id: string; x: number; y: number }[]
  edges: { id: string; d: string }[]
}

const round = (value: number) => Math.round(value * 10) / 10

/**
 * Fits a document's own vertex positions into a small box and turns its edges
 * into SVG paths: straight where an edge is alone, fanned into curves where
 * edges are parallel (Königsberg has seven bridges between four vertices), and
 * a small teardrop for a self-loop. Directed edges stop at the target's rim so
 * an arrowhead has somewhere to sit.
 *
 * It never enlarges a drawing past its own scale, so a two-vertex sketch does
 * not balloon to fill the card.
 */
export const thumbnailGeometry = (
  doc: GraphDocument,
  { width, height, padding, radius }: ThumbnailOptions,
): ThumbnailGeometry => {
  if (doc.vertices.length === 0) return { vertices: [], edges: [] }

  const xs = doc.vertices.map((v) => v.x)
  const ys = doc.vertices.map((v) => v.y)
  const minX = Math.min(...xs)
  const minY = Math.min(...ys)
  const spanX = Math.max(...xs) - minX
  const spanY = Math.max(...ys) - minY
  const room = { x: width - 2 * padding, y: height - 2 * padding }
  const scale = Math.min(
    spanX > 0 ? room.x / spanX : Infinity,
    spanY > 0 ? room.y / spanY : Infinity,
    1,
  )
  const offsetX = (width - spanX * scale) / 2
  const offsetY = (height - spanY * scale) / 2

  const at = new Map(
    doc.vertices.map((v) => [
      v.id,
      { x: offsetX + (v.x - minX) * scale, y: offsetY + (v.y - minY) * scale },
    ]),
  )

  // Parallel edges are fanned out symmetrically, so count each unordered pair
  // first. Opposite directions share a pair: an edge each way should curve
  // apart rather than draw over each other.
  const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`)
  const pairSize = new Map<string, number>()
  for (const e of doc.edges) {
    const key = pairKey(e.source, e.target)
    pairSize.set(key, (pairSize.get(key) ?? 0) + 1)
  }
  const pairSeen = new Map<string, number>()
  const spread = radius * 2.4

  const edges = doc.edges.flatMap((e) => {
    const p = at.get(e.source)
    const q = at.get(e.target)
    if (!p || !q) return []

    if (e.source === e.target) {
      const r = radius * 2.6
      return [
        {
          id: e.id,
          d: `M${round(p.x)} ${round(p.y)}C${round(p.x + r)} ${round(p.y - r * 1.6)} ${round(p.x - r)} ${round(p.y - r * 1.6)} ${round(p.x)} ${round(p.y)}`,
        },
      ]
    }

    const key = pairKey(e.source, e.target)
    const index = pairSeen.get(key) ?? 0
    pairSeen.set(key, index + 1)
    const offset = (index - ((pairSize.get(key) ?? 1) - 1) / 2) * spread

    // The normal is taken from the pair's canonical direction, so a reversed
    // edge in the same bundle bends by its own offset, not a mirrored one.
    const [from, to] = e.source < e.target ? [p, q] : [q, p]
    const length = Math.hypot(to.x - from.x, to.y - from.y) || 1
    const normal = { x: -(to.y - from.y) / length, y: (to.x - from.x) / length }
    // A quadratic's apex sits halfway to its control point, hence the doubling.
    const control = {
      x: (p.x + q.x) / 2 + normal.x * offset * 2,
      y: (p.y + q.y) / 2 + normal.y * offset * 2,
    }

    let end = q
    if (doc.directed) {
      const towards = offset === 0 ? p : control
      const reach = Math.hypot(q.x - towards.x, q.y - towards.y) || 1
      const trim = radius + 1.5
      end = {
        x: q.x - ((q.x - towards.x) / reach) * trim,
        y: q.y - ((q.y - towards.y) / reach) * trim,
      }
    }

    const d =
      offset === 0
        ? `M${round(p.x)} ${round(p.y)}L${round(end.x)} ${round(end.y)}`
        : `M${round(p.x)} ${round(p.y)}Q${round(control.x)} ${round(control.y)} ${round(end.x)} ${round(end.y)}`
    return [{ id: e.id, d }]
  })

  return {
    vertices: doc.vertices.map((v) => {
      const p = at.get(v.id)!
      return { id: v.id, x: round(p.x), y: round(p.y) }
    }),
    edges,
  }
}
