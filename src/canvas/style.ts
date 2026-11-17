import type { StylesheetJson } from 'cytoscape'
import type { CanvasTheme } from './theme'

/** Vertices are lettered in the app's control face; weights, like every other reading, in its mono. */
const SANS = '"Outfit", "Avenir Next", "Century Gothic", "Segoe UI", system-ui, sans-serif'
const MONO = '"Martian Mono", ui-monospace, "SF Mono", Menlo, monospace'

export interface StyleOptions {
  directed: boolean
  weighted: boolean
  showLabels: boolean
  /**
   * The weights are set as paper slips in the HTML overlay above the figure
   * (GraphCanvas), so Cytoscape draws no edge labels of its own. Cytoscape
   * paints a label with its own line, so later edges would strike through it.
   */
  weightSlips?: boolean
  /** Honours the viewer's prefers-reduced-motion setting. */
  reducedMotion?: boolean
}

/**
 * The complete Cytoscape stylesheet. All colours come from the theme, and all
 * emphasis is data-driven (`hlColor`, `fillColor`) so no component ever pokes
 * at Cytoscape styling directly.
 */
export const buildStylesheet = (
  theme: CanvasTheme,
  options: StyleOptions,
): StylesheetJson => {
  const arrow = options.directed ? 'triangle' : 'none'
  const transition = options.reducedMotion ? 0 : 120
  return [
    {
      // A point of the figure: a round keycap ringed in ink, shaded from
      // its top edge to its bottom like every other key on the instrument.
      selector: 'node',
      style: {
        width: 34,
        height: 34,
        shape: 'ellipse',
        'background-color': theme.vertexFill,
        'background-fill': 'linear-gradient',
        'background-gradient-direction': 'to-bottom',
        'background-gradient-stop-colors': `${theme.vertexFill} ${theme.vertexFillLow}`,
        'border-width': 1.5,
        'border-color': theme.vertexBorder,
        label: options.showLabels ? 'data(label)' : '',
        color: theme.vertexText,
        'font-family': SANS,
        'font-size': 15,
        'font-weight': 500,
        'text-valign': 'center',
        'text-halign': 'center',
        // The lamp round a selected point, dark until it is selected.
        'underlay-color': theme.selected,
        'underlay-shape': 'ellipse',
        'underlay-padding': 6,
        'underlay-opacity': 0,
        'transition-property':
          'background-color, border-color, border-width, opacity, underlay-opacity',
        'transition-duration': transition,
        'overlay-opacity': 0,
        'z-index': 10,
      },
    },
    {
      selector: 'node:active',
      style: {
        'overlay-opacity': 0.12,
        'overlay-color': theme.selected,
        'overlay-padding': 6,
      },
    },
    {
      selector: 'node.hovered',
      style: {
        'background-fill': 'solid',
        'background-color': theme.vertexHover,
        'border-color': theme.selected,
        'border-width': 2,
      },
    },
    {
      // Selected: the cap tints and a ring of the signal lights round it.
      selector: 'node:selected',
      style: {
        'background-fill': 'solid',
        'background-color': theme.selectedFill,
        'border-color': theme.selected,
        'border-width': 2.5,
        'underlay-opacity': 0.28,
        'z-index': 30,
      },
    },
    {
      // A colouring or partition: the part's ink laid on flat, still ringed
      // in ink so a pale pigment holds its edge on the screen.
      selector: 'node[fillColor]',
      style: {
        'background-fill': 'solid',
        'background-color': 'data(fillColor)',
        color: 'data(inkColor)',
        'border-color': theme.vertexBorder,
        'border-width': 1.5,
      },
    },
    {
      selector: 'node[groupShape]',
      style: {
        shape: 'data(groupShape)',
      },
    },
    {
      // A witness or an algorithm's state: the point filled with the
      // highlight's ink (the signal, its warm tint or the slate) inside an
      // ink ring, like the figure on the home page.
      selector: 'node[hlColor]',
      style: {
        'background-fill': 'solid',
        'background-color': 'data(hlColor)',
        'border-color': theme.vertexBorder,
        'border-width': 1.5,
        'z-index': 40,
      },
    },
    {
      // The letter on a filled point: light on the dark inks, ink on the pale one.
      selector: 'node[hlInk]',
      style: {
        color: 'data(hlInk)',
      },
    },
    {
      // A coloured point keeps its colour class; the algorithm's state is
      // shown as a ring in the state's ink, so the two never hide each other.
      selector: 'node[hlColor][fillColor]',
      style: {
        'background-color': 'data(fillColor)',
        color: 'data(inkColor)',
        'border-color': 'data(hlColor)',
        'border-width': 3.5,
      },
    },
    {
      // A filled point that is also selected keeps its ink ring; the lamp
      // round it is what says so, since the signal may be its own fill.
      selector: 'node[hlColor]:selected, node[fillColor]:selected',
      style: {
        'border-color': theme.vertexBorder,
        'border-width': 2.5,
        'underlay-opacity': 0.4,
      },
    },
    {
      selector: 'node.pending',
      style: {
        'border-color': theme.selected,
        'border-width': 3,
        'border-style': 'dashed',
      },
    },
    {
      selector: 'edge',
      style: {
        width: 1.5,
        'line-color': theme.edge,
        'curve-style': 'bezier',
        'control-point-step-size': 44,
        'target-arrow-shape': arrow,
        'target-arrow-color': theme.edge,
        'arrow-scale': 1.25,
        'loop-direction': '-45deg',
        'loop-sweep': '-60deg',
        // Weights are readings, so they are set in the mono on a small tag.
        label: options.weighted && !options.weightSlips ? 'data(weightLabel)' : '',
        'font-family': MONO,
        'font-size': 11,
        'font-weight': 500,
        color: theme.edgeLabel,
        'text-background-color': theme.edgeLabelBg,
        'text-background-opacity': 1,
        'text-background-padding': '2px',
        'text-background-shape': 'roundrectangle',
        'text-border-width': 1,
        'text-border-color': theme.edge,
        'text-border-opacity': 1,
        'text-border-style': 'solid',
        'text-rotation': 'none',
        'transition-property': 'line-color, width, opacity',
        'transition-duration': transition,
        'overlay-opacity': 0,
        'z-index': 5,
      },
    },
    {
      selector: 'edge:selected',
      style: {
        'line-color': theme.selected,
        'target-arrow-color': theme.selected,
        width: 3,
        'z-index': 25,
      },
    },
    {
      // A witness, path or cycle is laid on as a thick bar of its ink.
      selector: 'edge[hlColor]',
      style: {
        'line-color': 'data(hlColor)',
        'target-arrow-color': 'data(hlColor)',
        'source-arrow-color': 'data(hlColor)',
        'line-cap': 'round',
        width: 5,
        'z-index': 35,
      },
    },
    {
      // A rejected edge is a dotted line in ink.
      selector: 'edge.rejected',
      style: {
        'line-style': 'dotted',
        'line-dash-pattern': [2, 4],
        width: 2,
        opacity: 0.85,
      },
    },
    {
      // What is not part of the witness is drawn in a lighter ink rather than
      // faded out, so its letters stay readable (3:1 lines, 4.5:1 letters).
      selector: '.dimmed',
      style: {
        opacity: 1,
      },
    },
    {
      selector: 'node.dimmed',
      style: {
        'border-color': theme.dim,
        color: theme.dimText,
      },
    },
    {
      selector: 'edge.dimmed',
      style: {
        'line-color': theme.dim,
        'target-arrow-color': theme.dim,
        color: theme.dimText,
      },
    },
  ] as StylesheetJson
}
