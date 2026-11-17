import { useState, type ReactNode } from 'react'
import { useEditor } from '../state/store'
import { useDebounced } from '../hooks/useDeferred'
import { memoByStructure } from '../graph/cache'
import { analyzeCore, analyzeHard, analyzeMetrics, type InspectorSection } from '../graph/analysis'
import { PropertyRow } from './PropertyRow'
import { MatrixSection } from './MatrixSection'
import { SelectionPanel } from './SelectionPanel'
import { ChevronIcon } from './Icons'
import { runQuickInput } from '../state/actions'
import '../styles/panel.css'

const DEFAULT_OPEN = new Set([
  'selection',
  'overview',
  'connectivity',
  'structure',
  'cycles',
  'distance',
])

const Section = ({
  id,
  title,
  count,
  open,
  onToggle,
  children,
  note,
}: {
  id: string
  title: string
  count?: number
  open: boolean
  onToggle: () => void
  children: ReactNode
  note?: string
}) => (
  <section className="gz-wb-section">
    <h3 className="gz-wb-section-head">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={`section-${id}`}
        className="gz-wb-section-btn"
      >
        <ChevronIcon width={11} height={11} className="gz-wb-chevron" aria-hidden="true" />
        <span className="gz-marker gz-wb-marker">{title}</span>
        {count !== undefined && <span className="gz-wb-section-count gz-wb-num">{count}</span>}
      </button>
    </h3>
    {open && (
      <div id={`section-${id}`} className="gz-wb-section-content">
        {note && <p className="gz-wb-note">{note}</p>}
        {children}
      </div>
    )}
  </section>
)

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** Rows seat one after another when a section appears; the index is capped so
    a long list does not take seconds to arrive. */
const SEAT_CAP = 8

const RowList = ({ section }: { section: InspectorSection }) => (
  <div className="gz-wb-rows">
    {section.rows.map((row, i) => (
      <PropertyRow key={row.id} row={row} seat={Math.min(i, SEAT_CAP)} />
    ))}
  </div>
)

export const Inspector = () => {
  const graph = useEditor((s) => s.graph)
  const name = useEditor((s) => s.name)
  const setName = useEditor((s) => s.setName)
  const directed = useEditor((s) => s.doc.directed)
  const weighted = useEditor((s) => s.doc.weighted)
  const setDirected = useEditor((s) => s.setDirected)
  const setWeighted = useEditor((s) => s.setWeighted)
  const selectedVertices = useEditor((s) => s.selectedVertices)
  const selectedEdges = useEditor((s) => s.selectedEdges)
  const notify = useEditor((s) => s.notify)

  // Debounce the graph itself, not just its key: caching a result computed from
  // one graph under another graph's key would poison the cache permanently.
  const settled = useDebounced(graph, 160)

  const core = memoByStructure('core', graph.displayKey(), () => analyzeCore(graph))
  const metrics = memoByStructure('metrics', settled.displayKey(), () => analyzeMetrics(settled))

  const [openSections, setOpenSections] = useState<Set<string>>(() => new Set(DEFAULT_OPEN))
  const toggle = (id: string) =>
    setOpenSections((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const hardOpen = openSections.has('hard') || openSections.has('cuts')
  const hard = hardOpen
    ? memoByStructure('hard', settled.displayKey(), () => analyzeHard(settled))
    : null

  const [command, setCommand] = useState('')
  const sections = [...core.sections, ...metrics.sections]
  const hasSelection = selectedVertices.length > 0 || selectedEdges.length > 0

  return (
    <aside aria-label="Graph inspector" className="gz-wb-inspector">
      <div className="gz-wb-head">
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          aria-label="Graph name"
          className="gz-wb-name"
          placeholder="Untitled graph"
        />
        <span className="gz-wb-count gz-wb-num">
          {plural(graph.order, 'vertex', 'vertices')} · {plural(graph.size, 'edge', 'edges')}
        </span>
        <div className="gz-wb-modes">
          <button
            type="button"
            role="switch"
            aria-checked={directed}
            onClick={() => setDirected(!directed)}
            className="gz-switch gz-wb-toggle"
          >
            <span className="gz-switch-track" aria-hidden="true" />
            Directed
          </button>
          <button
            type="button"
            role="switch"
            aria-checked={weighted}
            onClick={() => setWeighted(!weighted)}
            className="gz-switch gz-wb-toggle"
          >
            <span className="gz-switch-track" aria-hidden="true" />
            Weighted
          </button>
        </div>
        <form
          className="gz-wb-command-form"
          onSubmit={(event) => {
            event.preventDefault()
            const text = command.trim()
            if (!text) return
            // A graph command replaces the graph; an edge list adds to it.
            // `failed` has already said why in the status bar.
            const outcome = runQuickInput(text)
            if (outcome === 'done') setCommand('')
            else if (outcome === 'unrecognised') {
              notify(
                `"${text}" is not a graph or an edge list I recognise. Try K5, C8, G(20,0.2) or A-B, B-C.`,
                'error',
              )
            }
          }}
        >
          <input
            value={command}
            onChange={(event) => setCommand(event.target.value)}
            className="gz-input gz-wb-command"
            placeholder="K5, C8, G(20, 0.2) or A-B, B-C…"
            aria-label="Quick graph command"
            spellCheck={false}
          />
        </form>
      </div>

      <div className="gz-scroll gz-wb-insp-body">
        {hasSelection && (
          <Section
            id="selection"
            title="Selection"
            open={openSections.has('selection')}
            onToggle={() => toggle('selection')}
          >
            <SelectionPanel />
          </Section>
        )}

        {sections.map((section) => (
          <Section
            key={section.id}
            id={section.id}
            title={section.title}
            open={openSections.has(section.id)}
            onToggle={() => toggle(section.id)}
            note={section.note}
          >
            <RowList section={section} />
          </Section>
        ))}

        <Section
          id="matrices"
          title="Matrices"
          open={openSections.has('matrices')}
          onToggle={() => toggle('matrices')}
        >
          <MatrixSection />
        </Section>

        {(['hard', 'cuts'] as const).map((id) => {
          const section = hard?.sections.find((s) => s.id === id)
          return (
            <Section
              key={id}
              id={id}
              title={id === 'hard' ? 'Hard invariants' : 'Cuts'}
              open={openSections.has(id)}
              onToggle={() => toggle(id)}
              note={
                section
                  ? undefined
                  : 'These are NP-hard or cubic. Expand to compute them for the current graph.'
              }
            >
              {section ? (
                <RowList section={section} />
              ) : (
                <p className="gz-wb-note">Computing…</p>
              )}
            </Section>
          )
        })}
      </div>
    </aside>
  )
}
