/**
 * Where Google sends the browser back to, and how the app returns the user to
 * the screen they left.
 *
 * Two constraints shape this:
 *
 *  1. Supabase compares `redirectTo` against an allow-list. A URL carrying a
 *     fragment or a query string is a poor thing to allow-list, so the value
 *     sent is always the bare origin + path — one entry covers every route.
 *  2. Graphualize routes on the fragment. Rather than trying to smuggle the
 *     route through a URL that Supabase and Google will both rewrite, the
 *     intended route is parked in `sessionStorage` and picked up on return.
 *     sessionStorage, not localStorage: it is per-tab and self-cleaning, so a
 *     redirect abandoned half-way cannot strand a stale route in another tab.
 */

const RETURN_KEY = 'graphualize:auth:return-to'

/** The exact string handed to Supabase as `redirectTo`. */
export const redirectTarget = (): string =>
  `${window.location.origin}${window.location.pathname}`

/** Remembers the current route so the user lands back where they started. */
export const rememberRoute = (): void => {
  try {
    const hash = window.location.hash || '#/'
    window.sessionStorage.setItem(RETURN_KEY, hash)
  } catch {
    /* Private mode denies storage; the user simply lands on the home page. */
  }
}

/**
 * Restores the remembered route, if the browser has just come back from a
 * provider. Returns the route it navigated to, or null when there was nothing
 * to restore.
 */
export const consumeRememberedRoute = (): string | null => {
  try {
    const hash = window.sessionStorage.getItem(RETURN_KEY)
    if (!hash) return null
    window.sessionStorage.removeItem(RETURN_KEY)
    if (!hash.startsWith('#/')) return null
    if (window.location.hash !== hash) window.location.hash = hash
    return hash
  } catch {
    return null
  }
}

/**
 * True when the current URL looks like an OAuth return.
 *
 * `detectSessionInUrl` strips these parameters as soon as the client starts, so
 * this is read once during initialisation and never relied on afterwards.
 */
export const isOAuthReturn = (): boolean => {
  const params = new URLSearchParams(window.location.search)
  return params.has('code') || params.has('error') || params.has('error_description')
}

/** The provider's error message, when it sent one back instead of a code. */
export const oauthErrorFromUrl = (): string | null => {
  const params = new URLSearchParams(window.location.search)
  const description = params.get('error_description')
  const code = params.get('error')
  if (!description && !code) return null
  return description ?? `Google returned "${code}".`
}

/**
 * Removes the OAuth parameters from the address bar.
 *
 * supabase-js does this itself on success. Doing it again is harmless and
 * covers the failure case, where it does not, and where leaving `?error=...`
 * behind would resurface the same error on every reload.
 */
export const cleanOAuthParamsFromUrl = (): void => {
  const url = new URL(window.location.href)
  let changed = false
  for (const key of ['code', 'error', 'error_description', 'error_code', 'state']) {
    if (url.searchParams.has(key)) {
      url.searchParams.delete(key)
      changed = true
    }
  }
  if (!changed) return
  const search = url.searchParams.toString()
  window.history.replaceState(
    null,
    '',
    `${url.pathname}${search ? `?${search}` : ''}${url.hash}`,
  )
}
