import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import cytoscape, { type Core } from 'cytoscape'
import { useTheme } from '../hooks/useTheme'
import { canvasTheme, modeColor } from '../canvas/theme'
import { buildStylesheet } from '../canvas/style'
import { witnessToHighlight } from '../canvas/highlight'
import { analyzeCore, analyzeMetrics, type InspectorRow } from '../graph/analysis'
import type { HighlightMode, HighlightRequest } from '../graph/model/types'
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

const CYCLE_MS = 3400

/** Room around the drawing. The compact layout is only used on small stages. */
const FIT_PADDING: Record<DemoLayout, number> = { wide: 48, compact: 28 }
const MAX_ZOOM = 1.15

interface TourStop {
  row: InspectorRow
  highlight: HighlightRequest | null
  /** The mode the witness is drawn in, so the row's swatch matches the canvas. */
  mode: HighlightMode | null
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
 * moves on its own should always be stoppable. With reduced motion there is
 * no tour at all, so there is nothing to pause.
 */
export const HeroDemo = () => {
  const containerRef = useRef<HTMLDivElement>(null)
  const cyRef = useRef<Core | null>(null)
  const [active, setActive] = useState(0)
  const [hovered, setHovered] = useState(false)
  const [stopped, setStopped] = useState(false)
  const [still] = useState(prefersReducedMotion)
  const { dark } = useTheme()
  const theme = useMemo(() => canvasTheme(dark), [dark])

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
    const tour = picked.map((row): TourStop => {
      if (!row.witness) return { row, highlight: null, mode: null }
      const highlight = witnessToHighlight(row.witness, built)
      const mode =
        Object.values(highlight.edges ?? {})[0] ?? Object.values(highlight.vertices ?? {})[0]
      return { row, highlight, mode: mode ?? null }
    })
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

    // The document is drawn wide. A narrow stage swaps in the compact drawing
    // of the same graph, and swaps back if the stage widens again.
    const labels = new Map(doc.vertices.map((v) => [v.id, v.label]))
    let layout: DemoLayout = 'wide'
    const fit = () => {
      instance.resize()
      const wanted = demoLayoutFor(instance.width(), instance.height())
      if (wanted !== layout) {
        layout = wanted
        const positions = demoPositions(wanted)
        instance.batch(() => {
          instance.nodes().forEach((node) => {
            const at = positions.get(labels.get(node.id()) ?? '')
            if (at) node.position({ ...at })
          })
        })
      }
      instance.fit(instance.elements(), FIT_PADDING[layout])
      if (instance.zoom() > MAX_ZOOM) {
        instance.zoom({
          level: MAX_ZOOM,
          renderedPosition: { x: instance.width() / 2, y: instance.height() / 2 },
        })
        instance.center(instance.elements())
      }
    }
    const observer = new ResizeObserver(fit)
    observer.observe(containerRef.current)
    fit()

    return () => {
      observer.disconnect()
      instance.destroy()
      cyRef.current = null
    }
  }, [doc])

  /* Theme. */
  useEffect(() => {
    cyRef.current?.style(
      buildStylesheet(theme, {
        directed: false,
        weighted: false,
        showLabels: true,
        reducedMotion: still,
      }),
    )
  }, [theme, still])

  /* Highlight the witness of the active row. */
  useEffect(() => {
    const instance = cyRef.current
    const highlight = stops[active]?.highlight
    if (!instance || !highlight) return
    instance.batch(() => {
      instance.nodes().forEach((node) => {
        const mode = highlight.vertices?.[node.id()]
        if (mode) node.data('hlColor', modeColor(theme, mode))
        else node.removeData('hlColor')
        node.toggleClass('dimmed', Boolean(highlight.dimOthers) && !mode)
      })
      instance.edges().forEach((edge) => {
        const mode = highlight.edges?.[edge.id()]
        if (mode) edge.data('hlColor', modeColor(theme, mode))
        else edge.removeData('hlColor')
        edge.toggleClass('dimmed', Boolean(highlight.dimOthers) && !mode)
      })
    })
  }, [active, stops, theme])

  /* Advance the tour, unless the visitor is interacting, stopped it, or prefers stillness. */
  const touring = !hovered && !stopped && !still && stops.length > 1
  useEffect(() => {
    if (!touring) return
    const handle = window.setInterval(() => {
      setActive((index) => (index + 1) % stops.length)
    }, CYCLE_MS)
    return () => window.clearInterval(handle)
  }, [touring, stops.length])

  const current = stops[active]?.row

  return (
    <div
      className="gz-demo"
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocusCapture={() => setHovered(true)}
      onBlurCapture={() => setHovered(false)}
    >
      <div className="flex h-11 items-center gap-2.5 border-b px-4">
        <span className="gz-demo-live" aria-hidden />
        <span className="text-[0.8125rem] font-medium tracking-[-0.01em]">Live analysis</span>
        <span className="gz-num hidden text-[0.75rem] text-[var(--gz-faint)] sm:inline">
          · {graph.order} vertices · {graph.size} edges
        </span>
        <span className="ml-auto flex items-center gap-1.5 text-[0.75rem] text-[var(--gz-faint)]">
          <MoveIcon />
          Drag a vertex
        </span>
        {!still && (
          <button
            type="button"
            onClick={() => setStopped((value) => !value)}
            aria-label={stopped ? 'Resume the tour' : 'Pause the tour'}
            className="gz-demo-control ml-1.5"
          >
            {stopped ? <PlayIcon width={13} height={13} /> : <PauseIcon width={13} height={13} />}
          </button>
        )}
      </div>

      <div className="grid md:grid-cols-[minmax(0,1fr)_20rem] lg:grid-cols-[minmax(0,1fr)_23rem]">
        <div className="gz-demo-canvas relative h-[300px] sm:h-[340px] md:h-[384px] lg:h-[364px]">
          <div ref={containerRef} className="h-full w-full" aria-hidden />
        </div>

        <div className="border-t p-2.5 md:border-l md:border-t-0 md:p-3">
          <p className="gz-label px-3 pb-2 pt-2">Properties</p>
          <ul className="flex flex-col gap-1" aria-label="Properties of the example graph">
            {stops.map(({ row, mode }, index) => {
              const selected = index === active
              const swatch = mode ? modeColor(theme, mode) : 'var(--gz-accent)'
              return (
                <li key={row.id}>
                  <button
                    type="button"
                    onClick={() => setActive(index)}
                    aria-pressed={selected}
                    className="gz-demo-row"
                    style={{ '--gz-row': swatch } as CSSProperties}
                  >
                    <span className="flex items-center gap-3">
                      <span className="gz-demo-swatch" aria-hidden />
                      <span
                        className={`flex-1 text-[0.8125rem] ${
                          selected ? 'font-medium text-[var(--gz-text)]' : 'text-[var(--gz-muted)]'
                        }`}
                      >
                        {row.label}
                      </span>
                      <span
                        className={`gz-num font-medium ${
                          row.status === 'success'
                            ? 'text-[var(--gz-success)]'
                            : row.status === 'warning'
                              ? 'text-[var(--gz-warning)]'
                              : ''
                        }`}
                      >
                        {row.value}
                      </span>
                    </span>
                    {selected && row.explanation && (
                      // Two lines are reserved whether or not they are needed,
                      // so the list does not jump as the tour moves on.
                      <span className="gz-anim-in mt-1.5 block min-h-[3em] pl-5 text-[0.8125rem] leading-[1.5] text-[var(--gz-muted)]">
                        {row.explanation}
                      </span>
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
            <li aria-live="polite" className="sr-only">
              {current ? `${current.label}: ${current.value}. ${current.explanation ?? ''}` : ''}
            </li>
          </ul>
        </div>
      </div>
    </div>
  )
}
