import type { GraphDocument } from '../graph/model/types'
import {
  ImportError,
  parseGraphualizeJson,
  serializeGraph,
  toJsonString,
  type SavedGraph,
} from '../graph/serialization'

const INDEX_KEY = 'graphualize:index:v1'
const DOC_PREFIX = 'graphualize:doc:'
const SESSION_KEY = 'graphualize:session:v1'
const SESSION_VERSION = 1

export interface DocumentSummary {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  vertexCount: number
  edgeCount: number
}

const safeLocalStorage = (): Storage | null => {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null
    const probe = '__graphualize_probe__'
    window.localStorage.setItem(probe, '1')
    window.localStorage.removeItem(probe)
    return window.localStorage
  } catch {
    return null
  }
}

const readIndex = (): DocumentSummary[] => {
  const store = safeLocalStorage()
  if (!store) return []
  try {
    const raw = store.getItem(INDEX_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (entry): entry is DocumentSummary =>
        typeof entry === 'object' && entry !== null && typeof (entry as DocumentSummary).id === 'string',
    )
  } catch {
    return []
  }
}

const writeIndex = (entries: DocumentSummary[]): void => {
  const store = safeLocalStorage()
  if (!store) return
  try {
    store.setItem(INDEX_KEY, JSON.stringify(entries))
  } catch {
    /* quota exhausted; the app keeps working in memory */
  }
}

export const listDocuments = (): DocumentSummary[] =>
  readIndex().sort((a, b) => b.updatedAt - a.updatedAt)

export const loadDocument = (id: string): SavedGraph | null => {
  const store = safeLocalStorage()
  if (!store) return null
  const raw = store.getItem(DOC_PREFIX + id)
  if (!raw) return null
  try {
    return parseGraphualizeJson(raw)
  } catch (error) {
    if (error instanceof ImportError) return null
    return null
  }
}

export interface SaveInput {
  id: string
  name: string
  graph: GraphDocument
  createdAt?: number
  viewport?: SavedGraph['viewport']
}

/** Returns null when this browser will not let us write to local storage. */
export const saveDocument = (input: SaveInput): DocumentSummary | null => {
  const now = Date.now()
  const saved = serializeGraph({
    id: input.id,
    name: input.name,
    graph: input.graph,
    createdAt: input.createdAt ?? now,
    updatedAt: now,
    viewport: input.viewport,
  })
  const store = safeLocalStorage()
  const summary: DocumentSummary = {
    id: saved.id,
    name: saved.name,
    createdAt: saved.createdAt,
    updatedAt: saved.updatedAt,
    vertexCount: saved.graph.vertices.length,
    edgeCount: saved.graph.edges.length,
  }
  if (!store) return null
  try {
    store.setItem(DOC_PREFIX + saved.id, toJsonString(saved))
    const index = readIndex().filter((entry) => entry.id !== saved.id)
    index.push(summary)
    writeIndex(index)
  } catch {
    return null
  }
  return summary
}

export const deleteDocument = (id: string): void => {
  const store = safeLocalStorage()
  if (store) store.removeItem(DOC_PREFIX + id)
  writeIndex(readIndex().filter((entry) => entry.id !== id))
}

export interface SessionPayload {
  id: string
  name: string
  graph: GraphDocument
  savedId: string | null
  /** False while the name is one Graphualize chose, so it may be replaced. */
  namedByUser: boolean
}

/** The unsaved working document, restored when the tab is reopened. */
export const persistSession = (payload: SessionPayload): void => {
  const store = safeLocalStorage()
  if (!store) return
  try {
    store.setItem(SESSION_KEY, JSON.stringify({ version: SESSION_VERSION, ...payload }))
  } catch {
    /* quota exhausted; the app keeps working in memory */
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const finite = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback

/**
 * Restores the working document, discarding anything that is not exactly the
 * shape the model expects.
 *
 * This runs while the store module is being created, before React (and any
 * error boundary) exists, so it must never throw: a single malformed entry left
 * behind by an older build, another tab, or a hand-edited storage value would
 * otherwise turn the whole app into a blank page.
 */
export const restoreSession = (): SessionPayload | null => {
  const store = safeLocalStorage()
  if (!store) return null
  try {
    const raw = store.getItem(SESSION_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (!isRecord(parsed)) return null
    if (parsed.version !== undefined && parsed.version !== SESSION_VERSION) return null

    const graph = parsed.graph
    if (!isRecord(graph) || !Array.isArray(graph.vertices) || !Array.isArray(graph.edges)) {
      return null
    }

    const seenVertices = new Set<string>()
    const vertices = graph.vertices.flatMap((candidate, index) => {
      if (!isRecord(candidate) || typeof candidate.id !== 'string') return []
      if (seenVertices.has(candidate.id)) return []
      seenVertices.add(candidate.id)
      return [
        {
          id: candidate.id,
          label: typeof candidate.label === 'string' ? candidate.label : String(index + 1),
          x: finite(candidate.x, 0),
          y: finite(candidate.y, 0),
        },
      ]
    })

    const seenEdges = new Set<string>()
    const edges = graph.edges.flatMap((candidate) => {
      if (!isRecord(candidate)) return []
      const { id, source, target } = candidate
      if (typeof id !== 'string' || typeof source !== 'string' || typeof target !== 'string') {
        return []
      }
      if (seenEdges.has(id) || !seenVertices.has(source) || !seenVertices.has(target)) return []
      seenEdges.add(id)
      const weight =
        typeof candidate.weight === 'number' && Number.isFinite(candidate.weight)
          ? candidate.weight
          : undefined
      return [weight === undefined ? { id, source, target } : { id, source, target, weight }]
    })

    return {
      id: typeof parsed.id === 'string' ? parsed.id : 'session',
      name: typeof parsed.name === 'string' ? parsed.name : 'Untitled graph',
      graph: {
        vertices,
        edges,
        directed: Boolean(graph.directed),
        weighted: Boolean(graph.weighted),
      },
      savedId: typeof parsed.savedId === 'string' ? parsed.savedId : null,
      // Sessions written before this flag existed are treated as named by the
      // user whenever the name is not the default, so nothing is renamed under
      // someone who chose a title.
      namedByUser:
        typeof parsed.namedByUser === 'boolean'
          ? parsed.namedByUser
          : typeof parsed.name === 'string' && parsed.name !== 'Untitled graph',
    }
  } catch {
    return null
  }
}

export const clearSession = (): void => {
  const store = safeLocalStorage()
  if (store) store.removeItem(SESSION_KEY)
}
