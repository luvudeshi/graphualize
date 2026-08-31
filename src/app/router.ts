import { useEffect, useState } from 'react'

export type RouteName = 'home' | 'editor'

export interface Route {
  name: RouteName
  /** A graph command carried in the URL, e.g. `#/graph?g=K5`. */
  command: string | null
}

const parse = (hash: string): Route => {
  const raw = hash.replace(/^#/, '')
  const [path, query] = raw.split('?')
  const command = query ? new URLSearchParams(query).get('g') : null
  if (path === '/graph' || path === '/editor') return { name: 'editor', command }
  return { name: 'home', command: null }
}

/**
 * Hash routing rather than history routing, deliberately: Graphualize ships as
 * a single HTML file you can open from disk, and `file://` URLs have no server
 * to rewrite paths.
 */
export const useRoute = (): Route => {
  const [route, setRoute] = useState<Route>(() =>
    parse(typeof window === 'undefined' ? '' : window.location.hash),
  )

  useEffect(() => {
    const onHashChange = () => setRoute(parse(window.location.hash))
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
