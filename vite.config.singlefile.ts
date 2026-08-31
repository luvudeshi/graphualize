import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

/**
 * Builds Graphualize as one self-contained HTML file that runs from a
 * `file://` URL with no server and no Node. Everything is inlined and emitted
 * as a classic script, because module scripts and separate asset files are
 * both blocked when a page is opened straight from disk.
 *
 * Supabase is aliased away here. Sign-in cannot work from `file://` — there is
 * no origin for an OAuth provider to redirect back to — so the SDK would be
 * ~210 KB of unreachable code in a file that is meant to be small enough to
 * email. `isAuthConfigured()` already returns false under `file://`, so the
 * stub is never reached; it throws if it ever is.
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@supabase/supabase-js': fileURLToPath(
        new URL('./scripts/stubs/supabase-stub.ts', import.meta.url),
      ),
    },
  },
  build: {
    outDir: 'dist-single',
    cssCodeSplit: false,
    assetsInlineLimit: 100_000_000,
    modulePreload: { polyfill: false },
    rollupOptions: {
      output: { format: 'iife', inlineDynamicImports: true, entryFileNames: 'app.js' },
    },
  },
})
