import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AlgorithmPanel } from './AlgorithmPanel'
import { useEditor } from '../state/store'
import { docFromEdges } from '../graph/model/builder'

const state = () => useEditor.getState()

const player = () => screen.getByRole('region', { name: 'Algorithm playback' })
const choice = (name: string) => within(player()).queryByRole('combobox', { name })

/** A-B-C-D costs 4, beating the direct A-C:5. */
const loadWeighted = () => {
  state().replaceDocument(
    docFromEdges(['A-B:1', 'B-C:2', 'A-C:5', 'C-D:1'], { weighted: true }),
    'Weighted',
  )
  return state().graph.vertexIds as [string, string, string, string]
}

beforeEach(() => {
  window.localStorage.clear()
  state().newDocument()
})

describe('AlgorithmPanel run options', () => {
  it('offers From and To for Dijkstra, labelled by vertex', () => {
    const [a] = loadWeighted()
    state().startAlgorithm('dijkstra', { source: a })
    render(<AlgorithmPanel />)

    const from = choice('From vertex')!
    expect(from).toHaveValue(a)
    expect(within(from).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'A',
      'B',
      'C',
      'D',
    ])

    const to = choice('To vertex')!
    expect(to).toHaveValue('')
    expect(within(to).getAllByRole('option')).toHaveLength(5)
    expect(choice('Order of vertices')).toBeNull()
  })

  it('offers only From for the other algorithms that start somewhere', () => {
    loadWeighted()
    for (const id of ['bfs', 'dfs', 'bellman-ford', 'prim']) {
      state().startAlgorithm(id)
      expect(state().algorithm?.algorithmId).toBe(id)
      const { unmount } = render(<AlgorithmPanel />)
      expect(choice('From vertex'), id).not.toBeNull()
      expect(choice('To vertex'), id).toBeNull()
      expect(choice('Order of vertices'), id).toBeNull()
      unmount()
    }
  })

  it('offers no choices for an algorithm that takes none', () => {
    loadWeighted()
    state().startAlgorithm('kruskal')
    expect(state().algorithm?.algorithmId).toBe('kruskal')
    render(<AlgorithmPanel />)
    // Only the playback speed is left to choose.
    expect(within(player()).getAllByRole('combobox')).toHaveLength(1)
  })

  it('restarts from step 1 when the start vertex changes', async () => {
    const user = userEvent.setup()
    const [a, , c] = loadWeighted()
    state().startAlgorithm('dijkstra', { source: a })
    render(<AlgorithmPanel />)

    await user.click(within(player()).getByRole('button', { name: 'Step forward' }))
    await user.click(within(player()).getByRole('button', { name: 'Step forward' }))
    expect(state().algorithm!.index).toBe(2)

    await user.selectOptions(choice('From vertex')!, 'C')
    expect(state().algorithm!.options.source).toBe(c)
    expect(state().algorithm!.index).toBe(0)
    expect(choice('From vertex')).toHaveValue(c)
    expect(player()).toHaveTextContent('Start at C')
  })

  it('shows the shortest path to a chosen target at the end of the run', async () => {
    const user = userEvent.setup()
    const [a, , , d] = loadWeighted()
    state().startAlgorithm('dijkstra', { source: a })
    render(<AlgorithmPanel />)

    await user.selectOptions(choice('To vertex')!, 'D')
    expect(state().algorithm!.options.target).toBe(d)
    expect(state().algorithm!.index).toBe(0)

    state().goToStep(state().algorithm!.steps.length - 1)
    expect(await screen.findByText('Distance to D')).toBeInTheDocument()
    expect(screen.getByText('A → B → C → D')).toBeInTheDocument()

    // Back to no target: the path rows go away with it.
    await user.selectOptions(choice('To vertex')!, '')
    expect(state().algorithm!.options.target).toBeUndefined()
    state().goToStep(state().algorithm!.steps.length - 1)
    expect(await screen.findByText('Distances')).toBeInTheDocument()
    expect(screen.queryByText('Distance to D')).toBeNull()
  })

  it('switches the greedy colouring order', async () => {
    const user = userEvent.setup()
    state().replaceDocument(docFromEdges(['B-A', 'C-A', 'D-A']), 'Star')
    state().startAlgorithm('greedy-coloring')
    render(<AlgorithmPanel />)

    expect(choice('From vertex')).toBeNull()
    const order = choice('Order of vertices')!
    expect(order).toHaveValue('largest-first')
    expect(within(order).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Document order',
      'Largest first',
      'Smallest last',
      'DSATUR',
    ])

    await user.selectOptions(order, 'Document order')
    expect(state().algorithm!.options.ordering).toBe('document')
    expect(state().algorithm!.index).toBe(0)
    expect(choice('Order of vertices')).toHaveValue('document')
    expect(player()).toHaveTextContent('Colour the vertices in document order')
  })

  it('puts the choices in the tab order, From then To', async () => {
    // jsdom cannot open a native select, so this checks reachability; the
    // select's own arrow keys are the browser's.
    const user = userEvent.setup()
    const [a] = loadWeighted()
    state().startAlgorithm('dijkstra', { source: a })
    render(<AlgorithmPanel />)

    const from = choice('From vertex')!
    for (let i = 0; i < 10 && document.activeElement !== from; i++) await user.tab()
    expect(from).toHaveFocus()
    await user.tab()
    expect(choice('To vertex')).toHaveFocus()
  })
})
