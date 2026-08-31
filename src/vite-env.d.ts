/// <reference types="vite/client" />

/**
 * Typed environment. Only publishable values appear here by design — a secret
 * placed in a `VITE_*` variable would be inlined into the browser bundle.
 */
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_ANON_KEY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
