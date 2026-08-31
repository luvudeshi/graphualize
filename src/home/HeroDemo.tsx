import { useEffect, useMemo, useRef, useState } from 'react'
import cytoscape, { type Core } from 'cytoscape'
import { useTheme } from '../hooks/useTheme'
import { canvasTheme, modeColor } from '../canvas/theme'
import { buildStylesheet } from '../canvas/style'
import { witnessToHighlight } from '../canvas/highlight'
import { analyzeCore, analyzeMetrics, type InspectorRow } from '../graph/analysis'
import { prefersReducedMotion } from '../utils/platform'
import { buildDemoDocument, DEMO_ROW_IDS } from './demoGraph'
import { Graph } from '../graph/model/graph'

const CYCLE_MS = 3400

/**
 * The homepage demo is the real thing: the same graph library computes these
 * properties, the same witness-to-highlight code draws them, and the vertices
 * are draggable — moving one recomputes nothing, which is the point.
 */
export const HeroDemo = () => {
  const containerRef = useRef<HTMLDivElement>(null)
  const cyRef = useRef<Core | null>(null)
  const [active, setActive] = useState(0)
  const [paused, setPaused] = useState(false)
  const { dark } = useTheme()
  const theme = useMemo(() => canvasTheme(dark), [dark])

  const { doc, graph, rows } = useMemo(() => {
    const document = buildDemoDocument()
    const built = new Graph(document)
    const all = [
      ...analyzeCore(built).sections.flatMap((section) => section.rows),
      ...analyzeMetrics(built).sections.flatMap((section) => section.rows),
    ]
    const picked = DEMO_ROW_IDS.map((id) => all.find((row) => row.id === id)).filter(
      (row): row is InspectorRow => Boolean(row),
    )
    return { doc: document, graph: built, rows: picked }
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

    const fit = () => {
      instance.resize()
      instance.fit(instance.elements(), 44)
      if (instance.zoom() > 1.15) {
        instance.zoom({
          level: 1.15,
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
        reducedMotion: prefersReducedMotion(),
      }),
    )
  }, [theme])

  /* Highlight the witness of the active row. */
  useEffect(() => {
    const instance = cyRef.current
    const row = rows[active]
    if (!instance || !row?.witness) return
    const highlight = witnessToHighlight(row.witness, graph)
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
  }, [active, rows, graph, theme])

  /* Advance the tour, unless the visitor is interacting or prefers stillness. */
  useEffect(() => {
    if (paused || prefersReducedMotion() || rows.length < 2) return
    const handle = window.setInterval(() => {
      setActive((index) => (index + 1) % rows.length)
    }, CYCLE_MS)
    return () => window.clearInterval(handle)
  }, [paused, rows.length])

  const current = rows[active]

  return (
    <div
      className="grid gap-4 lg:grid-cols-[1.35fr_1fr]"
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
    >
      <div
        className="relative h-[240px] overflow-hidden rounded-xl border sm:h-[300px]"
        style={{ background: theme.background }}
      >
        <div ref={containerRef} className="h-full w-full" aria-hidden />
        <span className="pointer-events-none absolute bottom-2 left-3 text-[0.6875rem] text-[var(--gz-faint)]">
          drag a vertex — the mathematics does not change
        </span>
      </div>

      <ul className="flex flex-col gap-1" aria-label="Properties of the example graph">
        {rows.map((row, index) => {
          const selected = index === active
          return (
            <li key={row.id}>
              <button
                type="button"
                onClick={() => setActive(index)}
                aria-pressed={selected}
                className={`w-full rounded-lg border-l-2 px-3 py-2 text-left transition-colors ${
                  selected
                    ? 'border-[var(--gz-accent)] bg-[var(--gz-accent-soft)]'
                    : 'border-transparent hover:bg-[color-mix(in_oklab,var(--gz-border)_45%,transparent)]'
                }`}
              >
                <span className="flex items-baseline justify-between gap-3">
                  <span className="text-[0.8125rem] text-[var(--gz-muted)]">{row.label}</span>
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
                  <span className="mt-1 block text-[0.75rem] leading-relaxed text-[var(--gz-text)]">
                    {row.explanation}
                  </span>
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
  )
}
