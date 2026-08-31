import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Inspector } from './Inspector'
import { PropertyRow } from './PropertyRow'
import { useEditor } from '../state/store'
import { docFromEdges } from '../graph/model/builder'

const state = () => useEditor.getState()

const rowByLabel = async (label: string) => {
  const heading = await screen.findByText(label, { selector: 'span' })
  // Clickable rows are buttons; the rest are plain divs.
  const row = heading.closest('button') ?? heading.closest('div')
  if (!row) throw new Error(`No inspector row for "${label}"`)
  return row as HTMLElement
}

beforeEach(() => {
  window.localStorage.clear()
  state().newDocument()
})

describe('Inspector', () => {
  it('shows the overview of the current graph', async () => {
    state().replaceDocument(docFromEdges(['A-B', 'B-C', 'C-A']), 'Triangle')
    render(<Inspector />)

    expect(within(await rowByLabel('Vertices')).getByText('3')).toBeInTheDocument()
    expect(within(await rowByLabel('Edges')).getByText('3')).toBeInTheDocument()
    expect(within(await rowByLabel('Bipartite')).getByText('No')).toBeInTheDocument()
  })

  it('explains and highlights an odd cycle when the bipartite row is clicked', async () => {
    const user = userEvent.setup()
    state().replaceDocument(docFromEdges(['A-B', 'B-C', 'C-A']), 'Triangle')
    render(<Inspector />)

    const row = await rowByLabel('Bipartite')
    expect(row).toHaveAttribute('aria-pressed', 'false')
    await user.click(row)

    expect(row).toHaveAttribute('aria-pressed', 'true')
    expect(await screen.findByText(/odd length 3/)).toBeInTheDocument()
    expect(state().activeWitness?.rowId).toBe('bipartite')
    expect(state().activeWitness?.witness.type).toBe('cycle')

    await user.click(row)
    expect(state().activeWitness).toBeNull()
  })

  it('only keeps one witness active at a time', async () => {
    const user = userEvent.setup()
    state().replaceDocument(docFromEdges(['A-B', 'B-C', 'C-A', 'C-D']), 'Triangle plus a tail')
    render(<Inspector />)

    await user.click(await rowByLabel('Bipartite'))
    expect(state().activeWitness?.rowId).toBe('bipartite')
    await user.click(await rowByLabel('Bridges'))
    expect(state().activeWitness?.rowId).toBe('bridges')
  })

  it('runs the quick graph command from the inspector', async () => {
    const user = userEvent.setup()
    render(<Inspector />)
    const input = screen.getByLabelText('Quick graph command')
    await user.type(input, 'K4{Enter}')
    await waitFor(() => expect(state().doc.vertices).toHaveLength(4))
    expect(state().doc.edges).toHaveLength(6)
  })

  it('reports an unrecognised command instead of doing nothing', async () => {
    const user = userEvent.setup()
    render(<Inspector />)
    await user.type(screen.getByLabelText('Quick graph command'), 'banana{Enter}')
    await waitFor(() => expect(state().status?.tone).toBe('error'))
    expect(state().status?.text).toContain('K5')
  })

  it('toggles directed and weighted modes', async () => {
    const user = userEvent.setup()
    state().replaceDocument(docFromEdges(['A-B']), 'Edge')
    render(<Inspector />)

    await user.click(screen.getByRole('switch', { name: 'Directed' }))
    expect(state().doc.directed).toBe(true)
    await user.click(screen.getByRole('switch', { name: 'Weighted' }))
    expect(state().doc.weighted).toBe(true)
  })

  it('collapses and expands a section', async () => {
    const user = userEvent.setup()
    state().replaceDocument(docFromEdges(['A-B']), 'Edge')
    render(<Inspector />)

    const toggle = screen.getByRole('button', { name: /Overview/ })
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('Density')).not.toBeInTheDocument()
  })

  it('defers the NP-hard section until it is opened', async () => {
    const user = userEvent.setup()
    state().replaceDocument(docFromEdges(['A-B', 'B-C', 'C-A']), 'Triangle')
    render(<Inspector />)

    expect(screen.queryByText('Chromatic number')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Hard invariants/ }))
    expect(await screen.findByText('Chromatic number')).toBeInTheDocument()
  })

  it('never caches one graph\'s analysis under another graph\'s key', async () => {
    const user = userEvent.setup()
    state().replaceDocument(docFromEdges(['A-B', 'B-C', 'C-A']), 'Triangle')
    render(<Inspector />)

    await user.click(screen.getByRole('button', { name: /Hard invariants/ }))
    const chromatic = async () => (await rowByLabel('Chromatic number')).textContent ?? ''
    await waitFor(async () => expect(await chromatic()).toContain('3'))

    // Edit, then edit back. The debounced analysis must never leave a result
    // computed from one graph filed under the other one's key.
    state().replaceDocument(docFromEdges(['A-B', 'B-C']), 'Path')
    await waitFor(async () => expect(await chromatic()).toContain('2'), { timeout: 2000 })

    state().undo()
    await waitFor(async () => expect(await chromatic()).toContain('3'), { timeout: 2000 })
  })

  it('refreshes the prose when a vertex is renamed', async () => {
    const user = userEvent.setup()
    state().replaceDocument(docFromEdges(['A-B', 'B-C', 'C-A']), 'Triangle')
    render(<Inspector />)

    await user.click(await rowByLabel('Bipartite'))
    expect(await screen.findByText(/odd length 3/)).toBeInTheDocument()

    state().renameVertex(state().graph.vertexIds[0]!, 'ZZZ')
    await waitFor(() =>
      expect(screen.getByText(/odd length 3/).textContent).toContain('ZZZ'),
    )
  })

  it('shows the selection panel when a vertex is selected', async () => {
    state().replaceDocument(docFromEdges(['A-B', 'B-C']), 'Path')
    state().select([state().graph.vertexIds[1]!], [])
    render(<Inspector />)

    expect(await screen.findByLabelText(/Label/)).toHaveValue('B')
    expect(screen.getByText('Degree')).toBeInTheDocument()
  })
})

describe('PropertyRow', () => {
  it('shows a chip only for results that carry a caveat', () => {
    const { rerender } = render(
      <PropertyRow row={{ id: 'x', label: 'Chromatic number', value: '3', exactness: 'exact' }} />,
    )
    expect(screen.queryByText('exact')).not.toBeInTheDocument()

    rerender(
      <PropertyRow
        row={{ id: 'x', label: 'Chromatic number', value: '3-5', exactness: 'bounded' }}
      />,
    )
    expect(screen.getByText('bounded')).toBeInTheDocument()
  })

  it('is not clickable without a witness', () => {
    render(<PropertyRow row={{ id: 'x', label: 'Density', value: '0.4' }} />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
