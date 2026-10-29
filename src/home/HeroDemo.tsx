import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import cytoscape, { type Core } from 'cytoscape'
import { useTheme } from '../hooks/useTheme'
import { buildStylesheet } from '../canvas/style'
import { witnessToHighlight } from '../canvas/highlight'
import { analyzeCore, analyzeMetrics, type InspectorRow } from '../graph/analysis'
import type { HighlightRequest } from '../graph/model/types'
import { prefersReducedMotion } from '../utils/platform'
import {
  buildDemoDocument,
  DEMO_ROW_IDS,
  demoLayoutFor,
  demoPositions,
  type DemoLayout,
} from './demoGraph'
import { Graph } from '../graph/model/graph'
import { PauseIcon, PlayIcon } from '../components/Icons'
import {
  byrneCanvasOverrides,
  byrneCanvasTheme,
  byrnePalette,
  DEMO_WITNESS_STROKE,
  labelMargin,
  labelSides,
  tourInk,
  witnessGlyph,
  type Glyph,
  type Ink,
  type LabelSide,
} from './byrne'
import { DemoNotes } from './DemoNotes'
import type { Box, Plot, Plotted } from './notes'

const CYCLE_MS = 3400

/**
 * Room around the drawing, which is also where the notes on the plate are
 * written. The compact layout is only used on small stages.
 */
const FIT_PADDING: Record<DemoLayout, number> = { wide: 72, compact: 46 }
const MAX_ZOOM = 1.15

interface TourStop {
  row: InspectorRow
  highlight: HighlightRequest | null
  /** The primary the witness is laid on in, so the row's glyph matches the canvas. */
  ink: Ink
  /** The shape the witness takes, which the row's glyph repeats. */
  glyph: Glyph
}

const MoveIcon = () => (
  <svg
    width={12}
    height={12}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <path d="M12 3v18M3 12h18M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3" />
  </svg>
)

/**
 * The homepage demo is the real thing: the same graph library computes these
 * properties, the same witness-to-highlight code draws them, and the vertices
 * are draggable — moving one recomputes nothing, which is the point.
 *
 * It tours its properties on a timer, pausing while the pointer or focus is
 * inside it, and has an explicit pause control as well, because content that
 * moves on its own should always be stoppable. Picking a row stops the tour
 * too: the visitor has taken over, and the row they chose stays chosen. With
 * reduced motion there is no tour at all, so there is nothing to pause.
 */
export const HeroDemo = () => {
  const containerRef = useRef<HTMLDivElement>(null)
  const cyRef = useRef<Core | null>(null)
  const [active, setActive] = useState(0)
  // Pointer and focus are tracked apart: a row keeps focus after the pointer
  // has left, and pressing on the canvas to drag a vertex takes focus off a
  // row while the pointer is still in the demo. Either one holds the tour.
  const [pointerInside, setPointerInside] = useState(false)
  const [focusInside, setFocusInside] = useState(false)
  const [stopped, setStopped] = useState(false)
  /**
   * The row the visitor picked, which is the only kind of change worth saying
   * out loud. The tour moving on by itself is not announced, or a screen
   * reader would be interrupted every few seconds for as long as the page
   * stays open.
   */
  const [announced, setAnnounced] = useState<InspectorRow | null>(null)
  const [still] = useState(prefersReducedMotion)
  const { dark } = useTheme()
  const theme = useMemo(() => byrneCanvasTheme(dark), [dark])
  const palette = byrnePalette(dark)
  /** Where everything is drawn right now, for the notes written over it. */
  const [plot, setPlot] = useState<Plot | null>(null)
  const [layoutUp, setLayoutUp] = useState<DemoLayout>('wide')
  /** Asks for the drawing to be measured again on the next frame. */
  const remeasureRef = useRef<() => void>(() => {})

  const { doc, graph, stops } = useMemo(() => {
    const document = buildDemoDocument()
    const built = new Graph(document)
    const all = [
      ...analyzeCore(built).sections.flatMap((section) => section.rows),
      ...analyzeMetrics(built).sections.flatMap((section) => section.rows),
    ]
    const picked = DEMO_ROW_IDS.map((id) => all.find((row) => row.id === id)).filter(
      (row): row is InspectorRow => Boolean(row),
    )
    const tour = picked.map(
      (row, index): TourStop => ({
        row,
        highlight: row.witness ? witnessToHighlight(row.witness, built) : null,
        ink: tourInk(index),
        glyph: witnessGlyph(row.witness),
      }),
    )
    return { doc: document, graph: built, stops: tour }
  }, [])

  /* Mount the canvas once. */
  useEffect(() => {
    if (!containerRef.current) return
    const instance = cytoscape({
      container: containerRef.current,
      elements: [
        ...doc.vertices.map((v) => ({
          group: 'nodes' as const,
          data: { id: v.id, label: v.label },
          position: { x: v.x, y: v.y },
        })),
        ...doc.edges.map((e) => ({
          group: 'edges' as const,
          data: { id: e.id, source: e.source, target: e.target, weightLabel: '' },
        })),
      ],
      // Without this, Cytoscape lays the elements out itself and throws away
      // the hand-placed positions the demo depends on.
      layout: { name: 'preset' },
      userZoomingEnabled: false,
      userPanningEnabled: false,
      boxSelectionEnabled: false,
      autounselectify: true,
    })
    cyRef.current = instance

    const labels = new Map(doc.vertices.map((v) => [v.id, v.label]))
    const edges = doc.edges.map(({ id, source, target }) => ({ id, source, target }))

    // Letter each vertex on its most open side. Done again whenever a vertex
    // moves, so a letter never ends up lying along an edge that was dragged
    // over to its side.
    const sides = new Map<string, LabelSide>()
    const letter = () => {
      const placed = new Map<string, { x: number; y: number }>()
      instance.nodes().forEach((node) => {
        placed.set(node.id(), node.position())
      })
      const wanted = labelSides(placed, doc.edges)
      instance.batch(() => {
        instance.nodes().forEach((node) => {
          const side = wanted.get(node.id())
          const had = sides.get(node.id())
          if (!side || (had && had.halign === side.halign && had.valign === side.valign)) return
          sides.set(node.id(), side)
          const margin = labelMargin(side)
          node.data('labelMX', margin.x)
          node.data('labelMY', margin.y)
          node.data('labelH', side.halign)
          node.data('labelV', side.valign)
        })
      })
    }

    // The notes over the drawing follow it: when a vertex is dragged, when the
    // stage is refitted or the drawing swapped, and when a witness changes
    // the size of its points. Measured at most once a frame.
    let frame = 0
    const measure = () => {
      frame = 0
      letter()
      const vertices = new Map<string, Plotted>()
      const letters = new Map<string, Box>()
      instance.nodes().forEach((node) => {
        const at = node.renderedPosition()
        vertices.set(node.id(), { x: at.x, y: at.y, r: node.renderedOuterWidth() / 2 })
        const box = node.renderedBoundingBox({
          includeNodes: false,
          includeEdges: false,
          includeLabels: true,
          includeOverlays: false,
        })
        if (box.w > 0 && box.h > 0) letters.set(node.id(), { x0: box.x1, y0: box.y1, x1: box.x2, y1: box.y2 })
      })
      setPlot({
        width: instance.width(),
        height: instance.height(),
        vertices,
        letters,
        names: labels,
        edges,
        stroke: DEMO_WITNESS_STROKE * instance.zoom(),
      })
    }
    const remeasure = () => {
      if (!frame) frame = window.requestAnimationFrame(measure)
    }
    remeasureRef.current = remeasure
    instance.on('position', 'node', remeasure)
    instance.on('viewport resize', remeasure)

    // A dragged vertex stays on the plate, with room for its letter (set
    // beside the disc, on whichever side is most open) inside the frame.
    instance.on('drag', 'node', (event) => {
      const node = event.target
      const ext = instance.extent()
      const zoom = instance.zoom()
      const pad = { left: 36 / zoom, right: 46 / zoom, top: 38 / zoom, bottom: 32 / zoom }
      const at = node.position()
      const x = Math.min(Math.max(at.x, ext.x1 + pad.left), ext.x2 - pad.right)
      const y = Math.min(Math.max(at.y, ext.y1 + pad.top), ext.y2 - pad.bottom)
      if (x !== at.x || y !== at.y) node.position({ x, y })
    })

    // The document is drawn wide. A narrow stage swaps in the compact drawing
    // of the same graph, and swaps back if the stage widens again.
    let layout: DemoLayout = 'wide'
    const fit = () => {
      instance.resize()
      const wanted = demoLayoutFor(instance.width(), instance.height())
      if (wanted !== layout) {
        layout = wanted
        setLayoutUp(wanted)
        const positions = demoPositions(wanted)
        instance.batch(() => {
          instance.nodes().forEach((node) => {
            const at = positions.get(labels.get(node.id()) ?? '')
            if (at) node.position({ ...at })
          })
        })
      }
      letter()
      instance.fit(instance.elements(), FIT_PADDING[layout])
      if (instance.zoom() > MAX_ZOOM) {
        instance.zoom({
          level: MAX_ZOOM,
          renderedPosition: { x: instance.width() / 2, y: instance.height() / 2 },
        })
        instance.center(instance.elements())
      }
      remeasure()
    }
    const observer = new ResizeObserver(fit)
    observer.observe(containerRef.current)
    fit()

    return () => {
      observer.disconnect()
      window.cancelAnimationFrame(frame)
      remeasureRef.current = () => {}
      instance.destroy()
      cyRef.current = null
    }
  }, [doc])

  /* Theme: the workbench's stylesheet, then the page's own ink on top. */
  useEffect(() => {
    const sheet = [
      ...buildStylesheet(theme, {
        directed: false,
        weighted: false,
        showLabels: true,
        reducedMotion: still,
      }),
      ...byrneCanvasOverrides(dark),
    ]
    cyRef.current?.style(sheet)
    // The canvas letters its vertices in the page's italic, which may still be
    // on its way; once it has arrived the canvas is drawn again with it.
    let live = true
    void document.fonts
      ?.load('italic 500 22px "EB Garamond"')
      .then(() => {
        if (!live) return
        cyRef.current?.style(sheet)
        remeasureRef.current()
      })
      .catch(() => {})
    remeasureRef.current()
    return () => {
      live = false
    }
  }, [theme, still, dark])

  /* Highlight the witness of the active row, in that row's colour. */
  const activeInk = stops[active] ? palette[stops[active].ink] : palette.ink
  useEffect(() => {
    const instance = cyRef.current
    const highlight = stops[active]?.highlight
    if (!instance || !highlight) return
    instance.batch(() => {
      instance.nodes().forEach((node) => {
        const mode = highlight.vertices?.[node.id()]
        if (mode) node.data('hlColor', activeInk)
        else node.removeData('hlColor')
        node.toggleClass('dimmed', Boolean(highlight.dimOthers) && !mode)
      })
      instance.edges().forEach((edge) => {
        const mode = highlight.edges?.[edge.id()]
        if (mode) edge.data('hlColor', activeInk)
        else edge.removeData('hlColor')
        edge.toggleClass('dimmed', Boolean(highlight.dimOthers) && !mode)
      })
    })
    // A witness's points are drawn larger, which moves their letters out.
    remeasureRef.current()
  }, [active, stops, activeInk])

  /* Advance the tour, unless the visitor is interacting, stopped it, or prefers stillness. */
  const touring = !pointerInside && !focusInside && !stopped && !still && stops.length > 1
  useEffect(() => {
    if (!touring) return
    const handle = window.setInterval(() => {
      setActive((index) => (index + 1) % stops.length)
    }, CYCLE_MS)
    return () => window.clearInterval(handle)
  }, [touring, stops.length])

  const pick = (index: number) => {
    setActive(index)
    setStopped(true)
    setAnnounced(stops[index]?.row ?? null)
  }

  const toggleTour = () => {
    // A resumed tour goes back to running silently.
    if (stopped) setAnnounced(null)
    setStopped(!stopped)
  }

  const current = stops[active]
  const subject = useMemo(
    () =>
      current ? { id: current.row.id, value: current.row.value, witness: current.row.witness } : null,
    [current],
  )

  return (
    <div
      className="gz-demo"
      onPointerEnter={() => setPointerInside(true)}
      onPointerLeave={() => setPointerInside(false)}
      // Focus on the pause/resume control is not a hold: Chrome focuses a
      // clicked button, and Resume would otherwise keep the tour stopped.
      onFocus={(event) =>
        setFocusInside(!(event.target as Element).closest('.gz-demo-control'))
      }
      onBlur={(event) => {
        // Moving from one row to the next is not leaving.
        if (!event.currentTarget.contains(event.relatedTarget)) setFocusInside(false)
      }}
    >
      <div className="gz-demo-head">
        <span className="gz-demo-plate">Plate I.</span>
        {/* The title and the counts are one flex item, so the first middot is
            set off by a word space like the second, not by the head's gap. */}
        <span>
          <span className="gz-demo-title">Live analysis</span>
          <span className="gz-num hidden text-[var(--gz-muted)] sm:inline">
            {' '}· {graph.order} vertices · {graph.size} edges
          </span>
        </span>
        <span className="gz-demo-hint ml-auto text-[var(--gz-muted)]">
          <MoveIcon />
          Drag a vertex
        </span>
        {!still && (
          <button
            type="button"
            onClick={toggleTour}
            aria-label={stopped ? 'Resume the tour' : 'Pause the tour'}
            className="gz-demo-control"
          >
            {stopped ? <PlayIcon width={13} height={13} /> : <PauseIcon width={13} height={13} />}
          </button>
        )}
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] md:grid-cols-[minmax(0,1fr)_20rem] lg:grid-cols-[minmax(0,1fr)_23rem]">
        <div className="gz-demo-canvas relative">
          <div ref={containerRef} className="h-full w-full" aria-hidden />
          <DemoNotes
            plot={plot}
            subject={subject}
            ink={current?.ink ?? 'red'}
            glyph={current?.glyph ?? 'square'}
            compact={layoutUp === 'compact'}
          />
        </div>

        <div className="gz-demo-side">
          <p className="gz-demo-label">Properties</p>
          <ul className="gz-demo-list" aria-label="Properties of the example graph">
            {stops.map(({ row, ink, glyph }, index) => {
              const selected = index === active
              return (
                <li key={row.id}>
                  <button
                    type="button"
                    onClick={() => pick(index)}
                    aria-pressed={selected}
                    className="gz-demo-row"
                    style={{ '--gz-row': `var(--gz-home-${ink})` } as CSSProperties}
                  >
                    <span className="gz-demo-line">
                      <span className="gz-demo-glyph" data-glyph={glyph} aria-hidden />
                      <span className="gz-demo-name">{row.label}</span>
                      <span className="gz-demo-leader" aria-hidden />
                      <span
                        className="gz-demo-value gz-num"
                        data-status={row.status === 'success' || row.status === 'warning' ? row.status : undefined}
                      >
                        {row.value}
                      </span>
                    </span>
                    {selected && row.explanation && (
                      // The list reserves two lines for this (home.css), so it
                      // does not jump as the tour moves on.
                      <span className="gz-demo-why gz-anim-in">{row.explanation}</span>
                    )}
                    {selected && touring && (
                      <span
                        className="gz-demo-progress"
                        style={{ animationDuration: `${CYCLE_MS}ms` }}
                        aria-hidden
                      />
                    )}
                  </button>
                </li>
              )
            })}
          </ul>
          <p role="status" aria-live="polite" className="sr-only">
            {announced
              ? `${announced.label}: ${announced.value}. ${announced.explanation ?? ''}`
              : ''}
          </p>
        </div>
      </div>
    </div>
  )
}
