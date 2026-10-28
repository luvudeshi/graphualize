import { afterEach, describe, expect, it, vi } from 'vitest'

import { GraphBuilder, docFromEdges } from '../model/builder'
import type { GraphDocument } from '../model/types'
import {
  SHARED_GRAPH_NAME,
  SHARE_LINK_LIMITS,
  decodeShareCode,
  encodeShareCode,
  type ShareDecodeResult,
  type ShareInput,
} from './link'

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const encode = async (doc: GraphDocument, name = 'Test graph'): Promise<string> => {
  const result = await encodeShareCode({ name, doc })
  if (!result.ok) throw new Error(`expected the graph to encode, got: ${result.reason}`)
  return result.code
}

const decoded = async (code: unknown) => {
  const result = await decodeShareCode(code)
  if (!result.ok) throw new Error(`expected the link to open, got: ${result.reason}`)
  return result
}

const refused = async (code: unknown): Promise<string> => {
  const result: ShareDecodeResult = await decodeShareCode(code)
  expect(result.ok, 'a malformed link was accepted').toBe(false)
  return result.ok ? '' : result.reason
}

/** Edges as label pairs with their weights, comparable across documents. */
const edgeSummary = (doc: GraphDocument): string[] => {
  const label = new Map(doc.vertices.map((v) => [v.id, v.label]))
  return doc.edges
    .map((e) => `${label.get(e.source)}>${label.get(e.target)}:${e.weight ?? '-'}`)
    .sort()
}

const bytesToBase64Url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')

/** A hand-made `1j.` code for an arbitrary payload, as an attacker would write one. */
const plainCode = (payload: unknown): string =>
  `1j.${bytesToBase64Url(new TextEncoder().encode(JSON.stringify(payload)))}`

const deflated = async (text: string): Promise<Uint8Array> => {
  const stream = new CompressionStream('deflate-raw')
  const writer = stream.writable.getWriter()
  void writer.write(new TextEncoder().encode(text))
  void writer.close()
  const chunks: Uint8Array[] = []
  const reader = stream.readable.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
  }
  const out = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0))
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}

/** Deterministic noise, so an incompressible graph is the same graph every run. */
const noise = (seed: number) => {
  let state = seed
  return () => {
    state = (Math.imul(state, 1103515245) + 12345) >>> 0
    return state
  }
}

/**
 * A graph whose share payload — the JSON a link inflates back into — is
 * exactly `bytes` long: vertices at the origin with CJK labels, three bytes a
 * character yet so repetitive that deflate packs a megabyte into a short code.
 */
const graphWithPayload = (bytes: number): ShareInput => {
  const name = 'g'
  const payload = (labels: string[]) =>
    new TextEncoder().encode(JSON.stringify({ v: labels.map((label) => [label, 0, 0]), e: [], n: name }))
      .length
  // Any size from 0 to 600 bytes, in at most 200 characters.
  const labelOf = (size: number) => '東'.repeat(Math.floor(size / 3)) + ['', 'a', 'é'][size % 3]
  const perVertex = payload(['', '']) - payload([''])
  const order = Math.ceil(bytes / (perVertex + 600))
  // Spread over every label, with at least a byte each: an empty label would
  // be renamed on the way in, and the round trip would not match.
  const extra = bytes - payload(Array<string>(order).fill('')) - order
  const labels = Array.from({ length: order }, (_, i) => labelOf(1 + Math.min(599, Math.max(0, extra - 599 * i))))
  if (payload(labels) !== bytes) throw new Error(`built a ${payload(labels)}-byte payload, not ${bytes}`)
  return {
    name,
    doc: {
      vertices: labels.map((label, i) => ({ id: `v${i}`, label, x: 0, y: 0 })),
      edges: [],
      directed: false,
      weighted: false,
    },
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

/* ------------------------------------------------------------------ */
/* Round trips                                                         */
/* ------------------------------------------------------------------ */

describe('share links round-trip', () => {
  it('keeps labels, edges, weights and both flags', async () => {
    const builder = new GraphBuilder({ directed: true, weighted: true })
    builder.addEdgeByLabel('A', 'B', 4)
    builder.addEdgeByLabel('B', 'C', -2.5)
    builder.addEdgeByLabel('C', 'A', 0)
    builder.addEdgeByLabel('A', 'D', 1e-3)
    const doc = builder.build()

    const result = await decoded(await encode(doc, 'Negative cycle?'))
    expect(result.name).toBe('Negative cycle?')
    expect(result.document.directed).toBe(true)
    expect(result.document.weighted).toBe(true)
    expect(result.document.vertices.map((v) => v.label)).toEqual(['A', 'B', 'C', 'D'])
    expect(edgeSummary(result.document)).toEqual(edgeSummary(doc))
  })

  it('keeps an undirected, unweighted graph that way', async () => {
    const doc = docFromEdges(['A-B', 'B-C'])
    const result = await decoded(await encode(doc))
    expect(result.document.directed).toBe(false)
    expect(result.document.weighted).toBe(false)
    expect(result.document.edges.every((e) => e.weight === undefined)).toBe(true)
  })

  it('keeps weights that are hidden while weights are switched off', async () => {
    const builder = new GraphBuilder({ weighted: false })
    builder.addEdgeByLabel('A', 'B', 7)
    const result = await decoded(await encode(builder.build()))
    expect(result.document.weighted).toBe(false)
    expect(result.document.edges[0]?.weight).toBe(7)
  })

  it('keeps unicode and punctuation in labels and the name', async () => {
    const labels = ['Zürich', '東京', '🙂 face', 'a "quoted" \\ label', '<script>', 'x,y;z', 'A&B', '%20?#']
    const builder = new GraphBuilder()
    labels.forEach((label, i) => builder.addVertex(label, i * 10, 0))
    builder.addEdgeByLabel(labels[0]!, labels[1]!)
    builder.addEdgeByLabel(labels[2]!, labels[7]!)
    const name = 'Ünïcödé — “graph” #1 & <friends>?'

    const code = await encode(builder.build(), name)
    // Nothing in the code needs escaping in a URL.
    expect(code).toMatch(/^1[jz]\.[A-Za-z0-9_-]+$/)

    const result = await decoded(code)
    expect(result.name).toBe(name)
    expect(result.document.vertices.map((v) => v.label)).toEqual(labels)
  })

  it('keeps self-loops and parallel edges', async () => {
    const builder = new GraphBuilder()
    const a = builder.addVertex('A')
    const b = builder.addVertex('B')
    builder.addEdge(a, a)
    builder.addEdge(a, b)
    builder.addEdge(a, b)
    const result = await decoded(await encode(builder.build()))
    expect(edgeSummary(result.document)).toEqual(['A>A:-', 'A>B:-', 'A>B:-'])
  })

  it('rounds positions to whole units and keeps the drawing’s shape', async () => {
    const builder = new GraphBuilder()
    builder.addVertex('A', -1203.4, 88.6)
    builder.addVertex('B', -1000.2, 300.1)
    builder.addVertex('C', 250.7, -40.49)
    const doc = builder.build()

    const result = await decoded(await encode(doc))
    const out = result.document.vertices
    for (const v of out) {
      expect(Number.isInteger(v.x) && Number.isInteger(v.y)).toBe(true)
    }
    // Shifted to start at the origin, but every offset between vertices survives.
    expect(Math.min(...out.map((v) => v.x))).toBe(0)
    expect(Math.min(...out.map((v) => v.y))).toBe(0)
    for (let i = 1; i < doc.vertices.length; i++) {
      const dx = doc.vertices[i]!.x - doc.vertices[0]!.x
      const dy = doc.vertices[i]!.y - doc.vertices[0]!.y
      expect(Math.abs(out[i]!.x - out[0]!.x - dx)).toBeLessThanOrEqual(1)
      expect(Math.abs(out[i]!.y - out[0]!.y - dy)).toBeLessThanOrEqual(1)
    }
  })

  it('mints fresh ids rather than trusting the link’s', async () => {
    const doc = docFromEdges(['A-B'])
    const result = await decoded(await encode(doc))
    const before = new Set([...doc.vertices.map((v) => v.id), ...doc.edges.map((e) => e.id)])
    for (const v of result.document.vertices) expect(before.has(v.id)).toBe(false)
    for (const e of result.document.edges) expect(before.has(e.id)).toBe(false)
    const ids = new Set(result.document.vertices.map((v) => v.id))
    expect(result.document.edges.every((e) => ids.has(e.source) && ids.has(e.target))).toBe(true)
  })

  it('compresses a large graph and stays readable without compression', async () => {
    const builder = new GraphBuilder()
    for (let i = 0; i < 40; i++) builder.addVertex(`v${i}`, (i % 8) * 110, Math.floor(i / 8) * 110)
    for (let i = 0; i < 40; i++) builder.addEdgeByLabel(`v${i}`, `v${(i + 1) % 40}`)
    const doc = builder.build()

    const zipped = await encode(doc)
    expect(zipped.startsWith('1z.')).toBe(true)

    vi.stubGlobal('CompressionStream', undefined)
    const plain = await encode(doc)
    expect(plain.startsWith('1j.')).toBe(true)
    expect(zipped.length).toBeLessThan(plain.length)
    vi.unstubAllGlobals()

    for (const code of [zipped, plain]) {
      expect(edgeSummary((await decoded(code)).document)).toEqual(edgeSummary(doc))
    }
  })

  it('names an unnamed link, and shortens an over-long name rather than refusing it', async () => {
    const doc = docFromEdges(['A-B'])
    expect((await decoded(await encode(doc, '   '))).name).toBe(SHARED_GRAPH_NAME)
    const long = (await decoded(await encode(doc, 'n'.repeat(5000)))).name
    expect(long).toHaveLength(SHARE_LINK_LIMITS.text)
  })

  it('opens an empty graph', async () => {
    const result = await decoded(await encode({ vertices: [], edges: [], directed: true, weighted: false }))
    expect(result.document.vertices).toEqual([])
    expect(result.document.directed).toBe(true)
  })
})

/* ------------------------------------------------------------------ */
/* What the encoder refuses                                            */
/* ------------------------------------------------------------------ */

describe('share links the encoder refuses', () => {
  it('refuses more vertices than a link carries', async () => {
    const builder = new GraphBuilder()
    for (let i = 0; i <= SHARE_LINK_LIMITS.vertices; i++) builder.addVertex(`v${i}`)
    const result = await encodeShareCode({ name: 'big', doc: builder.build() })
    expect(result.ok).toBe(false)
    expect(!result.ok && result.reason).toMatch(/2,001 vertices.*at most 2,000/)
  })

  it('refuses an over-long vertex label', async () => {
    const builder = new GraphBuilder()
    builder.addVertex('x'.repeat(SHARE_LINK_LIMITS.text + 1))
    const result = await encodeShareCode({ name: 'g', doc: builder.build() })
    expect(result.ok).toBe(false)
    expect(!result.ok && result.reason).toMatch(/longer than 200 characters/)
  })

  it('says so when the link would be too long, instead of producing a broken one', async () => {
    // Incompressible labels, so that deflate cannot rescue it.
    const next = noise(7)
    const builder = new GraphBuilder()
    for (let i = 0; i < SHARE_LINK_LIMITS.vertices; i++) {
      let label = ''
      while (label.length < 150) label += next().toString(36)
      builder.addVertex(label.slice(0, 150), i, i)
    }
    const result = await encodeShareCode({ name: 'huge', doc: builder.build() })
    expect(result.ok).toBe(false)
    expect(!result.ok && result.reason).toMatch(/characters long, and links are limited to 100,000/)
  })

  it('refuses a graph that would unpack to more than a link may carry, though it packs small', async () => {
    // Exactly at the limit: a short code, and every recipient can open it.
    const fits = graphWithPayload(SHARE_LINK_LIMITS.json)
    const code = await encode(fits.doc, fits.name)
    expect(code.length).toBeLessThan(SHARE_LINK_LIMITS.code)
    const result = await decoded(code)
    expect(result.document.vertices.map((v) => v.label)).toEqual(fits.doc.vertices.map((v) => v.label))

    // One byte more still packs into a short code, but no decoder would open it.
    const over = graphWithPayload(SHARE_LINK_LIMITS.json + 1)
    const refusedResult = await encodeShareCode(over)
    expect(refusedResult.ok).toBe(false)
    expect(!refusedResult.ok && refusedResult.reason).toMatch(/1,000,001 bytes of data, and a link carries at most 1,000,000/)
  })
})

/* ------------------------------------------------------------------ */
/* What the decoder refuses                                            */
/* ------------------------------------------------------------------ */

describe('share links the decoder refuses', () => {
  const valid = { n: 'ok', v: [['A', 0, 0], ['B', 10, 0]], e: [[0, 1]] }

  it('accepts the hand-made baseline the hostile cases below are variations of', async () => {
    const result = await decoded(plainCode(valid))
    expect(result.document.vertices).toHaveLength(2)
  })

  it.each([
    ['nothing at all', undefined],
    ['null', null],
    ['a number', 42],
    ['an object', { v: [] }],
    ['an empty string', ''],
    ['whitespace', '   '],
    ['no prefix', 'eyJ2IjpbXSwiZSI6W119'],
    ['an unknown codec', '1x.eyJ2IjpbXSwiZSI6W119'],
    ['version zero', '0j.eyJ2IjpbXSwiZSI6W119'],
    ['characters outside base64url', '1j.eyJ2Ijpb+/XSwiZSI6W119'],
    ['an impossible base64 length', '1j.eyJ2I'],
    ['bytes that are not UTF-8', `1j.${bytesToBase64Url(new Uint8Array([0xff, 0xfe, 0x7b]))}`],
    ['text that is not JSON', `1j.${bytesToBase64Url(new TextEncoder().encode('{"v":[ oops'))}`],
    ['corrupt compressed data', '1z.AAAAAAAAAAAAAAAA'],
  ])('refuses %s', async (_, code) => {
    expect(await refused(code)).toMatch(/damaged or incomplete/)
  })

  it.each([
    ['a JSON array', [1, 2, 3]],
    ['missing vertex list', { e: [] }],
    ['missing edge list', { v: [] }],
    ['a vertex that is not a tuple', { ...valid, v: [{ label: 'A', x: 0, y: 0 }] }],
    ['a vertex with a numeric label', { ...valid, v: [[1, 0, 0], ['B', 0, 0]] }],
    ['a vertex with a string coordinate', { ...valid, v: [['A', '0', 0], ['B', 0, 0]] }],
    ['a vertex with an extra slot', { ...valid, v: [['A', 0, 0, 'x'], ['B', 0, 0]] }],
    ['an absurd coordinate', { ...valid, v: [['A', 1e300, 0], ['B', 0, 0]] }],
    ['an over-long label', { ...valid, v: [['x'.repeat(201), 0, 0], ['B', 0, 0]] }],
    ['an over-long name', { ...valid, n: 'n'.repeat(201) }],
    ['a name that is not text', { ...valid, n: { toString: 'x' } }],
    ['an edge to a missing vertex', { ...valid, e: [[0, 2]] }],
    ['an edge with a negative index', { ...valid, e: [[-1, 0]] }],
    ['an edge with a fractional index', { ...valid, e: [[0.5, 1]] }],
    ['an edge with a string weight', { ...valid, e: [[0, 1, '3']] }],
    ['an edge with a null weight', { ...valid, e: [[0, 1, null]] }],
    ['a one-ended edge', { ...valid, e: [[0]] }],
    ['a flag other than 0 or 1', { ...valid, d: true }],
    ['a weighted flag of 2', { ...valid, w: 2 }],
  ])('refuses %s', async (_, payload) => {
    expect(await refused(plainCode(payload))).toMatch(/damaged or incomplete/)
  })

  it('refuses a link with more vertices than a link carries', async () => {
    const v = Array.from({ length: SHARE_LINK_LIMITS.vertices + 1 }, () => ['', 0, 0])
    expect(await refused(plainCode({ v, e: [] }))).toMatch(/2,001 vertices/)
  })

  it('refuses a link with more edges than a link carries', async () => {
    const e = Array.from({ length: SHARE_LINK_LIMITS.edges + 1 }, () => [0, 0])
    expect(await refused(plainCode({ v: [['A', 0, 0]], e }))).toMatch(/10,001 edges/)
  })

  it('refuses an over-long code before decoding any of it', async () => {
    const atob = vi.fn(globalThis.atob)
    vi.stubGlobal('atob', atob)
    const code = `1j.${'A'.repeat(SHARE_LINK_LIMITS.code)}`
    expect(await refused(code)).toMatch(/longer than the 100,000 characters/)
    expect(atob).not.toHaveBeenCalled()
  })

  it('stops a compressed link that unpacks to too much data', async () => {
    // About a kilobyte on the wire, a couple of megabytes once inflated.
    const bomb = `{"v":[],"e":[],"x":"${' '.repeat(2_000_000)}"}`
    const code = `1z.${bytesToBase64Url(await deflated(bomb))}`
    expect(code.length).toBeLessThan(10_000)
    expect(await refused(code)).toMatch(/unpacks to more data/)
  })

  it('says a link from a newer version is from a newer version', async () => {
    expect(await refused('2z.AAAA')).toMatch(/newer version of Graphualize/)
  })

  it('says when this browser cannot unpack a compressed link', async () => {
    const code = await encode(docFromEdges(Array.from({ length: 30 }, (_, i) => `v${i}-v${i + 1}`)))
    expect(code.startsWith('1z.')).toBe(true)
    vi.stubGlobal('DecompressionStream', undefined)
    expect(await refused(code)).toMatch(/cannot unpack compressed links/)
  })

  it('refuses a link cut short in transit', async () => {
    const code = await encode(docFromEdges(Array.from({ length: 30 }, (_, i) => `v${i}-v${i + 1}`)))
    for (const cut of [code.length - 1, Math.floor(code.length / 2), 4]) {
      await refused(code.slice(0, cut))
    }
  })

  it('ignores keys it does not know, so later versions can add some', async () => {
    const result = await decoded(plainCode({ ...valid, future: { anything: true } }))
    expect(result.document.vertices).toHaveLength(2)
  })
})
