import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  buildDemoDocument,
  buildDemoGraph,
  DEMO_ROW_IDS,
  demoLayoutFor,
  demoPositions,
} from './demoGraph'
import { analyzeCore, analyzeMetrics } from '../graph/analysis'
import { connectedComponents } from '../graph/properties/traversal'
import { biconnectivity } from '../graph/properties/connectivity'
import { analyzeBipartite } from '../graph/properties/structure'
import { EXAMPLES } from '../graph/examples'
import { useEditor } from '../state/store'

// Cytoscape needs a real canvas, which jsdom does not provide, so the page is
// tested without its live demo. The demo's data is checked separately below.
vi.mock('./HeroDemo', () => ({ HeroDemo: () => <div data-testid="hero-demo" /> }))

// Imported after the mock is registered, so the page picks up the stub.
const { HomePage } = await import('./HomePage')

beforeEach(() => {
  window.localStorage.clear()
  window.location.hash = ''
  useEditor.getState().newDocument()
  useEditor.getState().setTheme('system')
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('the demo graph the homepage talks about', () => {
  const graph = buildDemoGraph()

  it('is connected and simple', () => {
    expect(connectedComponents(graph)).toHaveLength(1)
    expect(graph.isSimple()).toBe(true)
  })

  it('really does have the properties the copy claims', () => {
    const { bridges, articulationPoints } = biconnectivity(graph)
    expect(bridges).toHaveLength(3)
    expect(articulationPoints).toHaveLength(4)

    const bipartite = analyzeBipartite(graph)
    expect(bipartite.isBipartite).toBe(false)
    expect(bipartite.oddCycle!.edgeIds).toHaveLength(3)

    const metrics = analyzeMetrics(graph)
    const diameter = metrics.sections
      .flatMap((section) => section.rows)
      .find((row) => row.id === 'diameter')
    expect(diameter?.value).toBe('5')
  })

  it('has a witness for every row the tour steps through', () => {
    const rows = [
      ...analyzeCore(graph).sections.flatMap((section) => section.rows),
      ...analyzeMetrics(graph).sections.flatMap((section) => section.rows),
    ]
    for (const id of DEMO_ROW_IDS) {
      const row = rows.find((candidate) => candidate.id === id)
      expect(row, `the tour names a row "${id}" that does not exist`).toBeTruthy()
      expect(row?.witness, `"${id}" has nothing to highlight`).toBeTruthy()
      expect(row?.explanation).toBeTruthy()
    }
  })

  it('lays every vertex out somewhere finite and distinct', () => {
    const seen = new Set<string>()
    for (const vertex of graph.vertices) {
      expect(Number.isFinite(vertex.x) && Number.isFinite(vertex.y)).toBe(true)
      seen.add(`${vertex.x},${vertex.y}`)
    }
    expect(seen.size).toBe(graph.order)
  })
})

describe('the compact drawing used on narrow stages', () => {
  const doc = buildDemoDocument()
  const compact = demoPositions('compact')
  const extent = (points: { x: number; y: number }[]) => {
    const xs = points.map((p) => p.x)
    const ys = points.map((p) => p.y)
    return (Math.max(...xs) - Math.min(...xs)) / (Math.max(...ys) - Math.min(...ys))
  }

  it('places every vertex of the demo somewhere finite and distinct', () => {
    const seen = new Set<string>()
    for (const vertex of doc.vertices) {
      const at = compact.get(vertex.label)
      expect(at, `no compact position for ${vertex.label}`).toBeTruthy()
      expect(Number.isFinite(at!.x) && Number.isFinite(at!.y)).toBe(true)
      seen.add(`${at!.x},${at!.y}`)
    }
    expect(seen.size).toBe(doc.vertices.length)
  })

  it('names exactly the vertices of the demo, so swapping it in moves every one', () => {
    const labels = doc.vertices.map((vertex) => vertex.label).sort()
    expect([...compact.keys()].sort()).toEqual(labels)
    expect([...demoPositions('wide').keys()].sort()).toEqual(labels)
  })

  it('is close to square, where the wide drawing is a long strip', () => {
    expect(extent([...compact.values()])).toBeLessThan(1.6)
    expect(extent([...demoPositions('wide').values()])).toBeGreaterThan(2.5)
  })

  it('is chosen for phone-width and side-panel stages, not for a wide one', () => {
    expect(demoLayoutFor(706, 364)).toBe('wide')
    expect(demoLayoutFor(780, 340)).toBe('wide')
    expect(demoLayoutFor(342, 300)).toBe('compact')
    expect(demoLayoutFor(370, 384)).toBe('compact')
    // Before layout has happened a stage measures nothing at all.
    expect(demoLayoutFor(0, 0)).toBe('compact')
  })
})

describe('HomePage', () => {
  it('leads with the product, not a sign-up', () => {
    render(<HomePage />)
    expect(
      screen.getByRole('heading', { name: /shows its working/i, level: 1 }),
    ).toBeInTheDocument()
    expect(screen.getByTestId('hero-demo')).toBeInTheDocument()
    expect(screen.queryByText(/sign up|pricing|free trial/i)).not.toBeInTheDocument()
  })

  it('opens the workbench from the primary call to action', async () => {
    const user = userEvent.setup()
    render(<HomePage />)
    await user.click(screen.getByRole('button', { name: 'Start drawing' }))
    expect(window.location.hash).toBe('#/graph')
  })

  it('carries a graph command into the workbench', async () => {
    const user = userEvent.setup()
    render(<HomePage />)
    await user.click(screen.getByRole('button', { name: 'K3,3' }))
    expect(window.location.hash).toBe('#/graph?g=K3%2C3')
  })

  it('offers to continue an existing session rather than starting over', () => {
    useEditor.getState().setName('Homework 3')
    useEditor.getState().addVertexAt(0, 0)
    render(<HomePage />)
    expect(screen.getByRole('button', { name: /Continue .Homework 3./ })).toBeInTheDocument()
  })

  it('lists every built-in example', () => {
    render(<HomePage />)
    expect(screen.getByRole('button', { name: /Seven bridges of Königsberg/ })).toBeInTheDocument()
    for (const example of EXAMPLES) {
      const name = example.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      expect(screen.getByRole('button', { name: new RegExp(`^${name},`) })).toBeInTheDocument()
    }
    // The Petersen graph is both a quick-start chip and a gallery card.
    expect(screen.getByRole('button', { name: 'Petersen' })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /Petersen graph/ })).toHaveLength(1)
  })

  it('draws each example from its own document and says its size in words', () => {
    const { container } = render(<HomePage />)
    expect(container.querySelectorAll('#examples svg.gz-thumb')).toHaveLength(EXAMPLES.length)
    expect(screen.getByRole('button', { name: 'K5, 5 vertices, 10 edges' })).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Seven bridges of Königsberg, 4 vertices, 7 edges' }),
    ).toBeInTheDocument()
    // What each one is good for is still there to be read, shown or not.
    expect(screen.getByRole('button', { name: /^Petersen graph,/ })).toHaveAccessibleDescription(
      /standard counterexample/,
    )
    expect(screen.getByRole('button', { name: /^Triangle,/ })).toHaveAccessibleDescription(
      /smallest cycle/,
    )
  })

  it('opens an example from its card', async () => {
    const user = userEvent.setup()
    render(<HomePage />)
    await user.click(screen.getByRole('button', { name: /^Petersen graph,/ }))
    expect(window.location.hash).toBe('#/graph?g=example%3Apetersen')
  })

  it('scrolls to the examples without putting a fragment in the route', async () => {
    const user = userEvent.setup()
    // jsdom does not implement scrolling, so stand in for it.
    const original = Element.prototype.scrollIntoView
    const scrolled = vi.fn()
    Element.prototype.scrollIntoView = scrolled
    try {
      render(<HomePage />)
      await user.click(screen.getByRole('button', { name: 'Browse examples' }))
      expect(scrolled).toHaveBeenCalledTimes(1)
      expect(scrolled.mock.contexts[0]).toBe(document.getElementById('examples'))
      // The hash is the router's: a `#examples` there would be read as a route.
      expect(window.location.hash).toBe('')
    } finally {
      Element.prototype.scrollIntoView = original
    }
  })

  it('switches the theme from the header', async () => {
    const user = userEvent.setup()
    render(<HomePage />)
    await user.click(screen.getByRole('button', { name: 'Switch to dark theme' }))
    expect(useEditor.getState().theme).toBe('dark')
    expect(document.documentElement).toHaveClass('dark')
    await user.click(screen.getByRole('button', { name: 'Switch to light theme' }))
    expect(useEditor.getState().theme).toBe('light')
  })

  it('still opens the workbench from the header', async () => {
    const user = userEvent.setup()
    render(<HomePage />)
    await user.click(screen.getByRole('button', { name: 'Open the workbench' }))
    expect(window.location.hash).toBe('#/graph')
  })
})
