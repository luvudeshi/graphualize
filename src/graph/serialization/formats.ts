/**
 * Import and export for the plain-text interchange formats: adjacency lists,
 * adjacency matrices, CSV edge lists, DOT and GraphML.
 *
 * Exporters take a {@link Graph} and return a string. Importers take a string
 * and return a {@link ParseResult}: a fresh {@link GraphDocument} plus the
 * warnings a human should see about what was lost or guessed. Importers never
 * silently discard information — anything skipped is named in `warnings`, and
 * anything unreadable raises {@link ImportError}.
 *
 * Conventions shared by every importer:
 *  - Vertices and edges get fresh ids from the model's id generator.
 *  - Vertices are laid out on a circle, because the text formats carry no
 *    geometry and a circle is legible for any graph.
 *  - `weighted` is set only when a weight other than 1 actually appeared, so
 *    an unweighted file never turns the app into weighted mode.
 *  - A repeated edge is dropped with a warning rather than becoming a
 *    parallel edge. The one exception is the *reciprocal* entry of a
 *    symmetric format (`A: B` together with `B: A` in an undirected adjacency
 *    list or matrix), which is the expected encoding and is merged silently.
 */

import { circleLayout } from '../layout'
import type { Graph } from '../model/graph'
import { labelForIndex, nextEdgeId, nextVertexId } from '../model/ids'
import type { Edge, EdgeId, GraphDocument, Vertex, VertexId } from '../model/types'
import { ImportError, parseGraphualizeJson } from './document'

export interface ParseResult {
  document: GraphDocument
  warnings: string[]
  /** The name carried by the file, when the format records one. */
  name?: string
}

export interface ParseOptions {
  directed?: boolean
}

export interface MatrixTextOptions {
  delimiter?: string
  withHeaders?: boolean
}

/** Format ids returned by {@link parseAnyGraphText}. */
export type TextFormat =
  | 'graphualize'
  | 'dot'
  | 'adjacency-matrix'
  | 'edge-list-csv'
  | 'adjacency-list'

/* ------------------------------------------------------------------ */
/* Shared helpers                                                      */
/* ------------------------------------------------------------------ */

/** Prints 3 rather than "3", and 1.5 rather than 1.5000000000000002. */
const formatNumber = (value: number): string => {
  if (Number.isInteger(value)) return String(value)
  return String(Number(value.toFixed(6)))
}

/** Non-empty lines with `#` and `//` comments removed. */
const contentLines = (text: string): string[] =>
  text
    .split(/\r?\n/)
    .map((line) => line.replace(/(^|\s)(#|\/\/).*$/, '$1').trim())
    .filter((line) => line !== '')

const isNumericToken = (token: string): boolean =>
  token !== '' && Number.isFinite(Number(token))

/* ------------------------------------------------------------------ */
/* Document assembly                                                   */
/* ------------------------------------------------------------------ */

/**
 * Collects vertices and edges keyed by whatever string the source format uses
 * as an identity (a label, a DOT node id, a matrix row number), then produces
 * a laid-out document. Every importer funnels through this so that ids,
 * layout, weighted-detection and duplicate handling behave identically.
 */
const createAssembler = (directed: boolean) => {
  const vertices: Vertex[] = []
  const idByKey = new Map<string, VertexId>()
  const labelById = new Map<VertexId, string>()
  const edges: Edge[] = []
  const seen = new Map<string, Set<string>>()
  const warnings: string[] = []

  const vertexFor = (key: string, label?: string): VertexId => {
    const existing = idByKey.get(key)
    if (existing !== undefined) return existing
    const id = nextVertexId()
    const text = label ?? key
    idByKey.set(key, id)
    labelById.set(id, text)
    vertices.push({ id, label: text, x: 0, y: 0 })
    return id
  }

  const setLabel = (key: string, label: string): void => {
    const id = vertexFor(key)
    labelById.set(id, label)
    const vertex = vertices.find((candidate) => candidate.id === id)
    if (vertex) vertex.label = label
  }

  const labelOf = (id: VertexId): string => labelById.get(id) ?? id

  /**
   * Adds an edge unless it repeats one already present. `symmetricInput` says
   * that the source format lists undirected edges from both endpoints, so the
   * mirrored entry is expected rather than a mistake.
   */
  const addEdge = (
    sourceKey: string,
    targetKey: string,
    weight?: number,
    symmetricInput = false,
  ): boolean => {
    const source = vertexFor(sourceKey)
    const target = vertexFor(targetKey)
    const orientation = `${source}|${target}`
    const key = directed || source <= target ? orientation : `${target}|${source}`
    const orientations = seen.get(key)
    if (orientations) {
      if (!directed && symmetricInput && !orientations.has(orientation)) {
        orientations.add(orientation)
        return false
      }
      warnings.push(
        `Duplicate edge ${labelOf(source)}${directed ? '->' : '-'}${labelOf(target)} was ignored.`,
      )
      return false
    }
    seen.set(key, new Set([orientation]))
    const edge: Edge = { id: nextEdgeId(), source, target }
    if (weight !== undefined) edge.weight = weight
    edges.push(edge)
    return true
  }

  const warn = (message: string): void => {
    if (!warnings.includes(message)) warnings.push(message)
  }

  const finish = (): ParseResult => {
    const positions = circleLayout(vertices.map((v) => v.id))
    const weighted = edges.some((e) => e.weight !== undefined && e.weight !== 1)
    if (!weighted) for (const edge of edges) delete edge.weight
    return {
      document: {
        vertices: vertices.map((v) => {
          const spot = positions[v.id] ?? { x: 0, y: 0 }
          return { id: v.id, label: v.label, x: spot.x, y: spot.y }
        }),
        edges,
        directed,
        weighted,
      },
      warnings,
    }
  }

  return { vertexFor, setLabel, addEdge, warn, finish }
}

/* ------------------------------------------------------------------ */
/* Adjacency list                                                      */
/* ------------------------------------------------------------------ */

/**
 * One line per vertex: `A: B, C, D`, and `E:` for an isolated vertex. In a
 * weighted graph each neighbour carries its weight, `A: B(3), C(1.5)`. A
 * directed graph lists only successors; an undirected graph lists every
 * neighbour, so each edge appears on both of its endpoints' lines.
 */
export const toAdjacencyList = (g: Graph): string => {
  const lines: string[] = []
  for (const vertex of g.vertices) {
    const used = new Set<EdgeId>()
    const entries: { index: number; text: string }[] = []
    for (const incidence of g.successors(vertex.id)) {
      // An undirected self-loop is stored on both ends of the same edge.
      if (!g.directed) {
        if (used.has(incidence.edgeId)) continue
        used.add(incidence.edgeId)
      }
      const label = g.label(incidence.to)
      entries.push({
        index: g.index(incidence.to),
        text: g.weighted ? `${label}(${formatNumber(incidence.weight)})` : label,
      })
    }
    entries.sort((a, b) => a.index - b.index)
    const head = g.label(vertex.id)
    lines.push(entries.length === 0 ? `${head}:` : `${head}: ${entries.map((e) => e.text).join(', ')}`)
  }
  return lines.join('\n')
}

const NEIGHBOUR_WITH_WEIGHT = /^(.+?)\s*(?:\(([^)]*)\)|\[([^\]]*)\]|[:=]([^:=]*))$/

const splitNeighbour = (token: string): { name: string; weight?: number } => {
  const match = NEIGHBOUR_WITH_WEIGHT.exec(token)
  if (!match) return { name: token }
  const raw = match[2] ?? match[3] ?? match[4] ?? ''
  const weight = Number(raw.trim())
  if (raw.trim() === '' || !Number.isFinite(weight)) return { name: token }
  return { name: match[1], weight }
}

const ADJACENCY_ARROW = /^\s*(.+?)\s*(?:-->|->|=>)\s*(.*)$/

/**
 * Reads `A: B C D`, `A: B,C,D`, `A B C D` and `A -> B, C`, with optional
 * `B(3)`, `B[3]` or `B:3` weights. Blank lines and `#` / `//` comments are
 * skipped. When the text uses arrows and the caller did not say otherwise,
 * the graph is taken to be directed.
 */
export const parseAdjacencyList = (text: string, opts: ParseOptions = {}): ParseResult => {
  const lines = contentLines(text)
  if (lines.length === 0) {
    throw new ImportError('There is nothing to import — the adjacency list has no lines.')
  }

  const usesArrows = lines.some((line) => ADJACENCY_ARROW.test(line))
  const directed = opts.directed ?? usesArrows
  const assembler = createAssembler(directed)

  for (const line of lines) {
    let source: string
    let rest: string
    const arrow = ADJACENCY_ARROW.exec(line)
    if (arrow) {
      source = arrow[1].trim()
      rest = arrow[2]
    } else {
      const colon = line.indexOf(':')
      // The separating colon is the one attached to the first token. When a
      // label contains a space ("New York: B") we still accept it as long as
      // it is the only colon on the line.
      const separates =
        colon >= 0 &&
        (!/[\s,]/.test(line.slice(0, colon)) || line.indexOf(':', colon + 1) < 0)
      if (separates) {
        source = line.slice(0, colon).trim()
        rest = line.slice(colon + 1)
      } else {
        const parts = line.split(/[\s,]+/).filter(Boolean)
        source = parts[0] ?? ''
        rest = parts.slice(1).join(' ')
      }
    }
    if (source === '') continue

    assembler.vertexFor(source)
    const normalised = rest
      .replace(/\s*([([:=])\s*/g, '$1')
      .replace(/\s*([)\]])/g, '$1')
    for (const token of normalised.split(/[\s,]+/).filter(Boolean)) {
      const { name, weight } = splitNeighbour(token)
      if (name === '') continue
      assembler.addEdge(source, name, weight, !directed)
    }
  }

  return assembler.finish()
}

/* ------------------------------------------------------------------ */
/* Adjacency matrix                                                    */
/* ------------------------------------------------------------------ */

/**
 * A square matrix of numbers, optionally framed by a row and a column of
 * vertex labels (`withHeaders`, on by default).
 *
 * Entry convention: in a weighted graph an entry is the edge's weight, and in
 * an unweighted graph it is 1 for "edge present" and 0 for "absent"; a
 * self-loop contributes 1 (or its weight) on the diagonal, not 2. In a
 * directed graph **rows are sources and columns are targets**, so entry
 * `[i][j]` describes the edge i -> j; an undirected graph is symmetric.
 */
export const toAdjacencyMatrixText = (g: Graph, opts: MatrixTextOptions = {}): string => {
  const delimiter = opts.delimiter ?? ' '
  const withHeaders = opts.withHeaders ?? true
  const ids = g.vertexIds
  const n = ids.length

  const matrix: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0))
  for (const edge of g.edges) {
    const i = g.index(edge.source)
    const j = g.index(edge.target)
    if (i < 0 || j < 0) continue
    const value = g.weighted ? (edge.weight ?? 1) : 1
    matrix[i][j] = value
    if (!g.directed) matrix[j][i] = value
  }

  const rows: string[][] = []
  if (withHeaders) {
    rows.push(['', ...ids.map((id) => g.label(id))])
    matrix.forEach((row, i) => rows.push([g.label(ids[i]), ...row.map(formatNumber)]))
  } else {
    for (const row of matrix) rows.push(row.map(formatNumber))
  }

  if (delimiter.trim() === '') {
    const width = Math.max(1, ...rows.flat().map((cell) => cell.length))
    return rows
      .map((row) => row.map((cell) => cell.padStart(width)).join(delimiter).trimEnd())
      .join('\n')
  }
  return rows.map((row) => row.join(delimiter)).join('\n')
}

type MatrixAnalysis =
  | { ok: true; labels: string[] | null; values: number[][] }
  | { ok: false; reason: string }

const analyseMatrix = (text: string): MatrixAnalysis => {
  const lines = contentLines(text)
  if (lines.length === 0) {
    return { ok: false, reason: 'There is nothing to import — the matrix has no rows.' }
  }
  const byComma = text.includes(',')
  const rows = lines.map((line) =>
    byComma ? line.split(',').map((cell) => cell.trim()) : line.split(/\s+/),
  )
  const isLabelToken = (token: string): boolean => token !== '' && !isNumericToken(token)

  // A header *column* only ever puts a label in position 0, so a label
  // anywhere further along the first row is what marks it as a header *row*.
  // Without this, "X 0 1 0" would lose its first data row.
  const hasHeaderRow = rows[0].slice(1).some(isLabelToken)
  const body = hasHeaderRow ? rows.slice(1) : rows
  if (body.length === 0) {
    return { ok: false, reason: 'The matrix has a row of labels but no rows of numbers.' }
  }
  const hasHeaderColumn = body.some((row) => isLabelToken(row[0] ?? ''))

  const values: number[][] = []
  for (let i = 0; i < body.length; i++) {
    const cells = (hasHeaderColumn ? body[i].slice(1) : body[i]).slice()
    while (cells.length > 0 && cells[cells.length - 1] === '') cells.pop()
    const bad = cells.find((cell) => cell !== '' && !isNumericToken(cell))
    if (bad !== undefined) {
      return {
        ok: false,
        reason: `Row ${i + 1} of the adjacency matrix contains "${bad}", which is not a number.`,
      }
    }
    values.push(cells.map((cell) => (cell === '' ? 0 : Number(cell))))
  }

  const n = values.length
  for (let i = 0; i < n; i++) {
    if (values[i].length !== n) {
      const count = values[i].length
      return {
        ok: false,
        reason:
          `The adjacency matrix is not square: row ${i + 1} has ${count} ` +
          `${count === 1 ? 'entry' : 'entries'} but the matrix has ${n} rows.`,
      }
    }
  }

  let labels: string[] | null = null
  if (hasHeaderRow) {
    const head = rows[0].slice()
    while (head.length > 0 && head[head.length - 1] === '') head.pop()
    // With both a header row and a header column the top-left corner cell may
    // or may not be written out; drop it when it is there.
    const trimmed = head.length === n + 1 ? head.slice(1) : head
    if (trimmed.length !== n) {
      return {
        ok: false,
        reason: `The matrix header lists ${trimmed.length} labels but the matrix has ${n} rows.`,
      }
    }
    labels = trimmed.map((cell, i) => (cell === '' ? labelForIndex(i) : cell))
  } else if (hasHeaderColumn) {
    labels = body.map((row, i) => (isLabelToken(row[0] ?? '') ? row[0] : labelForIndex(i)))
  }

  return { ok: true, labels, values }
}

/**
 * Reads a matrix with or without headers, separated by whitespace or commas.
 * Without headers the vertices are named A, B, C... An asymmetric matrix is
 * read as directed unless the caller insists otherwise, since an undirected
 * graph cannot represent one.
 */
export const parseAdjacencyMatrix = (text: string, opts: ParseOptions = {}): ParseResult => {
  const analysis = analyseMatrix(text)
  if (!analysis.ok) throw new ImportError(analysis.reason)

  const { labels, values } = analysis
  const n = values.length
  const names = labels ?? Array.from({ length: n }, (_, i) => labelForIndex(i))

  let symmetric = true
  for (let i = 0; i < n && symmetric; i++) {
    for (let j = i + 1; j < n; j++) {
      if (values[i][j] !== values[j][i]) {
        symmetric = false
        break
      }
    }
  }

  const directed = opts.directed ?? !symmetric
  const assembler = createAssembler(directed)
  // Rows are keyed by position rather than label so that a file repeating a
  // label does not silently merge two different rows into one vertex.
  names.forEach((name, i) => assembler.vertexFor(String(i), name))

  if (directed) {
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const value = values[i][j]
        if (value !== 0) assembler.addEdge(String(i), String(j), value)
      }
    }
  } else {
    if (!symmetric) {
      assembler.warn(
        'The matrix is not symmetric, so the entry above the diagonal was used for each undirected edge.',
      )
    }
    for (let i = 0; i < n; i++) {
      for (let j = i; j < n; j++) {
        const upper = values[i][j]
        const lower = values[j][i]
        const value = upper !== 0 ? upper : lower
        if (value !== 0) assembler.addEdge(String(i), String(j), value)
      }
    }
  }

  return assembler.finish()
}

/* ------------------------------------------------------------------ */
/* CSV edge list                                                       */
/* ------------------------------------------------------------------ */

const csvField = (value: string): string =>
  /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value

const splitCsvLine = (line: string): string[] => {
  const cells: string[] = []
  let current = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"'
          i++
        } else quoted = false
      } else current += ch
      continue
    }
    if (ch === '"') quoted = true
    else if (ch === ',' || ch === ';' || ch === '\t') {
      cells.push(current)
      current = ''
    } else current += ch
  }
  cells.push(current)
  return cells
}

/**
 * `source,target` (plus `weight` when the graph is weighted), one edge per
 * row. A vertex with no edges is written as `A,` with an empty target so that
 * isolated vertices survive the round trip.
 */
export const toEdgeListCsv = (g: Graph): string => {
  const lines: string[] = [g.weighted ? 'source,target,weight' : 'source,target']
  for (const edge of g.edges) {
    const cells = [csvField(g.label(edge.source)), csvField(g.label(edge.target))]
    if (g.weighted) cells.push(formatNumber(edge.weight ?? 1))
    lines.push(cells.join(','))
  }
  for (const vertex of g.vertices) {
    if (g.degree(vertex.id) === 0) lines.push(`${csvField(g.label(vertex.id))},`)
  }
  return lines.join('\n')
}

// Deliberately no single-letter aliases: "A,B" is far more likely to be the
// first edge of a headerless file than a header naming columns a and b.
const SOURCE_HEADERS = new Set(['source', 'from', 'src', 'node1', 'tail', 'start'])
const TARGET_HEADERS = new Set(['target', 'to', 'dst', 'node2', 'head', 'end'])
const WEIGHT_HEADERS = new Set(['weight', 'w', 'cost', 'value', 'capacity'])

/**
 * Reads an edge list separated by commas, semicolons or tabs, with or without
 * a header row. A row with an empty target declares an isolated vertex.
 */
export const parseEdgeListCsv = (text: string, opts: ParseOptions = {}): ParseResult => {
  const lines = contentLines(text)
  if (lines.length === 0) {
    throw new ImportError('There is nothing to import — the edge list has no rows.')
  }

  const rows = lines.map((line) => splitCsvLine(line).map((cell) => cell.trim()))
  const head = rows[0].map((cell) => cell.toLowerCase())
  const hasHeader =
    head.length >= 2 && SOURCE_HEADERS.has(head[0]) && TARGET_HEADERS.has(head[1])
  const weightColumn = hasHeader
    ? (() => {
        const found = head.findIndex((cell) => WEIGHT_HEADERS.has(cell))
        return found === -1 ? 2 : found
      })()
    : 2

  const directed = opts.directed ?? false
  const assembler = createAssembler(directed)

  for (let i = hasHeader ? 1 : 0; i < rows.length; i++) {
    const row = rows[i]
    const source = row[0] ?? ''
    const target = row[1] ?? ''
    if (source === '') {
      assembler.warn(`Row ${i + 1} of the edge list has no source vertex and was skipped.`)
      continue
    }
    if (target === '') {
      assembler.vertexFor(source)
      continue
    }
    const rawWeight = row[weightColumn] ?? ''
    let weight: number | undefined
    if (rawWeight !== '') {
      const parsed = Number(rawWeight)
      if (Number.isFinite(parsed)) weight = parsed
      else {
        assembler.warn(
          `Row ${i + 1} of the edge list has a weight "${rawWeight}" that is not a number, so it was ignored.`,
        )
      }
    }
    assembler.addEdge(source, target, weight)
  }

  return assembler.finish()
}

/* ------------------------------------------------------------------ */
/* DOT                                                                 */
/* ------------------------------------------------------------------ */

const dotEscape = (value: string): string => value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')

/**
 * Graphviz DOT. Undirected graphs are written as `graph "Name" { "A" -- "B" }`
 * and directed graphs as `digraph "Name" { "A" -> "B" }`. Every vertex gets a
 * node statement so that isolated vertices survive, identifiers are always
 * quoted, and a weighted edge carries `[label=3, weight=3]` — `label` so the
 * weight is visible when Graphviz draws it, `weight` because that is what
 * other tools read back.
 */
export const toDot = (g: Graph, name = 'G'): string => {
  const keyword = g.directed ? 'digraph' : 'graph'
  const operator = g.directed ? '->' : '--'
  const lines: string[] = [`${keyword} "${dotEscape(name)}" {`]
  for (const vertex of g.vertices) lines.push(`  "${dotEscape(g.label(vertex.id))}";`)
  for (const edge of g.edges) {
    const weight = g.weighted ? (edge.weight ?? 1) : undefined
    const text = weight === undefined ? '' : formatNumber(weight)
    const attrs = weight === undefined ? '' : ` [label=${text}, weight=${text}]`
    lines.push(
      `  "${dotEscape(g.label(edge.source))}" ${operator} "${dotEscape(g.label(edge.target))}"${attrs};`,
    )
  }
  lines.push('}')
  return lines.join('\n')
}

interface DotToken {
  value: string
  punct: boolean
}

const DOT_PUNCT = '{}[];,=:'
/** Characters that may continue a bare DOT identifier or numeral. */
const DOT_BARE = /[A-Za-z0-9_.\u0080-\uFFFF]/

const tokenizeDot = (text: string): DotToken[] => {
  const tokens: DotToken[] = []
  const n = text.length
  let i = 0
  while (i < n) {
    const ch = text[i]
    if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') {
      i++
      continue
    }
    if (ch === '#' || (ch === '/' && text[i + 1] === '/')) {
      while (i < n && text[i] !== '\n') i++
      continue
    }
    if (ch === '/' && text[i + 1] === '*') {
      i += 2
      while (i < n && !(text[i] === '*' && text[i + 1] === '/')) i++
      i += 2
      continue
    }
    if (ch === '"') {
      i++
      let out = ''
      while (i < n && text[i] !== '"') {
        if (text[i] === '\\') {
          const next = text[i + 1]
          if (next === '"' || next === '\\') {
            out += next
            i += 2
            continue
          }
          if (next === '\n') {
            i += 2
            continue
          }
        }
        out += text[i]
        i++
      }
      i++
      tokens.push({ value: out, punct: false })
      continue
    }
    if (ch === '<') {
      // HTML-like label. Consume the balanced angle brackets and keep the text.
      let depth = 0
      let out = ''
      while (i < n) {
        if (text[i] === '<') depth++
        else if (text[i] === '>') {
          depth--
          if (depth === 0) {
            i++
            break
          }
        }
        out += text[i]
        i++
      }
      tokens.push({ value: out.slice(1), punct: false })
      continue
    }
    if (ch === '-' && (text[i + 1] === '>' || text[i + 1] === '-')) {
      tokens.push({ value: text.slice(i, i + 2), punct: true })
      i += 2
      continue
    }
    if (DOT_PUNCT.includes(ch)) {
      tokens.push({ value: ch, punct: true })
      i++
      continue
    }
    let j = i
    if (text[j] === '-' || text[j] === '+') j++
    while (j < n && DOT_BARE.test(text[j])) j++
    if (j === i) {
      i++
      continue
    }
    tokens.push({ value: text.slice(i, j), punct: false })
    i = j
  }
  return tokens
}

const weightFromDotAttrs = (attrs: Map<string, string>): number | undefined => {
  const raw = attrs.get('weight') ?? attrs.get('label')
  if (raw === undefined || raw.trim() === '') return undefined
  const value = Number(raw)
  return Number.isFinite(value) ? value : undefined
}

/**
 * A tolerant DOT reader: `strict`, `graph`/`digraph`, node statements, edge
 * chains (`A -> B -> C`), attribute lists (only `label` and `weight` are
 * read), line comments, block comments and `#` comments, optional semicolons,
 * and quoted or bare identifiers. Subgraphs are skipped with a warning.
 */
export const parseDot = (text: string): ParseResult => {
  const tokens = tokenizeDot(text)
  let i = 0
  const at = (offset = 0): DotToken | undefined => tokens[i + offset]

  if (tokens.length === 0) {
    throw new ImportError('There is nothing to import — the DOT text is empty.')
  }
  if (!at()?.punct && at()?.value.toLowerCase() === 'strict') i++

  const keyword = at()
  const kind = keyword && !keyword.punct ? keyword.value.toLowerCase() : ''
  if (kind !== 'graph' && kind !== 'digraph') {
    throw new ImportError(
      'This does not look like DOT: the text should begin with "graph", "digraph" or "strict".',
    )
  }
  const directed = kind === 'digraph'
  i++

  const named = at()
  const graphName = named && !named.punct ? named.value : undefined
  if (named && !named.punct) i++
  if (at()?.value !== '{' || !at()?.punct) {
    throw new ImportError('This DOT graph is missing its opening "{", so it cannot be read.')
  }
  i++

  const assembler = createAssembler(directed)
  let sawSubgraph = false

  const skipBlock = (): void => {
    let depth = 0
    while (i < tokens.length) {
      const token = tokens[i]
      if (token.punct && token.value === '{') depth++
      else if (token.punct && token.value === '}') {
        depth--
        i++
        if (depth <= 0) return
        continue
      }
      i++
    }
  }

  const readAttrs = (): Map<string, string> => {
    const attrs = new Map<string, string>()
    while (at()?.punct && at()?.value === '[') {
      i++
      while (i < tokens.length) {
        const token = tokens[i]
        if (token.punct && token.value === ']') {
          i++
          break
        }
        if (token.punct) {
          i++
          continue
        }
        const key = token.value.toLowerCase()
        i++
        let value = ''
        const equals = at()
        if (equals && equals.punct && equals.value === '=') {
          i++
          const candidate = at()
          if (candidate && !candidate.punct) {
            value = candidate.value
            i++
          }
        }
        attrs.set(key, value)
      }
    }
    return attrs
  }

  const readEndpoint = (): string | undefined => {
    const token = at()
    if (!token || token.punct) return undefined
    i++
    // Ports (`A:port:compass`) name a place on the node, not another node.
    while (at()?.punct && at()?.value === ':') {
      const port = at(1)
      if (port && !port.punct) i += 2
      else i += 1
    }
    return token.value
  }

  while (i < tokens.length) {
    const token = tokens[i]
    if (token.punct) {
      if (token.value === '}') {
        i++
        break
      }
      if (token.value === '{') {
        sawSubgraph = true
        skipBlock()
        continue
      }
      i++
      continue
    }

    const lower = token.value.toLowerCase()
    if (lower === 'subgraph') {
      sawSubgraph = true
      i++
      const label = at()
      if (label && !label.punct) i++
      if (at()?.punct && at()?.value === '{') skipBlock()
      continue
    }
    if (
      (lower === 'node' || lower === 'edge' || lower === 'graph') &&
      at(1)?.punct &&
      at(1)?.value === '['
    ) {
      i++
      readAttrs()
      continue
    }

    const start = i
    const first = readEndpoint()
    if (first === undefined) {
      i = start + 1
      continue
    }

    const next = at()
    if (next && next.punct && next.value === '=') {
      // A graph-level attribute such as `rankdir = LR`.
      i++
      const value = at()
      if (value && !value.punct) i++
      continue
    }

    if (next && next.punct && (next.value === '->' || next.value === '--')) {
      const chain = [first]
      for (;;) {
        const operator = at()
        if (!operator || !operator.punct || (operator.value !== '->' && operator.value !== '--')) {
          break
        }
        i++
        const brace = at()
        if (brace && brace.punct && brace.value === '{') {
          sawSubgraph = true
          skipBlock()
          break
        }
        const endpoint = readEndpoint()
        if (endpoint === undefined) break
        chain.push(endpoint)
      }
      const weight = weightFromDotAttrs(readAttrs())
      for (let k = 0; k + 1 < chain.length; k++) {
        assembler.addEdge(chain[k], chain[k + 1], weight)
      }
      continue
    }

    const attrs = readAttrs()
    assembler.vertexFor(first)
    const label = attrs.get('label')
    if (label !== undefined && label !== '') assembler.setLabel(first, label)
  }

  if (sawSubgraph) assembler.warn('Subgraphs are not supported and were skipped.')
  const parsed = assembler.finish()
  return graphName === undefined || graphName === '' ? parsed : { ...parsed, name: graphName }
}

/* ------------------------------------------------------------------ */
/* GraphML                                                             */
/* ------------------------------------------------------------------ */

const xmlEscape = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

/**
 * GraphML for interchange with yEd, Gephi and NetworkX. Labels and positions
 * travel as `<data>` elements so a round trip through another tool keeps the
 * drawing recognisable.
 */
export const toGraphml = (g: Graph): string => {
  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<graphml xmlns="http://graphml.graphdrawing.org/xmlns">',
    '  <key id="label" for="node" attr.name="label" attr.type="string"/>',
    '  <key id="x" for="node" attr.name="x" attr.type="double"/>',
    '  <key id="y" for="node" attr.name="y" attr.type="double"/>',
    '  <key id="weight" for="edge" attr.name="weight" attr.type="double"/>',
    `  <graph id="G" edgedefault="${g.directed ? 'directed' : 'undirected'}">`,
  ]
  for (const vertex of g.vertices) {
    lines.push(`    <node id="${xmlEscape(vertex.id)}">`)
    lines.push(`      <data key="label">${xmlEscape(vertex.label)}</data>`)
    lines.push(`      <data key="x">${formatNumber(vertex.x)}</data>`)
    lines.push(`      <data key="y">${formatNumber(vertex.y)}</data>`)
    lines.push('    </node>')
  }
  for (const edge of g.edges) {
    const open =
      `    <edge id="${xmlEscape(edge.id)}" source="${xmlEscape(edge.source)}"` +
      ` target="${xmlEscape(edge.target)}"`
    if (!g.weighted) {
      lines.push(`${open}/>`)
      continue
    }
    lines.push(`${open}>`)
    lines.push(`      <data key="weight">${formatNumber(edge.weight ?? 1)}</data>`)
    lines.push('    </edge>')
  }
  lines.push('  </graph>')
  lines.push('</graphml>')
  return lines.join('\n')
}

/* ------------------------------------------------------------------ */
/* Sniffing                                                            */
/* ------------------------------------------------------------------ */

const looksLikeDot = (text: string): boolean => {
  const withoutComments = text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ')
    .replace(/^\s*#.*$/gm, ' ')
  return /^\s*(strict\s+)?(di)?graph\b/i.test(withoutComments)
}

const looksLikeMatrix = (text: string): boolean => {
  const analysis = analyseMatrix(text)
  return analysis.ok && analysis.values.length >= 2
}

const looksLikeEdgeCsv = (text: string): boolean => {
  const lines = contentLines(text)
  if (lines.length === 0) return false
  const rows = lines.map((line) => splitCsvLine(line).map((cell) => cell.trim()))
  const head = rows[0].map((cell) => cell.toLowerCase())
  if (head.length >= 2 && SOURCE_HEADERS.has(head[0]) && TARGET_HEADERS.has(head[1])) return true
  // Otherwise every row must be a short, comma-separated pair or triple that
  // contains none of the punctuation an adjacency list would use.
  return lines.every((line, index) => {
    const row = rows[index]
    if (!line.includes(',')) return false
    if (row.length < 2 || row.length > 4) return false
    return row.every((cell) => !/(:|->|--)/.test(cell))
  })
}

/**
 * Tries the formats in order of how distinctive they are: Graphualize JSON,
 * DOT, adjacency matrix, CSV edge list, adjacency list. The adjacency list is
 * last because almost any whitespace-separated text is a valid one.
 */
export const parseAnyGraphText = (text: string): ParseResult & { format: TextFormat } => {
  const trimmed = text.trim()
  if (trimmed === '') {
    throw new ImportError('There is nothing to import — the text is empty.')
  }
  if (/<graphml\b/i.test(trimmed)) {
    throw new ImportError(
      'This is a GraphML file. Graphualize can write GraphML but cannot read it back yet — ' +
        'export the graph as DOT or CSV instead.',
    )
  }
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    const saved = parseGraphualizeJson(trimmed)
    return { document: saved.graph, warnings: [], name: saved.name, format: 'graphualize' }
  }
  if (looksLikeDot(trimmed)) return { ...parseDot(text), format: 'dot' }
  if (looksLikeMatrix(text)) return { ...parseAdjacencyMatrix(text), format: 'adjacency-matrix' }
  if (looksLikeEdgeCsv(text)) return { ...parseEdgeListCsv(text), format: 'edge-list-csv' }
  if (contentLines(text).length > 0) {
    return { ...parseAdjacencyList(text), format: 'adjacency-list' }
  }
  throw new ImportError(
    'This text did not match any format Graphualize can import: Graphualize JSON, DOT, ' +
      'an adjacency matrix, a CSV edge list or an adjacency list.',
  )
}
