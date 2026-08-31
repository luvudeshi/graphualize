/**
 * Dinic max-flow on an index-based network. Kept deliberately generic so the
 * connectivity code can build split/expanded networks without inventing
 * documents.
 */
export interface FlowNetwork {
  size: number
  head: number[]
  next: number[]
  to: number[]
  cap: number[]
}

export const createNetwork = (size: number): FlowNetwork => ({
  size,
  head: new Array<number>(size).fill(-1),
  next: [],
  to: [],
  cap: [],
})

/** Adds a directed arc with `capacity`, plus a reverse arc of `reverse`. */
export const addArc = (
  net: FlowNetwork,
  from: number,
  toIndex: number,
  capacity: number,
  reverse = 0,
): number => {
  const id = net.to.length
  net.to.push(toIndex)
  net.cap.push(capacity)
  net.next.push(net.head[from]!)
  net.head[from] = id
  net.to.push(from)
  net.cap.push(reverse)
  net.next.push(net.head[toIndex]!)
  net.head[toIndex] = id + 1
  return id
}

export interface MaxFlowResult {
  value: number
  /** Vertices reachable from the source in the residual network. */
  sourceSide: Set<number>
  /** Arc ids (even indices only) that cross the minimum cut. */
  cutArcs: number[]
}

export const maxFlow = (net: FlowNetwork, source: number, sink: number): MaxFlowResult => {
  if (source === sink) return { value: Infinity, sourceSide: new Set([source]), cutArcs: [] }
  const level = new Array<number>(net.size).fill(-1)
  const iter = new Array<number>(net.size).fill(-1)
  const original = net.cap.slice()

  const bfs = (): boolean => {
    level.fill(-1)
    level[source] = 0
    const queue = [source]
    let head = 0
    while (head < queue.length) {
      const v = queue[head++]!
      for (let e = net.head[v]!; e !== -1; e = net.next[e]!) {
        if (net.cap[e]! > 1e-9 && level[net.to[e]!] === -1) {
          level[net.to[e]!] = level[v]! + 1
          queue.push(net.to[e]!)
        }
      }
    }
    return level[sink] !== -1
  }

  const dfs = (v: number, pushed: number): number => {
    if (v === sink) return pushed
    for (; iter[v]! !== -1; iter[v] = net.next[iter[v]!]!) {
      const e = iter[v]!
      const u = net.to[e]!
      if (net.cap[e]! <= 1e-9 || level[u] !== level[v]! + 1) continue
      const got = dfs(u, Math.min(pushed, net.cap[e]!))
      if (got > 1e-9) {
        net.cap[e] = net.cap[e]! - got
        net.cap[e ^ 1] = net.cap[e ^ 1]! + got
        return got
      }
    }
    level[v] = -1
    return 0
  }

  let flow = 0
  while (bfs()) {
    for (let i = 0; i < net.size; i++) iter[i] = net.head[i]!
    for (;;) {
      const pushed = dfs(source, Infinity)
      if (pushed <= 1e-9) break
      flow += pushed
    }
  }

  const sourceSide = new Set<number>()
  const stack = [source]
  sourceSide.add(source)
  while (stack.length) {
    const v = stack.pop()!
    for (let e = net.head[v]!; e !== -1; e = net.next[e]!) {
      const u = net.to[e]!
      if (net.cap[e]! > 1e-9 && !sourceSide.has(u)) {
        sourceSide.add(u)
        stack.push(u)
      }
    }
  }
  const cutArcs: number[] = []
  for (let e = 0; e < net.to.length; e += 2) {
    const from = net.to[e + 1]!
    const toIndex = net.to[e]!
    if (original[e]! > 0 && sourceSide.has(from) && !sourceSide.has(toIndex)) cutArcs.push(e)
  }
  return { value: flow, sourceSide, cutArcs }
}

/**
 * Stoer-Wagner global minimum cut for an undirected weighted graph given as a
 * dense symmetric matrix. Returns the cut value and one side of the partition.
 * O(V^3).
 */
export const globalMinCut = (
  weights: number[][],
): { value: number; side: number[] } => {
  const n = weights.length
  if (n < 2) return { value: 0, side: [] }
  const w = weights.map((row) => row.slice())
  const groups: number[][] = Array.from({ length: n }, (_, i) => [i])
  const active: number[] = Array.from({ length: n }, (_, i) => i)

  let best = Infinity
  let bestSide: number[] = []

  while (active.length > 1) {
    const added: number[] = []
    const inA = new Array<boolean>(n).fill(false)
    const weightTo = new Array<number>(n).fill(0)
    let prev = -1
    let last = -1
    for (let i = 0; i < active.length; i++) {
      let sel = -1
      for (const v of active) {
        if (inA[v]) continue
        if (sel === -1 || weightTo[v]! > weightTo[sel]!) sel = v
      }
      inA[sel] = true
      added.push(sel)
      prev = last
      last = sel
      for (const v of active) if (!inA[v]) weightTo[v] = weightTo[v]! + w[sel]![v]!
    }
    // Cut-of-the-phase separates `last` (merged group) from everything else.
    const cutValue = weightTo[last]!
    if (cutValue < best) {
      best = cutValue
      bestSide = groups[last]!.slice()
    }
    if (prev === -1) break
    // Merge `last` into `prev`.
    groups[prev] = groups[prev]!.concat(groups[last]!)
    for (const v of active) {
      if (v === prev || v === last) continue
      w[prev]![v] = w[prev]![v]! + w[last]![v]!
      w[v]![prev] = w[prev]![v]!
    }
    active.splice(active.indexOf(last), 1)
  }
  return { value: best === Infinity ? 0 : best, side: bestSide }
}
