import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: false,
    /**
     * Vite loads `.env.local` for test runs too, so without this a developer
     * who has configured Supabase locally runs a *different* suite from CI:
     * `isAuthConfigured()` flips to true, components take the signed-out
     * branch instead of the unconfigured one, and anything that reached
     * `initialize()` would open a real client against a real project from a
     * unit test.
     *
     * The suite therefore pins the auth environment to empty and tests the
     * configured paths by mocking `auth/client` instead — which is both
     * deterministic and offline. `src/auth/auth.test.tsx` asserts this holds.
     */
    env: {
      VITE_SUPABASE_URL: '',
      VITE_SUPABASE_ANON_KEY: '',
    },
  },
})
