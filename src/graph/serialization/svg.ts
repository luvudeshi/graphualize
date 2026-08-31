import type { Graph } from '../model/graph'
import type { EdgeId, VertexId } from '../model/types'

/**
 * Vector export of the drawing.
 *
 * This is a hand-written renderer rather than a dump of the canvas, so the
 * output is a small, clean SVG: real circles, lines and text that open in
 * Illustrator or Inkscape, drop into LaTeX, and stay sharp at any size.
 */

export interface SvgTheme {
  background: string
  vertexFill: string
  vertexBorder: string
  vertexText: string
  edge: string
  edgeLabel: string
  edgeLabelBackground: string
}

export const LIGHT_SVG_THEME: SvgTheme = {
  background: '#ffffff',
  vertexFill: '#ffffff',
  vertexBorder: '#3f3f46',
  vertexText: '#17171a',
  edge: '#71717a',
  edgeLabel: '#3f3f46',
  edgeLabelBackground: '#ffffff',
}

export interface SvgOptions {
  theme?: SvgTheme
  /** Omit the background rectangle, for placing the drawing on a page. */
  transparent?: boolean
  padding?: number
  vertexRadius?: number
  /** Per-element colours, e.g. the witness currently highlighted on screen. */
  highlightVertices?: Record<VertexId, string>
  highlightEdges?: Record<EdgeId, string>
  /** Per-vertex fill, used by colourings and partitions. */
  vertexFills?: Record<VertexId, string>
  /** Elements to draw faintly because something else is highlighted. */
  dimmed?: boolean
  title?: string
}

interface Point {
  x: number
  y: number
}

const escapeXml = (text: string): string =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

const round = (value: number): string => String(Math.round(value * 100) / 100)

/** Point on a quadratic Bezier at parameter t. */
const quadratic = (a: Point, c: Point, b: Point, t: number): Point => {
  const u = 1 - t
  return {
    x: u * u * a.x + 2 * u * t * c.x + t * t * b.x,
    y: u * u * a.y + 2 * u * t * c.y + t * t * b.y,
  }
}

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)

/**
 * Walks the curve inwards from an endpoint until it clears the vertex circle,
 * so lines stop at the rim and arrowheads sit where they should. Sampling is
 * simpler and more robust than solving the intersection analytically, and the
 * curve is short.
 */
const meetCircle = (
  a: Point,
  c: Point,
  b: Point,
  centre: Point,
  radius: number,
  fromStart: boolean,
): { point: Point; tangent: Point } => {
  const steps = 48
  let previous = fromStart ? a : b
  for (let i = 1; i <= steps; i++) {
    const t = fromStart ? i / steps : 1 - i / steps
    const point = quadratic(a, c, b, t)
    if (distance(point, centre) >= radius) {
      const tangent = { x: point.x - previous.x, y: point.y - previous.y }
      const length = Math.hypot(tangent.x, tangent.y) || 1
      return { point, tangent: { x: tangent.x / length, y: tangent.y / length } }
    }
    previous = point
  }
  return { point: fromStart ? a : b, tangent: { x: 1, y: 0 } }
}

const arrowHead = (tip: Point, direction: Point, color: string): string => {
  const size = 9
  const spread = 3.6
  const back = { x: tip.x - direction.x * size, y: tip.y - direction.y * size }
  const normal = { x: -direction.y, y: direction.x }
  const left = { x: back.x + normal.x * spread, y: back.y + normal.y * spread }
  const right = { x: back.x - normal.x * spread, y: back.y - normal.y * spread }
  return `<path d="M ${round(tip.x)} ${round(tip.y)} L ${round(left.x)} ${round(left.y)} L ${round(right.x)} ${round(right.y)} Z" fill="${color}"/>`
}

export const toSvg = (graph: Graph, options: SvgOptions = {}): string => {
  const theme = options.theme ?? LIGHT_SVG_THEME
  const radius = options.vertexRadius ?? 17
  const padding = options.padding ?? 28
  const dimOpacity = 0.18

  const positions = new Map<VertexId, Point>(
    graph.vertices.map((v) => [v.id, { x: v.x, y: v.y }] as const),
  )

  const xs = graph.vertices.map((v) => v.x)
  const ys = graph.vertices.map((v) => v.y)
  const minX = (xs.length ? Math.min(...xs) : 0) - radius - padding
  const maxX = (xs.length ? Math.max(...xs) : 0) + radius + padding
  const minY = (ys.length ? Math.min(...ys) : 0) - radius - padding
  const maxY = (ys.length ? Math.max(...ys) : 0) + radius + padding
  const width = Math.max(1, maxX - minX)
  const height = Math.max(1, maxY - minY)

  const parts: string[] = []
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${round(minX)} ${round(minY)} ${round(width)} ${round(height)}" width="${round(width)}" height="${round(height)}" font-family="Inter, system-ui, sans-serif">`,
  )
  if (options.title) parts.push(`<title>${escapeXml(options.title)}</title>`)
  if (!options.transparent) {
    parts.push(
      `<rect x="${round(minX)}" y="${round(minY)}" width="${round(width)}" height="${round(height)}" fill="${theme.background}"/>`,
    )
  }

  /* ---- edges ---------------------------------------------------- */

  const bundles = new Map<string, EdgeId[]>()
  for (const edge of graph.edges) {
    const key =
      edge.source === edge.target
        ? `loop:${edge.source}`
        : [edge.source, edge.target].slice().sort().join('|')
    const bundle = bundles.get(key)
    if (bundle) bundle.push(edge.id)
    else bundles.set(key, [edge.id])
  }

  const edgeLabels: string[] = []

  for (const ids of bundles.values()) {
    ids.forEach((id, index) => {
      const edge = graph.edge(id)
      if (!edge) return
      const from = positions.get(edge.source)
      const to = positions.get(edge.target)
      if (!from || !to) return

      const color = options.highlightEdges?.[id] ?? theme.edge
      const emphasised = Boolean(options.highlightEdges?.[id])
      const opacity = options.dimmed && !emphasised ? dimOpacity : 1
      const strokeWidth = emphasised ? 3 : 1.8

      if (edge.source === edge.target) {
        // Self-loop: a teardrop above the vertex, one ring further out for
        // each additional loop.
        const lift = radius * (2.1 + index * 0.9)
        const spread = radius * 0.85
        const path = `M ${round(from.x - spread)} ${round(from.y - radius * 0.6)} C ${round(from.x - spread * 1.6)} ${round(from.y - lift)}, ${round(from.x + spread * 1.6)} ${round(from.y - lift)}, ${round(from.x + spread)} ${round(from.y - radius * 0.6)}`
        parts.push(
          `<path d="${path}" fill="none" stroke="${color}" stroke-width="${strokeWidth}" opacity="${opacity}"/>`,
        )
        return
      }

      const midpoint = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }
      const offset = (index - (ids.length - 1) / 2) * 42
      const dx = to.x - from.x
      const dy = to.y - from.y
      const length = Math.hypot(dx, dy) || 1
      const control = {
        x: midpoint.x + (-dy / length) * offset,
        y: midpoint.y + (dx / length) * offset,
      }

      const start = meetCircle(from, control, to, from, radius, true)
      const end = meetCircle(from, control, to, to, radius, false)

      parts.push(
        `<path d="M ${round(start.point.x)} ${round(start.point.y)} Q ${round(control.x)} ${round(control.y)} ${round(end.point.x)} ${round(end.point.y)}" fill="none" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round" opacity="${opacity}"/>`,
      )
      if (graph.directed) {
        parts.push(
          `<g opacity="${opacity}">${arrowHead(end.point, { x: -end.tangent.x, y: -end.tangent.y }, color)}</g>`,
        )
      }

      if (graph.weighted) {
        const label = String(graph.weight(id))
        const anchor = quadratic(start.point, control, end.point, 0.5)
        const boxWidth = 8 + label.length * 6.5
        edgeLabels.push(
          `<g opacity="${opacity}"><rect x="${round(anchor.x - boxWidth / 2)}" y="${round(anchor.y - 9)}" width="${round(boxWidth)}" height="18" rx="4" fill="${theme.edgeLabelBackground}"/><text x="${round(anchor.x)}" y="${round(anchor.y + 4)}" text-anchor="middle" font-size="11" font-family="ui-monospace, monospace" fill="${theme.edgeLabel}">${escapeXml(label)}</text></g>`,
        )
      }
    })
  }

  parts.push(...edgeLabels)

  /* ---- vertices ------------------------------------------------- */

  for (const vertex of graph.vertices) {
    const highlight = options.highlightVertices?.[vertex.id]
    const fill = options.vertexFills?.[vertex.id] ?? theme.vertexFill
    const emphasised = Boolean(highlight) || Boolean(options.vertexFills?.[vertex.id])
    const opacity = options.dimmed && !emphasised ? dimOpacity : 1
    const stroke = highlight ?? (options.vertexFills?.[vertex.id] ?? theme.vertexBorder)
    const strokeWidth = highlight ? 3.5 : 1.5
    const textFill = options.vertexFills?.[vertex.id] ? theme.vertexFill : theme.vertexText

    parts.push(
      `<g opacity="${opacity}"><circle cx="${round(vertex.x)}" cy="${round(vertex.y)}" r="${radius}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"/><text x="${round(vertex.x)}" y="${round(vertex.y + 4.5)}" text-anchor="middle" font-size="13" font-weight="600" fill="${textFill}">${escapeXml(vertex.label)}</text></g>`,
    )
  }

  parts.push('</svg>')
  return parts.join('\n')
}
