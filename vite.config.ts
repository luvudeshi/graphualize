import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    // Cytoscape is by far the largest dependency and changes far less often
    // than the app, so it gets its own long-lived chunk.
    rollupOptions: {
      output: {
        manualChunks: (id: string) => {
          if (id.includes('node_modules/cytoscape')) return 'cytoscape'
          if (/node_modules\/(react|react-dom|scheduler)\//.test(id)) return 'react'
          return undefined
        },
      },
    },
  },
})
