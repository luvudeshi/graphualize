import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useEditor } from '../state/store'
import { useUi } from '../state/ui'
import { fuzzyMatch, highlightParts } from '../utils/fuzzy'
import { ALGORITHMS } from '../graph/algorithms'
import { TRANSFORMS } from '../graph/transformations'
import { GENERATORS, defaultParams } from '../graph/generators'
import { parseGraphCommand } from '../graph/generators/commands'
import { EXAMPLES } from '../graph/examples'
import { LAYOUT_LABELS, type LayoutName } from '../graph/layout'
import {
  addTypedEdges,
  applyGenerator,
  applyTransformById,
  loadExample,
  previewEdgeList,
  runGraphCommand,
} from '../state/actions'
import { EdgeIcon, SparkIcon } from './Icons'
import { MathName } from './GenerateDialog'
import { replaceWorkingGraph } from '../state/replace'
import { requestSave, requestSaveAs } from '../state/save'
import { copyShareLink } from '../state/share'
import '../styles/dialogs.css'

interface Command {
  id: string
  label: string
  group: string
  hint?: string
  /** The label ends in notation (Cₙ, K_{m,n}, G(n, p)) that is set as maths. */
  maths?: boolean
  run: () => void
}

/** Indexed letters (Cn, Km,n) and calls (G(n, p)) inside a generator's label. */
const NOTATION = /\b[A-Z][a-z](?:,[a-z])?\b|\b[A-Z]\([^)]*\)/g

/**
 * The label with its notation set as maths. Matched letters stay underlined
 * in the plain words; a notation with any match is underlined whole. The
 * notation's plain text is kept for screen readers by MathName.
 */
const LabelText = ({
  label,
  positions,
  maths,
}: {
  label: string
  positions: readonly number[]
  maths?: boolean
}) => {
  const spans: { from: number; to: number; math: boolean }[] = []
  let at = 0
  if (maths) {
    for (const match of label.matchAll(NOTATION)) {
      const from = match.index
      if (from > at) spans.push({ from: at, to: from, math: false })
      spans.push({ from, to: from + match[0].length, math: true })
      at = from + match[0].length
    }
  }
  if (at < label.length) spans.push({ from: at, to: label.length, math: false })

  return (
    <>
      {spans.map((span) => {
        const text = label.slice(span.from, span.to)
        if (span.math) {
          const hit = positions.some((i) => i >= span.from && i < span.to)
          return (
            <span key={span.from} className={hit ? 'gz-wb-palette-hit' : ''}>
              <MathName text={text} className="gz-wb-palette-notation" />
            </span>
          )
        }
        const runs = highlightParts(
          text,
          positions.filter((i) => i >= span.from && i < span.to).map((i) => i - span.from),
        )
        return runs.map((run, i) => (
          <span key={`${span.from}-${i}`} className={run.hit ? 'gz-wb-palette-hit' : ''}>
            {run.text}
          </span>
        ))
      })}
    </>
  )
}

const buildCommands = (): Command[] => {
  const s = () => useEditor.getState()
  const commands: Command[] = [
    { id: 'tool.select', label: 'Select tool', group: 'Tools', run: () => s().setTool('select') },
    { id: 'tool.vertex', label: 'Vertex tool', group: 'Tools', run: () => s().setTool('vertex') },
    { id: 'tool.edge', label: 'Edge tool', group: 'Tools', run: () => s().setTool('edge') },
    { id: 'tool.erase', label: 'Erase tool', group: 'Tools', run: () => s().setTool('erase') },

    { id: 'edit.undo', label: 'Undo', group: 'Edit', run: () => s().undo() },
    { id: 'edit.redo', label: 'Redo', group: 'Edit', run: () => s().redo() },
    {
      id: 'edit.selectAll',
      label: 'Select all',
      group: 'Edit',
      run: () => s().select(s().graph.vertexIds, s().graph.edgeIds),
    },
    { id: 'edit.delete', label: 'Delete selection', group: 'Edit', run: () => s().deleteSelection() },
    { id: 'edit.clear', label: 'Clear graph', group: 'Edit', run: () => s().clearGraph() },
    {
      id: 'edit.directed',
      label: 'Toggle directed mode',
      group: 'Edit',
      run: () => s().setDirected(!s().doc.directed),
    },
    {
      id: 'edit.weighted',
      label: 'Toggle edge weights',
      group: 'Edit',
      run: () => s().setWeighted(!s().doc.weighted),
    },

    { id: 'view.fit', label: 'Fit graph to screen', group: 'View', run: () => s().requestView('fit') },
    { id: 'view.reset', label: 'Reset view', group: 'View', run: () => s().requestView('reset') },
    {
      id: 'view.inspector',
      label: 'Toggle inspector panel',
      group: 'View',
      run: () => s().setInspectorOpen(!s().inspectorOpen),
    },
    {
      id: 'view.theme',
      label: 'Toggle light / dark theme',
      group: 'View',
      run: () => s().setTheme(s().theme === 'dark' ? 'light' : 'dark'),
    },

    {
      id: 'file.new',
      label: 'New graph',
      group: 'File',
      run: () => replaceWorkingGraph({ kind: 'new' }),
    },
    { id: 'file.save', label: 'Save graph', group: 'File', run: () => requestSave() },
    { id: 'file.saveAs', label: 'Save as…', group: 'File', run: () => requestSaveAs() },
    {
      id: 'file.open',
      label: 'Open saved graph',
      group: 'File',
      run: () => useUi.getState().openDialog('documents'),
    },
    {
      id: 'file.import',
      label: 'Import graph data',
      group: 'File',
      run: () => useUi.getState().openDialog('import'),
    },
    {
      id: 'file.export',
      label: 'Export graph data',
      group: 'File',
      run: () => useUi.getState().openDialog('export'),
    },
    {
      id: 'file.share',
      label: 'Copy share link',
      group: 'File',
      hint: 'A link that opens this graph for anyone, with nothing uploaded',
      run: () => void copyShareLink(),
    },
    {
      id: 'help.shortcuts',
      label: 'Keyboard shortcuts',
      group: 'Help',
      run: () => useUi.getState().openDialog('shortcuts'),
    },
  ]

  for (const algorithm of ALGORITHMS) {
    commands.push({
      id: `algorithm.${algorithm.id}`,
      label: `Run ${algorithm.name}`,
      group: 'Algorithms',
      hint: algorithm.description,
      run: () => s().startAlgorithm(algorithm.id),
    })
  }

  for (const transform of TRANSFORMS) {
    commands.push({
      id: `transform.${transform.id}`,
      label: transform.name,
      group: 'Transform',
      hint: transform.description,
      run: () => applyTransformById(transform.id),
    })
  }

  for (const generator of GENERATORS) {
    commands.push({
      id: `generate.${generator.id}`,
      label: `Generate ${generator.name}`,
      group: 'Generate',
      hint: generator.description,
      maths: true,
      run: () => {
        if (generator.params.length === 0) applyGenerator(generator.id, {})
        else {
          applyGenerator(generator.id, defaultParams(generator))
        }
      },
    })
  }

  for (const example of EXAMPLES) {
    commands.push({
      id: `example.${example.id}`,
      label: `Example: ${example.name}`,
      group: 'Examples',
      hint: example.blurb,
      run: () => loadExample(example.id),
    })
  }

  for (const name of Object.keys(LAYOUT_LABELS) as LayoutName[]) {
    if (name === 'bipartite') continue
    commands.push({
      id: `layout.${name}`,
      label: `Layout: ${LAYOUT_LABELS[name]}`,
      group: 'View',
      run: () => s().runLayout(name),
    })
  }

  return commands
}

/**
 * Whether the query is a command's own name rather than an edge list.
 *
 * "bellman-ford", "force-directed" and "r-ary" all parse as edges, but someone
 * typing them in the palette wants the command. So a query that appears in a
 * command's label, starting at a word, means that command; "A-B" appears in
 * none, so it stays an edge list.
 */
const namesACommand = (query: string, commands: readonly Command[]): boolean => {
  const needle = query.toLowerCase().replace(/\s*-\s*/g, '-').replace(/\s+/g, ' ')
  return commands.some(({ label }) => {
    const haystack = label.toLowerCase()
    for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + 1)) {
      if (at === 0 || !/[\p{L}\p{N}]/u.test(haystack[at - 1]!)) return true
    }
    return false
  })
}

export const CommandPalette = () => {
  const open = useEditor((s) => s.commandPaletteOpen)
  return open ? <PaletteBody /> : null
}

/** Mounted only while open, so opening always starts from a clean slate. */
const PaletteBody = () => {
  const setOpen = useEditor((s) => s.setCommandPaletteOpen)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  const listId = useId()
  const optionId = (index: number) => `${listId}-option-${index}`
  const commands = useMemo(() => buildCommands(), [])
  const doc = useEditor((s) => s.doc)

  const trimmed = query.trim()
  const parsed = trimmed ? parseGraphCommand(trimmed) : null
  // A graph command wins outright; failing that, an edge list gets the first
  // row — unless the query is really a command's name that happens to read as
  // one, like "bellman-ford".
  const edgePreview = useMemo(
    () =>
      trimmed && !parseGraphCommand(trimmed) && !namesACommand(trimmed, commands)
        ? previewEdgeList(trimmed, doc)
        : null,
    [trimmed, commands, doc],
  )
  const lead = parsed || edgePreview ? 1 : 0

  const results = useMemo(() => {
    const scored = commands
      .map((command) => {
        const direct = fuzzyMatch(query, command.label)
        if (direct) return { command, ...direct }
        // Fall back to the group and description, so "weighted" still finds
        // the example called "Shortest path trap".
        const context = `${command.label} ${command.group} ${command.hint ?? ''}`
        const loose = fuzzyMatch(query, context)
        return loose ? { command, score: loose.score - 30, positions: [] } : null
      })
      .filter((entry): entry is { command: Command; score: number; positions: number[] } =>
        Boolean(entry),
      )
    scored.sort((a, b) => b.score - a.score)
    return scored.slice(0, 40)
  }, [commands, query])

  const total = results.length + lead

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({
      block: 'nearest',
    })
  }, [active, query])

  const runAt = (index: number) => {
    if (parsed && index === 0) {
      runGraphCommand(trimmed)
      setOpen(false)
      return
    }
    if (edgePreview && index === 0) {
      addTypedEdges(trimmed)
      setOpen(false)
      return
    }
    const entry = results[index - lead]
    if (!entry) return
    setOpen(false)
    entry.command.run()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[12vh]">
      <div
        className="gz-wb-backdrop fixed inset-0"
        onClick={() => setOpen(false)}
        aria-hidden
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="gz-wb-dialog gz-wb-palette gz-anim-pop relative z-10 w-full max-w-xl overflow-hidden"
      >
        <input
          autoFocus
          role="combobox"
          aria-expanded
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={total ? optionId(active) : undefined}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setActive(0)
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              setActive((i) => (total ? (i + 1) % total : 0))
            } else if (event.key === 'ArrowUp') {
              event.preventDefault()
              setActive((i) => (total ? (i - 1 + total) % total : 0))
            } else if (event.key === 'Enter') {
              event.preventDefault()
              runAt(active)
            } else if (event.key === 'Escape') {
              event.preventDefault()
              setOpen(false)
            } else if (event.key === 'Tab') {
              // The input is the only focusable thing here; keep focus inside.
              event.preventDefault()
            }
          }}
          placeholder="Search commands, or type K5, K6 w1-9 or A-B, B-C..."
          aria-label="Command search"
          className="gz-wb-palette-input"
          spellCheck={false}
        />
        <div
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label="Commands"
          className="gz-wb-palette-list gz-scroll max-h-[min(52vh,26rem)]"
        >
          {parsed && (
            <div
              id={optionId(0)}
              role="option"
              aria-selected={active === 0}
              data-active={active === 0}
              onMouseMove={() => setActive(0)}
              onClick={() => runAt(0)}
              className="gz-wb-palette-row gz-wb-palette-lead"
            >
              <SparkIcon className="shrink-0 text-[var(--gz-red-text)]" />
              <span className="flex-1">
                Generate <span className="gz-num gz-wb-palette-maths">{parsed.canonical}</span>
              </span>
              <span className="gz-wb-palette-hint">Enter</span>
            </div>
          )}
          {edgePreview && (
            <div
              id={optionId(0)}
              role="option"
              aria-selected={active === 0}
              data-active={active === 0}
              onMouseMove={() => setActive(0)}
              onClick={() => runAt(0)}
              className="gz-wb-palette-row gz-wb-palette-lead"
            >
              <EdgeIcon className="shrink-0 text-[var(--gz-red-text)]" />
              <span className="min-w-0 flex-1 truncate">
                <span className="font-medium">{edgePreview.title}</span>
                {edgePreview.notes.length > 0 && (
                  <span className="italic text-[var(--gz-muted)]">
                    {' '}
                    · {edgePreview.notes.join(' · ')}
                  </span>
                )}
              </span>
              <span className="gz-wb-palette-hint">Enter</span>
            </div>
          )}
          {results.map((entry, index) => {
            const position = index + lead
            return (
              <div
                key={entry.command.id}
                id={optionId(position)}
                role="option"
                aria-selected={position === active}
                data-active={position === active}
                onMouseMove={() => setActive(position)}
                onClick={() => runAt(position)}
                className="gz-wb-palette-row"
              >
                <span className="flex-1 truncate">
                  <LabelText
                    label={entry.command.label}
                    positions={entry.positions}
                    maths={entry.command.maths}
                  />
                </span>
                <span className="gz-wb-palette-group shrink-0">
                  {entry.command.group}
                </span>
              </div>
            )
          })}
          {total === 0 && (
            <p className="gz-wb-palette-empty">
              Nothing matches "{query}".
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
