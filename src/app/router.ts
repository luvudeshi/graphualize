import { useEffect, useState } from 'react'

export type RouteName = 'home' | 'editor'

export interface Route {
  name: RouteName
  /** A graph command carried in the URL, e.g. `#/graph?g=K5`. */
  command: string | null
  /** A whole graph carried in the URL by a share link, `#/graph?d=…`. */
  shared: string | null
}

export const parseRoute = (hash: string): Route => {
  const raw = hash.replace(/^#/, '')
  const [path, query] = raw.split('?')
  const params = new URLSearchParams(query ?? '')
  if (path === '/graph' || path === '/editor') {
    return { name: 'editor', command: params.get('g'), shared: params.get('d') }
  }
  return { name: 'home', command: null, shared: null }
}

/**
 * Hash routing rather than history routing, deliberately: Graphualize ships as
 * a single HTML file you can open from disk, and `file://` URLs have no server
 * to rewrite paths.
 */
export const useRoute = (): Route => {
  const [route, setRoute] = useState<Route>(() =>
    parseRoute(typeof window === 'undefined' ? '' : window.location.hash),
  )

  useEffect(() => {
    const onHashChange = () => setRoute(parseRoute(window.location.hash))
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  return route
}

export const navigate = (path: string): void => {
  if (typeof window === 'undefined') return
  window.location.hash = path
}

/** Opens the workbench, optionally generating a graph on arrival. */
export const openEditor = (command?: string): void => {
  navigate(command ? `/graph?g=${encodeURIComponent(command)}` : '/graph')
}

/**
 * The hash of a share link. A share code is base64url plus a `.`, all of which
 * is safe in a URL as it stands, so it is not escaped and the link stays as
 * short as the code.
 */
export const shareHash = (code: string): string => `#/graph?d=${code}`
