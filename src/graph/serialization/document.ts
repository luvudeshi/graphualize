/**
 * The Graphualize saved-file format, and the reader that accepts it.
 *
 * A saved file is JSON with a small envelope (`format`, `version`, identity
 * and timestamps) wrapped around a plain {@link GraphDocument}. The envelope
 * exists so that a file found on disk years from now can still be recognised
 * and migrated instead of silently mis-read.
 *
 * The reader is deliberately forgiving about *missing* information — absent
 * coordinates, labels or ids are filled in — and deliberately strict about
 * *contradictory* information: a vertex with no id, an edge pointing at a
 * vertex that is not in the file, or a coordinate of `NaN` all raise an
 * {@link ImportError} carrying a sentence a human can act on. Nothing in this
 * module is ever allowed to escape as a raw `SyntaxError` from `JSON.parse`.
 */

import { circleLayout } from '../layout'
import { labelForIndex, nextEdgeId, nextVertexId } from '../model/ids'
import type { Edge, GraphDocument, Vertex, VertexId } from '../model/types'

/** Bumped whenever the on-disk shape changes in a way the reader must know about. */
export const GRAPHUALIZE_FORMAT_VERSION = 2

export interface SavedGraph {
  format: 'graphualize'
  version: number
  id: string
  name: string
  createdAt: number
  updatedAt: number
  graph: GraphDocument
  viewport?: { zoom: number; pan: { x: number; y: number } }
  notes?: string
}

export interface SerializeInput {
  id: string
  name: string
  graph: GraphDocument
  createdAt?: number
  updatedAt?: number
  viewport?: SavedGraph['viewport']
  notes?: string
}

/**
 * Raised for every input a human could plausibly hand us that we cannot read.
 * The message is always a complete sentence naming the offending part of the
 * file, because it is shown verbatim in the import dialog.
 */
export class ImportError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ImportError'
  }
}

/* ------------------------------------------------------------------ */
/* Writing                                                             */
/* ------------------------------------------------------------------ */

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

const cloneDocument = (doc: GraphDocument): GraphDocument => ({
  vertices: doc.vertices.map((v) => ({ ...v })),
  edges: doc.edges.map((e) => ({ ...e })),
  directed: doc.directed,
  weighted: doc.weighted,
})

const cleanViewport = (raw: unknown): SavedGraph['viewport'] => {
  if (!isRecord(raw)) return undefined
  const pan = isRecord(raw.pan) ? raw.pan : undefined
  const zoom = readNumber(raw.zoom)
  const x = readNumber(pan?.x)
  const y = readNumber(pan?.y)
  if (!isFiniteNumber(zoom) || !isFiniteNumber(x) || !isFiniteNumber(y)) return undefined
  return { zoom, pan: { x, y } }
}

/**
 * Wraps a document in the save envelope. The graph is deep-copied, so later
 * edits to the live document cannot mutate an already-serialized snapshot.
 */
export const serializeGraph = (input: SerializeInput): SavedGraph => {
  const now = Date.now()
  const createdAt = isFiniteNumber(input.createdAt) ? input.createdAt : now
  const updatedAt = isFiniteNumber(input.updatedAt) ? input.updatedAt : now
  const saved: SavedGraph = {
    format: 'graphualize',
    version: GRAPHUALIZE_FORMAT_VERSION,
    id: input.id,
    name: input.name,
    createdAt,
    updatedAt,
    graph: cloneDocument(input.graph),
  }
  const viewport = cleanViewport(input.viewport)
  if (viewport) saved.viewport = viewport
  if (typeof input.notes === 'string' && input.notes !== '') saved.notes = input.notes
  return saved
}

/** Pretty printed with a 2-space indent, which is what we write to disk. */
export const toJsonString = (saved: SavedGraph): string => JSON.stringify(saved, null, 2)

/* ------------------------------------------------------------------ */
/* Reading                                                             */
/* ------------------------------------------------------------------ */

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** `undefined` when absent, the trimmed text otherwise. Numbers are accepted. */
const readString = (value: unknown): string | undefined => {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed === '' ? undefined : trimmed
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return undefined
}

/** `undefined` when absent, `null` when present but not a finite number. */
const readNumber = (value: unknown): number | null | undefined => {
  if (value === undefined || value === null) return undefined
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed === '') return undefined
    const parsed = Number(trimmed)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

const readBoolean = (value: unknown): boolean | undefined => {
  if (typeof value === 'boolean') return value
  if (value === 'true') return true
  if (value === 'false') return false
  return undefined
}

/** Deterministic stand-in id for files that never had one. Never random. */
const hashText = (text: string): string => {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36)
}

const firstDefined = (source: Record<string, unknown>, keys: readonly string[]): unknown => {
  for (const key of keys) {
    const value = source[key]
    if (value !== undefined && value !== null) return value
  }
  return undefined
}

interface DraftVertex {
  id: VertexId
  label: string
  x?: number
  y?: number
}

const readVertices = (raw: unknown): DraftVertex[] => {
  if (raw === undefined || raw === null) return []
  if (!Array.isArray(raw)) {
    throw new ImportError('The vertex list in this file is not an array, so the graph cannot be read.')
  }
  const used = new Set<string>()
  const drafts: DraftVertex[] = []
  raw.forEach((entry, index) => {
    const position = index + 1
    if (!isRecord(entry)) {
      throw new ImportError(`Vertex at position ${position} is not an object, so it cannot be read.`)
    }
    const rawId = readString(firstDefined(entry, ['id', 'vertexId', 'key']))
    if (rawId === undefined) {
      // Edges address vertices by id, so a missing id is not recoverable:
      // inventing one here would silently orphan every edge that meant to
      // point at this vertex. Colliding ids *are* repaired, just below.
      throw new ImportError(
        `Vertex at position ${position} has no id, so the edges in this file could not be matched to it.`,
      )
    }
    const label = readString(firstDefined(entry, ['label', 'name'])) ?? labelForIndex(index)
    const nested = isRecord(entry.position) ? entry.position : undefined
    const x = readNumber(firstDefined(entry, ['x']) ?? nested?.x)
    const y = readNumber(firstDefined(entry, ['y']) ?? nested?.y)
    if (x === null) {
      throw new ImportError(`Vertex "${label}" has an x coordinate that is not a finite number.`)
    }
    if (y === null) {
      throw new ImportError(`Vertex "${label}" has a y coordinate that is not a finite number.`)
    }
    // A duplicate id keeps the *first* vertex addressable; the later twin is
    // renamed, which means edges naming that id attach to the first vertex.
    const id = used.has(rawId) ? nextVertexId() : rawId
    used.add(id)
    drafts.push({ id, label, x, y })
  })
  return drafts
}

const readEdges = (raw: unknown, vertexIds: ReadonlySet<VertexId>): Edge[] => {
  if (raw === undefined || raw === null) return []
  if (!Array.isArray(raw)) {
    throw new ImportError('The edge list in this file is not an array, so the graph cannot be read.')
  }
  const used = new Set<string>()
  const edges: Edge[] = []
  raw.forEach((entry, index) => {
    const position = index + 1
    if (!isRecord(entry)) {
      throw new ImportError(`Edge at position ${position} is not an object, so it cannot be read.`)
    }
    const rawId = readString(entry.id)
    const describe = rawId === undefined ? `Edge at position ${position}` : `Edge "${rawId}"`
    const source = readString(firstDefined(entry, ['source', 'from', 'src', 'u']))
    const target = readString(firstDefined(entry, ['target', 'to', 'dst', 'v']))
    if (source === undefined) throw new ImportError(`${describe} is missing a source vertex.`)
    if (target === undefined) throw new ImportError(`${describe} is missing a target vertex.`)
    if (!vertexIds.has(source)) {
      throw new ImportError(`${describe} refers to a vertex "${source}" that is not in this file.`)
    }
    if (!vertexIds.has(target)) {
      throw new ImportError(`${describe} refers to a vertex "${target}" that is not in this file.`)
    }
    const weight = readNumber(firstDefined(entry, ['weight', 'value', 'cost']))
    if (weight === null) {
      throw new ImportError(`${describe} has a weight that is not a finite number.`)
    }
    const id = rawId === undefined || used.has(rawId) ? nextEdgeId() : rawId
    used.add(id)
    const edge: Edge = { id, source, target }
    if (weight !== undefined) edge.weight = weight
    edges.push(edge)
  })
  return edges
}

const readDocument = (section: Record<string, unknown>): GraphDocument => {
  const drafts = readVertices(firstDefined(section, ['vertices', 'nodes']))
  const ids = new Set(drafts.map((v) => v.id))
  const edges = readEdges(firstDefined(section, ['edges', 'links']), ids)

  // Files written by other tools routinely omit coordinates; a circle is the
  // one layout that is readable for any graph without knowing its structure.
  const fallback = circleLayout(drafts.map((v) => v.id))
  const vertices: Vertex[] = drafts.map((draft) => {
    const spot = fallback[draft.id] ?? { x: 0, y: 0 }
    return {
      id: draft.id,
      label: draft.label,
      x: draft.x ?? spot.x,
      y: draft.y ?? spot.y,
    }
  })

  const weighted =
    readBoolean(section.weighted) ??
    edges.some((e) => e.weight !== undefined && e.weight !== 1)

  return {
    vertices,
    edges,
    directed: readBoolean(section.directed) ?? false,
    weighted,
  }
}

/**
 * Reads a `.graphualize.json` file.
 *
 * Accepts both version 1 (no `viewport`/`notes`, and possibly `nodes`/`links`
 * instead of `vertices`/`edges`) and version 2 payloads, and always returns a
 * version 2 {@link SavedGraph}. Anything else throws an {@link ImportError}
 * whose message is safe to show to the user.
 */
export const parseGraphualizeJson = (text: string): SavedGraph => {
  if (typeof text !== 'string' || text.trim() === '') {
    throw new ImportError('There is nothing to import — the file is empty.')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(text) as unknown
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new ImportError(
      `This file is not valid JSON, so it cannot be a Graphualize graph (${detail}).`,
    )
  }

  if (!isRecord(parsed)) {
    throw new ImportError('This file does not contain a JSON object, so it is not a Graphualize graph.')
  }

  const format = readString(parsed.format)
  if (format === undefined) {
    throw new ImportError('This file is not a Graphualize graph: its "format" field is missing.')
  }
  if (format.toLowerCase() !== 'graphualize') {
    throw new ImportError(
      `This file is not a Graphualize graph: its "format" field says "${format}" instead of "graphualize".`,
    )
  }

  const rawVersion = readNumber(parsed.version)
  if (rawVersion === null) {
    throw new ImportError('This file\'s "version" field is not a number, so its format cannot be identified.')
  }
  const version = rawVersion === undefined ? 1 : Math.floor(rawVersion)
  if (version > GRAPHUALIZE_FORMAT_VERSION) {
    throw new ImportError(
      `This file was written by a newer version of Graphualize (format version ${version}); ` +
        `this build can read up to version ${GRAPHUALIZE_FORMAT_VERSION}.`,
    )
  }

  const graphRaw = firstDefined(parsed, ['graph', 'document'])
  let section: Record<string, unknown>
  if (isRecord(graphRaw)) {
    section = graphRaw
  } else if (graphRaw !== undefined) {
    throw new ImportError('This file\'s "graph" section is not an object, so there is nothing to import.')
  } else if (parsed.vertices !== undefined || parsed.nodes !== undefined) {
    // Very early files kept the vertex and edge lists at the top level.
    section = parsed
  } else {
    throw new ImportError('This file has no "graph" section, so there is nothing to import.')
  }

  const graph = readDocument(section)
  const now = Date.now()
  const createdAt = readNumber(parsed.createdAt)
  const updatedAt = readNumber(parsed.updatedAt)

  const saved: SavedGraph = {
    format: 'graphualize',
    version: GRAPHUALIZE_FORMAT_VERSION,
    id: readString(parsed.id) ?? `graph-${hashText(text)}`,
    name: readString(parsed.name) ?? 'Untitled graph',
    createdAt: isFiniteNumber(createdAt) ? createdAt : now,
    updatedAt: isFiniteNumber(updatedAt) ? updatedAt : now,
    graph,
  }

  const viewport = cleanViewport(parsed.viewport)
  if (viewport) saved.viewport = viewport
  if (typeof parsed.notes === 'string' && parsed.notes !== '') saved.notes = parsed.notes
  return saved
}
