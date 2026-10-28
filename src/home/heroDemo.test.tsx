import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { demoPositions } from './demoGraph'

/**
 * Cytoscape needs a real canvas, which jsdom does not have, so the demo is
 * tested against a stand-in that records what the component asks of it: where
 * the vertices were put, and which carry a highlight.
 */
interface FakeElement {
  id: () => string
  data: (key: string, value?: unknown) => unknown
  removeData: (key: string) => void
  toggleClass: (name: string, on: boolean) => void
  position: (to?: { x: number; y: number }) => { x: number; y: number } | undefined
  label: string
}

const { stage, mounted, fakeElement } = vi.hoisted(() => {
  const fake = (data: Record<string, unknown>, at?: { x: number; y: number }): FakeElement => {
    const values: Record<string, unknown> = { ...data }
    let position = at ? { ...at } : undefined
    return {
      id: () => String(data.id),
      data: (key, value) => {
        if (value === undefined) return values[key]
        values[key] = value
        return undefined
      },
      removeData: (key) => {
        delete values[key]
      },
      toggleClass: () => {},
      position: (to) => {
        if (to) position = { ...to }
        return position
      },
      label: String(data.label ?? ''),
    }
  }
  return {
    /** What the fake reports as the size of the drawing area. */
    stage: { width: 706, height: 364 },
    mounted: [] as { nodes: FakeElement[]; edges: FakeElement[] }[],
    fakeElement: fake,
  }
})

vi.mock('cytoscape', () => ({
  default: (options: {
    elements: { group: string; data: Record<string, unknown>; position?: { x: number; y: number } }[]
  }) => {
    const nodes = options.elements
      .filter((element) => element.group === 'nodes')
      .map((element) => fakeElement(element.data, element.position))
    const edges = options.elements
      .filter((element) => element.group === 'edges')
      .map((element) => fakeElement(element.data))
    mounted.push({ nodes, edges })
    const collection = (items: FakeElement[]) => ({ forEach: (fn: (item: FakeElement) => void) => items.forEach(fn) })
    return {
      nodes: () => collection(nodes),
      edges: () => collection(edges),
      elements: () => collection([...nodes, ...edges]),
      batch: (fn: () => void) => fn(),
      style: () => {},
      resize: () => {},
      fit: () => {},
      zoom: () => 1,
      center: () => {},
      width: () => stage.width,
      height: () => stage.height,
      destroy: () => {},
    }
  },
}))

const { HeroDemo } = await import('./HeroDemo')

const list = () => screen.getByRole('list', { name: 'Properties of the example graph' })
const pressed = () => within(list()).getByRole('button', { pressed: true })

const prefersReducedMotion = (reduce: boolean) => {
  const original = window.matchMedia
  vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
    ...original(query),
    matches: reduce && query.includes('prefers-reduced-motion'),
  }))
}

beforeEach(() => {
  vi.useFakeTimers()
  mounted.length = 0
  stage.width = 706
  stage.height = 364
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('the live demo', () => {
  it('lists the properties the real analysis found', () => {
    render(<HeroDemo />)
    const rows = within(list()).getAllByRole('button')
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringMatching(/^BipartiteNo/),
      expect.stringMatching(/^Bridges3/),
      expect.stringMatching(/^Articulation vertices4/),
      expect.stringMatching(/^Diameter5/),
      expect.stringMatching(/^Eulerian circuitNo/),
    ])
    expect(pressed()).toHaveTextContent(/cycle of odd length 3/)
  })

  it('highlights the witness of the property on show', () => {
    render(<HeroDemo />)
    const { nodes } = mounted[0]!
    const lit = nodes.filter((node) => node.data('hlColor')).map((node) => node.label)
    // Bipartite: No — the odd triangle A, B, C.
    expect(lit.sort()).toEqual(['A', 'B', 'C'])
  })

  it('moves on by itself', () => {
    render(<HeroDemo />)
    expect(pressed()).toHaveTextContent(/^Bipartite/)
    act(() => void vi.advanceTimersByTime(3400))
    expect(pressed()).toHaveTextContent(/^Bridges/)
  })

  it('can be paused, and stays paused after the pointer leaves', () => {
    render(<HeroDemo />)
    // A click without pointer movement, so it is the button and not the hover
    // that stops the tour.
    fireEvent.click(screen.getByRole('button', { name: 'Pause the tour' }))
    act(() => void vi.advanceTimersByTime(10_000))
    expect(pressed()).toHaveTextContent(/^Bipartite/)

    fireEvent.click(screen.getByRole('button', { name: 'Resume the tour' }))
    act(() => void vi.advanceTimersByTime(3400))
    expect(pressed()).toHaveTextContent(/^Bridges/)
  })

  it('holds still while the pointer is over it', () => {
    const { container } = render(<HeroDemo />)
    const root = container.firstElementChild!
    fireEvent.pointerEnter(root)
    act(() => void vi.advanceTimersByTime(10_000))
    expect(pressed()).toHaveTextContent(/^Bipartite/)
    fireEvent.pointerLeave(root)
    act(() => void vi.advanceTimersByTime(3400))
    expect(pressed()).toHaveTextContent(/^Bridges/)
  })

  it('shows a property and its reason when clicked', () => {
    render(<HeroDemo />)
    fireEvent.click(within(list()).getByRole('button', { name: /Diameter/ }))
    expect(pressed()).toHaveTextContent(/furthest pair is A and H/)
  })

  it('does not tour at all with reduced motion, so offers nothing to pause', () => {
    prefersReducedMotion(true)
    render(<HeroDemo />)
    expect(screen.queryByRole('button', { name: 'Pause the tour' })).not.toBeInTheDocument()
    act(() => void vi.advanceTimersByTime(10_000))
    expect(pressed()).toHaveTextContent(/^Bipartite/)
  })

  it('keeps the wide drawing on a wide stage', () => {
    render(<HeroDemo />)
    const wide = demoPositions('wide')
    for (const node of mounted[0]!.nodes) expect(node.position()).toEqual(wide.get(node.label))
  })

  it('swaps in the compact drawing on a phone-width stage', () => {
    stage.width = 342
    stage.height = 300
    render(<HeroDemo />)
    const compact = demoPositions('compact')
    for (const node of mounted[0]!.nodes) expect(node.position()).toEqual(compact.get(node.label))
  })
})
