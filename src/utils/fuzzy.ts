export interface FuzzyMatch {
  score: number
  /** Indexes in the haystack that matched, for highlighting. */
  positions: number[]
}

/**
 * Subsequence matching with the scoring people expect from a command palette:
 * consecutive runs and word starts win, gaps cost.
 */
export const fuzzyMatch = (needle: string, haystack: string): FuzzyMatch | null => {
  const query = needle.trim().toLowerCase()
  if (!query) return { score: 0, positions: [] }
  const target = haystack.toLowerCase()
  const positions: number[] = []
  let score = 0
  let cursor = 0
  let lastMatch = -2

  for (const char of query) {
    if (char === ' ') continue
    const index = target.indexOf(char, cursor)
    if (index === -1) return null
    positions.push(index)
    if (index === lastMatch + 1) score += 8
    const previous = index > 0 ? target[index - 1] : ' '
    if (index === 0) score += 12
    else if (previous === ' ' || previous === '-' || previous === '(') score += 9
    score -= Math.min(6, index - cursor)
    lastMatch = index
    cursor = index + 1
  }
  // Prefer shorter labels when scores tie.
  score -= Math.floor(target.length / 12)
  return { score, positions }
}

export const highlightParts = (
  text: string,
  positions: readonly number[],
): { text: string; hit: boolean }[] => {
  if (!positions.length) return [{ text, hit: false }]
  const set = new Set(positions)
  const parts: { text: string; hit: boolean }[] = []
  let buffer = ''
  let bufferHit = set.has(0)
  for (let i = 0; i < text.length; i++) {
    const hit = set.has(i)
    if (hit !== bufferHit) {
      if (buffer) parts.push({ text: buffer, hit: bufferHit })
      buffer = ''
      bufferHit = hit
    }
    buffer += text[i]
  }
  if (buffer) parts.push({ text: buffer, hit: bufferHit })
  return parts
}
