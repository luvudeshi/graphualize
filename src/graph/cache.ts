const MAX_ENTRIES = 32

interface Bucket {
  order: string[]
  values: Map<string, unknown>
}

const buckets = new Map<string, Bucket>()

/**
 * Memoises an analysis against a graph's structure key.
 *
 * Keeping the cache at module scope rather than in a component means undo,
 * redo and toggling a panel all hit a warm cache, and it keeps the components
 * free of caching machinery. Each namespace holds its own small LRU.
 */
export const memoByStructure = <T>(namespace: string, key: string, compute: () => T): T => {
  let bucket = buckets.get(namespace)
  if (!bucket) {
    bucket = { order: [], values: new Map() }
    buckets.set(namespace, bucket)
  }
  if (bucket.values.has(key)) return bucket.values.get(key) as T
  const value = compute()
  bucket.values.set(key, value)
  bucket.order.push(key)
  if (bucket.order.length > MAX_ENTRIES) {
    const evicted = bucket.order.shift()
    if (evicted !== undefined) bucket.values.delete(evicted)
  }
  return value
}

/** Test helper. */
export const clearAnalysisCache = (): void => {
  buckets.clear()
}
