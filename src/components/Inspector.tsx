import { useState, type ReactNode } from 'react'
import { useEditor } from '../state/store'
import { useDebounced } from '../hooks/useDeferred'
import { memoByStructure } from '../graph/cache'
import { analyzeCore, analyzeHard, analyzeMetrics, type InspectorSection } from '../graph/analysis'
import { PropertyRow } from './PropertyRow'
import { MatrixSection } from './MatrixSection'
import { SelectionPanel } from './SelectionPanel'
import { ChevronIcon } from './Icons'
import { runGraphCommand } from '../state/actions'

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
  <section className="border-b last:border-b-0">
    <h3>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={`section-${id}`}
        className="flex w-full items-center gap-1.5 px-2.5 py-2 text-left transition-colors hover:bg-[color-mix(in_oklab,var(--gz-border)_35%,transparent)]"
      >
        <ChevronIcon
          width={12}
          height={12}
          className={`shrink-0 text-[var(--gz-faint)] transition-transform ${open ? 'rotate-90' : ''}`}
        />
        <span className="gz-label !text-[var(--gz-muted)]">{title}</span>
        {count !== undefined && (
          <span className="gz-num ml-auto text-[0.6875rem] text-[var(--gz-faint)]">{count}</span>
        )}
      </button>
    </h3>
    {open && (
      <div id={`section-${id}`} className="pb-1.5">
        {note && (
          <p className="px-2.5 pb-1 text-[0.7188rem] text-[var(--gz-faint)]">{note}</p>
        )}
        {children}
      </div>
    )}
  </section>
)

const RowList = ({ section }: { section: InspectorSection }) => (
  <div className="space-y-0.5 px-1">
    {section.rows.map((row) => (
      <PropertyRow key={row.id} row={row} />
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
    <aside
      aria-label="Graph inspector"
      className="flex h-full w-full flex-col border-l bg-[var(--gz-panel)]"
    >
      <div className="shrink-0 border-b px-2.5 py-2">
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          aria-label="Graph name"
          className="w-full bg-transparent text-[0.875rem] font-semibold tracking-[-0.01em] outline-none placeholder:text-[var(--gz-faint)]"
          placeholder="Untitled graph"
        />
        <div className="mt-1.5 flex items-center gap-1">
          <button
            type="button"
            role="switch"
            aria-checked={directed}
            onClick={() => setDirected(!directed)}
            className={`gz-chip transition-colors ${
              directed
                ? 'border-[var(--gz-accent)] text-[var(--gz-accent)]'
                : 'hover:text-[var(--gz-text)]'
            }`}
          >
            Directed
          </button>
          <button
            type="button"
            role="switch"
            aria-checked={weighted}
            onClick={() => setWeighted(!weighted)}
            className={`gz-chip transition-colors ${
              weighted
                ? 'border-[var(--gz-accent)] text-[var(--gz-accent)]'
                : 'hover:text-[var(--gz-text)]'
            }`}
          >
            Weighted
          </button>
          <span className="gz-num ml-auto text-[0.6875rem] text-[var(--gz-faint)]">
            {graph.order}v · {graph.size}e
          </span>
        </div>
        <form
          className="mt-2"
          onSubmit={(event) => {
            event.preventDefault()
            const text = command.trim()
            if (!text) return
            if (runGraphCommand(text)) setCommand('')
            else notify(`"${text}" is not a graph I recognise. Try K5, C8, K3,4 or G(20,0.2).`, 'error')
          }}
        >
          <input
            value={command}
            onChange={(event) => setCommand(event.target.value)}
            className="gz-input gz-num"
            placeholder="K5, C8, K3,4, Q4, G(20,0.2)..."
            aria-label="Quick graph command"
            spellCheck={false}
          />
        </form>
      </div>

      <div className="gz-scroll min-h-0 flex-1">
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
                <p className="px-2.5 text-[0.75rem] text-[var(--gz-faint)]">Computing...</p>
              )}
            </Section>
          )
        })}
      </div>
    </aside>
  )
}
