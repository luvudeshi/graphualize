import type { Graph } from '../model/graph'
import type { EdgeId, HighlightMode, VertexId } from '../model/types'

/**
 * TikZ export of the drawing, for writing answers up in LaTeX.
 *
 * This is the second backend behind the drawing. It follows the SVG exporter's
 * geometry — the same bundles of parallel edges with the same spacing, loops
 * stacked above their vertex, the highlight carried as colours the caller
 * resolved — but writes source a reader can edit rather than finished shapes.
 * Every vertex is a named node and every edge a `\draw` between two names, so
 * TikZ itself stops each line at the rim of its node and lays the arrowhead
 * along the curve.
 *
 * The styles are declared in the picture's own options rather than with a
 * global `\tikzset`, so a pasted picture cannot restyle the reader's other
 * figures (or be restyled by them), and changing one style — say, making the
 * cycle dashed for a black-and-white print — changes it everywhere it is used.
 */

export interface TikzOptions {
  /**
   * Wrap the picture in a `standalone` document that compiles as it is, on
   * Overleaf or anywhere else. Without it the output is a bare `tikzpicture`
   * for pasting into an existing document.
   */
  standalone?: boolean
  /** Canvas pixels per centimetre, before the picture is fitted to a page. */
  pixelsPerCm?: number
  /** The largest the picture may span, in centimetres between vertex centres. */
  maxWidth?: number
  maxHeight?: number
  /** Per-element highlight roles, e.g. the witness currently on screen. */
  highlightVertices?: Record<VertexId, HighlightMode>
  highlightEdges?: Record<EdgeId, HighlightMode>
  /** The colour of each role as `#rrggbb`, resolved by the caller from its theme. */
  roleColors?: Partial<Record<HighlightMode, string>>
  /** Vertex -> colour class, used by colourings and partitions. */
  vertexClasses?: Record<VertexId, number>
  /** Fill for each colour class as `#rrggbb`, reused cyclically. */
  classColors?: readonly string[]
  /** Draw everything that is not highlighted faintly. */
  dimmed?: boolean
  /** Written as a comment on the first line. */
  title?: string
}

/** The SVG exporter's defaults, so both drawings have the same proportions. */
const VERTEX_RADIUS_PX = 17
const BUNDLE_STEP_PX = 42
const DIM_OPACITY = 0.18

const DEFAULT_PIXELS_PER_CM = 50
const DEFAULT_MAX_WIDTH_CM = 12
const DEFAULT_MAX_HEIGHT_CM = 16

/** Vertices keep their size when a large drawing is fitted to the page. */
const VERTEX_RADIUS_MM = (VERTEX_RADIUS_PX / DEFAULT_PIXELS_PER_CM) * 10

/** The steepest a bend may start, so very short edges in a bundle stay legible. */
const MAX_BEND_DEGREES = 75

/**
 * Style names for each highlight role. They are phrases rather than the bare
 * role names so none of them can shadow a TikZ key of the same name (`path`,
 * `tree`), and they read naturally in place: `\draw[edge, on cycle]`.
 */
const ROLE_STYLES: Record<HighlightMode, string> = {
  witness: 'witness',
  path: 'on path',
  cycle: 'on cycle',
  matching: 'in matching',
  tree: 'in tree',
  partition: 'witness',
  coloring: 'witness',
  algorithmCurrent: 'current',
  algorithmVisited: 'visited',
  algorithmFrontier: 'frontier',
  algorithmAccepted: 'accepted',
  algorithmRejected: 'rejected',
}

/** `on cycle` -> `gzcycle`: letters only, which every xcolor accepts as a name. */
const colorName = (style: string): string => `gz${style.split(' ').pop()!}`

const LATEX_TEXT_ESCAPES: Record<string, string> = {
  '\\': '\\textbackslash{}',
  '{': '\\{',
  '}': '\\}',
  $: '\\$',
  '&': '\\&',
  '#': '\\#',
  '%': '\\%',
  _: '\\_',
  '~': '\\textasciitilde{}',
  '^': '\\textasciicircum{}',
  // The default OT1 font encoding prints these three as other glyphs.
  '<': '\\textless{}',
  '>': '\\textgreater{}',
  '|': '\\textbar{}',
}

/**
 * Makes user text safe to typeset in text mode. Each character is replaced at
 * most once, so an escape is never itself escaped, and line breaks collapse to
 * spaces because a blank line inside a node is a paragraph break and an error.
 */
export const escapeLatex = (text: string): string =>
  text.replace(/\s+/g, ' ').replace(/[\\{}$&#%_~^<>|]/g, (ch) => LATEX_TEXT_ESCAPES[ch] ?? ch)

/** A comment runs to the end of its line, so only line breaks need taming. */
const comment = (text: string): string => `% ${text.replace(/\s+/g, ' ').trim()}`

const round = (value: number, places = 2): string => {
  const factor = 10 ** places
  const rounded = Math.round(value * factor) / factor
  return String(Object.is(rounded, -0) ? 0 : rounded)
}

/** A weight in math mode, so a negative one gets a real minus sign. */
const formatWeight = (weight: number): string => {
  if (weight === Infinity) return '\\infty'
  if (weight === -Infinity) return '-\\infty'
  if (Number.isNaN(weight) || Number.isInteger(weight)) return String(weight)
  return round(weight, 6)
}

/** `#be123c` -> `BE123C` for xcolor's HTML model; anything unreadable is black. */
const htmlColor = (hex: string | undefined): string => {
  const digits = (hex ?? '').trim().replace(/^#/, '')
  if (/^[0-9a-f]{6}$/i.test(digits)) return digits.toUpperCase()
  if (/^[0-9a-f]{3}$/i.test(digits)) {
    return [...digits].map((d) => d + d).join('').toUpperCase()
  }
  return '000000'
}

type EdgeShape =
  | { kind: 'straight' }
  | { kind: 'bend'; side: 'left' | 'right'; degrees: number }
  | { kind: 'loop'; ring: number }

/**
 * How each edge is drawn, matching the SVG exporter: edges between the same
 * two vertices form a bundle spread `BUNDLE_STEP_PX` apart around the straight
 * line, and the k-th loop at a vertex is the k-th ring out.
 *
 * The SVG offsets a curve from its control point; TikZ bends by an angle, so
 * the offset becomes the angle at which that curve leaves its vertex. The side
 * is measured against the direction of the bundle's first edge rather than
 * each edge's own, so arcs u->v and v->u in one bundle separate instead of
 * being drawn on top of each other, and a bundle whose edges all point the same
 * way bends exactly as it does in the SVG.
 */
const edgeShapes = (graph: Graph): Map<EdgeId, EdgeShape> => {
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

  const shapes = new Map<EdgeId, EdgeShape>()
  for (const ids of bundles.values()) {
    const reference = graph.edge(ids[0]!)!.source
    ids.forEach((id, index) => {
      const edge = graph.edge(id)!
      if (edge.source === edge.target) {
        shapes.set(id, { kind: 'loop', ring: index })
        return
      }
      const offset = (index - (ids.length - 1) / 2) * BUNDLE_STEP_PX
      const from = graph.vertex(edge.source)
      const to = graph.vertex(edge.target)
      const length = from && to ? Math.hypot(to.x - from.x, to.y - from.y) : 0
      const degrees = Math.min(
        MAX_BEND_DEGREES,
        Math.round((Math.atan2(2 * Math.abs(offset), length) * 180) / Math.PI),
      )
      if (degrees === 0) {
        shapes.set(id, { kind: 'straight' })
        return
      }
      // A positive offset lies to the right of travel along the first edge
      // (the SVG's normal, with y pointing down); against it, that is the left.
      const forward = edge.source === reference
      const right = (offset > 0) === forward
      shapes.set(id, { kind: 'bend', side: right ? 'right' : 'left', degrees })
    })
  }
  return shapes
}

const pathFor = (shape: EdgeShape): string => {
  switch (shape.kind) {
    case 'straight':
      return '--'
    case 'bend':
      return `to[bend ${shape.side}=${shape.degrees}]`
    case 'loop': {
      // A teardrop above the vertex, each further loop one ring further out.
      const reach = VERTEX_RADIUS_MM * (1.5 + shape.ring * 0.9)
      return `to[out=110, in=70, min distance=${round(reach, 1)}mm]`
    }
  }
}

export const toTikz = (graph: Graph, options: TikzOptions = {}): string => {
  const highlightVertices = options.highlightVertices ?? {}
  const highlightEdges = options.highlightEdges ?? {}
  const classes = options.vertexClasses ?? {}
  const classColors = options.classColors ?? []

  /* ---- scale ---------------------------------------------------- */

  // Vertex names come from the order rather than the ids, which can be any
  // string an imported file chose and say nothing to a reader.
  const order = new Map<VertexId, number>(graph.vertices.map((v, i) => [v.id, i] as const))
  const nodeName = (id: VertexId) => `v${(order.get(id) ?? 0) + 1}`

  const xs = graph.vertices.map((v) => v.x)
  const ys = graph.vertices.map((v) => v.y)
  const minX = xs.length ? Math.min(...xs) : 0
  const maxY = ys.length ? Math.max(...ys) : 0
  const spanX = xs.length ? Math.max(...xs) - minX : 0
  const spanY = ys.length ? maxY - Math.min(...ys) : 0
  let scale = 1 / (options.pixelsPerCm ?? DEFAULT_PIXELS_PER_CM)
  const maxWidth = options.maxWidth ?? DEFAULT_MAX_WIDTH_CM
  const maxHeight = options.maxHeight ?? DEFAULT_MAX_HEIGHT_CM
  if (spanX * scale > maxWidth) scale = maxWidth / spanX
  if (spanY * scale > maxHeight) scale = maxHeight / spanY

  // TikZ's y axis points up and the canvas's points down; measuring from the
  // leftmost and lowest vertices keeps every coordinate non-negative.
  const at = (x: number, y: number) => `(${round((x - minX) * scale)},${round((maxY - y) * scale)})`

  /* ---- what the picture uses ----------------------------------- */

  const emphasisedVertex = (id: VertexId) =>
    highlightVertices[id] !== undefined || classes[id] !== undefined
  const emphasisedEdge = (id: EdgeId) => highlightEdges[id] !== undefined
  const dims =
    Boolean(options.dimmed) &&
    (graph.vertices.some((v) => !emphasisedVertex(v.id)) ||
      graph.edges.some((e) => !emphasisedEdge(e.id)))

  // Roles in the order the drawing first uses them, so the output is stable.
  const roleColor = new Map<string, string>()
  const noteRole = (mode: HighlightMode | undefined) => {
    if (mode === undefined) return
    const style = ROLE_STYLES[mode] ?? ROLE_STYLES.witness
    if (!roleColor.has(style)) roleColor.set(style, htmlColor(options.roleColors?.[mode]))
  }
  for (const v of graph.vertices) noteRole(highlightVertices[v.id])
  for (const e of graph.edges) noteRole(highlightEdges[e.id])

  const usedClasses = [
    ...new Set(graph.vertices.flatMap((v) => (classes[v.id] === undefined ? [] : [classes[v.id]!]))),
  ].sort((a, b) => a - b)
  const classStyle = (index: number) => `class ${index + 1}`
  const classColor = (index: number) =>
    htmlColor(classColors.length ? classColors[index % classColors.length] : undefined)

  /* ---- styles --------------------------------------------------- */

  const diameter = round(VERTEX_RADIUS_MM * 2, 1)
  const styles = [
    `vertex/.style={circle, draw=black!80, fill=white, line width=0.8pt, minimum size=${diameter}mm, inner sep=1pt, font=\\small}`,
    `edge/.style={draw=black!55, line width=1pt${graph.directed ? ', -{Stealth}' : ''}}`,
  ]
  if (graph.weighted && graph.edges.length > 0) {
    styles.push(
      'weight/.style={midway, fill=white, text=black!80, inner sep=1pt, font=\\scriptsize}',
    )
  }
  for (const index of usedClasses) {
    styles.push(
      `${classStyle(index)}/.style={fill=gzclass${index + 1}, draw=gzclass${index + 1}, text=white}`,
    )
  }
  for (const style of roleColor.keys()) {
    styles.push(`${style}/.style={draw=${colorName(style)}, line width=1.6pt}`)
  }
  if (dims) styles.push(`dimmed/.style={opacity=${DIM_OPACITY}}`)

  /* ---- body ----------------------------------------------------- */

  const body: string[] = []
  for (const index of usedClasses) {
    body.push(`\\definecolor{gzclass${index + 1}}{HTML}{${classColor(index)}}`)
  }
  for (const [style, color] of roleColor) {
    body.push(`\\definecolor{${colorName(style)}}{HTML}{${color}}`)
  }

  for (const vertex of graph.vertices) {
    const keys = ['vertex']
    const cls = classes[vertex.id]
    if (cls !== undefined) keys.push(classStyle(cls))
    // The role comes after the class so its outline wins, as in the SVG.
    const role = highlightVertices[vertex.id]
    if (role !== undefined) keys.push(ROLE_STYLES[role] ?? ROLE_STYLES.witness)
    if (dims && !emphasisedVertex(vertex.id)) keys.push('dimmed')
    body.push(
      `\\node[${keys.join(', ')}] (${nodeName(vertex.id)}) at ${at(vertex.x, vertex.y)} {${escapeLatex(vertex.label)}};`,
    )
  }

  if (graph.edges.length > 0 && graph.vertices.length > 0) body.push('')

  const shapes = edgeShapes(graph)
  for (const edge of graph.edges) {
    if (!order.has(edge.source) || !order.has(edge.target)) continue
    const keys = ['edge']
    const role = highlightEdges[edge.id]
    if (role !== undefined) keys.push(ROLE_STYLES[role] ?? ROLE_STYLES.witness)
    if (dims && !emphasisedEdge(edge.id)) keys.push('dimmed')
    const label = graph.weighted ? ` node[weight] {$${formatWeight(graph.weight(edge.id))}$}` : ''
    body.push(
      `\\draw[${keys.join(', ')}] (${nodeName(edge.source)}) ${pathFor(shapes.get(edge.id)!)}${label} (${nodeName(edge.target)});`,
    )
  }

  /* ---- document ------------------------------------------------- */

  const picture = [
    '\\begin{tikzpicture}[',
    styles.map((style) => `  ${style}`).join(',\n'),
    ']',
    ...body.map((line) => (line ? `  ${line}` : line)),
    '\\end{tikzpicture}',
  ]

  const title = options.title?.trim() ? [comment(options.title)] : []

  if (!options.standalone) {
    const needs = graph.directed
      ? '\\usepackage{tikz} and \\usetikzlibrary{arrows.meta}'
      : '\\usepackage{tikz}'
    return [...title, comment(`Needs ${needs} in the preamble.`), ...picture].join('\n')
  }

  return [
    ...title,
    '\\documentclass[tikz, border=4pt]{standalone}',
    '\\usetikzlibrary{arrows.meta}',
    '\\begin{document}',
    ...picture,
    '\\end{document}',
  ].join('\n')
}
