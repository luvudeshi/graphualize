import { useEditor } from './store'
import { getCanvasInstance } from '../canvas/instance'
import { canvasTheme, modeColor } from '../canvas/theme'
import { emptyHighlight, stepToHighlight, witnessToHighlight } from '../canvas/highlight'
import { LIGHT_SVG_THEME, toSvg, type SvgTheme } from '../graph/serialization/svg'
import { toTikz } from '../graph/serialization/tikz'
import type { EdgeId, HighlightMode, HighlightRequest, VertexId } from '../graph/model/types'

const isDark = (): boolean =>
  typeof document !== 'undefined' && document.documentElement.classList.contains('dark')

const svgThemeFor = (dark: boolean): SvgTheme => {
  if (!dark) return LIGHT_SVG_THEME
  const theme = canvasTheme(true)
  return {
    background: theme.background,
    vertexFill: theme.vertexFill,
    vertexBorder: theme.vertexBorder,
    vertexText: theme.vertexText,
    edge: theme.edge,
    edgeLabel: theme.edgeLabel,
    edgeLabelBackground: theme.edgeLabelBg,
  }
}

export interface DrawingOptions {
  /** Follow the app's theme, or force a light drawing for printing. */
  appearance: 'light' | 'dark'
  transparent: boolean
  /** Include whatever witness or algorithm step is highlighted on screen. */
  withHighlight: boolean
}

export const defaultDrawingOptions = (): DrawingOptions => ({
  appearance: isDark() ? 'dark' : 'light',
  transparent: false,
  withHighlight: true,
})

/** The algorithm step or witness on screen, or nothing when it is left out. */
const currentHighlight = (withHighlight: boolean): HighlightRequest => {
  const state = useEditor.getState()
  return !withHighlight
    ? emptyHighlight()
    : state.algorithm
      ? (stepToHighlight(state.algorithm.steps[state.algorithm.index] ?? { type: '', description: '' }))
      : state.activeWitness
        ? witnessToHighlight(state.activeWitness.witness, state.graph)
        : emptyHighlight()
}

/**
 * The current drawing as SVG, optionally carrying the highlight that is on
 * screen — so "export the picture with the odd cycle marked" is one click.
 */
export const currentSvg = (options: DrawingOptions): string => {
  const state = useEditor.getState()
  const dark = options.appearance === 'dark'
  const theme = canvasTheme(dark)
  const highlight = currentHighlight(options.withHighlight)

  const highlightVertices: Record<VertexId, string> = {}
  for (const [id, mode] of Object.entries(highlight.vertices ?? {})) {
    highlightVertices[id] = modeColor(theme, mode)
  }
  const highlightEdges: Record<EdgeId, string> = {}
  for (const [id, mode] of Object.entries(highlight.edges ?? {})) {
    highlightEdges[id] = modeColor(theme, mode)
  }
  const vertexFills: Record<VertexId, string> = {}
  for (const [id, index] of Object.entries(highlight.colors ?? {})) {
    vertexFills[id] = theme.palette[index % theme.palette.length]!
  }

  return toSvg(state.graph, {
    theme: svgThemeFor(dark),
    transparent: options.transparent,
    highlightVertices,
    highlightEdges,
    vertexFills,
    dimmed: Boolean(highlight.dimOthers),
    title: state.name,
  })
}

export interface TikzDrawingOptions {
  /** Include whatever witness or algorithm step is highlighted on screen. */
  withHighlight: boolean
  /** A whole document that compiles as it is, rather than a bare picture. */
  standalone: boolean
}

/**
 * The current drawing as TikZ, carrying the on-screen highlight the same way
 * the SVG does: each role keeps the colour it has on the canvas. A LaTeX
 * document is read on a page, so these are always the light theme's colours,
 * whatever the app's appearance.
 */
export const currentTikz = (options: TikzDrawingOptions): string => {
  const state = useEditor.getState()
  const theme = canvasTheme(false)
  const highlight = currentHighlight(options.withHighlight)

  const roleColors: Partial<Record<HighlightMode, string>> = {}
  for (const mode of [
    ...Object.values(highlight.vertices ?? {}),
    ...Object.values(highlight.edges ?? {}),
  ]) {
    roleColors[mode] = modeColor(theme, mode)
  }

  return toTikz(state.graph, {
    standalone: options.standalone,
    highlightVertices: highlight.vertices,
    highlightEdges: highlight.edges,
    roleColors,
    vertexClasses: highlight.colors,
    classColors: theme.palette,
    dimmed: Boolean(highlight.dimOthers),
    title: state.name,
  })
}

/**
 * The current drawing as PNG, rendered by the canvas itself so it matches the
 * screen exactly. Returns null when there is nothing mounted to render.
 */
export const currentPng = (options: DrawingOptions, scale = 2): string | null => {
  const instance = getCanvasInstance()
  if (!instance || instance.nodes().length === 0) return null
  return instance.png({
    output: 'base64uri',
    scale,
    full: true,
    maxWidth: 4000,
    maxHeight: 4000,
    bg: options.transparent ? undefined : canvasTheme(options.appearance === 'dark').background,
  })
}

export const downloadDataUrl = (filename: string, dataUrl: string): void => {
  const anchor = document.createElement('a')
  anchor.href = dataUrl
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
}
