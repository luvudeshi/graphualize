import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { docFromEdges } from '../graph/model/builder'

vi.mock('./cloud', () => import('../test/fakeCloud'))

const { __fake } = await import('../test/fakeCloud')
const { useEditor, setSignedInProbe } = await import('../state/store')
const { useAuth } = await import('../auth/store')
const { SavedGraphs } = await import('../home/SavedGraphs')
const { adoptLocalGraphs, pendingLocalGraphCount, discardLocalOriginals } = await import('./adopt')
const { saveDocument, listDocuments } = await import('../state/documents')

const state = () => useEditor.getState()

const signedIn = (yes: boolean) => {
  setSignedInProbe(() => yes)
  useAuth.setState({
    status: yes ? 'signedIn' : 'signedOut',
    profile: yes ? { id: 'u', email: 'a@b.c', name: 'Ada', avatarUrl: null } : null,
  })
}

beforeEach(() => {
  window.localStorage.clear()
  __fake.reset()
  signedIn(true)
  state().newDocument()
})

describe('a graph is only kept by saving it to an account', () => {
  it('leaves nothing behind in this browser while you work', () => {
    state().replaceDocument(docFromEdges(['A-B', 'B-C', 'C-A']), 'Triangle')
    state().addVertexAt(40, 40)
    state().setName('Homework 3')

    // The old build wrote the working document to local storage on every
    // change. Nothing does now — closing the tab really does lose it, which is
    // the behaviour the product promises rather than an accident.
    expect(Object.keys(window.localStorage)).not.toContain('graphualize:session:v1')
  })

  it('starts empty even if an old session payload is still lying around', async () => {
    window.localStorage.setItem(
      'graphualize:session:v1',
      JSON.stringify({ id: 'old', name: 'Ghost', graph: { vertices: [], edges: [] } }),
    )
    // A fresh import of the store must ignore it entirely.
    vi.resetModules()
    const { useEditor: fresh } = await import('../state/store')
    expect(fresh.getState().name).toBe('Untitled graph')
    expect(fresh.getState().doc.vertices).toHaveLength(0)
  })
})

describe('the home page when signed out', () => {
  it('explains what signing in is for instead of showing an empty shelf', () => {
    signedIn(false)
    render(<SavedGraphs />)
    expect(screen.getByText(/Sign in to keep your graphs/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /continue with google/i })).toBeInTheDocument()
  })

  it('says how many older graphs are waiting, when there are some', () => {
    saveDocument({ id: 'legacy-1', name: 'Old one', graph: docFromEdges(['A-B']) })
    saveDocument({ id: 'legacy-2', name: 'Old two', graph: docFromEdges(['A-B', 'B-C']) })
    signedIn(false)
    render(<SavedGraphs />)
    expect(screen.getByText(/2 graphs saved here by an older version/i)).toBeInTheDocument()
  })
})

describe('graphs saved before an account was required', () => {
  it('counts what is still waiting to move', () => {
    expect(pendingLocalGraphCount()).toBe(0)
    saveDocument({ id: 'legacy-1', name: 'Old one', graph: docFromEdges(['A-B']) })
    expect(pendingLocalGraphCount()).toBe(1)
  })

  it('uploads them once, and not again on the next sign-in', async () => {
    saveDocument({ id: 'legacy-1', name: 'Homework 1', graph: docFromEdges(['A-B']) })
    saveDocument({ id: 'legacy-2', name: 'Homework 2', graph: docFromEdges(['A-B', 'B-C']) })

    const first = await adoptLocalGraphs()
    expect(first.uploaded).toBe(2)
    expect(__fake.rows()).toHaveLength(2)

    const second = await adoptLocalGraphs()
    expect(second.uploaded).toBe(0)
    expect(__fake.rows()).toHaveLength(2)
  })

  it('keeps the local originals, in case the wrong account was used', async () => {
    saveDocument({ id: 'legacy-1', name: 'Homework 1', graph: docFromEdges(['A-B']) })
    await adoptLocalGraphs()
    // Deleting them here would leave no copy at all if this was the wrong
    // Google account. They go only when the user says so.
    expect(listDocuments()).toHaveLength(1)
    expect(discardLocalOriginals()).toBe(1)
    expect(listDocuments()).toHaveLength(0)
  })

  it('does not merge two graphs just because they share a name', async () => {
    saveDocument({ id: 'legacy-1', name: 'Untitled graph', graph: docFromEdges(['A-B']) })
    __fake.seed('Untitled graph', docFromEdges(['C-D', 'D-E']))

    await adoptLocalGraphs()
    // Two graphs called the same thing are two graphs.
    expect(__fake.rows()).toHaveLength(2)
  })

  it('reports a partial failure honestly', async () => {
    saveDocument({ id: 'legacy-1', name: 'Homework 1', graph: docFromEdges(['A-B']) })
    saveDocument({ id: 'legacy-2', name: 'Homework 2', graph: docFromEdges(['A-B']) })
    __fake.failNextCall('offline')

    const outcome = await adoptLocalGraphs()
    expect(outcome.uploaded).toBe(1)
    expect(outcome.failed).toBe(1)
    expect(outcome.message).toMatch(/1 could not be copied/i)
  })

  it('survives an index entry whose document has gone missing', async () => {
    saveDocument({ id: 'legacy-1', name: 'Homework 1', graph: docFromEdges(['A-B']) })
    window.localStorage.removeItem('graphualize:doc:legacy-1')
    const outcome = await adoptLocalGraphs()
    expect(outcome.uploaded).toBe(0)
    expect(outcome.failed).toBe(0)
  })
})
