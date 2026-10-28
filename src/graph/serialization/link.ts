/**
 * Share links: a whole graph carried in the URL, with no server involved.
 *
 * `#/graph?d=<code>` opens the workbench with the graph the code describes. The
 * code is the document in a compact positional JSON form, optionally deflated,
 * then base64url-encoded, so it survives chat apps, email and address bars
 * without a single percent-escape:
 *
 *   1z.<base64url of deflate-raw(JSON)>   when the browser can compress
 *   1j.<base64url of JSON>                otherwise, or when that is shorter
 *
 * The number is the format version and the letter the codec, so the format can
 * change later without old links being silently mis-read.
 *
 * The compact form is only a transport encoding of the saved-file format. On
 * the way in it is expanded back into one and handed to
 * {@link parseGraphualizeJson}, so a link can never produce a graph that
 * opening a file could not.
 *
 * A code arriving in a URL is untrusted: anyone can craft one. Decoding checks
 * the length before doing any work, caps how far a compressed payload may
 * inflate, checks every field's type and range, and never throws — every
 * failure is a {@link ShareDecodeResult} carrying a reason a human can read.
 * Every limit the decoder enforces, the encoder enforces too, so a link this
 * build produces is always one it can open.
 */

import { nextVertexId } from '../model/ids'
import type { GraphDocument } from '../model/types'
import { GRAPHUALIZE_FORMAT_VERSION, parseGraphualizeJson } from './document'

/** Bumped whenever the compact shape changes in a way the decoder must know about. */
export const SHARE_LINK_VERSION = 1

export const SHARE_LINK_LIMITS = {
  /** Longest code accepted or produced, in characters. */
  code: 100_000,
  /**
   * Most a compressed code may inflate to, in bytes. A deflate bomb stops here,
   * and the encoder refuses a graph whose JSON is larger.
   */
  json: 1_000_000,
  vertices: 2_000,
  edges: 10_000,
  /** Longest vertex label or graph name, in characters. */
  text: 200,
  /** Largest coordinate. Positions are shifted to start at 0 before encoding. */
  coordinate: 1_000_000,
} as const

export interface ShareInput {
  name: string
  doc: GraphDocument
}

export type ShareEncodeResult =
  | { ok: true; code: string }
  /** `reason` completes "This graph cannot be shared as a link: …". */
  | { ok: false; reason: string }

export type ShareDecodeResult =
  | { ok: true; name: string; document: GraphDocument }
  /** `reason` completes "This share link cannot be opened: …". */
  | { ok: false; reason: string }

/** The name a link opens under when it carries none. */
export const SHARED_GRAPH_NAME = 'Shared graph'

/**
 * The wire shape. Keys are single letters and entries are tuples because this
 * is what makes a link short enough to paste; the expansion back into a saved
 * file is the one place that knows what each slot means.
 */
interface CompactGraph {
  /** Graph name. */
  n?: string
  /** 1 when directed. Absent means undirected. */
  d?: 0 | 1
  /** 1 when weighted. Absent means unweighted. */
  w?: 0 | 1
  /** Vertices as `[label, x, y]`, positions rounded to whole units. */
  v: Array<[string, number, number]>
  /** Edges as `[source, target]` or `[source, target, weight]`, by index into `v`. */
  e: Array<[number, number] | [number, number, number]>
}

const CODE_PATTERN = /^(\d{1,4})([a-z])\.([A-Za-z0-9_-]*)$/
const DAMAGED = 'it is damaged or incomplete. Check that the whole link was copied.'

const count = (value: number): string => value.toLocaleString('en-US')

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

/** Null when the counts fit in a link, otherwise why they do not. */
const sizeProblem = (vertices: number, edges: number): string | null => {
  if (vertices > SHARE_LINK_LIMITS.vertices) {
    return `it has ${count(vertices)} vertices, and a link carries at most ${count(SHARE_LINK_LIMITS.vertices)}.`
  }
  if (edges > SHARE_LINK_LIMITS.edges) {
    return `it has ${count(edges)} edges, and a link carries at most ${count(SHARE_LINK_LIMITS.edges)}.`
  }
  return null
}

/* ------------------------------------------------------------------ */
/* Bytes                                                               */
/* ------------------------------------------------------------------ */

const toBase64Url = (bytes: Uint8Array): string => {
  let binary = ''
  // In slices, because spreading a large array into one call overflows the stack.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** Throws on input that is not base64url; callers catch it as a damaged link. */
const fromBase64Url = (text: string): Uint8Array<ArrayBuffer> => {
  if (text.length % 4 === 1) throw new Error('Truncated base64url.')
  const padded = text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4)
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/**
 * Pushes bytes through a compression or decompression stream, giving up with
 * `null` once the output passes `limit`. Writing is not awaited before
 * reading: the stream applies backpressure, so waiting for the write to finish
 * first would stall on any input larger than its internal buffer.
 */
const pipe = async (
  bytes: Uint8Array<ArrayBuffer>,
  stream: CompressionStream | DecompressionStream,
  limit: number,
): Promise<Uint8Array<ArrayBuffer> | null> => {
  const writer = stream.writable.getWriter()
  // A corrupt input rejects these as well as the read below; the read is the
  // one that reports it, so these must not surface as unhandled rejections.
  writer.write(bytes).catch(() => {})
  writer.close().catch(() => {})
  const reader = stream.readable.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > limit) {
      await reader.cancel().catch(() => {})
      return null
    }
    chunks.push(value)
  }
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}

/** Null when this environment cannot compress, which is never an error. */
const deflate = async (bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer> | null> => {
  if (typeof CompressionStream !== 'function') return null
  try {
    // Older browsers know only 'gzip' and 'deflate' and throw for this one.
    return await pipe(bytes, new CompressionStream('deflate-raw'), Number.POSITIVE_INFINITY)
  } catch {
    return null
  }
}

/* ------------------------------------------------------------------ */
/* Encoding                                                            */
/* ------------------------------------------------------------------ */

const finiteOr = (value: number, fallback: number): number =>
  Number.isFinite(value) ? value : fallback

const toCompact = ({ name, doc }: ShareInput): CompactGraph | string => {
  const index = new Map(doc.vertices.map((v, i) => [v.id, i]))
  // Shifting the drawing to start at the origin keeps every coordinate short
  // and non-negative; the workbench fits the view on arrival anyway.
  const minX = Math.min(...doc.vertices.map((v) => finiteOr(v.x, 0)))
  const minY = Math.min(...doc.vertices.map((v) => finiteOr(v.y, 0)))

  const vertices: CompactGraph['v'] = []
  for (const v of doc.vertices) {
    if (v.label.length > SHARE_LINK_LIMITS.text) {
      return `the vertex label "${v.label.slice(0, 24)}…" is longer than ${SHARE_LINK_LIMITS.text} characters.`
    }
    const x = Math.round(finiteOr(v.x, 0) - minX)
    const y = Math.round(finiteOr(v.y, 0) - minY)
    if (x > SHARE_LINK_LIMITS.coordinate || y > SHARE_LINK_LIMITS.coordinate) {
      return 'its vertices are spread too far apart. Run a layout first.'
    }
    vertices.push([v.label, x, y])
  }

  const edges: CompactGraph['e'] = []
  for (const e of doc.edges) {
    const source = index.get(e.source)
    const target = index.get(e.target)
    // An edge to a vertex that is not in the document is already invisible
    // on the canvas; carrying it would only make the link unopenable.
    if (source === undefined || target === undefined) continue
    edges.push(isFiniteNumber(e.weight) ? [source, target, e.weight] : [source, target])
  }

  const compact: CompactGraph = { v: vertices, e: edges }
  // A name is metadata, so an over-long one is shortened rather than refused.
  const trimmed = name.trim().slice(0, SHARE_LINK_LIMITS.text)
  if (trimmed) compact.n = trimmed
  if (doc.directed) compact.d = 1
  if (doc.weighted) compact.w = 1
  return compact
}

/**
 * Encodes a document as a share code: the part after `?d=`.
 *
 * Compresses when the environment can and keeps whichever form is shorter, so
 * a tiny graph is never made longer by a compression header.
 */
export const encodeShareCode = async (input: ShareInput): Promise<ShareEncodeResult> => {
  try {
    const tooBig = sizeProblem(input.doc.vertices.length, input.doc.edges.length)
    if (tooBig) return { ok: false, reason: tooBig }

    const compact = toCompact(input)
    if (typeof compact === 'string') return { ok: false, reason: compact }

    const bytes = new TextEncoder().encode(JSON.stringify(compact))
    // Repetitive text can deflate a payload larger than this into a code short
    // enough to copy, but the decoder stops inflating here: no one could open it.
    if (bytes.length > SHARE_LINK_LIMITS.json) {
      return {
        ok: false,
        reason: `it holds ${count(bytes.length)} bytes of data, and a link carries at most ${count(SHARE_LINK_LIMITS.json)}.`,
      }
    }
    const plain = `${SHARE_LINK_VERSION}j.${toBase64Url(bytes)}`
    const packed = await deflate(bytes)
    const zipped = packed ? `${SHARE_LINK_VERSION}z.${toBase64Url(packed)}` : null
    const code = zipped !== null && zipped.length < plain.length ? zipped : plain

    if (code.length > SHARE_LINK_LIMITS.code) {
      return {
        ok: false,
        reason: `the link would be ${count(code.length)} characters long, and links are limited to ${count(SHARE_LINK_LIMITS.code)}.`,
      }
    }
    return { ok: true, code }
  } catch {
    return { ok: false, reason: 'something in it could not be encoded.' }
  }
}

/* ------------------------------------------------------------------ */
/* Decoding                                                            */
/* ------------------------------------------------------------------ */

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isFlag = (value: unknown): value is 0 | 1 | undefined =>
  value === undefined || value === 0 || value === 1

const isText = (value: unknown): value is string =>
  typeof value === 'string' && value.length <= SHARE_LINK_LIMITS.text

const isCoordinate = (value: unknown): value is number =>
  isFiniteNumber(value) && Math.abs(value) <= SHARE_LINK_LIMITS.coordinate

const isIndex = (value: unknown, length: number): value is number =>
  Number.isInteger(value) && (value as number) >= 0 && (value as number) < length

/**
 * Checks the parsed payload slot by slot. Returns the payload, or the reason
 * it was refused. Unknown keys are ignored, so a later version can add one
 * that older builds simply do not read.
 */
const readCompact = (raw: unknown): CompactGraph | string => {
  if (!isRecord(raw) || !Array.isArray(raw.v) || !Array.isArray(raw.e)) return DAMAGED
  const tooBig = sizeProblem(raw.v.length, raw.e.length)
  if (tooBig) return tooBig
  if (!isFlag(raw.d) || !isFlag(raw.w)) return DAMAGED
  if (raw.n !== undefined && !isText(raw.n)) return DAMAGED

  const order = raw.v.length
  for (const entry of raw.v as unknown[]) {
    if (!Array.isArray(entry) || entry.length !== 3) return DAMAGED
    const [label, x, y] = entry as unknown[]
    if (!isText(label) || !isCoordinate(x) || !isCoordinate(y)) return DAMAGED
  }
  for (const entry of raw.e as unknown[]) {
    if (!Array.isArray(entry) || (entry.length !== 2 && entry.length !== 3)) return DAMAGED
    const [source, target, weight] = entry as unknown[]
    if (!isIndex(source, order) || !isIndex(target, order)) return DAMAGED
    if (entry.length === 3 && !isFiniteNumber(weight)) return DAMAGED
  }
  return raw as unknown as CompactGraph
}

/**
 * Expands the compact form into a saved file and reads it with the same
 * parser that opens files. Ids are minted here rather than taken from the
 * link, so a crafted link cannot collide with anything already on screen.
 */
const toDocument = (compact: CompactGraph): GraphDocument => {
  const ids = compact.v.map(() => nextVertexId())
  const saved = {
    format: 'graphualize',
    version: GRAPHUALIZE_FORMAT_VERSION,
    graph: {
      directed: compact.d === 1,
      weighted: compact.w === 1,
      vertices: compact.v.map(([label, x, y], i) => ({ id: ids[i], label, x, y })),
      edges: compact.e.map(([source, target, weight]) => ({
        source: ids[source],
        target: ids[target],
        ...(weight === undefined ? {} : { weight }),
      })),
    },
  }
  return parseGraphualizeJson(JSON.stringify(saved)).graph
}

/**
 * Decodes a share code from a URL. Never throws, whatever it is given.
 */
export const decodeShareCode = async (code: unknown): Promise<ShareDecodeResult> => {
  try {
    if (typeof code !== 'string' || code.trim() === '') return { ok: false, reason: DAMAGED }
    const text = code.trim()
    // Checked before anything else touches the input, so an enormous URL costs
    // one length comparison and nothing more.
    if (text.length > SHARE_LINK_LIMITS.code) {
      return {
        ok: false,
        reason: `it is longer than the ${count(SHARE_LINK_LIMITS.code)} characters a share link may be.`,
      }
    }

    const match = CODE_PATTERN.exec(text)
    if (!match) return { ok: false, reason: DAMAGED }
    const version = Number(match[1])
    const codec = match[2]
    if (version > SHARE_LINK_VERSION) {
      return { ok: false, reason: 'it was made by a newer version of Graphualize. Reload to update.' }
    }
    if (version !== SHARE_LINK_VERSION || (codec !== 'j' && codec !== 'z')) {
      return { ok: false, reason: DAMAGED }
    }

    let bytes: Uint8Array<ArrayBuffer> | null = fromBase64Url(match[3]!)
    if (codec === 'z') {
      if (typeof DecompressionStream !== 'function') {
        return {
          ok: false,
          reason: 'this browser cannot unpack compressed links. Try a recent Chrome, Firefox or Safari.',
        }
      }
      bytes = await pipe(bytes, new DecompressionStream('deflate-raw'), SHARE_LINK_LIMITS.json)
      if (bytes === null) return { ok: false, reason: 'it unpacks to more data than a share link may carry.' }
    }

    const json = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    const compact = readCompact(JSON.parse(json) as unknown)
    if (typeof compact === 'string') return { ok: false, reason: compact }

    const name = compact.n?.trim() || SHARED_GRAPH_NAME
    return { ok: true, name, document: toDocument(compact) }
  } catch {
    // Bad base64, a corrupt deflate stream, invalid UTF-8, invalid JSON, or the
    // file parser refusing the expansion: to the person holding the link these
    // are all the same thing.
    return { ok: false, reason: DAMAGED }
  }
}
