import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { useEditor } from './state/store'

const container = document.getElementById('root')
if (!container) throw new Error('Graphualize could not find its root element.')

/**
 * A small read-only automation hook. The end-to-end tests use it to assert on
 * the exact mathematical witness a property row produced, which is not
 * otherwise visible from the DOM (the graph is drawn to a canvas).
 */
declare global {
  interface Window {
    graphualize?: { getState: () => ReturnType<typeof useEditor.getState> }
  }
}
window.graphualize = { getState: () => useEditor.getState() }

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
