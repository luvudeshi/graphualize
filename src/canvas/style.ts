import type { StylesheetJson } from 'cytoscape'
import type { CanvasTheme } from './theme'

export interface StyleOptions {
  directed: boolean
  weighted: boolean
  showLabels: boolean
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
        'font-family': 'Inter, system-ui, sans-serif',
        'font-size': 13,
        'font-weight': 600,
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
        'border-color': theme.selected,
        'border-width': 2,
      },
    },
    {
      selector: 'node:selected',
      style: {
        'background-color': theme.selectedFill,
        'border-color': theme.selected,
        'border-width': 2.5,
        'z-index': 30,
      },
    },
    {
      selector: 'node[fillColor]',
      style: {
        'background-color': 'data(fillColor)',
        color: 'data(inkColor)',
        'border-color': 'data(fillColor)',
      },
    },
    {
      selector: 'node[groupShape]',
      style: {
        shape: 'data(groupShape)',
      },
    },
    {
      selector: 'node[hlColor]',
      style: {
        'border-color': 'data(hlColor)',
        'border-width': 3.5,
        'z-index': 40,
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
        width: 1.8,
        'line-color': theme.edge,
        'curve-style': 'bezier',
        'control-point-step-size': 44,
        'target-arrow-shape': arrow,
        'target-arrow-color': theme.edge,
        'arrow-scale': 1.1,
        'loop-direction': '-45deg',
        'loop-sweep': '-60deg',
        label: options.weighted ? 'data(weightLabel)' : '',
        'font-family': 'JetBrains Mono, ui-monospace, monospace',
        'font-size': 11,
        color: theme.edgeLabel,
        'text-background-color': theme.edgeLabelBg,
        'text-background-opacity': 1,
        'text-background-padding': '2px',
        'text-background-shape': 'roundrectangle',
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
      selector: 'edge[hlColor]',
      style: {
        'line-color': 'data(hlColor)',
        'target-arrow-color': 'data(hlColor)',
        'source-arrow-color': 'data(hlColor)',
        width: 3.4,
        'z-index': 35,
      },
    },
    {
      selector: 'edge.rejected',
      style: {
        'line-style': 'dashed',
        width: 1.6,
        opacity: 0.55,
      },
    },
    {
      selector: '.dimmed',
      style: {
        opacity: 0.16,
      },
    },
    {
      selector: 'node.dimmed',
      style: {
        'text-opacity': 0.4,
      },
    },
  ] as StylesheetJson
}
