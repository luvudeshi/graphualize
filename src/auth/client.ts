/**
 * The Supabase client, created lazily and only when it can actually work.
 *
 * Signing in is strictly *additive* to Graphualize: the product is a local
 * graph theory workbench that has never needed an account, and it still does
 * not. Every code path here is written so that the app is identical to its
 * pre-auth self whenever authentication is unavailable — no env vars, no
 * network, a `file://` page, a test runner. `isAuthConfigured()` is the single
 * gate, and the UI renders nothing account-related when it returns false.
 *
 * Only publishable values live here. `VITE_SUPABASE_ANON_KEY` is designed to
 * ship to browsers and is protected by row-level security; the OAuth client
 * secret and the service-role key are never referenced by this bundle at all —
 * they belong to the Supabase project's own configuration.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL?.trim() ?? ''
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim() ?? ''

/**
 * Storage is namespaced away from `graphualize:*` so that clearing a session
 * can never touch a saved graph, and so a future change to either side cannot
 * collide with the other.
 */
const STORAGE_KEY = 'graphualize:auth:v1'

/** True on a real page served over http(s), false under `file://` and in jsdom. */
const canReceiveARedirect = (): boolean => {
  if (typeof window === 'undefined') return false
  return window.location.protocol === 'http:' || window.location.protocol === 'https:'
}

const looksLikeUrl = (value: string): boolean => {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:'
  } catch {
    return false
  }
}

/**
 * Whether sign-in can be offered at all.
 *
 * The single-file `file://` build deliberately fails this test: an OAuth
 * redirect needs an origin a provider can return to, and `file://` has none.
 * Rather than showing a button that cannot work, that build simply has no
 * account UI — which is also exactly the behaviour anyone gets who clones the
 * repository without a Supabase project.
 */
export const isAuthConfigured = (): boolean =>
  looksLikeUrl(url) && anonKey.length > 0 && canReceiveARedirect()

let client: SupabaseClient | null = null

export const getSupabase = (): SupabaseClient | null => {
  if (!isAuthConfigured()) return null
  client ??= createClient(url, anonKey, {
    auth: {
      // PKCE, not implicit. The implicit flow returns its tokens in the URL
      // *fragment* (`#access_token=...`), and Graphualize routes on the
      // fragment (`#/graph`) because it also has to run from a file. Those two
      // uses of the hash cannot coexist: the router would see a garbage route
      // and the callback would be eaten by a re-render. PKCE returns `?code=`
      // in the query string instead, which nothing else here reads.
      flowType: 'pkce',
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: STORAGE_KEY,
    },
  })
  return client
}

/** The Supabase project URL, for diagnostics. Empty when unconfigured. */
export const supabaseUrl = (): string => url

/** Test seam: drops the memoised client so a test can change the environment. */
export const resetSupabaseForTests = (): void => {
  client = null
}
