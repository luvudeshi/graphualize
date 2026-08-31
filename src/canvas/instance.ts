import type { Core } from 'cytoscape'

/**
 * A single reference to the live canvas, so features that need pixels rather
 * than data — PNG export, and nothing else so far — can reach it without
 * threading the instance through the component tree.
 */
let current: Core | null = null

export const setCanvasInstance = (instance: Core | null): void => {
  current = instance
}

export const getCanvasInstance = (): Core | null => current
