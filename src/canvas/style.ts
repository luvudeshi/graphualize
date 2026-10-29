import type { StylesheetJson } from 'cytoscape'
import type { CanvasTheme } from './theme'

/** The canvas is lettered in the app's text face, EB Garamond. */
const SERIF = '"EB Garamond", "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif'

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
      // A point of the figure: a disc of paper ringed in ink, lettered in
      // italic Garamond, as Byrne letters the points of a Euclid plate.
      selector: 'node',
      style: {
        width: 34,
        height: 34,
        shape: 'ellipse',
        'background-color': theme.vertexFill,
        'border-width': 1.5,
        'border-color': theme.vertexBorder,
        label: options.showLabels ? 'data(label)' : '',
        color: theme.vertexText,
        'font-family': SERIF,
        'font-style': 'italic',
        'font-size': 18,
        'font-weight': 500,
        'text-valign': 'center',
        'text-halign': 'center',
        'transition-property': 'background-color, border-color, border-width, opacity',
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
        'background-color': theme.vertexHover,
        'border-color': theme.selected,
        'border-width': 2,
      },
    },
    {
      selector: 'node:selected',
      style: {
        'background-color': theme.selectedFill,
        'border-color': theme.selected,
        'border-width': 3,
        'z-index': 30,
      },
    },
    {
      // A colouring or partition: the part's ink laid on flat, still ringed
      // in black so a pale pigment holds its edge on the paper.
      selector: 'node[fillColor]',
      style: {
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
      // highlight's ink (vermilion, cobalt or chrome yellow) inside an ink
      // ring, like the figure on the home page.
      selector: 'node[hlColor]',
      style: {
        'background-color': 'data(hlColor)',
        'border-color': theme.vertexBorder,
        'border-width': 1.5,
        'z-index': 40,
      },
    },
    {
      // The letter on a filled point: paper on the dark inks, ink on yellow.
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
      selector: 'node[hlColor]:selected, node[fillColor]:selected',
      style: {
        'border-color': theme.selected,
        'border-width': 3.5,
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
        // Weights are set in the text face on a slip of paper with an ink
        // hairline, like the figures' labels on the home plates.
        label: options.weighted && !options.weightSlips ? 'data(weightLabel)' : '',
        'font-family': SERIF,
        'font-size': 14,
        'font-weight': 500,
        color: theme.edgeLabel,
        'text-background-color': theme.edgeLabelBg,
        'text-background-opacity': 1,
        'text-background-padding': '2px',
        'text-background-shape': 'rectangle',
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
      // A witness, path or cycle is laid on as a thick flat bar of ink.
      selector: 'edge[hlColor]',
      style: {
        'line-color': 'data(hlColor)',
        'target-arrow-color': 'data(hlColor)',
        'source-arrow-color': 'data(hlColor)',
        'line-cap': 'butt',
        width: 5,
        'z-index': 35,
      },
    },
    {
      // A rejected edge is Byrne's dotted black line.
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
