/**
 * Relative timestamps for the saved-graph list.
 *
 * `Intl.RelativeTimeFormat` rather than a hand-rolled ladder, so the wording
 * follows the browser's locale ("il y a 2 heures") instead of being English
 * with an English-shaped plural rule baked in.
 */

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const WEEK = 7 * DAY
const MONTH = 30 * DAY
const YEAR = 365 * DAY

/** Largest unit first: the first threshold a gap clears is the one used. */
const UNITS: [limit: number, ms: number, unit: Intl.RelativeTimeFormatUnit][] = [
  [YEAR, YEAR, 'year'],
  [MONTH, MONTH, 'month'],
  [WEEK, WEEK, 'week'],
  [DAY, DAY, 'day'],
  [HOUR, HOUR, 'hour'],
  [MINUTE, MINUTE, 'minute'],
]

/**
 * "3 minutes ago", "yesterday", "last week".
 *
 * `now` is injectable so tests do not depend on the wall clock. Anything under
 * a minute reads as "just now": second-level precision on a list of documents
 * is noise, and a row that changes every render is worse than one that does
 * not.
 */
export const relativeTime = (timestamp: number, now: number = Date.now()): string => {
  if (!Number.isFinite(timestamp)) return ''
  const elapsed = now - timestamp
  // A clock that has gone backwards (a synced device, a hand-set clock) should
  // not produce "in 3 hours" for a file that was obviously saved already.
  if (elapsed < MINUTE) return 'just now'

  const format = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
  for (const [limit, ms, unit] of UNITS) {
    if (elapsed >= limit) return format.format(-Math.floor(elapsed / ms), unit)
  }
  return 'just now'
}
