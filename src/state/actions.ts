import { useEditor } from './store'
import { GeneratorError, generate, generatorById } from '../graph/generators'
import { parseGraphCommand } from '../graph/generators/commands'
import { freshSeed } from '../graph/generators/random'
import { describeWeighting, type EdgeWeighting } from '../graph/generators/weights'
import { applyTransform as runTransform, TransformError } from '../graph/transformations'
import { exampleById } from '../graph/examples'
import {
  ImportError,
  parseAnyGraphText,
  toAdjacencyList,
  toAdjacencyMatrixText,
  toDot,
  toEdgeListCsv,
  toGraphml,
  toJsonString,
  serializeGraph,
} from '../graph/serialization'
import type { GraphDocument } from '../graph/model/types'
import {
  applyEdgeListPlan,
  parseEdgeList,
  planEdgeList,
  type EdgeListPlan,
  type ParsedEdgeList,
} from '../graph/model/builder'
import { getCanvasInstance } from '../canvas/instance'

const MAX_GENERATED_ELEMENTS = 4000

/**
 * Turns a generator's shape name into the concrete one, so the status bar says
 * "Generated W6" rather than "Generated Wn".
 */
const generatorLabel = (shortName: string, params: Record<string, number>): string => {
  let label = shortName
  for (const key of Object.keys(params).sort((a, b) => b.length - a.length)) {
    const value = params[key]
    if (value === undefined) continue
    // Placeholders are lowercase and often sit right after the family letter
    // ("Cn", "Km,n", "G(n,p)"), so only neighbouring lowercase letters block a
    // substitution.
    label = label.replace(new RegExp(`(?<![a-z])${key}(?![a-z])`, 'g'), String(value))
  }
  return label
}

/**
 * `weights` decides the new graph's weighted mode: leave it out to keep the
 * document's (weight 1 on every edge when weighted, as always), pass `null`
 * for an unweighted graph, or pass a scheme for a weighted one.
 *
 * Every call draws a fresh seed, so generating a random family (or random
 * weights) again gives a new graph. Only tests pass `seed`.
 */
export const applyGenerator = (
  id: string,
  params: Record<string, number>,
  weights?: EdgeWeighting | null,
  seed: number = freshSeed(),
): boolean => {
  const state = useEditor.getState()
  const def = generatorById(id)
  if (!def) {
    state.notify(`Unknown generator "${id}".`, 'error')
    return false
  }
  const estimate = def.estimateSize?.(params)
  if (estimate && estimate.vertices + estimate.edges > MAX_GENERATED_ELEMENTS) {
    state.notify(
      `${def.shortName} would need ${estimate.vertices} vertices and ${estimate.edges} edges, which is too large to draw smoothly.`,
      'error',
    )
    return false
  }
  const weighted = weights === undefined ? state.doc.weighted : weights !== null
  try {
    const doc = generate(id, params, {
      seed,
      directed: state.doc.directed,
      weighted,
      weights: weights ?? undefined,
    })
    const label = generatorLabel(def.shortName, params)
    state.replaceDocument(
      { ...doc, directed: state.doc.directed, weighted },
      `Generate ${label}`,
      { title: label },
    )
    state.notify(
      weights ? `Generated ${label} with ${describeWeighting(weights)}` : `Generated ${label}`,
      'success',
    )
    return true
  } catch (error) {
    state.notify(
      error instanceof GeneratorError ? error.message : 'That graph could not be generated.',
      'error',
    )
    return false
  }
}

/** Handles the quick-input syntax: `K5`, `C8`, `K3,4`, `G(20,0.2)`, `K6 w1-9`, ... */
export const runGraphCommand = (input: string, seed?: number): boolean => {
  const parsed = parseGraphCommand(input)
  if (!parsed) return false
  return applyGenerator(parsed.generatorId, parsed.params, parsed.weights, seed)
}

/**
 * `done`: it happened. `failed`: the input was understood, but could not be
 * carried out, and the status bar already says why. `unrecognised`: it is
 * neither a graph command nor an edge list, and nothing has been said yet.
 */
export type QuickInputOutcome = 'done' | 'failed' | 'unrecognised'

/**
 * More edges than this is a file rather than something typed, and File →
 * Import reads edge lists of any length.
 */
const MAX_TYPED_EDGES = 500

/**
 * The most vertices {@link MAX_TYPED_EDGES} edges can name. Bare labels are
 * not edges, so without this `A-B, x0, x1, …, x4999` would get past the edge
 * cap and leave thousands of new vertices to lay out at once.
 */
const MAX_TYPED_LABELS = 2 * MAX_TYPED_EDGES

/** Why `parsed` is too long for the quick box, or null when it fits. */
const tooLongToType = (parsed: ParsedEdgeList): string | null =>
  parsed.edges.length > MAX_TYPED_EDGES
    ? `That is ${parsed.edges.length} edges, more than the quick box takes. Use File → Import for long edge lists.`
    : parsed.labels.length > MAX_TYPED_LABELS
      ? `That names ${parsed.labels.length} vertices, more than the quick box takes. Use File → Import for long lists.`
      : null

const counted = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

const listed = (items: readonly string[]): string =>
  items.length <= 1
    ? (items[0] ?? '')
    : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`

/** "A–B and B–C", or a count once naming them all would not fit a status bar. */
const skippedEdges = (names: readonly string[]): string =>
  names.length <= 3 ? listed(names) : counted(names.length, 'edge')

const quoted = (labels: readonly string[]) => listed(labels.map((label) => `“${label}”`))

const edgeListLabel = (plan: EdgeListPlan): string =>
  plan.newEdges.length
    ? `Add ${counted(plan.newEdges.length, 'edge')}`
    : `Add ${counted(plan.newVertices.length, 'vertex', 'vertices')}`

/** The status-bar report of an edge list that has been added. */
const describeAdded = (plan: EdgeListPlan): string => {
  const edges = plan.newEdges.length
  const vertices = plan.newVertices.length
  const added =
    edges && vertices
      ? `Added ${counted(edges, 'edge')} and ${counted(vertices, 'vertex', 'vertices')}`
      : edges
        ? `Added ${counted(edges, 'edge')}`
        : vertices
          ? `Added ${counted(vertices, 'vertex', 'vertices')}`
          : 'Nothing added'
  const notes: string[] = []
  if (plan.switchedToDirected) notes.push('Switched to directed for the arrows.')
  if (plan.enabledWeights) notes.push('Turned on weights.')
  if (plan.arrowsIgnored) {
    notes.push(
      'The graph is undirected, so arrows are read as plain edges; switch on Directed for arcs.',
    )
  }
  if (plan.duplicates.length) {
    notes.push(`Skipped ${skippedEdges(plan.duplicates)}, already in the graph.`)
  }
  if (plan.ambiguous.length) {
    notes.push(
      `${quoted(plan.ambiguous)} matched more than one vertex up to case, so ${
        plan.ambiguous.length === 1 ? 'it is a new vertex' : 'they are new vertices'
      }.`,
    )
  }
  return notes.length ? `${added}. ${notes.join(' ')}` : added
}

export interface EdgeListPreview {
  /** Null when the list is too long for the quick box, so it was never planned. */
  plan: EdgeListPlan | null
  /** What pressing Enter would do: "Add 3 edges, 1 new vertex". */
  title: string
  /** Side effects worth knowing before pressing it, each a short phrase. */
  notes: string[]
}

/**
 * What typing `input` would add to `doc`, without adding it — the command
 * palette's first row. Null when `input` is not an edge list.
 */
export const previewEdgeList = (
  input: string,
  doc: GraphDocument = useEditor.getState().doc,
): EdgeListPreview | null => {
  const parsed = parseEdgeList(input)
  if (!parsed) return null
  // This runs on every keystroke, so a pasted file is turned away before it is
  // planned; Enter then reports it as `addTypedEdges` does.
  if (tooLongToType(parsed)) {
    return { plan: null, title: 'Too long for the quick box', notes: ['use File → Import'] }
  }
  const plan = planEdgeList(doc, parsed)
  const edges = plan.newEdges.length
  const vertices = plan.newVertices.length
  const created = counted(vertices, 'new vertex', 'new vertices')
  const title = edges
    ? `Add ${counted(edges, 'edge')}${vertices ? `, ${created}` : ''}`
    : vertices
      ? `Add ${created}`
      : 'Nothing to add'
  const notes: string[] = []
  if (plan.switchedToDirected) notes.push('switches to directed')
  if (plan.enabledWeights) notes.push('turns on weights')
  if (plan.arrowsIgnored) notes.push('arrows read as plain edges')
  if (plan.duplicates.length) notes.push(`${skippedEdges(plan.duplicates)} already there`)
  if (plan.ambiguous.length) {
    notes.push(`${quoted(plan.ambiguous)} ${plan.ambiguous.length === 1 ? 'is' : 'are'} ambiguous`)
  }
  return { plan, title, notes }
}

/** The middle and extent of what the canvas shows, in graph coordinates. */
const visibleArea = () => {
  const instance = getCanvasInstance()
  if (!instance) return null
  const extent = instance.extent()
  return {
    centre: { x: (extent.x1 + extent.x2) / 2, y: (extent.y1 + extent.y2) / 2 },
    contains: (p: { x: number; y: number }, margin = 24) =>
      p.x - margin >= extent.x1 &&
      p.x + margin <= extent.x2 &&
      p.y - margin >= extent.y1 &&
      p.y + margin <= extent.y2,
  }
}

/**
 * Adds a typed edge list — `A-B, B-C`, `a->b->c`, `A-B:4` — to the graph on
 * screen as one undo step, and reports the result in the status bar.
 *
 * `parseEdgeList` defines the syntax and `planEdgeList` how labels, arrows,
 * weights and duplicates are treated. This is an edit, not a replacement: the
 * graph keeps its name and its saved entry. What was added is selected, and
 * the view only refits when a new vertex landed somewhere off screen.
 */
export const addTypedEdges = (input: string): QuickInputOutcome => {
  const state = useEditor.getState()
  const parsed = parseEdgeList(input)
  if (!parsed) return 'unrecognised'
  const tooLong = tooLongToType(parsed)
  if (tooLong) {
    state.notify(tooLong, 'error')
    return 'failed'
  }

  const plan = planEdgeList(state.doc, parsed)
  if (!plan.newEdges.length && !plan.newVertices.length) {
    state.notify(describeAdded(plan))
    return 'done'
  }

  const view = visibleArea()
  const result = applyEdgeListPlan(state.doc, plan, { anchor: view?.centre })
  const created = new Set(result.vertexIds)
  const offScreen = result.document.vertices.some(
    (v) => created.has(v.id) && !(view?.contains(v) ?? false),
  )
  state.replaceDocument(result.document, edgeListLabel(plan), { relayout: offScreen })
  state.select(result.vertexIds, result.edgeIds)
  state.notify(describeAdded(plan), 'success')
  return 'done'
}

/**
 * The inspector's quick box. A graph command always wins — `K5` is the
 * complete graph, never a vertex called "K5" — and anything else is tried as
 * an edge list to add to the current graph.
 */
export const runQuickInput = (input: string): QuickInputOutcome => {
  if (parseGraphCommand(input)) return runGraphCommand(input) ? 'done' : 'failed'
  return addTypedEdges(input)
}

export const applyTransformById = (id: string): boolean => {
  const state = useEditor.getState()
  try {
    const result = runTransform(id, state.graph, {
      selectedVertices: state.selectedVertices,
      selectedEdges: state.selectedEdges,
      seed: freshSeed(),
    })
    state.replaceDocument(result.document, result.summary, { relayout: result.relayout })
    state.notify(result.summary, 'success')
    return true
  } catch (error) {
    state.notify(
      error instanceof TransformError ? error.message : 'That transformation failed.',
      'error',
    )
    return false
  }
}

export const loadExample = (id: string): boolean => {
  const state = useEditor.getState()
  const example = exampleById(id)
  if (!example) return false
  const doc = example.build()
  state.replaceDocument(doc, `Open example: ${example.name}`, { title: example.name })
  state.notify(`Loaded "${example.name}"`, 'success')
  return true
}

export type ExportFormat =
  | 'json'
  | 'adjacency-list'
  | 'adjacency-matrix'
  | 'edge-csv'
  | 'dot'
  | 'graphml'

export const EXPORT_LABELS: Record<ExportFormat, string> = {
  json: 'Graphualize JSON',
  'adjacency-list': 'Adjacency list',
  'adjacency-matrix': 'Adjacency matrix',
  'edge-csv': 'Edge list (CSV)',
  dot: 'Graphviz DOT',
  graphml: 'GraphML',
}

export const EXPORT_EXTENSIONS: Record<ExportFormat, string> = {
  json: 'json',
  'adjacency-list': 'txt',
  'adjacency-matrix': 'txt',
  'edge-csv': 'csv',
  dot: 'dot',
  graphml: 'graphml',
}

export const exportText = (format: ExportFormat): string => {
  const state = useEditor.getState()
  const graph = state.graph
  switch (format) {
    case 'json':
      return toJsonString(
        serializeGraph({ id: state.docId, name: state.name, graph: state.doc }),
      )
    case 'adjacency-list':
      return toAdjacencyList(graph)
    case 'adjacency-matrix':
      return toAdjacencyMatrixText(graph)
    case 'edge-csv':
      return toEdgeListCsv(graph)
    case 'dot':
      return toDot(graph, state.name)
    case 'graphml':
      return toGraphml(graph)
  }
}

export interface ImportOutcome {
  ok: boolean
  message: string
  warnings: string[]
}

export const importText = (text: string): ImportOutcome => {
  const state = useEditor.getState()
  const trimmed = text.trim()
  if (!trimmed) return { ok: false, message: 'Nothing to import.', warnings: [] }
  try {
    const parsed = parseAnyGraphText(trimmed)
    const doc: GraphDocument = parsed.document
    state.replaceDocument(doc, 'Import graph', { title: parsed.name ?? 'Imported graph' })
    return {
      ok: true,
      message: `Imported ${doc.vertices.length} vertices and ${doc.edges.length} edges from ${parsed.format}.`,
      warnings: parsed.warnings,
    }
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof ImportError
          ? error.message
          : 'That text could not be read as a graph.',
      warnings: [],
    }
  }
}

export const downloadText = (filename: string, text: string): void => {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export const copyToClipboard = async (text: string): Promise<boolean> => {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}
