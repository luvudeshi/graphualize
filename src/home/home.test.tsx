import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { buildDemoGraph, DEMO_ROW_IDS } from './demoGraph'
import { analyzeCore, analyzeMetrics } from '../graph/analysis'
import { connectedComponents } from '../graph/properties/traversal'
import { biconnectivity } from '../graph/properties/connectivity'
import { analyzeBipartite } from '../graph/properties/structure'
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
    // Once as a hero shortcut, once in the gallery.
    expect(screen.getAllByRole('button', { name: /Petersen graph/ })).toHaveLength(2)
  })
})
