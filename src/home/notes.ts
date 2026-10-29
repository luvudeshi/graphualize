import type { GraphWitness } from '../graph/model/types'

/**
 * The notes written on the demo's plate: a few words of italic beside the
 * witness, joined to it by a thin leader ("a bridge", "cut vertex"), and for
 * a diameter a bracket measured along the drawing ("diameter 5"), the way an
 * engraver letters a plate.
 *
 * Everything here is pure geometry in screen pixels, worked out again from
 * where the vertices are drawn right now, so the notes follow a vertex that is
 * being dragged and find new places when the stage is resized. A note never
 * covers a vertex, a vertex's letter or another note. Where there is no room
 * for the words, the note shrinks to its mark alone: the same glyph the
 * property list shows, set beside the witness, so the list still keys it.
 */

export interface Point {
  x: number
  y: number
}

export interface Box {
  x0: number
  y0: number
  x1: number
  y1: number
}

export interface Plotted {
  x: number
  y: number
  /** The radius the point is drawn at, in pixels. */
  r: number
}

/** The demo as it is drawn on screen at this moment. */
export interface Plot {
  width: number
  height: number
  vertices: ReadonlyMap<string, Plotted>
  /** The box each vertex's letter occupies. No note may touch one. */
  letters: ReadonlyMap<string, Box>
  /** Each vertex's letter, for the notes' wording ("the triangle ABC"). */
  names: ReadonlyMap<string, string>
  edges: readonly { id: string; source: string; target: string }[]
  /** How wide a witness edge is drawn, so a leader can start at its side. */
  stroke: number
}

export interface Subject {
  /** The property's row id. */
  id: string
  value: string
  witness?: GraphWitness
}

/** How wide a run of the notes' italic is, in pixels. */
export type Measure = (text: string) => number

/** The words of a note, set on one line: the property's glyph, then the text. */
export interface Lettering {
  text: string
  centre: Point
  /** 0 for a line of text, -90 for one that reads up the side of the plate. */
  angle: 0 | -90
  /** The width of glyph and text together, before any turning. */
  width: number
  box: Box
}

/**
 * A note on the plate. `key` names what it is about (a vertex or an edge),
 * and `theta`, `leg` and `side` say how it was placed, so that the next
 * placement, a frame later in a drag, can keep to the same spot while it
 * still fits rather than jump about.
 */
export type Note =
  | { kind: 'leader'; key: string; theta: number; leg: number; from: Point; to: Point; lettering: Lettering }
  /** No room for the words: the property's glyph alone, beside its subject. */
  | { kind: 'mark'; key: string; theta: number; at: Point; box: Box }
  | {
      kind: 'dimension'
      key: string
      side: string
      line: [Point, Point]
      ticks: [Point, Point][]
      extensions: [Point, Point][]
      lettering: Lettering
    }

/** The glyph's square, the space after it, and the height of a line of notes. */
export const GLYPH = 11
export const GLYPH_GAP = 5
export const NOTE_LINE = 20

/** EB Garamond italic at the notes' size averages a little under half an em. */
export const roughMeasure: Measure = (text) => text.length * 7.3

const STAGE_MARGIN = 4
/** Notes keep further in from the side rules, which they would otherwise crowd. */
const STAGE_MARGIN_X = 10
const ANGLES = Array.from({ length: 24 }, (_, i) => -90 + i * 15)
const LEGS = [24, 34, 48, 66]
/** Anything below this is a note that sits on something it must not. */
const REJECT = -1e6

/* ------------------------------------------------------------------ */
/* Geometry                                                            */
/* ------------------------------------------------------------------ */

const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y })
const add = (a: Point, b: Point): Point => ({ x: a.x + b.x, y: a.y + b.y })
const times = (a: Point, k: number): Point => ({ x: a.x * k, y: a.y * k })
const dot = (a: Point, b: Point) => a.x * b.x + a.y * b.y
const norm = (a: Point) => Math.hypot(a.x, a.y)
const unit = (a: Point): Point => {
  const n = norm(a)
  return n === 0 ? { x: 0, y: -1 } : times(a, 1 / n)
}
const mid = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
const grow = (b: Box, by: number): Box => ({ x0: b.x0 - by, y0: b.y0 - by, x1: b.x1 + by, y1: b.y1 + by })

export const boxesOverlap = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1

const circleHitsBox = (c: Point, r: number, b: Box) => {
  const x = Math.max(b.x0, Math.min(c.x, b.x1))
  const y = Math.max(b.y0, Math.min(c.y, b.y1))
  return Math.hypot(c.x - x, c.y - y) < r
}

const cross = (a: Point, b: Point, c: Point) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)

const segmentsCross = (p: Point, q: Point, r: Point, s: Point) =>
  cross(r, s, p) * cross(r, s, q) < 0 && cross(p, q, r) * cross(p, q, s) < 0

const inBox = (p: Point, b: Box) => p.x >= b.x0 && p.x <= b.x1 && p.y >= b.y0 && p.y <= b.y1

export const segmentHitsBox = (p: Point, q: Point, b: Box) => {
  if (inBox(p, b) || inBox(q, b)) return true
  const corners = [
    { x: b.x0, y: b.y0 },
    { x: b.x1, y: b.y0 },
    { x: b.x1, y: b.y1 },
    { x: b.x0, y: b.y1 },
  ]
  return corners.some((c, i) => segmentsCross(p, q, c, corners[(i + 1) % 4]!))
}

const distanceToSegment = (c: Point, p: Point, q: Point) => {
  const pq = sub(q, p)
  const t = Math.max(0, Math.min(1, dot(sub(c, p), pq) / Math.max(dot(pq, pq), 1e-9)))
  return norm(sub(c, add(p, times(pq, t))))
}

/** How far along a ray from `o` in direction `d` it leaves the box, or null if it never enters. */
const rayExit = (o: Point, d: Point, b: Box): number | null => {
  let near = -Infinity
  let far = Infinity
  for (const [origin, dir, lo, hi] of [
    [o.x, d.x, b.x0, b.x1],
    [o.y, d.y, b.y0, b.y1],
  ] as const) {
    if (Math.abs(dir) < 1e-9) {
      if (origin < lo || origin > hi) return null
      continue
    }
    const t1 = (lo - origin) / dir
    const t2 = (hi - origin) / dir
    near = Math.max(near, Math.min(t1, t2))
    far = Math.min(far, Math.max(t1, t2))
  }
  return far >= Math.max(near, 0) ? far : null
}

const inside = (b: Box, plot: Plot) =>
  b.x0 >= STAGE_MARGIN_X &&
  b.y0 >= STAGE_MARGIN &&
  b.x1 <= plot.width - STAGE_MARGIN_X &&
  b.y1 <= plot.height - STAGE_MARGIN

/** The lettering of a note set on one line, centred at a point. */
const letter = (text: string, centre: Point, measure: Measure, angle: 0 | -90 = 0): Lettering => {
  const width = GLYPH + (text ? GLYPH_GAP + measure(text) : 0)
  const [w, h] = angle === 0 ? [width, NOTE_LINE] : [NOTE_LINE, width]
  return {
    text,
    centre,
    angle,
    width,
    box: { x0: centre.x - w / 2, y0: centre.y - h / 2, x1: centre.x + w / 2, y1: centre.y + h / 2 },
  }
}

/* ------------------------------------------------------------------ */
/* What is already on the plate                                        */
/* ------------------------------------------------------------------ */

interface Taken {
  boxes: Box[]
  segments: [Point, Point][]
}

const segmentsOf = (plot: Plot): { id: string; ends: [Point, Point] }[] =>
  plot.edges.flatMap(({ id, source, target }) => {
    const p = plot.vertices.get(source)
    const q = plot.vertices.get(target)
    return p && q && source !== target ? [{ id, ends: [p, q] as [Point, Point] }] : []
  })

/** A box of words: may it go here, and if so how much does it cost? */
const boxCost = (box: Box, plot: Plot, taken: Taken, lines: [Point, Point][]) => {
  if (!inside(box, plot)) return REJECT
  for (const v of plot.vertices.values()) if (circleHitsBox(v, v.r + 3, box)) return REJECT
  for (const l of plot.letters.values()) if (boxesOverlap(box, grow(l, 2))) return REJECT
  for (const other of taken.boxes) if (boxesOverlap(box, grow(other, 6))) return REJECT
  for (const [p, q] of taken.segments) if (segmentHitsBox(p, q, grow(box, 2))) return REJECT
  // Words across a line of the drawing can still be read, but only just.
  let cost = 0
  for (const [p, q] of lines) if (segmentHitsBox(p, q, grow(box, 1))) cost -= 60
  return cost
}

/** A leader or rule: may it run here, and at what cost? `own` is the vertex it starts on. */
const lineCost = (
  p: Point,
  q: Point,
  plot: Plot,
  taken: Taken,
  lines: [Point, Point][],
  own: readonly string[] = [],
) => {
  for (const [id, v] of plot.vertices) {
    if (!own.includes(id) && distanceToSegment(v, p, q) < v.r + 2) return REJECT
  }
  for (const l of plot.letters.values()) if (segmentHitsBox(p, q, grow(l, 1))) return REJECT
  for (const b of taken.boxes) if (segmentHitsBox(p, q, grow(b, 2))) return REJECT
  for (const [r, s] of taken.segments) if (segmentsCross(p, q, r, s)) return REJECT
  let cost = 0
  for (const [r, s] of lines) if (segmentsCross(p, q, r, s)) cost -= 25
  return cost
}

/* ------------------------------------------------------------------ */
/* Leaders                                                             */
/* ------------------------------------------------------------------ */

interface Anchor {
  /** The vertex or edge the note is about. */
  key: string
  at: Point
  /** How far out from `at` the leader starts: off the point, or off the side of a thick edge. */
  clearance: number
  /** Directions a leader should not run along: the lines through `at`. */
  along: Point[]
  /** Leaders should head this way, out of a cycle or away from the drawing. */
  outward?: Point
  own: string[]
}

interface Candidate {
  note: Note
  box: Box
  segments: [Point, Point][]
  score: number
}

/** How much staying where a note was is worth, so it does not flicker between two spots. */
const STAY = 14

const leaderAt = (
  anchor: Anchor,
  text: string,
  plot: Plot,
  taken: Taken,
  lines: [Point, Point][],
  measure: Measure,
  centroid: Point,
  before?: Note,
): Candidate | null => {
  let best: Candidate | null = null
  const away = unit(sub(anchor.at, centroid))
  for (const theta of ANGLES) {
    const d = { x: Math.cos((theta * Math.PI) / 180), y: Math.sin((theta * Math.PI) / 180) }
    if (anchor.outward && dot(d, anchor.outward) < 0.2) continue
    let bend = 0
    for (const line of anchor.along) {
      const cos = Math.abs(dot(d, unit(line)))
      if (cos > Math.cos((28 * Math.PI) / 180)) bend -= 40
    }
    for (const leg of LEGS) {
      const from = add(anchor.at, times(d, anchor.clearance))
      const to = add(anchor.at, times(d, anchor.clearance + leg))
      const draft = letter(text, { x: 0, y: 0 }, measure)
      // Words run off the end of the leader: beside it if the leader slopes,
      // centred over or under it if it stands nearly upright.
      const upright = Math.abs(d.x) < 0.42
      const centre = upright
        ? { x: to.x, y: to.y + Math.sign(d.y) * (NOTE_LINE / 2 + 2) }
        : { x: to.x + Math.sign(d.x) * (draft.width / 2 + 4), y: to.y }
      const lettering = letter(text, centre, measure)
      const boxScore = boxCost(lettering.box, plot, taken, lines)
      if (boxScore <= REJECT) continue
      const runScore = lineCost(from, to, plot, taken, lines, anchor.own)
      if (runScore <= REJECT) continue
      const score =
        boxScore +
        runScore +
        bend -
        leg * 0.35 +
        (d.y < 0 ? 6 : 0) +
        dot(d, away) * 14 +
        (anchor.outward ? dot(d, anchor.outward) * 10 : 0) +
        (before?.kind === 'leader' && before.theta === theta ? STAY + (before.leg === leg ? STAY / 2 : 0) : 0)
      if (!best || score > best.score) {
        best = {
          note: { kind: 'leader', key: anchor.key, theta, leg, from, to, lettering },
          box: lettering.box,
          segments: [[from, to]],
          score,
        }
      }
    }
  }
  return best
}

/** The glyph alone, as close to its subject as it can sit. */
const markAt = (
  anchor: Anchor,
  plot: Plot,
  taken: Taken,
  lines: [Point, Point][],
  before?: Note,
): Candidate | null => {
  let best: Candidate | null = null
  for (const theta of ANGLES) {
    const d = { x: Math.cos((theta * Math.PI) / 180), y: Math.sin((theta * Math.PI) / 180) }
    if (anchor.outward && dot(d, anchor.outward) < 0) continue
    for (const gap of [4, 10, 18]) {
      const at = add(anchor.at, times(d, anchor.clearance + gap + GLYPH / 2))
      const box = { x0: at.x - GLYPH / 2, y0: at.y - GLYPH / 2, x1: at.x + GLYPH / 2, y1: at.y + GLYPH / 2 }
      const fit = boxCost(box, plot, taken, lines)
      if (fit <= REJECT) continue
      let bend = 0
      for (const line of anchor.along) if (Math.abs(dot(d, unit(line))) > 0.88) bend -= 30
      const stay = before?.kind === 'mark' && before.theta === theta ? STAY : 0
      const score = fit + bend - gap + (d.y < 0 ? 4 : 0) + stay
      if (!best || score > best.score) {
        best = { note: { kind: 'mark', key: anchor.key, theta, at, box }, box, segments: [], score }
      }
    }
  }
  return best
}

/**
 * Places one note per anchor, or with `oneOf` a single note at whichever
 * anchor has the best spot (a cycle needs naming only once).
 *
 * Greedy placement depends on order, so a few orders are tried and the one
 * that letters the most notes in full, and then scores best, wins.
 */
const placeLeaders = (
  anchors: Anchor[],
  text: string,
  plot: Plot,
  taken: Taken,
  measure: Measure,
  before: ReadonlyMap<string, Note>,
  oneOf = false,
): Note[] => {
  const lines = segmentsOf(plot).map((s) => s.ends)
  const points = [...plot.vertices.values()]
  const centroid = points.length
    ? times(points.reduce((sum, p) => add(sum, p), { x: 0, y: 0 }), 1 / points.length)
    : { x: plot.width / 2, y: plot.height / 2 }

  const choose = (anchor: Anchor, now: Taken) => {
    const was = before.get(anchor.key)
    return (
      leaderAt(anchor, text, plot, now, lines, measure, centroid, was) ??
      markAt(anchor, plot, now, lines, was)
    )
  }

  if (oneOf) {
    // Naming a cycle once, on whichever edge has the best spot, and on the
    // same edge as last time while that one still fits.
    const options = anchors
      .map((anchor) => {
        const pick = choose(anchor, taken)
        if (pick && before.has(anchor.key)) pick.score += STAY
        return pick
      })
      .filter((c): c is Candidate => c !== null)
      .sort((a, b) => (b.note.kind === 'leader' ? 1 : 0) - (a.note.kind === 'leader' ? 1 : 0) || b.score - a.score)
    const top = options[0]
    if (!top) return []
    taken.boxes.push(top.box)
    taken.segments.push(...top.segments)
    return [top.note]
  }

  const orders: number[][] = []
  const base = anchors.map((_, i) => i)
  for (let shift = 0; shift < base.length; shift++) {
    orders.push([...base.slice(shift), ...base.slice(0, shift)])
  }
  orders.push([...base].reverse())

  let best: { notes: (Note | null)[]; full: number; score: number; added: Taken } | null = null
  for (const order of orders) {
    const local: Taken = { boxes: [...taken.boxes], segments: [...taken.segments] }
    const notes: (Note | null)[] = anchors.map(() => null)
    let full = 0
    let score = 0
    for (const i of order) {
      const pick = choose(anchors[i]!, local)
      if (!pick) continue
      notes[i] = pick.note
      local.boxes.push(pick.box)
      local.segments.push(...pick.segments)
      if (pick.note.kind === 'leader') full++
      score += pick.score
    }
    if (!best || full > best.full || (full === best.full && score > best.score)) {
      best = { notes, full, score, added: local }
    }
  }
  if (!best) return []
  taken.boxes.splice(0, taken.boxes.length, ...best.added.boxes)
  taken.segments.splice(0, taken.segments.length, ...best.added.segments)
  // In the witness's own order, so the notes are stable from frame to frame.
  return best.notes.filter((note): note is Note => note !== null)
}

/* ------------------------------------------------------------------ */
/* The bracket for a distance                                          */
/* ------------------------------------------------------------------ */

const TICK = 5
const RULE_GAP = 12

/**
 * A bracket from one end of a path to the other, set clear of everything it
 * spans, with dotted extension lines down to the two ends and the words
 * beyond it. Horizontal or upright, whichever the ends allow, on whichever
 * side needs the shorter extension lines.
 */
const bracket = (
  ends: [string, string],
  text: string,
  plot: Plot,
  taken: Taken,
  measure: Measure,
  before?: Note,
): Candidate | null => {
  const a = plot.vertices.get(ends[0])
  const b = plot.vertices.get(ends[1])
  if (!a || !b) return null
  const lines = segmentsOf(plot).map((s) => s.ends)
  const width = letter(text, { x: 0, y: 0 }, measure).width
  let best: Candidate | null = null

  const all = [...plot.vertices.values()]
  for (const axis of ['x', 'y'] as const) {
    const span = Math.abs(axis === 'x' ? b.x - a.x : b.y - a.y)
    if (span < width + 16) continue
    // A bracket says "from this end of the figure to that one", so it is only
    // drawn along an axis the path really runs the length of.
    const along = all.map((v) => (axis === 'x' ? v.x : v.y))
    if (span < (Math.max(...along) - Math.min(...along)) * 0.6) continue
    const [lo, hi] = axis === 'x' ? [Math.min(a.x, b.x), Math.max(a.x, b.x)] : [Math.min(a.y, b.y), Math.max(a.y, b.y)]
    // Everything the bracket passes over: points, letters and the edges between.
    const extents: { lo: number; hi: number; near: number; far: number }[] = []
    for (const v of plot.vertices.values()) {
      const [along, across] = axis === 'x' ? [v.x, v.y] : [v.y, v.x]
      extents.push({ lo: along - v.r, hi: along + v.r, near: across - v.r, far: across + v.r })
    }
    for (const l of plot.letters.values()) {
      extents.push(
        axis === 'x'
          ? { lo: l.x0, hi: l.x1, near: l.y0, far: l.y1 }
          : { lo: l.y0, hi: l.y1, near: l.x0, far: l.x1 },
      )
    }
    for (const side of [-1, 1]) {
      let reach = side < 0 ? Infinity : -Infinity
      for (const e of extents) {
        if (e.hi < lo - 6 || e.lo > hi + 6) continue
        reach = side < 0 ? Math.min(reach, e.near) : Math.max(reach, e.far)
      }
      if (!Number.isFinite(reach)) continue
      const level = reach + side * RULE_GAP
      const at = (along: number): Point => (axis === 'x' ? { x: along, y: level } : { x: level, y: along })
      const [first, last] = axis === 'x' ? [a.x, b.x] : [a.y, b.y]
      const line: [Point, Point] = [at(first), at(last)]
      const ticks: [Point, Point][] = line.map((p) =>
        axis === 'x'
          ? [{ x: p.x, y: p.y - TICK }, { x: p.x, y: p.y + TICK }]
          : [{ x: p.x - TICK, y: p.y }, { x: p.x + TICK, y: p.y }],
      ) as [Point, Point][]
      // Dotted lines from each end of the path out to the bracket. One that
      // would run over its own vertex's letter starts beyond it instead.
      const extension = (id: string, v: Plotted, foot: Point): [Point, Point] | null => {
        const dir = unit(sub(foot, v))
        let start = v.r + 4
        const own = plot.letters.get(id)
        const past = own ? rayExit(v, dir, grow(own, 6)) : null
        if (past !== null) start = Math.max(start, past + 8)
        const end = norm(sub(foot, v)) - TICK - 2
        return end - start >= 6 ? [add(v, times(dir, start)), add(v, times(dir, end))] : null
      }
      const first0 = extension(ends[0], a, line[0])
      const last0 = extension(ends[1], b, line[1])
      if (!first0 || !last0) continue
      const extensions: [Point, Point][] = [first0, last0]
      const reachOut = side * (NOTE_LINE / 2 + 5)
      const centre = axis === 'x' ? { x: (first + last) / 2, y: level + reachOut } : { x: level + reachOut, y: (first + last) / 2 }
      const lettering = letter(text, centre, measure, axis === 'x' ? 0 : -90)

      let score = 0
      const ruleBox: Box = grow(
        {
          x0: Math.min(line[0].x, line[1].x),
          y0: Math.min(line[0].y, line[1].y),
          x1: Math.max(line[0].x, line[1].x),
          y1: Math.max(line[0].y, line[1].y),
        },
        TICK,
      )
      if (!inside(ruleBox, plot)) continue
      const fit = boxCost(lettering.box, plot, taken, lines)
      if (fit <= REJECT) continue
      score += fit
      let clear = true
      for (const [p, q] of [line, ...extensions]) {
        const own = p === extensions[0]?.[0] ? [ends[0]] : p === extensions[1]?.[0] ? [ends[1]] : []
        const run = lineCost(p, q, plot, taken, lines, own)
        // Nor may a dotted line cut across the figure on its way out.
        if (run <= REJECT || run < 0) {
          clear = false
          break
        }
        score += run
      }
      if (!clear) continue
      const length = extensions.reduce((sum, [p, q]) => sum + norm(sub(q, p)), 0)
      const placed = `${axis}${side}`
      score -= length * 0.5 + (axis === 'y' ? 30 : 0)
      if (before?.kind === 'dimension' && before.side === placed) score += STAY * 3
      if (!best || score > best.score) {
        best = {
          note: { kind: 'dimension', key: ends.join('|'), side: placed, line, ticks, extensions, lettering },
          box: grow(
            {
              x0: Math.min(ruleBox.x0, lettering.box.x0),
              y0: Math.min(ruleBox.y0, lettering.box.y0),
              x1: Math.max(ruleBox.x1, lettering.box.x1),
              y1: Math.max(ruleBox.y1, lettering.box.y1),
            },
            0,
          ),
          segments: [line, ...extensions],
          score,
        }
      }
    }
  }
  return best
}

/* ------------------------------------------------------------------ */
/* What each property says                                             */
/* ------------------------------------------------------------------ */

const SHAPES: Record<number, string> = { 3: 'triangle', 4: 'quadrilateral', 5: 'pentagon', 6: 'hexagon' }

/** The words for a property, in the voice of the book. */
export const wording = (subject: Subject, names: ReadonlyMap<string, string>): string => {
  const { witness, id, value } = subject
  if (!witness) return ''
  switch (witness.type) {
    case 'cycle': {
      const n = witness.edgeIds.length
      const letters = witness.vertexIds.map((v) => names.get(v) ?? '')
      const shape = SHAPES[n]
      const named = shape ? `the ${shape} ${[...letters].sort().join('')}` : `the cycle ${letters.join('')}`
      return id === 'bipartite' && n % 2 === 1 ? `${named}, of odd length` : named
    }
    case 'edges':
      return id === 'bridges' ? 'a bridge' : ''
    case 'vertices':
      if (id === 'articulation') return 'cut vertex'
      if (id === 'eulerCircuit' || id === 'eulerTrail') return 'odd degree'
      return witness.caption?.toLowerCase() ?? ''
    case 'path':
    case 'trail':
      return id === 'diameter' ? `diameter ${value}` : `length ${witness.edgeIds.length}`
    default:
      return ''
  }
}

/**
 * The notes that explain one property of the demo, in stage pixels. Empty for
 * a property with nothing to point at.
 *
 * `before` is what was placed for the same property a moment ago, if
 * anything: each note keeps to its old spot while that still fits.
 */
export const annotate = (
  subject: Subject,
  plot: Plot,
  measure: Measure = roughMeasure,
  before: readonly Note[] = [],
): Note[] => {
  const { witness } = subject
  if (!witness || plot.vertices.size === 0) return []
  const text = wording(subject, plot.names)
  const taken: Taken = { boxes: [], segments: [] }
  const was = new Map(before.map((note) => [note.key, note]))
  const edgeById = new Map(plot.edges.map((edge) => [edge.id, edge]))

  const neighbours = (id: string) =>
    plot.edges.flatMap((e) => (e.source === id ? [e.target] : e.target === id ? [e.source] : []))

  const vertexAnchor = (id: string): Anchor | null => {
    const v = plot.vertices.get(id)
    if (!v) return null
    return {
      key: id,
      at: v,
      clearance: v.r + 3,
      along: neighbours(id).flatMap((other) => {
        const there = plot.vertices.get(other)
        return there ? [sub(there, v)] : []
      }),
      own: [id],
    }
  }

  const edgeAnchor = (id: string, outwardFrom?: Point): Anchor | null => {
    const edge = edgeById.get(id)
    const p = edge && plot.vertices.get(edge.source)
    const q = edge && plot.vertices.get(edge.target)
    if (!edge || !p || !q) return null
    const at = mid(p, q)
    const along = sub(q, p)
    return {
      key: id,
      at,
      clearance: plot.stroke / 2 + 2,
      along: [along],
      outward: outwardFrom ? unit(sub(at, outwardFrom)) : undefined,
      own: [],
    }
  }

  const real = <T>(items: (T | null)[]) => items.filter((item): item is T => item !== null)

  switch (witness.type) {
    case 'vertices':
      return placeLeaders(real(witness.vertexIds.map(vertexAnchor)), text, plot, taken, measure, was)
    case 'edges':
    case 'matching':
    case 'tree':
      return placeLeaders(real(witness.edgeIds.map((id) => edgeAnchor(id))), text, plot, taken, measure, was)
    case 'cycle': {
      const corners = real(witness.vertexIds.map((id) => plot.vertices.get(id) ?? null))
      const centre = corners.length
        ? times(corners.reduce((s, p) => add(s, p), { x: 0, y: 0 }), 1 / corners.length)
        : undefined
      const anchors = real(witness.edgeIds.map((id) => edgeAnchor(id, centre)))
      const notes = placeLeaders(anchors, text, plot, taken, measure, was, true)
      // On the narrowest stage the full wording may find no room at all; the
      // figure's name alone still can, which beats a bare mark.
      const short = text.replace(/, of odd length$/, '')
      if (short === text || notes.some((note) => note.kind === 'leader')) return notes
      return placeLeaders(anchors, short, plot, { boxes: [], segments: [] }, measure, was, true)
    }
    case 'path':
    case 'trail': {
      const first = witness.vertexIds[0]
      const last = witness.vertexIds.at(-1)
      if (first && last && first !== last) {
        const a = plot.vertices.get(first)
        const b = plot.vertices.get(last)
        // Measured left to right, or top to bottom, so the words read forwards.
        const ends: [string, string] =
          a && b && (a.x < b.x || (a.x === b.x && a.y <= b.y)) ? [first, last] : [last, first]
        const measured = bracket(ends, text, plot, taken, measure, before[0])
        if (measured) return [measured.note]
      }
      // No room to measure it: name the path at its middle edge instead.
      const middle = witness.edgeIds[Math.floor(witness.edgeIds.length / 2)]
      const anchor = middle ? edgeAnchor(middle) : null
      return anchor ? placeLeaders([anchor], text, plot, taken, measure, was) : []
    }
    default:
      return []
  }
}

/**
 * Writes the notes for whichever property is on show, remembering what it
 * wrote last time: called again for the same property (a frame later in a
 * drag, or after a resize), each note keeps to its old spot while that fits.
 */
export const notebook = () => {
  let last: { id: string; notes: Note[] } | null = null
  return (subject: Subject, plot: Plot, measure: Measure = roughMeasure): Note[] => {
    const notes = annotate(subject, plot, measure, last?.id === subject.id ? last.notes : [])
    last = { id: subject.id, notes }
    return notes
  }
}

/** The outline of everything a note occupies, for checking that notes keep clear. */
export const noteBox = (note: Note): Box => (note.kind === 'mark' ? note.box : note.lettering.box)
