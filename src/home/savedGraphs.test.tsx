import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { relativeTime } from '../utils/time'
import { docFromEdges } from '../graph/model/builder'

// Saved graphs live in the account now, so the section is tested against an
// in-memory stand-in for the cloud rather than local storage.
vi.mock('../sync/cloud', () => import('../test/fakeCloud'))

const { __fake } = await import('../test/fakeCloud')
const { useEditor, setSignedInProbe } = await import('../state/store')
const { useAuth } = await import('../auth/store')
const { SavedGraphs } = await import('./SavedGraphs')

const state = () => useEditor.getState()

/** Puts a graph in the account and refreshes the list, as saving would. */
const saveAGraph = async (name: string, spec: string[]) => {
  state().replaceDocument(docFromEdges(spec), `Build ${name}`)
  await state().saveCurrent(name)
  state().newDocument()
  await state().refreshDocuments()
}

const signedIn = (yes: boolean) => {
  setSignedInProbe(() => yes)
  useAuth.setState({
    status: yes ? 'signedIn' : 'signedOut',
    profile: yes ? { id: 'u', email: 'a@b.c', name: 'Ada', avatarUrl: null } : null,
  })
}

beforeEach(async () => {
  window.localStorage.clear()
  window.location.hash = ''
  __fake.reset()
  signedIn(true)
  state().newDocument()
  await state().refreshDocuments()
})

describe('relativeTime', () => {
  const now = new Date('2026-06-15T12:00:00Z').getTime()
  const ago = (ms: number) => relativeTime(now - ms, now)

  it('collapses anything under a minute to "just now"', () => {
    expect(ago(0)).toBe('just now')
    expect(ago(45_000)).toBe('just now')
  })

  it('picks the largest unit that fits', () => {
    expect(ago(5 * 60_000)).toMatch(/5 minutes ago/)
    expect(ago(3 * 3_600_000)).toMatch(/3 hours ago/)
    expect(ago(24 * 3_600_000)).toMatch(/yesterday|1 day ago/i)
    expect(ago(9 * 24 * 3_600_000)).toMatch(/last week|1 week ago/i)
    expect(ago(400 * 24 * 3_600_000)).toMatch(/last year|1 year ago/i)
  })

  it('does not say "in 3 hours" when the clock has drifted backwards', () => {
    expect(relativeTime(now + 3 * 3_600_000, now)).toBe('just now')
  })

  it('returns nothing for a nonsense timestamp rather than "Invalid Date"', () => {
    expect(relativeTime(Number.NaN, now)).toBe('')
  })
})

describe('the saved graphs section', () => {
  it('renders nothing at all when the account has no saved graphs', () => {
    const { container } = render(<SavedGraphs />)
    // A landing page should not show a first-time visitor an empty shelf.
    expect(container).toBeEmptyDOMElement()
  })

  it('lists what has been saved, with its size', async () => {
    await saveAGraph('Homework 3', ['A-B', 'B-C', 'C-A'])
    render(<SavedGraphs />)
    const card = screen.getByRole('button', { name: /^Open Homework 3/ })
    expect(card).toBeInTheDocument()
    expect(card).toHaveTextContent('3v')
    expect(card).toHaveTextContent('3e')
    // The visible shorthand reads badly aloud, so the accessible name spells
    // it out instead.
    expect(card).toHaveAccessibleName(/3 vertices, 3 edges/)
  })

  it('opens a saved graph by id, without going through the editor first', async () => {
    const user = userEvent.setup()
    await saveAGraph('Homework 3', ['A-B'])
    const id = state().documents[0]!.id

    render(<SavedGraphs />)
    await user.click(screen.getByRole('button', { name: /^Open Homework 3/ }))
    expect(window.location.hash).toBe(`#/graph?g=${encodeURIComponent(`doc:${id}`)}`)
  })

  it('shows the most recent first', async () => {
    await saveAGraph('Older', ['A-B'])
    await saveAGraph('Newer', ['A-B', 'B-C'])

    render(<SavedGraphs />)
    const names = screen
      .getAllByRole('button')
      .map((button) => button.textContent ?? '')
      .filter((text) => /Older|Newer/.test(text))
    expect(names[0]).toContain('Newer')
  })

  it('caps the list and reveals the rest on request', async () => {
    const user = userEvent.setup()
    for (let i = 0; i < 8; i += 1) {
      state().newDocument()
      await saveAGraph(`Graph ${i}`, ['A-B'])
    }
    render(<SavedGraphs />)
    expect(screen.getAllByRole('button', { name: /^Open Graph \d/ })).toHaveLength(6)

    await user.click(screen.getByRole('button', { name: /Show 2 more/ }))
    expect(screen.getAllByRole('button', { name: /^Open Graph \d/ })).toHaveLength(8)
  })
})

describe('deleting from the home page', () => {
  it('offers a delete control per graph, reachable without a mouse', async () => {
    await saveAGraph('Homework 3', ['A-B'])
    render(<SavedGraphs />)
    const remove = screen.getByRole('button', { name: 'Delete Homework 3' })
    expect(remove).toBeInTheDocument()
    // Revealed by opacity, never removed from the DOM, so it stays tabbable.
    expect(remove).toBeVisible()
  })

  it('always confirms before destroying anything', async () => {
    const user = userEvent.setup()
    await saveAGraph('Homework 3', ['A-B'])
    render(<SavedGraphs />)

    await user.click(screen.getByRole('button', { name: 'Delete Homework 3' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    // Nothing has happened yet.
    expect(state().documents).toHaveLength(1)
  })

  it('names the graph and its size, so the wrong one is not deleted', async () => {
    const user = userEvent.setup()
    await saveAGraph('Homework 3', ['A-B', 'B-C', 'C-A'])
    render(<SavedGraphs />)
    await user.click(screen.getByRole('button', { name: 'Delete Homework 3' }))

    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent(/Delete .Homework 3./)
    expect(dialog).toHaveTextContent('3 vertices')
    expect(dialog).toHaveTextContent('3 edges')
    expect(dialog).toHaveTextContent(/no undo/i)
  })

  it('keeps the graph when the confirmation is cancelled', async () => {
    const user = userEvent.setup()
    await saveAGraph('Homework 3', ['A-B'])
    render(<SavedGraphs />)

    await user.click(screen.getByRole('button', { name: 'Delete Homework 3' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(state().documents).toHaveLength(1)
    expect(screen.getByRole('button', { name: /^Open Homework 3/ })).toBeInTheDocument()
  })

  it('removes it once confirmed, and only it', async () => {
    const user = userEvent.setup()
    await saveAGraph('Keep me', ['A-B'])
    state().newDocument()
    await saveAGraph('Delete me', ['A-B', 'B-C'])
    render(<SavedGraphs />)

    await user.click(screen.getByRole('button', { name: 'Delete Delete me' }))
    await user.click(screen.getByRole('button', { name: 'Delete' }))

    expect(state().documents.map((entry) => entry.name)).toEqual(['Keep me'])
    expect(screen.queryByRole('button', { name: /^Open Delete me/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Open Keep me/ })).toBeInTheDocument()
  })

  it('disappears entirely once the last graph is deleted', async () => {
    const user = userEvent.setup()
    await saveAGraph('Only one', ['A-B'])
    const { container } = render(<SavedGraphs />)

    await user.click(screen.getByRole('button', { name: 'Delete Only one' }))
    await user.click(screen.getByRole('button', { name: 'Delete' }))

    expect(container).toBeEmptyDOMElement()
  })

  it('does not open the graph when the delete control is used', async () => {
    const user = userEvent.setup()
    await saveAGraph('Homework 3', ['A-B'])
    render(<SavedGraphs />)

    await user.click(screen.getByRole('button', { name: 'Delete Homework 3' }))
    // The delete button sits on top of the card; the card must not also fire.
    expect(window.location.hash).not.toContain('doc%3A')
  })
})

describe('protecting unsaved work', () => {
  it('opens straight away when there is nothing to lose', async () => {
    const user = userEvent.setup()
    await saveAGraph('Homework 3', ['A-B'])
    // saveCurrent leaves the document clean, so this click is not destructive.
    render(<SavedGraphs />)
    await user.click(screen.getByRole('button', { name: /^Open Homework 3/ }))
    expect(window.location.hash).toContain('doc%3A')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('asks first when the canvas holds unsaved work', async () => {
    const user = userEvent.setup()
    await saveAGraph('Homework 3', ['A-B'])
    // A fresh sketch that has never been saved: openDocument would discard it
    // and clear the undo history with it.
    state().newDocument()
    state().addVertexAt(0, 0)

    render(<SavedGraphs />)
    await user.click(screen.getByRole('button', { name: /^Open Homework 3/ }))

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(window.location.hash).not.toContain('doc%3A')
  })

  it('leaves everything alone when the warning is dismissed', async () => {
    const user = userEvent.setup()
    await saveAGraph('Homework 3', ['A-B'])
    state().newDocument()
    state().addVertexAt(0, 0)

    render(<SavedGraphs />)
    await user.click(screen.getByRole('button', { name: /^Open Homework 3/ }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(window.location.hash).not.toContain('doc%3A')
    expect(state().doc.vertices).toHaveLength(1)
  })

  it('goes ahead once the warning is accepted', async () => {
    const user = userEvent.setup()
    await saveAGraph('Homework 3', ['A-B'])
    const id = state().documents[0]!.id
    state().newDocument()
    state().addVertexAt(0, 0)

    render(<SavedGraphs />)
    await user.click(screen.getByRole('button', { name: /^Open Homework 3/ }))
    await user.click(screen.getByRole('button', { name: /^Open “Homework 3”$/ }))

    expect(window.location.hash).toBe(`#/graph?g=${encodeURIComponent(`doc:${id}`)}`)
  })
})
