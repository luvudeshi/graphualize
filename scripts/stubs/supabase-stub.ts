/**
 * Stands in for `@supabase/supabase-js` in the single-file `file://` build.
 *
 * That build can never sign anyone in: OAuth needs an origin a provider can
 * redirect back to, and `file://` has none — which is exactly why
 * `isAuthConfigured()` returns false there. Bundling the real SDK would add
 * ~210 KB to a file whose entire purpose is to be small enough to email, in
 * exchange for code that cannot execute.
 *
 * `createClient` therefore throws rather than returning a broken object: if a
 * future change ever reaches it in this build, that is a bug, and it should be
 * loud instead of silently doing nothing.
 */
export const createClient = (): never => {
  throw new Error(
    'Supabase is not available in the single-file build — authentication requires an http(s) origin.',
  )
}

export type SupabaseClient = never
export type Session = never
export type User = never
