export const isMac = (): boolean => {
  if (typeof navigator === 'undefined') return false
  const data = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData
  const platform = data?.platform ?? navigator.platform ?? navigator.userAgent
  return /mac|iphone|ipad/i.test(platform)
}

/** True when the viewer has asked the OS to minimise animation. */
export const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

export const modKey = (): string => (isMac() ? '⌘' : 'Ctrl')

/** Formats a shortcut for display, e.g. `mod+Z` -> `⌘Z` or `Ctrl+Z`. */
export const formatShortcut = (spec: string): string =>
  spec
    .split('+')
    .map((part) => {
      const key = part.trim()
      if (key === 'mod') return modKey()
      if (key === 'shift') return isMac() ? '⇧' : 'Shift'
      if (key === 'alt') return isMac() ? '⌥' : 'Alt'
      return key.length === 1 ? key.toUpperCase() : key
    })
    .join(isMac() ? '' : '+')
