import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Inspector } from './Inspector'
import { CommandPalette } from './CommandPalette'
import { useEditor } from '../state/store'
import { runGraphCommand } from '../state/actions'

const state = () => useEditor.getState()

beforeAll(() => {
  // The palette keeps its active row in view; jsdom does no layout, so has no
  // scrollIntoView to call.
  Element.prototype.scrollIntoView ??= () => {}
})

beforeEach(() => {
  window.localStorage.clear()
  state().newDocument()
  useEditor.setState({ status: null, commandPaletteOpen: false })
})

describe('the inspector quick box', () => {
  it('adds a typed edge list to the graph and clears itself', async () => {
    const user = userEvent.setup()
    runGraphCommand('P3')
    render(<Inspector />)
    const input = screen.getByLabelText('Quick graph command')
    await user.type(input, 'C-D, D-A{Enter}')

    await waitFor(() => expect(state().doc.edges).toHaveLength(4))
    expect(state().doc.vertices.map((v) => v.label)).toEqual(['A', 'B', 'C', 'D'])
    expect(state().status?.text).toBe('Added 2 edges and 1 vertex')
    expect(input).toHaveValue('')
  })

  it('still generates a graph from a command', async () => {
    const user = userEvent.setup()
    runGraphCommand('P3')
    render(<Inspector />)
    await user.type(screen.getByLabelText('Quick graph command'), 'C5{Enter}')
    await waitFor(() => expect(state().doc.edges).toHaveLength(5))
    expect(state().doc.vertices).toHaveLength(5)
  })

  it('keeps a generator refusal instead of calling the command unrecognised', async () => {
    const user = userEvent.setup()
    render(<Inspector />)
    const input = screen.getByLabelText('Quick graph command')
    await user.type(input, 'K5000{Enter}')
    await waitFor(() => expect(state().status?.tone).toBe('error'))
    expect(state().status?.text).toContain('too large')
    expect(input).toHaveValue('K5000')
  })

  it('mentions edge lists when nothing matches', async () => {
    const user = userEvent.setup()
    render(<Inspector />)
    await user.type(screen.getByLabelText('Quick graph command'), 'A-{Enter}')
    await waitFor(() => expect(state().status?.tone).toBe('error'))
    expect(state().status?.text).toContain('A-B, B-C')
  })
})

describe('the command palette', () => {
  const openPalette = () => {
    state().setCommandPaletteOpen(true)
    render(<CommandPalette />)
    return screen.getByLabelText('Command search')
  }

  it('previews a typed edge list as its first row and adds it on Enter', async () => {
    const user = userEvent.setup()
    runGraphCommand('P3')
    const input = openPalette()
    await user.type(input, 'C-D, D-A, A-B')

    const first = screen.getAllByRole('option')[0]!
    expect(first).toHaveTextContent('Add 2 edges, 1 new vertex')
    expect(first).toHaveTextContent('A–B already there')
    expect(first).toHaveAttribute('aria-selected', 'true')

    await user.keyboard('{Enter}')
    expect(state().doc.edges).toHaveLength(4)
    expect(state().commandPaletteOpen).toBe(false)
  })

  it('says what an arrow and a weight would change', async () => {
    const user = userEvent.setup()
    const input = openPalette()
    await user.type(input, 'a->b:2')
    expect(screen.getAllByRole('option')[0]).toHaveTextContent(
      'Add 1 edge, 2 new vertices · switches to directed · turns on weights',
    )
  })

  it('still offers to generate for a graph command', async () => {
    const user = userEvent.setup()
    const input = openPalette()
    await user.type(input, 'K3,3')
    expect(screen.getAllByRole('option')[0]).toHaveTextContent('Generate K3,3')
    expect(screen.queryByText(/new vert/)).not.toBeInTheDocument()
  })

  it('runs a command whose name reads like an edge, rather than adding vertices', async () => {
    const user = userEvent.setup()
    runGraphCommand('C4')
    const input = openPalette()
    await user.type(input, 'bellman-ford')
    expect(screen.getAllByRole('option')[0]).toHaveTextContent('Run Bellman-Ford')
    expect(screen.queryByText(/new vert/)).not.toBeInTheDocument()
  })
})
