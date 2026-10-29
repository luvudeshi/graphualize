import { useEffect, useMemo, useRef, useState } from 'react'
import cytoscape, {
  type Core,
  type EdgeSingular,
  type EventObject,
  type NodeSingular,
} from 'cytoscape'
import { useEditor } from '../state/store'
import { useTheme } from '../hooks/useTheme'
import { canvasTheme, highlightInk, modeColor } from './theme'
import { buildStylesheet } from './style'
import { emptyHighlight, stepToHighlight, witnessToHighlight } from './highlight'
import type { HighlightRequest, VertexId } from '../graph/model/types'
import { CanvasEmptyState } from '../components/CanvasEmptyState'
import { setCanvasInstance } from './instance'
import { ContextMenu } from '../components/ContextMenu'
import type { MenuItem } from '../components/Menu'
import { applyTransformById } from '../state/actions'
import { useUi } from '../state/ui'
import { prefersReducedMotion } from '../utils/platform'
import '../styles/canvas.css'

const sameIds = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((id, i) => id === b[i])

/** Redundant, non-colour encoding for partition and colouring groups. */
const SHAPE_BY_GROUP = ['ellipse', 'rectangle', 'diamond', 'hexagon']

interface ContextTarget {
  kind: 'vertex' | 'edge' | 'canvas'
  id?: string
  /** Screen coordinates for the menu. */
  x: number
  y: number
  /** Graph coordinates, so "add a vertex here" lands under the pointer. */
  modelX: number
  modelY: number
}

/**
 * Above this many edges the weights go back to Cytoscape's own labels, so a
 * large weighted graph does not re-render the overlay on every pan frame.
 */
const WEIGHT_SLIP_LIMIT = 400
/** Slips whose centres fall closer than this (px) are moved along their edge. */
const SLIP_CLEARANCE = 16

const FIT_PADDING = 60
/** Small graphs would otherwise fill the screen with enormous vertices. */
const FIT_MAX_ZOOM = 1.5

const fitView = (instance: Core, animate = true): void => {
  const duration = animate && !prefersReducedMotion() ? 220 : 0
  const elements = instance.elements()
  if (!elements.length) return
  const box = elements.boundingBox()
  const width = instance.width()
  const height = instance.height()
  if (width <= 0 || height <= 0) return
  const zoom = Math.min(
    FIT_MAX_ZOOM,
    box.w > 0 ? (width - 2 * FIT_PADDING) / box.w : FIT_MAX_ZOOM,
    box.h > 0 ? (height - 2 * FIT_PADDING) / box.h : FIT_MAX_ZOOM,
  )
  const safeZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1
  const pan = {
    x: width / 2 - safeZoom * (box.x1 + box.w / 2),
    y: height / 2 - safeZoom * (box.y1 + box.h / 2),
  }
  if (duration > 0) instance.animate({ zoom: safeZoom, pan }, { duration })
  else {
    instance.zoom(safeZoom)
    instance.pan(pan)
  }
}

export const GraphCanvas = () => {
  const containerRef = useRef<HTMLDivElement>(null)
  const cyRef = useRef<Core | null>(null)
  const suppressSelectionSync = useRef(false)
  const draggingRef = useRef(false)
  /** The vertex an edge gesture started on, plus whether it was already armed. */
  const armedRef = useRef<{ id: VertexId; wasPending: boolean } | null>(null)
  const pointerVisible = useRef(false)
  const seededRef = useRef(false)
  /** True while badges or the edge guide need to track the viewport. */
  const overlayActive = useRef(false)

  const [cy, setCy] = useState<Core | null>(null)
  const [menu, setMenu] = useState<ContextTarget | null>(null)
  const [viewportTick, setViewportTick] = useState(0)
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null)

  const { dark } = useTheme()
  const theme = useMemo(() => canvasTheme(dark), [dark])

  const doc = useEditor((s) => s.doc)
  const graph = useEditor((s) => s.graph)
  const tool = useEditor((s) => s.tool)
  const selectedVertices = useEditor((s) => s.selectedVertices)
  const selectedEdges = useEditor((s) => s.selectedEdges)
  const pendingEdgeSource = useEditor((s) => s.pendingEdgeSource)
  const activeWitness = useEditor((s) => s.activeWitness)
  const algorithm = useEditor((s) => s.algorithm)
  const viewRequest = useEditor((s) => s.viewRequest)

  const highlight: HighlightRequest = useMemo(() => {
    if (algorithm) {
      const step = algorithm.steps[algorithm.index]
      return step ? stepToHighlight(step) : emptyHighlight()
    }
    if (activeWitness) return witnessToHighlight(activeWitness.witness, graph)
    return emptyHighlight()
  }, [algorithm, activeWitness, graph])

  /* ---------------------------------------------------------------- */
  /* Instance lifecycle                                                */
  /* ---------------------------------------------------------------- */

  useEffect(() => {
    if (!containerRef.current) return
    const instance = cytoscape({
      container: containerRef.current,
      elements: [],
      minZoom: 0.1,
      maxZoom: 4,
      boxSelectionEnabled: true,
      // Click replaces the selection; shift-click adds to it.
      selectionType: 'single',
      textureOnViewport: false,
      pixelRatio: 'auto',
    })
    cyRef.current = instance
    setCanvasInstance(instance)
    setCy(instance)

    let frame = 0
    const onViewport = () => {
      // The overlay is the only thing that needs repositioning, so skip the
      // re-render entirely when there is nothing floating above the canvas.
      if (!overlayActive.current || frame) return
      frame = window.requestAnimationFrame(() => {
        frame = 0
        setViewportTick((n) => (n + 1) % 1_000_000)
      })
    }
    instance.on('viewport position add remove', onViewport)

    // Cytoscape only watches the window, so panels opening and closing need an
    // explicit nudge or the canvas keeps a stale size. When the plate shrinks
    // (the algorithm player opens or grows) and a figure that was wholly in
    // view no longer fits, refit it so no point is left under the player.
    let lastHeight = containerRef.current.clientHeight
    const observer = new ResizeObserver(() => {
      const box = instance.elements().renderedBoundingBox()
      const wasInView =
        instance.elements().length > 0 &&
        box.x1 >= 0 &&
        box.y1 >= 0 &&
        box.x2 <= instance.width() &&
        box.y2 <= lastHeight
      instance.resize()
      const height = instance.height()
      const shrank = height < lastHeight
      lastHeight = height
      if (shrank && wasInView && (box.y2 > height || box.x2 > instance.width())) {
        fitView(instance, false)
      }
    })
    observer.observe(containerRef.current)

    instance.on('select unselect', () => {
      if (suppressSelectionSync.current) return
      const vertices = instance.nodes(':selected').map((n) => n.id())
      const edges = instance.edges(':selected').map((e) => e.id())
      const state = useEditor.getState()
      if (!sameIds(vertices, state.selectedVertices) || !sameIds(edges, state.selectedEdges)) {
        state.select(vertices, edges)
      }
    })

    instance.on('mouseover', 'node', (event: EventObject) => {
      ;(event.target as NodeSingular).addClass('hovered')
    })
    instance.on('mouseout', 'node', (event: EventObject) => {
      ;(event.target as NodeSingular).removeClass('hovered')
    })

    // The rubber band only exists while an edge is being drawn, so pointer
    // tracking (and the re-renders it causes) is scoped to that gesture.
    instance.on('mousemove', (event: EventObject) => {
      const state = useEditor.getState()
      if (state.tool === 'edge' && state.pendingEdgeSource) {
        pointerVisible.current = true
        setPointer({ x: event.position.x, y: event.position.y })
      } else if (pointerVisible.current) {
        pointerVisible.current = false
        setPointer(null)
      }
    })

    instance.on('grab', () => {
      draggingRef.current = true
    })
    instance.on('dragfree', () => {
      draggingRef.current = false
      const positions: Record<string, { x: number; y: number }> = {}
      instance.nodes().forEach((n) => {
        const p = n.position()
        positions[n.id()] = { x: Math.round(p.x * 100) / 100, y: Math.round(p.y * 100) / 100 }
      })
      useEditor.getState().commitPositions(positions)
    })

    instance.on('tap', (event: EventObject) => {
      if (event.target !== instance) return
      const state = useEditor.getState()
      if (state.tool === 'vertex') {
        state.addVertexAt(
          Math.round(event.position.x * 100) / 100,
          Math.round(event.position.y * 100) / 100,
        )
        return
      }
      armedRef.current = null
      if (state.pendingEdgeSource) state.setPendingEdgeSource(null)
      if (state.activeWitness) state.clearWitness()
    })

    instance.on('tapstart', 'node', (event: EventObject) => {
      const state = useEditor.getState()
      if (state.tool !== 'edge') return
      const id = (event.target as NodeSingular).id()
      const pending = state.pendingEdgeSource
      if (pending && pending !== id) {
        state.addEdge(pending, id)
        state.setPendingEdgeSource(null)
        armedRef.current = null
        return
      }
      armedRef.current = { id, wasPending: pending === id }
      state.setPendingEdgeSource(id)
    })

    instance.on('tapend', 'node', (event: EventObject) => {
      const state = useEditor.getState()
      const id = (event.target as NodeSingular).id()
      if (state.tool === 'erase') {
        state.deleteElements([id], [])
        return
      }
      if (state.tool !== 'edge') return
      const armed = armedRef.current
      armedRef.current = null
      if (!armed) return
      if (armed.id !== id) {
        state.addEdge(armed.id, id)
        state.setPendingEdgeSource(null)
        return
      }
      // Released on the same vertex: a second click cancels, a first arms it.
      if (armed.wasPending) state.setPendingEdgeSource(null)
    })

    instance.on('tap', 'edge', (event: EventObject) => {
      const state = useEditor.getState()
      if (state.tool === 'erase') state.deleteElements([], [event.target.id()])
    })

    const openMenu = (kind: ContextTarget['kind'], event: EventObject, id?: string) => {
      const original = event.originalEvent as MouseEvent | undefined
      original?.preventDefault()
      setMenu({
        kind,
        id,
        x: original?.clientX ?? 0,
        y: original?.clientY ?? 0,
        modelX: Math.round(event.position.x * 100) / 100,
        modelY: Math.round(event.position.y * 100) / 100,
      })
    }
    instance.on('cxttap', 'node', (event: EventObject) => {
      const id = (event.target as NodeSingular).id()
      const state = useEditor.getState()
      if (!state.selectedVertices.includes(id)) state.select([id], [])
      openMenu('vertex', event, id)
    })
    instance.on('cxttap', 'edge', (event: EventObject) => {
      const id = event.target.id()
      const state = useEditor.getState()
      if (!state.selectedEdges.includes(id)) state.select([], [id])
      openMenu('edge', event, id)
    })
    instance.on('cxttap', (event: EventObject) => {
      if (event.target !== instance) return
      openMenu('canvas', event)
    })
    instance.on('tap', () => setMenu(null))
    instance.on('viewport', () => setMenu(null))

    instance.on('dbltap', 'node', (event: EventObject) => {
      const state = useEditor.getState()
      const node = event.target as NodeSingular
      const next = window.prompt('Rename vertex', node.data('label') as string)
      if (next !== null) state.renameVertex(node.id(), next)
    })

    instance.on('dbltap', 'edge', (event: EventObject) => {
      const state = useEditor.getState()
      if (!state.doc.weighted) {
        state.notify('Turn on weighted edges to give this edge a weight.', 'info')
        return
      }
      const id = event.target.id()
      const next = window.prompt('Edge weight', String(state.graph.weight(id)))
      if (next === null) return
      const parsed = Number(next)
      if (!Number.isFinite(parsed)) {
        state.notify('Edge weights must be finite numbers.', 'error')
        return
      }
      state.setEdgeWeight(id, parsed)
    })

    return () => {
      if (frame) window.cancelAnimationFrame(frame)
      observer.disconnect()
      instance.destroy()
      cyRef.current = null
      setCanvasInstance(null)
      setCy(null)
    }
  }, [])

  /* ---------------------------------------------------------------- */
  /* Stylesheet                                                        */
  /* ---------------------------------------------------------------- */

  useEffect(() => {
    const instance = cyRef.current
    if (!instance) return
    instance.style(
      buildStylesheet(theme, {
        directed: doc.directed,
        weighted: doc.weighted,
        weightSlips: doc.edges.length <= WEIGHT_SLIP_LIMIT,
        showLabels: true,
        reducedMotion: prefersReducedMotion(),
      }),
    )
  }, [theme, doc.directed, doc.weighted, doc.edges.length <= WEIGHT_SLIP_LIMIT])

  /* ---------------------------------------------------------------- */
  /* Element sync                                                      */
  /* ---------------------------------------------------------------- */

  useEffect(() => {
    const instance = cyRef.current
    if (!instance) return
    const moves: { node: NodeSingular; x: number; y: number }[] = []

    instance.batch(() => {
      const wantedNodes = new Set(doc.vertices.map((v) => v.id))
      const wantedEdges = new Set(doc.edges.map((e) => e.id))
      instance.nodes().forEach((n) => {
        if (!wantedNodes.has(n.id())) n.remove()
      })
      instance.edges().forEach((e) => {
        if (!wantedEdges.has(e.id())) e.remove()
      })

      for (const v of doc.vertices) {
        const existing = instance.getElementById(v.id)
        if (existing.empty()) {
          instance.add({
            group: 'nodes',
            data: { id: v.id, label: v.label },
            position: { x: v.x, y: v.y },
          })
        } else {
          if (existing.data('label') !== v.label) existing.data('label', v.label)
          const p = (existing as NodeSingular).position()
          if (!draggingRef.current && (Math.abs(p.x - v.x) > 0.5 || Math.abs(p.y - v.y) > 0.5)) {
            moves.push({ node: existing as NodeSingular, x: v.x, y: v.y })
          }
        }
      }

      for (const e of doc.edges) {
        const existing = instance.getElementById(e.id)
        const weightLabel = doc.weighted ? String(e.weight ?? 1) : ''
        if (existing.empty()) {
          instance.add({
            group: 'edges',
            data: { id: e.id, source: e.source, target: e.target, weightLabel },
          })
        } else if (existing.data('weightLabel') !== weightLabel) {
          existing.data('weightLabel', weightLabel)
        }
      }
    })

    const animate = moves.length <= 400 && !prefersReducedMotion()
    for (const move of moves) {
      if (animate) {
        move.node
          .stop(true)
          .animate({ position: { x: move.x, y: move.y } }, { duration: 220, easing: 'ease-out-cubic' })
      } else {
        move.node.position({ x: move.x, y: move.y })
      }
    }
  }, [doc])

  /* ---------------------------------------------------------------- */
  /* Selection sync (store -> canvas)                                  */
  /* ---------------------------------------------------------------- */

  useEffect(() => {
    const instance = cyRef.current
    if (!instance) return
    const currentVertices = instance.nodes(':selected').map((n) => n.id())
    const currentEdges = instance.edges(':selected').map((e) => e.id())
    if (sameIds(currentVertices, selectedVertices) && sameIds(currentEdges, selectedEdges)) return
    suppressSelectionSync.current = true
    instance.batch(() => {
      instance.elements().unselect()
      for (const id of selectedVertices) instance.getElementById(id).select()
      for (const id of selectedEdges) instance.getElementById(id).select()
    })
    suppressSelectionSync.current = false
  }, [selectedVertices, selectedEdges])

  /* ---------------------------------------------------------------- */
  /* Highlighting                                                      */
  /* ---------------------------------------------------------------- */

  useEffect(() => {
    const instance = cyRef.current
    if (!instance) return
    const vertexModes = highlight.vertices ?? {}
    const edgeModes = highlight.edges ?? {}
    const colors = highlight.colors ?? {}
    const anyHighlight =
      Object.keys(vertexModes).length > 0 ||
      Object.keys(edgeModes).length > 0 ||
      Object.keys(colors).length > 0

    instance.batch(() => {
      instance.nodes().forEach((n) => {
        const id = n.id()
        const mode = vertexModes[id]
        const colorIndex = colors[id]
        if (mode) {
          const fill = modeColor(theme, mode)
          n.data('hlColor', fill)
          n.data('hlInk', highlightInk(theme, fill))
        } else {
          n.removeData('hlColor')
          n.removeData('hlInk')
        }
        if (colorIndex !== undefined) {
          n.data('fillColor', theme.palette[colorIndex % theme.palette.length])
          n.data('inkColor', theme.paletteInk[colorIndex % theme.paletteInk.length])
          // Shape carries the same information as colour for the first few
          // groups, so a partition or colouring is not colour-only.
          n.data('groupShape', SHAPE_BY_GROUP[colorIndex % SHAPE_BY_GROUP.length])
        } else {
          n.removeData('fillColor')
          n.removeData('inkColor')
          n.removeData('groupShape')
        }
        n.toggleClass(
          'dimmed',
          Boolean(highlight.dimOthers) && anyHighlight && !mode && colorIndex === undefined,
        )
      })
      instance.edges().forEach((e) => {
        const mode = edgeModes[e.id()]
        if (mode) e.data('hlColor', modeColor(theme, mode))
        else e.removeData('hlColor')
        e.toggleClass('rejected', mode === 'algorithmRejected')
        e.toggleClass('dimmed', Boolean(highlight.dimOthers) && anyHighlight && !mode)
      })
    })
  }, [highlight, theme, doc])

  useEffect(() => {
    const instance = cyRef.current
    if (!instance) return
    instance.nodes().removeClass('pending')
    if (pendingEdgeSource) instance.getElementById(pendingEdgeSource).addClass('pending')
  }, [pendingEdgeSource, doc])

  /* ---------------------------------------------------------------- */
  /* Tool behaviour                                                    */
  /* ---------------------------------------------------------------- */

  useEffect(() => {
    const instance = cyRef.current
    if (!instance) return
    const grabbable = tool === 'select' || tool === 'vertex'
    instance.autoungrabify(!grabbable)
    instance.boxSelectionEnabled(tool === 'select')
    instance.autounselectify(tool === 'erase')
  }, [tool])

  /* ---------------------------------------------------------------- */
  /* Viewport                                                          */
  /* ---------------------------------------------------------------- */

  useEffect(() => {
    const instance = cyRef.current
    if (!instance || !viewRequest) return
    switch (viewRequest.kind) {
      case 'fit':
        fitView(instance)
        break
      case 'reset':
        instance.animate(
          { zoom: 1, pan: { x: instance.width() / 2, y: instance.height() / 2 } },
          { duration: prefersReducedMotion() ? 0 : 220 },
        )
        break
      case 'zoomIn':
        instance.zoom({
          level: instance.zoom() * 1.25,
          renderedPosition: { x: instance.width() / 2, y: instance.height() / 2 },
        })
        break
      case 'zoomOut':
        instance.zoom({
          level: instance.zoom() / 1.25,
          renderedPosition: { x: instance.width() / 2, y: instance.height() / 2 },
        })
        break
    }
  }, [viewRequest])

  // Fit once on mount for a restored session. Vertices added by hand must not
  // move the viewport, or clicking to draw would fight the camera.
  useEffect(() => {
    const instance = cyRef.current
    if (!instance || seededRef.current) return
    seededRef.current = true
    if (useEditor.getState().doc.vertices.length === 0) return
    const handle = window.setTimeout(() => fitView(instance, false), 0)
    return () => window.clearTimeout(handle)
  }, [])

  /* ---------------------------------------------------------------- */
  /* Overlay                                                           */
  /* ---------------------------------------------------------------- */

  const badgeCount = Object.keys(highlight.badges ?? {}).length
  const drawingEdge = tool === 'edge' && pendingEdgeSource !== null
  const showSlips = doc.weighted && doc.edges.length > 0 && doc.edges.length <= WEIGHT_SLIP_LIMIT
  useEffect(() => {
    overlayActive.current = badgeCount > 0 || drawingEdge || showSlips
  }, [badgeCount, drawingEdge, showSlips])

  const zoom = cy ? cy.zoom() : 1
  const toScreen = (x: number, y: number) => {
    if (!cy) return { x: 0, y: 0 }
    const pan = cy.pan()
    return { x: x * zoom + pan.x, y: y * zoom + pan.y }
  }

  const badgeEntries = cy
    ? Object.entries(highlight.badges ?? {})
        .filter(([id]) => !cy.getElementById(id).empty())
        .map(([id, text]) => {
          const node = cy.getElementById(id) as NodeSingular
          const p = toScreen(node.position('x'), node.position('y'))
          return { id, text, x: p.x, y: p.y }
        })
    : []

  /*
   * Edge weights, set on paper slips above every line (a Cytoscape label is
   * painted with its own edge, so later edges would strike through it). Each
   * slip sits at its edge's midpoint; when two midpoints coincide, as the
   * diameters of K6 do, the later slip moves along its own edge so none is
   * hidden.
   */
  const weightSlips = (() => {
    if (!cy || !showSlips) return []
    const edgeModes = highlight.edges ?? {}
    const anyHighlight =
      Object.keys(highlight.vertices ?? {}).length > 0 ||
      Object.keys(edgeModes).length > 0 ||
      Object.keys(highlight.colors ?? {}).length > 0
    const placed: { x: number; y: number }[] = []
    const clear = (p: { x: number; y: number }) =>
      placed.every((q) => Math.hypot(p.x - q.x, p.y - q.y) >= SLIP_CLEARANCE)
    const slips: { id: string; text: string; x: number; y: number; dimmed: boolean }[] = []
    for (const e of doc.edges) {
      const found = cy.getElementById(e.id)
      if (found.empty() || !found.isEdge()) continue
      const edge = found as unknown as EdgeSingular
      const s = edge.source().position()
      const t = edge.target().position()
      let mid = { x: (s.x + t.x) / 2, y: (s.y + t.y) / 2 }
      try {
        const m = edge.midpoint()
        if (Number.isFinite(m.x) && Number.isFinite(m.y)) mid = m
      } catch {
        // Not laid out yet: the straight midpoint will do.
      }
      const at = toScreen(mid.x, mid.y)
      const along = { x: (t.x - s.x) * zoom, y: (t.y - s.y) * zoom }
      let spot = at
      if (!clear(spot)) {
        for (const f of [-0.12, 0.12, -0.22, 0.22]) {
          const p = { x: at.x + along.x * f, y: at.y + along.y * f }
          if (clear(p)) {
            spot = p
            break
          }
        }
      }
      placed.push(spot)
      slips.push({
        id: e.id,
        text: String(e.weight ?? 1),
        x: spot.x,
        y: spot.y,
        dimmed: Boolean(highlight.dimOthers) && anyHighlight && !edgeModes[e.id],
      })
    }
    return slips
  })()

  const ghost = (() => {
    if (!cy || tool !== 'edge' || !pendingEdgeSource || !pointer) return null
    const node = cy.getElementById(pendingEdgeSource)
    if (node.empty()) return null
    const from = toScreen((node as NodeSingular).position('x'), (node as NodeSingular).position('y'))
    const to = toScreen(pointer.x, pointer.y)
    return { from, to }
  })()

  const menuItems = ((): MenuItem[] => {
    if (!menu) return []
    const state = useEditor.getState()
    if (menu.kind === 'vertex' && menu.id) {
      const id = menu.id
      return [
        {
          id: 'rename',
          label: 'Rename...',
          onSelect: () => {
            const next = window.prompt('Rename vertex', state.graph.label(id))
            if (next !== null) state.renameVertex(id, next)
          },
        },
        { id: 'bfs', label: 'Start BFS here', onSelect: () => state.startAlgorithm('bfs', { source: id }) },
        { id: 'dfs', label: 'Start DFS here', onSelect: () => state.startAlgorithm('dfs', { source: id }) },
        {
          id: 'paths',
          label: 'Shortest paths from here',
          onSelect: () => state.startAlgorithm('dijkstra', { source: id }),
        },
        {
          id: 'induced',
          label: 'Induced subgraph on the selection',
          separatorBefore: true,
          disabled: state.selectedVertices.length < 1,
          onSelect: () => applyTransformById('induced-subgraph'),
        },
        {
          id: 'delete',
          label: state.selectedVertices.length > 1 ? 'Delete selected vertices' : 'Delete vertex',
          danger: true,
          onSelect: () =>
            state.deleteElements(
              state.selectedVertices.includes(id) ? state.selectedVertices : [id],
              [],
            ),
        },
      ]
    }
    if (menu.kind === 'edge' && menu.id) {
      const id = menu.id
      return [
        {
          id: 'weight',
          label: 'Change weight...',
          disabled: !state.doc.weighted,
          onSelect: () => {
            const next = window.prompt('Edge weight', String(state.graph.weight(id)))
            if (next === null) return
            const parsed = Number(next)
            if (Number.isFinite(parsed)) state.setEdgeWeight(id, parsed)
            else state.notify('Edge weights must be finite numbers.', 'error')
          },
        },
        {
          id: 'reverse',
          label: 'Reverse direction',
          disabled: !state.doc.directed,
          onSelect: () => state.reverseEdge(id),
        },
        { id: 'subdivide', label: 'Subdivide', onSelect: () => applyTransformById('subdivide-edge') },
        { id: 'contract', label: 'Contract', onSelect: () => applyTransformById('contract-edge') },
        {
          id: 'delete',
          label: 'Delete edge',
          danger: true,
          separatorBefore: true,
          onSelect: () => state.deleteElements([], [id]),
        },
      ]
    }
    return [
      {
        id: 'add',
        label: 'Add a vertex here',
        onSelect: () => state.addVertexAt(menu.modelX, menu.modelY),
      },
      {
        id: 'selectAll',
        label: 'Select all',
        separatorBefore: true,
        onSelect: () => state.select(state.graph.vertexIds, state.graph.edgeIds),
      },
      { id: 'fit', label: 'Fit to screen', onSelect: () => state.requestView('fit') },
      {
        id: 'generate',
        label: 'Generate a graph...',
        separatorBefore: true,
        onSelect: () => useUi.getState().openDialog('generate'),
      },
      {
        id: 'clear',
        label: 'Clear graph',
        danger: true,
        disabled: graph.order === 0,
        onSelect: () => state.clearGraph(),
      },
    ]
  })()

  const cursor =
    tool === 'vertex'
      ? 'copy'
      : tool === 'edge'
        ? 'crosshair'
        : tool === 'erase'
          ? 'not-allowed'
          : 'default'

  return (
    <div className="gz-wb-canvas absolute inset-0">
      {/* Cytoscape forces `position: relative` on its container, so this uses
          percentage sizing rather than inset-0, which it would override. */}
      <div
        ref={containerRef}
        className="h-full w-full"
        style={{ cursor }}
        onContextMenu={(event) => event.preventDefault()}
        data-testid="graph-canvas"
        aria-label="Graph canvas"
      />

      <div
        className="pointer-events-none absolute inset-0 overflow-hidden"
        data-viewport-tick={viewportTick}
      >
        {ghost && (
          <svg className="absolute inset-0 h-full w-full">
            <line
              x1={ghost.from.x}
              y1={ghost.from.y}
              x2={ghost.to.x}
              y2={ghost.to.y}
              stroke={theme.selected}
              strokeWidth={1.5}
              strokeDasharray="6 4"
            />
          </svg>
        )}
        {weightSlips.map((slip) => (
          <span
            key={slip.id}
            className="gz-wb-badge gz-wb-weight absolute -translate-x-1/2 -translate-y-1/2"
            data-dimmed={slip.dimmed || undefined}
            style={{ left: slip.x, top: slip.y }}
          >
            {slip.text}
          </span>
        ))}
        {badgeEntries.map((badge) => (
          <span
            key={badge.id}
            className="gz-wb-badge absolute -translate-y-1/2"
            style={{
              left: badge.x + 22 * zoom,
              top: badge.y - 18 * zoom,
            }}
          >
            {badge.text}
          </span>
        ))}
      </div>

      <p className="sr-only" aria-live="polite">
        {doc.vertices.length === 0
          ? 'The canvas is empty.'
          : `${graph.order} vertices and ${graph.size} edges. ${
              highlight.caption ? `Highlighted: ${highlight.caption}.` : ''
            }`}
      </p>

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menuItems}
          onClose={() => setMenu(null)}
          label={
            menu.kind === 'vertex'
              ? 'Vertex actions'
              : menu.kind === 'edge'
                ? 'Edge actions'
                : 'Canvas actions'
          }
        />
      )}

      {doc.vertices.length === 0 && <CanvasEmptyState />}
    </div>
  )
}
