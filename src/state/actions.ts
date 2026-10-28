import { useEditor } from './store'
import { GeneratorError, generate, generatorById } from '../graph/generators'
import { parseGraphCommand } from '../graph/generators/commands'
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
 */
export const applyGenerator = (
  id: string,
  params: Record<string, number>,
  seed = 1,
  weights?: EdgeWeighting | null,
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
export const runGraphCommand = (input: string, seed = 1): boolean => {
  const parsed = parseGraphCommand(input)
  if (!parsed) return false
  return applyGenerator(parsed.generatorId, parsed.params, seed, parsed.weights)
}

export const applyTransformById = (id: string): boolean => {
  const state = useEditor.getState()
  try {
    const result = runTransform(id, state.graph, {
      selectedVertices: state.selectedVertices,
      selectedEdges: state.selectedEdges,
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
