import type { Graph } from './model/graph'
import type { VertexId } from './model/types'

export type LayoutName =
  | 'circle'
  | 'grid'
  | 'concentric'
  | 'breadthfirst'
  | 'force'
  | 'bipartite'

export type Positions = Record<VertexId, { x: number; y: number }>

export interface LayoutOptions {
  /** Half-width of the drawing area in graph units. */
  radius?: number
  spacing?: number
  center?: { x: number; y: number }
  /** Deterministic seed for the force layout. */
  seed?: number
  partition?: [VertexId[], VertexId[]]
  roots?: VertexId[]
}

const DEFAULT_CENTER = { x: 0, y: 0 }

const mulberry32 = (seed: number) => {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const circleLayout = (
  ids: readonly VertexId[],
  options: LayoutOptions = {},
): Positions => {
  const center = options.center ?? DEFAULT_CENTER
  const n = ids.length
  const spacing = options.spacing ?? 90
  const radius = options.radius ?? Math.max(90, (spacing * n) / (2 * Math.PI))
  const out: Positions = {}
  ids.forEach((id, i) => {
    const angle = (2 * Math.PI * i) / Math.max(1, n) - Math.PI / 2
    out[id] = {
      x: center.x + radius * Math.cos(angle),
      y: center.y + radius * Math.sin(angle),
    }
  })
  return out
}

export const gridLayout = (
  ids: readonly VertexId[],
  options: LayoutOptions & { columns?: number } = {},
): Positions => {
  const spacing = options.spacing ?? 120
  const center = options.center ?? DEFAULT_CENTER
  const cols = options.columns ?? Math.max(1, Math.ceil(Math.sqrt(ids.length)))
  const rows = Math.max(1, Math.ceil(ids.length / cols))
  const out: Positions = {}
  ids.forEach((id, i) => {
    const c = i % cols
    const r = Math.floor(i / cols)
    out[id] = {
      x: center.x + (c - (cols - 1) / 2) * spacing,
      y: center.y + (r - (rows - 1) / 2) * spacing,
    }
  })
  return out
}

/** Layered layout: BFS levels stacked vertically, siblings spread across. */
export const breadthFirstLayout = (
  graph: Graph,
  options: LayoutOptions = {},
): Positions => {
  const spacing = options.spacing ?? 120
  const center = options.center ?? DEFAULT_CENTER
  const seen = new Set<VertexId>()
  const levels: VertexId[][] = []
  const roots = options.roots?.length ? options.roots : graph.vertexIds

  for (const root of roots) {
    if (seen.has(root)) continue
    let frontier = [root]
    seen.add(root)
    let depth = 0
    while (frontier.length) {
      const bucket = (levels[depth] ??= [])
      bucket.push(...frontier)
      const next: VertexId[] = []
      for (const v of frontier) {
        for (const n of graph.successors(v)) {
          if (!seen.has(n.to)) {
            seen.add(n.to)
            next.push(n.to)
          }
        }
      }
      frontier = next
      depth += 1
    }
  }
  // Vertices unreachable through successors (directed graphs) get a final row.
  const leftovers = graph.vertexIds.filter((id) => !seen.has(id))
  if (leftovers.length) levels.push(leftovers)

  const out: Positions = {}
  levels.forEach((row, r) => {
    row.forEach((id, i) => {
      out[id] = {
        x: center.x + (i - (row.length - 1) / 2) * spacing,
        y: center.y + (r - (levels.length - 1) / 2) * spacing,
      }
    })
  })
  return out
}

export const concentricLayout = (
  graph: Graph,
  options: LayoutOptions = {},
): Positions => {
  const center = options.center ?? DEFAULT_CENTER
  const spacing = options.spacing ?? 110
  const sorted = graph.vertexIds
    .slice()
    .sort((a, b) => graph.degree(b) - graph.degree(a))
  const rings: VertexId[][] = []
  let ringIndex = 0
  let cursor = 0
  while (cursor < sorted.length) {
    const capacity = ringIndex === 0 ? 1 : ringIndex * 6
    rings.push(sorted.slice(cursor, cursor + capacity))
    cursor += capacity
    ringIndex += 1
  }
  const out: Positions = {}
  rings.forEach((ring, r) => {
    if (r === 0 && ring.length === 1) {
      out[ring[0]!] = { ...center }
      return
    }
    Object.assign(
      out,
      circleLayout(ring, { center, radius: spacing * r + spacing * 0.6 }),
    )
  })
  return out
}

export const bipartiteLayout = (
  groups: [VertexId[], VertexId[]],
  options: LayoutOptions = {},
): Positions => {
  const spacing = options.spacing ?? 100
  const center = options.center ?? DEFAULT_CENTER
  const gap = options.radius ?? 260
  const out: Positions = {}
  groups.forEach((group, gi) => {
    group.forEach((id, i) => {
      out[id] = {
        x: center.x + (gi === 0 ? -gap / 2 : gap / 2),
        y: center.y + (i - (group.length - 1) / 2) * spacing,
      }
    })
  })
  return out
}

/**
 * Deterministic Fruchterman-Reingold force layout. Good enough for the
 * educational graph sizes Graphualize targets, and seeded so repeated runs
 * on the same graph produce the same picture.
 */
export const forceLayout = (graph: Graph, options: LayoutOptions = {}): Positions => {
  const ids = graph.vertexIds
  const n = ids.length
  if (n === 0) return {}
  if (n === 1) return { [ids[0]!]: { ...(options.center ?? DEFAULT_CENTER) } }

  const center = options.center ?? DEFAULT_CENTER
  const area = Math.max(1, n) * 140 * 140
  const k = Math.sqrt(area / n)
  const rand = mulberry32(options.seed ?? 20240817)

  const pos = new Map<VertexId, { x: number; y: number }>()
  // Seed from a circle so symmetric graphs settle into symmetric pictures.
  const seedPositions = circleLayout(ids, { center, radius: Math.sqrt(area) / 2.6 })
  for (const id of ids) {
    const p = seedPositions[id]!
    pos.set(id, { x: p.x + (rand() - 0.5) * 4, y: p.y + (rand() - 0.5) * 4 })
  }

  const iterations = n <= 60 ? 320 : n <= 200 ? 180 : 90
  let temperature = Math.sqrt(area) / 8

  const disp = new Map<VertexId, { x: number; y: number }>()
  for (let step = 0; step < iterations; step++) {
    for (const id of ids) disp.set(id, { x: 0, y: 0 })

    for (let i = 0; i < n; i++) {
      const a = pos.get(ids[i]!)!
      for (let j = i + 1; j < n; j++) {
        const b = pos.get(ids[j]!)!
        let dx = a.x - b.x
        let dy = a.y - b.y
        let dist = Math.hypot(dx, dy)
        if (dist < 0.01) {
          dx = (rand() - 0.5) * 0.1
          dy = (rand() - 0.5) * 0.1
          dist = Math.hypot(dx, dy) || 0.01
        }
        const force = (k * k) / dist
        const da = disp.get(ids[i]!)!
        const db = disp.get(ids[j]!)!
        da.x += (dx / dist) * force
        da.y += (dy / dist) * force
        db.x -= (dx / dist) * force
        db.y -= (dy / dist) * force
      }
    }

    for (const e of graph.edges) {
      if (e.source === e.target) continue
      const a = pos.get(e.source)!
      const b = pos.get(e.target)!
      const dx = a.x - b.x
      const dy = a.y - b.y
      const dist = Math.max(0.01, Math.hypot(dx, dy))
      const force = (dist * dist) / k
      const da = disp.get(e.source)!
      const db = disp.get(e.target)!
      da.x -= (dx / dist) * force
      da.y -= (dy / dist) * force
      db.x += (dx / dist) * force
      db.y += (dy / dist) * force
    }

    for (const id of ids) {
      const d = disp.get(id)!
      const p = pos.get(id)!
      const len = Math.max(0.01, Math.hypot(d.x, d.y))
      p.x += (d.x / len) * Math.min(len, temperature)
      p.y += (d.y / len) * Math.min(len, temperature)
    }
    temperature = Math.max(0.5, temperature * 0.965)
  }

  // Recentre so the result sits where the caller expects.
  let cx = 0
  let cy = 0
  for (const id of ids) {
    const p = pos.get(id)!
    cx += p.x
    cy += p.y
  }
  cx /= n
  cy /= n
  const out: Positions = {}
  for (const id of ids) {
    const p = pos.get(id)!
    out[id] = { x: p.x - cx + center.x, y: p.y - cy + center.y }
  }
  return out
}

export const LAYOUT_LABELS: Record<LayoutName, string> = {
  circle: 'Circle',
  grid: 'Grid',
  concentric: 'Concentric',
  breadthfirst: 'Breadth-first',
  force: 'Force-directed',
  bipartite: 'Bipartite',
}

export const applyLayout = (
  graph: Graph,
  name: LayoutName,
  options: LayoutOptions = {},
): Positions => {
  switch (name) {
    case 'circle':
      return circleLayout(graph.vertexIds, options)
    case 'grid':
      return gridLayout(graph.vertexIds, options)
    case 'concentric':
      return concentricLayout(graph, options)
    case 'breadthfirst':
      return breadthFirstLayout(graph, options)
    case 'bipartite':
      return options.partition
        ? bipartiteLayout(options.partition, options)
        : circleLayout(graph.vertexIds, options)
    case 'force':
      return forceLayout(graph, options)
  }
}
