import { beforeEach, describe, expect, it, vi } from 'vitest'
import { docFromEdges } from '../graph/model/builder'
import { Graph } from '../graph/model/graph'

// Signed in, saving goes to the account, so the store is tested against an
// in-memory stand-in for the cloud. Signed out it goes to this browser, which
// is jsdom's real local storage.
vi.mock('../sync/cloud', () => import('../test/fakeCloud'))

const { __fake } = await import('../test/fakeCloud')
const { useEditor, setSignedInProbe } = await import('./store')
const { listDocuments } = await import('./documents')
const { adoptLocalGraphs, cloudLinkFor } = await import('../sync/adopt')
const { saveDocument } = await import('./documents')

/** Lets the clock move on, so the next local save gets a later `updatedAt`. */
const tick = () => new Promise((resolve) => setTimeout(resolve, 3))
const { applyGenerator, importText, runGraphCommand } = await import('./actions')

const state = () => useEditor.getState()

let signedIn = true

beforeEach(() => {
  window.localStorage.clear()
  __fake.reset()
  signedIn = true
  setSignedInProbe(() => signedIn)
  state().newDocument()
})

describe('editing', () => {
  it('adds vertices with spreadsheet labels and selects them', () => {
    const a = state().addVertexAt(0, 0)
    const b = state().addVertexAt(50, 0)
    expect(state().graph.labels([a, b])).toEqual(['A', 'B'])
    expect(state().selectedVertices).toEqual([b])
  })

  it('reuses a freed label rather than skipping ahead', () => {
    state().addVertexAt(0, 0)
    const b = state().addVertexAt(10, 0)
    state().addVertexAt(20, 0)
    state().deleteElements([b], [])
    const replacement = state().addVertexAt(30, 0)
    expect(state().graph.label(replacement)).toBe('B')
  })

  it('adds an edge and refuses an exact duplicate', () => {
    const a = state().addVertexAt(0, 0)
    const b = state().addVertexAt(50, 0)
    expect(state().addEdge(a, b)).toBeTruthy()
    expect(state().addEdge(a, b)).toBeNull()
    expect(state().doc.edges).toHaveLength(1)
    expect(state().status?.tone).toBe('error')
  })

  it('deletes incident edges when a vertex goes', () => {
    const a = state().addVertexAt(0, 0)
    const b = state().addVertexAt(50, 0)
    const c = state().addVertexAt(0, 50)
    state().addEdge(a, b)
    state().addEdge(b, c)
    state().deleteElements([b], [])
    expect(state().doc.vertices).toHaveLength(2)
    expect(state().doc.edges).toHaveLength(0)
  })

  it('renames a vertex and ignores an empty name', () => {
    const a = state().addVertexAt(0, 0)
    state().renameVertex(a, '  source ')
    expect(state().graph.label(a)).toBe('source')
    state().renameVertex(a, '   ')
    expect(state().graph.label(a)).toBe('source')
  })

  it('rejects a non-finite weight', () => {
    const a = state().addVertexAt(0, 0)
    const b = state().addVertexAt(50, 0)
    state().setWeighted(true)
    const edge = state().addEdge(a, b)!
    state().setEdgeWeight(edge, Number.NaN)
    expect(state().graph.weight(edge)).toBe(1)
    expect(state().status?.text).toContain('finite')
    state().setEdgeWeight(edge, -3)
    expect(state().graph.weight(edge)).toBe(-3)
  })

  it('gives new edges a weight of 1 in weighted mode', () => {
    state().setWeighted(true)
    const a = state().addVertexAt(0, 0)
    const b = state().addVertexAt(50, 0)
    const edge = state().addEdge(a, b)!
    expect(state().doc.edges.find((e) => e.id === edge)?.weight).toBe(1)
  })
})

describe('undo and redo', () => {
  it('reverses every kind of change', () => {
    const a = state().addVertexAt(0, 0)
    const b = state().addVertexAt(50, 0)
    state().addEdge(a, b)
    expect(state().doc.edges).toHaveLength(1)

    state().undo()
    expect(state().doc.edges).toHaveLength(0)
    state().undo()
    expect(state().doc.vertices).toHaveLength(1)
    state().redo()
    expect(state().doc.vertices).toHaveLength(2)
    state().redo()
    expect(state().doc.edges).toHaveLength(1)
  })

  it('undoes a move, a rename and a mode switch', () => {
    const a = state().addVertexAt(10, 10)
    state().commitPositions({ [a]: { x: 99, y: 99 } })
    expect(state().graph.vertex(a)!.x).toBe(99)
    state().undo()
    expect(state().graph.vertex(a)!.x).toBe(10)

    state().renameVertex(a, 'Root')
    state().undo()
    expect(state().graph.label(a)).toBe('A')

    state().setDirected(true)
    expect(state().doc.directed).toBe(true)
    state().undo()
    expect(state().doc.directed).toBe(false)
  })

  it('ignores a move that changes nothing', () => {
    const a = state().addVertexAt(10, 10)
    const before = state().past.length
    state().commitPositions({ [a]: { x: 10, y: 10 } })
    expect(state().past.length).toBe(before)
  })

  it('clears the redo stack once a new change lands', () => {
    state().addVertexAt(0, 0)
    state().undo()
    expect(state().future).toHaveLength(1)
    state().addVertexAt(30, 30)
    expect(state().future).toHaveLength(0)
  })

  it('does nothing when there is no history', () => {
    expect(() => state().undo()).not.toThrow()
    expect(() => state().redo()).not.toThrow()
    expect(state().doc.vertices).toHaveLength(0)
  })

  it('reverses a generated graph in one step', () => {
    state().replaceDocument(docFromEdges(['A-B', 'B-C', 'C-A']), 'Generate C3')
    expect(state().doc.vertices).toHaveLength(3)
    state().undo()
    expect(state().doc.vertices).toHaveLength(0)
  })
})

describe('witnesses and algorithms', () => {
  it('toggles a witness off when the same row is clicked twice', () => {
    const witness = { type: 'vertices', vertexIds: [] } as const
    state().setWitness('bipartite', witness)
    expect(state().activeWitness?.rowId).toBe('bipartite')
    state().setWitness('bipartite', witness)
    expect(state().activeWitness).toBeNull()
  })

  it('runs BFS and steps deterministically', () => {
    state().replaceDocument(docFromEdges(['A-B', 'B-C', 'C-D']), 'Path')
    const source = state().graph.vertexIds[0]!
    state().startAlgorithm('bfs', { source })
    const session = state().algorithm!
    expect(session.steps.length).toBeGreaterThan(3)
    expect(session.index).toBe(0)

    state().stepForward()
    expect(state().algorithm!.index).toBe(1)
    state().stepBackward()
    expect(state().algorithm!.index).toBe(0)
    state().stepBackward()
    expect(state().algorithm!.index).toBe(0)

    state().goToStep(10_000)
    expect(state().algorithm!.index).toBe(session.steps.length - 1)
  })

  it('refuses Dijkstra on a negative weight and explains why', () => {
    state().replaceDocument(
      docFromEdges(['A-B:-2', 'B-C:3'], { weighted: true }),
      'Negative weights',
    )
    state().startAlgorithm('dijkstra', { source: state().graph.vertexIds[0] })
    expect(state().algorithm).toBeNull()
    expect(state().status?.text).toMatch(/Bellman-Ford/)
  })

  it('drops the algorithm when the graph changes shape', () => {
    state().replaceDocument(docFromEdges(['A-B', 'B-C']), 'Path')
    state().startAlgorithm('bfs', { source: state().graph.vertexIds[0] })
    expect(state().algorithm).not.toBeNull()
    state().setDirected(true)
    expect(state().algorithm).toBeNull()
  })
})

describe('staying consistent with the graph on screen', () => {
  it('drops an active witness when the structure changes', () => {
    state().replaceDocument(docFromEdges(['A-B', 'B-C', 'C-A', 'C-D']), 'Triangle with a tail')
    state().setWitness('bridges', { type: 'edges', edgeIds: state().graph.edgeIds })
    expect(state().activeWitness).not.toBeNull()

    const [a, b] = [state().graph.vertexIds[0]!, state().graph.vertexIds[3]!]
    state().addEdge(a, b)
    expect(state().activeWitness).toBeNull()
  })

  it('keeps a witness through a move, which changes nothing mathematical', () => {
    state().replaceDocument(docFromEdges(['A-B', 'B-C']), 'Path')
    state().setWitness('edges', { type: 'edges', edgeIds: state().graph.edgeIds })
    const id = state().graph.vertexIds[0]!
    state().commitPositions({ [id]: { x: 400, y: 400 } })
    expect(state().activeWitness).not.toBeNull()
  })

  it('drops a running algorithm when the graph is edited', () => {
    state().replaceDocument(docFromEdges(['A-B', 'B-C', 'C-D']), 'Path')
    state().startAlgorithm('bfs', { source: state().graph.vertexIds[0] })
    expect(state().algorithm).not.toBeNull()
    state().deleteElements([state().graph.vertexIds[3]!], [])
    expect(state().algorithm).toBeNull()
  })

  it('drops a running algorithm on undo', () => {
    state().replaceDocument(docFromEdges(['A-B', 'B-C']), 'Path')
    state().startAlgorithm('bfs', { source: state().graph.vertexIds[0] })
    state().undo()
    expect(state().algorithm).toBeNull()
  })

  it('coalesces repeated nudges into one undo step', () => {
    state().replaceDocument(docFromEdges(['A-B']), 'Edge')
    const id = state().graph.vertexIds[0]!
    const before = state().past.length
    for (let i = 1; i <= 10; i++) {
      state().commitPositions({ [id]: { x: i * 8, y: 0 } }, 'Nudge', true)
    }
    expect(state().past.length).toBe(before + 1)
    state().undo()
    expect(state().graph.vertex(id)!.x).toBe(0)
  })

  it('never hands out an id that a reopened document already uses', async () => {
    state().replaceDocument(docFromEdges(['A-B', 'B-C']), 'Path')
    await state().saveCurrent('Reopen me')
    const id = state().savedId!

    state().newDocument()
    await state().openDocument(id)
    const before = new Set(state().doc.vertices.map((v) => v.id))
    const added = state().addVertexAt(10, 10)
    expect(before.has(added)).toBe(false)
    expect(new Set(state().doc.vertices.map((v) => v.id)).size).toBe(
      state().doc.vertices.length,
    )
  })
})

describe('saving in this browser when signed out', () => {
  beforeEach(() => {
    signedIn = false
  })

  it('saves to local storage, not the account', async () => {
    state().replaceDocument(docFromEdges(['A-B', 'B-C']), 'Path')
    await state().saveCurrent('Homework 3')

    expect(__fake.rows()).toHaveLength(0)
    expect(listDocuments().map((entry) => entry.name)).toEqual(['Homework 3'])
    expect(state().savedWhere).toBe('local')
    expect(state().dirty).toBe(false)
    expect(state().status?.tone).toBe('success')
    expect(state().status?.text).toMatch(/in this browser/i)
  })

  it('lists and reopens what was saved here', async () => {
    state().replaceDocument(docFromEdges(['A-B', 'B-C', 'C-A']), 'Triangle')
    await state().saveCurrent('My triangle')
    await state().refreshDocuments()
    expect(state().documentsSource).toBe('local')
    const [entry] = state().documents
    expect(entry!.name).toBe('My triangle')

    state().newDocument()
    await state().openDocument(entry!.id)
    expect(state().name).toBe('My triangle')
    expect(state().doc.edges).toHaveLength(3)
    expect(state().savedWhere).toBe('local')
    expect(state().dirty).toBe(false)
  })

  it('updates the same entry rather than piling up copies', async () => {
    state().replaceDocument(docFromEdges(['A-B']), 'Edge')
    await state().saveCurrent('Working')
    const first = listDocuments()[0]!
    state().addVertexAt(10, 10)
    await state().saveCurrent()

    const entries = listDocuments()
    expect(entries).toHaveLength(1)
    expect(entries[0]!.vertexCount).toBe(3)
    expect(entries[0]!.createdAt).toBe(first.createdAt)
  })

  it('deletes from this browser', async () => {
    state().replaceDocument(docFromEdges(['A-B']), 'Edge')
    await state().saveCurrent('Doomed')
    const id = state().savedId!
    await state().removeDocument(id, 'local')
    expect(listDocuments()).toHaveLength(0)
    expect(state().savedId).toBeNull()
    expect(state().dirty).toBe(true)
  })

  it('reports a missing local graph instead of throwing', async () => {
    await state().openDocument('nope', 'local')
    expect(state().status?.tone).toBe('error')
    expect(state().status?.text).toMatch(/no longer saved in this browser/i)
  })

  it('keeps a graph opened from this browser saved here after signing out', async () => {
    state().replaceDocument(docFromEdges(['A-B']), 'Edge')
    await state().saveCurrent('Mine')
    state().forgetDocuments()
    expect(state().savedWhere).toBe('local')
    expect(state().savedId).not.toBeNull()
  })
})

describe('moving between this browser and the account', () => {
  it('copies a graph saved here into the account, then keeps saving it there', async () => {
    signedIn = false
    state().replaceDocument(docFromEdges(['A-B', 'B-C']), 'Path')
    await state().saveCurrent('Carried over')

    signedIn = true
    await adoptLocalGraphs()
    state().followIntoAccount()
    expect(state().savedWhere).toBe('cloud')
    expect(__fake.rows()).toHaveLength(1)

    state().addVertexAt(1, 1)
    await state().saveCurrent()
    // The same account entry, now at version 2 — not a second copy.
    expect(__fake.rows()).toHaveLength(1)
    expect(__fake.rows()[0]!.version).toBe(2)
    expect(__fake.rows()[0]!.vertexCount).toBe(4)
  })

  it('saving a graph from this browser while signed in links it, so it is not uploaded twice', async () => {
    signedIn = false
    state().replaceDocument(docFromEdges(['A-B']), 'Edge')
    await state().saveCurrent('Linked')
    const localId = state().savedId!

    signedIn = true
    await state().saveCurrent()
    expect(__fake.rows()).toHaveLength(1)
    expect(cloudLinkFor(localId)?.cloudId).toBe(state().savedId)

    const outcome = await adoptLocalGraphs()
    expect(outcome.uploaded).toBe(0)
    expect(__fake.rows()).toHaveLength(1)
  })

  it('re-uploads a graph edited here since it was copied, onto the same entry', async () => {
    signedIn = false
    state().replaceDocument(docFromEdges(['A-B']), 'Edge')
    await state().saveCurrent('Edited later')
    signedIn = true
    await adoptLocalGraphs()

    signedIn = false
    state().addVertexAt(3, 3)
    // A later save gets a later timestamp, which is what marks it as newer.
    await tick()
    await state().saveCurrent()

    signedIn = true
    const outcome = await adoptLocalGraphs()
    expect(outcome.uploaded).toBe(1)
    expect(__fake.rows()).toHaveLength(1)
    expect(__fake.rows()[0]!.vertexCount).toBe(3)
  })

  it('never writes over an account entry that moved on elsewhere', async () => {
    signedIn = false
    state().replaceDocument(docFromEdges(['A-B']), 'Edge')
    await state().saveCurrent('Contested')
    signedIn = true
    await adoptLocalGraphs()
    const cloudId = __fake.rows()[0]!.id
    __fake.bumpElsewhere(cloudId)

    signedIn = false
    state().addVertexAt(3, 3)
    await tick()
    await state().saveCurrent()

    signedIn = true
    await adoptLocalGraphs()
    // Both survive: the other device's version and this browser's.
    expect(__fake.rows()).toHaveLength(2)
    expect(__fake.rows().find((row) => row.id === cloudId)!.vertexCount).toBe(2)
  })

  it('drops the account list, and only it, on sign-out', async () => {
    state().replaceDocument(docFromEdges(['A-B']), 'Edge')
    await state().saveCurrent('In the account')
    await state().refreshDocuments()
    expect(state().documentsSource).toBe('cloud')

    signedIn = false
    state().forgetDocuments()
    expect(state().savedId).toBeNull()
    expect(state().documents).toEqual([])
    await state().refreshDocuments()
    expect(state().documentsSource).toBe('local')
  })
})

describe('when the account cannot be reached', () => {
  it('keeps the graph in this browser instead of failing the save', async () => {
    __fake.setOffline(true)
    state().replaceDocument(docFromEdges(['A-B', 'B-C']), 'Path')
    await state().saveCurrent('Offline work')

    expect(listDocuments().map((entry) => entry.name)).toEqual(['Offline work'])
    expect(state().savedWhere).toBe('local')
    expect(state().dirty).toBe(false)
    expect(state().status?.text).toMatch(/could not reach your account/i)
    expect(state().status?.text).toMatch(/saved in this browser/i)
  })

  it('updates the original account entry once it is back, rather than duplicating it', async () => {
    state().replaceDocument(docFromEdges(['A-B']), 'Edge')
    await state().saveCurrent('Was online')
    expect(__fake.rows()).toHaveLength(1)

    __fake.setOffline(true)
    state().addVertexAt(9, 9)
    await state().saveCurrent()
    expect(state().savedWhere).toBe('local')

    __fake.setOffline(false)
    const outcome = await adoptLocalGraphs()
    expect(outcome.uploaded).toBe(1)
    expect(__fake.rows()).toHaveLength(1)
    expect(__fake.rows()[0]!.version).toBe(2)
    expect(__fake.rows()[0]!.vertexCount).toBe(3)
  })

  it('still reports an ordinary refusal as a failure', async () => {
    __fake.failNextCall('This account is not allowed to do that.')
    state().replaceDocument(docFromEdges(['A-B']), 'Edge')
    await state().saveCurrent('Refused')
    expect(listDocuments()).toHaveLength(0)
    expect(state().status?.tone).toBe('error')
    expect(state().status?.text).toMatch(/not allowed/)
  })

  it('ignores an account list that arrives after signing out', async () => {
    state().replaceDocument(docFromEdges(['A-B']), 'Edge')
    await state().saveCurrent('Cloud one')
    signedIn = false
    await state().refreshDocuments()
    expect(state().documentsSource).toBe('local')

    signedIn = true
    const pending = state().refreshDocuments()
    signedIn = false
    await pending
    expect(state().documentsSource).toBe('local')
    expect(state().documents.map((entry) => entry.name)).not.toContain('Cloud one')
  })
})

describe('found in review: the sync never loses or hides work', () => {
  it('a signed-in save of a graph from this browser cannot be undone by its old local content', async () => {
    // The account entry gets newer content than the local copy had. The local
    // copy must be brought up to date with it, or a later edit of the stale
    // local copy would pass the version check and overwrite this save.
    state().replaceDocument(docFromEdges(['A-B']), 'Edge')
    await state().saveCurrent('Foo')
    const cloudId = state().savedId!

    __fake.setOffline(true)
    state().addVertexAt(1, 1)
    await state().saveCurrent()
    const localId = state().savedId!
    __fake.setOffline(false)

    state().addVertexAt(2, 2)
    state().addVertexAt(3, 3)
    await state().saveCurrent()
    expect(__fake.rows().find((row) => row.id === cloudId)!.vertexCount).toBe(5)

    signedIn = false
    state().forgetDocuments()
    await state().openDocument(localId, 'local')
    // The local copy now holds what the account holds, not the stale 3.
    expect(state().doc.vertices).toHaveLength(5)
    state().renameVertex(state().doc.vertices[0]!.id, 'Z')
    await tick()
    await state().saveCurrent()

    signedIn = true
    await adoptLocalGraphs()
    const row = __fake.rows().find((candidate) => candidate.id === cloudId)!
    expect(row.vertexCount).toBe(5)
    expect(row.graph.vertices.map((v) => v.label)).toContain('Z')
  })

  it('a graph deleted from the account is not re-uploaded into the deleted entry', async () => {
    signedIn = false
    state().replaceDocument(docFromEdges(['A-B']), 'Edge')
    await state().saveCurrent('Foo')
    signedIn = true
    await adoptLocalGraphs()
    const cloudId = __fake.rows()[0]!.id
    await state().removeDocument(cloudId, 'cloud')
    expect(__fake.rows()).toHaveLength(0)

    signedIn = false
    const [entry] = listDocuments()
    await state().openDocument(entry!.id, 'local')
    state().addVertexAt(4, 4)
    await tick()
    await state().saveCurrent()

    signedIn = true
    const outcome = await adoptLocalGraphs()
    expect(outcome.uploaded).toBe(1)
    // A new, visible entry — not an update to the tombstone.
    expect(__fake.rows()).toHaveLength(1)
    expect(__fake.rows()[0]!.id).not.toBe(cloudId)
  })

  it('an untouched graph deleted from the account is not resurrected on sign-in', async () => {
    signedIn = false
    state().replaceDocument(docFromEdges(['A-B']), 'Edge')
    await state().saveCurrent('Foo')
    signedIn = true
    await adoptLocalGraphs()
    await state().removeDocument(__fake.rows()[0]!.id, 'cloud')
    const outcome = await adoptLocalGraphs()
    expect(outcome.uploaded).toBe(0)
    expect(__fake.rows()).toHaveLength(0)
  })

  it('two adoptions at once upload each graph once', async () => {
    saveDocument({ id: 'one', name: 'One', graph: docFromEdges(['A-B']) })
    saveDocument({ id: 'two', name: 'Two', graph: docFromEdges(['A-B']) })
    await Promise.all([adoptLocalGraphs(), adoptLocalGraphs()])
    expect(__fake.rows().map((row) => row.name).sort()).toEqual(['One', 'Two'])
  })

  it('a save made while adoption is running does not insert the graph twice', async () => {
    signedIn = false
    state().replaceDocument(docFromEdges(['A-B']), 'Edge')
    await state().saveCurrent('Racing')
    signedIn = true
    const adoption = adoptLocalGraphs()
    const save = state().saveCurrent()
    await Promise.all([adoption, save])
    expect(__fake.rows()).toHaveLength(1)
  })

  it('a graph an older build copied is uploaded again once edited here', async () => {
    saveDocument({ id: 'legacy-1', name: 'Old', graph: docFromEdges(['A-B']) })
    window.localStorage.setItem('graphualize:adopted:v1', JSON.stringify(['legacy-1']))
    expect((await adoptLocalGraphs()).uploaded).toBe(0)

    signedIn = false
    await state().openDocument('legacy-1', 'local')
    state().addVertexAt(5, 5)
    await tick()
    await state().saveCurrent()

    signedIn = true
    expect((await adoptLocalGraphs()).uploaded).toBe(1)
    expect(__fake.rows()[0]!.vertexCount).toBe(3)
  })

  it('while the account is unreachable, the list shows what is saved in this browser', async () => {
    saveDocument({ id: 'here', name: 'Saved here', graph: docFromEdges(['A-B']) })
    __fake.setOffline(true)
    await state().refreshDocuments()
    expect(state().accountUnreachable).toBe(true)
    expect(state().documentsSource).toBe('local')
    expect(state().documents.map((entry) => entry.name)).toEqual(['Saved here'])
  })

  it('copies an offline save across as soon as the account answers again', async () => {
    __fake.setOffline(true)
    state().replaceDocument(docFromEdges(['A-B']), 'Edge')
    await state().saveCurrent('Made offline')
    expect(__fake.rows()).toHaveLength(0)

    __fake.setOffline(false)
    await state().refreshDocuments()
    await vi.waitFor(() => expect(__fake.rows().map((row) => row.name)).toEqual(['Made offline']))
    expect(state().accountUnreachable).toBe(false)
    // And the open graph now follows its account entry.
    await vi.waitFor(() => expect(state().savedWhere).toBe('cloud'))
  })

  it('a graph from the account, saved after signing out, updates its entry on the next sign-in', async () => {
    state().replaceDocument(docFromEdges(['A-B']), 'Edge')
    await state().saveCurrent('Shared')
    expect(__fake.rows()).toHaveLength(1)

    signedIn = false
    state().forgetDocuments()
    state().addVertexAt(6, 6)
    await state().saveCurrent()
    expect(state().savedWhere).toBe('local')

    signedIn = true
    await adoptLocalGraphs()
    expect(__fake.rows()).toHaveLength(1)
    expect(__fake.rows()[0]!.version).toBe(2)
    expect(__fake.rows()[0]!.vertexCount).toBe(3)
  })

  it('a local save does not overwrite what another tab saved in the meantime', async () => {
    signedIn = false
    state().replaceDocument(docFromEdges(['A-B']), 'Edge')
    await state().saveCurrent('Two tabs')
    const id = state().savedId!

    // Another tab saves the same entry with different content.
    await tick()
    saveDocument({ id, name: 'Two tabs', graph: docFromEdges(['X-Y', 'Y-Z']) })

    state().addVertexAt(7, 7)
    await state().saveCurrent()
    const names = listDocuments().map((entry) => entry.name).sort()
    expect(names).toEqual(['Two tabs', 'Two tabs (copy)'])
    expect(listDocuments().find((entry) => entry.id === id)!.vertexCount).toBe(3)
    expect(state().status?.text).toMatch(/another tab/i)
  })

  it('an expired session keeps the graph in this browser instead of refusing the save', async () => {
    __fake.setSessionGone(true)
    state().replaceDocument(docFromEdges(['A-B']), 'Edge')
    await state().saveCurrent('Expired')
    expect(listDocuments().map((entry) => entry.name)).toEqual(['Expired'])
    expect(state().status?.text).toMatch(/sign-in has expired/i)
  })
})

describe('undoing a delete', () => {
  it('puts an account graph back, with the links that pointed at it', async () => {
    signedIn = false
    state().replaceDocument(docFromEdges(['A-B']), 'Edge')
    await state().saveCurrent('Linked')
    const localId = state().savedId!
    signedIn = true
    await adoptLocalGraphs()
    const cloudId = __fake.rows()[0]!.id
    const link = cloudLinkFor(localId)

    await state().removeDocument(cloudId, 'cloud', { offerUndo: true })
    expect(__fake.rows()).toHaveLength(0)
    expect(cloudLinkFor(localId)?.cloudId).toBeNull()

    await state().undoDelete()
    expect(__fake.rows().map((row) => row.id)).toEqual([cloudId])
    expect(cloudLinkFor(localId)).toEqual(link)
    expect(state().lastDeleted).toBeNull()
    expect(state().status?.text).toMatch(/Restored/)
  })

  it('re-attaches the graph on screen when nothing was edited since', async () => {
    state().replaceDocument(docFromEdges(['A-B']), 'Edge')
    await state().saveCurrent('On screen')
    const id = state().savedId!
    await state().refreshDocuments()

    await state().removeDocument(id, 'cloud', { offerUndo: true })
    expect(state().savedId).toBeNull()
    expect(state().dirty).toBe(true)

    await state().undoDelete()
    expect(state().savedId).toBe(id)
    expect(state().savedWhere).toBe('cloud')
    expect(state().savedVersion).toBe(1)
    expect(state().dirty).toBe(false)
  })

  it('leaves an edited graph unsaved, because it no longer matches what was restored', async () => {
    signedIn = false
    state().replaceDocument(docFromEdges(['A-B']), 'Edge')
    await state().saveCurrent('Edited after')
    const id = state().savedId!

    await state().removeDocument(id, 'local', { offerUndo: true })
    state().addVertexAt(8, 8)
    await state().undoDelete()
    expect(listDocuments().map((entry) => entry.id)).toEqual([id])
    expect(state().savedId).toBeNull()
    expect(state().dirty).toBe(true)
  })

  it('cannot undo an account delete after signing out', async () => {
    state().replaceDocument(docFromEdges(['A-B']), 'Edge')
    await state().saveCurrent('Account only')
    await state().removeDocument(state().savedId!, 'cloud', { offerUndo: true })
    expect(state().lastDeleted).not.toBeNull()
    signedIn = false
    state().forgetDocuments()
    expect(state().lastDeleted).toBeNull()
  })

  it('reports a failed restore and keeps the offer open', async () => {
    state().replaceDocument(docFromEdges(['A-B']), 'Edge')
    await state().saveCurrent('Flaky')
    await state().removeDocument(state().savedId!, 'cloud', { offerUndo: true })
    __fake.failNextCall('Could not reach your account.')
    await state().undoDelete()
    expect(state().status?.tone).toBe('error')
    expect(state().lastDeleted).not.toBeNull()
    await state().undoDelete()
    expect(__fake.rows()).toHaveLength(1)
  })

  it('offers no undo for a delete made elsewhere, such as the home page', async () => {
    signedIn = false
    state().replaceDocument(docFromEdges(['A-B']), 'Edge')
    await state().saveCurrent('Home delete')
    await state().removeDocument(state().savedId!, 'local')
    expect(state().lastDeleted).toBeNull()
  })

  it('does not re-offer undo for a delete that finished after the offer was withdrawn', async () => {
    state().replaceDocument(docFromEdges(['A-B']), 'Edge')
    await state().saveCurrent('Slow delete')
    const pending = state().removeDocument(state().savedId!, 'cloud', { offerUndo: true })
    state().dismissDeleted()
    await pending
    expect(state().lastDeleted).toBeNull()
  })

  it('a repeated delete of the same graph runs once', async () => {
    state().replaceDocument(docFromEdges(['A-B']), 'Edge')
    await state().saveCurrent('Twice')
    const id = state().savedId!
    await Promise.all([
      state().removeDocument(id, 'cloud', { offerUndo: true }),
      state().removeDocument(id, 'cloud', { offerUndo: true }),
    ])
    await state().undoDelete()
    expect(__fake.rows().map((row) => row.id)).toEqual([id])
  })

  it('restores beside, not over, a graph saved under the same id since', async () => {
    signedIn = false
    state().replaceDocument(docFromEdges(['A-B']), 'Edge')
    await state().saveCurrent('Original')
    const id = state().savedId!
    await state().removeDocument(id, 'local', { offerUndo: true })
    // Another tab saves something new under that id.
    saveDocument({ id, name: 'Newer', graph: docFromEdges(['X-Y', 'Y-Z']) })

    await state().undoDelete()
    const names = listDocuments().map((entry) => entry.name).sort()
    expect(names).toEqual(['Newer', 'Original (restored)'])
    expect(listDocuments().find((entry) => entry.id === id)!.name).toBe('Newer')
  })

  it('refuses to "restore" an account graph that is not deleted', async () => {
    state().replaceDocument(docFromEdges(['A-B']), 'Edge')
    await state().saveCurrent('Alive')
    const id = state().savedId!
    await state().removeDocument(id, 'cloud', { offerUndo: true })
    await state().undoDelete()
    // A second restore of the same, now live, row is not a success.
    useEditor.setState({ lastDeleted: { id, source: 'cloud', name: 'Alive', saved: null, links: [], wasOpen: null } })
    await state().undoDelete()
    expect(state().status?.tone).toBe('error')
  })
})

describe('found in review: edits made while a request is out are never discarded unasked', () => {
  it('an edit made while a save is in flight keeps the graph unsaved', async () => {
    state().replaceDocument(docFromEdges(['A-B', 'B-C']), 'Path')
    const saving = state().saveCurrent('In flight')
    state().addVertexAt(9, 9)
    await saving
    expect(__fake.rows()[0]!.vertexCount).toBe(3)
    expect(state().doc.vertices).toHaveLength(4)
    expect(state().dirty).toBe(true)
  })

  it('does not open an account graph over work drawn while it was loading', async () => {
    const id = __fake.seed('Remote', docFromEdges(['X-Y']))
    const opening = state().openDocument(id, 'cloud')
    state().addVertexAt(1, 1)
    state().addVertexAt(2, 2)
    await opening
    expect(state().doc.vertices).toHaveLength(2)
    expect(state().name).not.toBe('Remote')
    expect(state().status?.text).toMatch(/was loading, so it was not opened/)
  })
})

describe('saving to an account', () => {
  it('saves, lists and reopens a graph', async () => {
    state().replaceDocument(docFromEdges(['A-B', 'B-C', 'C-A']), 'Triangle')
    await state().saveCurrent('My triangle')

    await state().refreshDocuments()
    const saved = state().documents
    expect(saved).toHaveLength(1)
    expect(saved[0]!.name).toBe('My triangle')
    expect(saved[0]!.vertexCount).toBe(3)
    expect(state().dirty).toBe(false)

    state().newDocument()
    expect(state().doc.vertices).toHaveLength(0)

    await state().openDocument(saved[0]!.id)
    expect(state().name).toBe('My triangle')
    expect(state().doc.edges).toHaveLength(3)
    expect(state().dirty).toBe(false)
  })

  it('updates the same row rather than piling up copies', async () => {
    state().replaceDocument(docFromEdges(['A-B']), 'Edge')
    await state().saveCurrent('Working')
    state().addVertexAt(10, 10)
    await state().saveCurrent()

    expect(__fake.rows()).toHaveLength(1)
    expect(__fake.rows()[0]!.version).toBe(2)
  })

  it('keeps both versions when another device saved first', async () => {
    state().replaceDocument(docFromEdges(['A-B']), 'Edge')
    await state().saveCurrent('Shared')
    const id = state().savedId!

    // Someone else writes, so this device's version is now stale.
    __fake.bumpElsewhere(id)
    state().addVertexAt(20, 20)
    await state().saveCurrent()

    // Nothing was overwritten: two rows, and the user was told.
    expect(__fake.rows()).toHaveLength(2)
    expect(state().status?.text).toMatch(/newer changes from elsewhere/i)
    expect(state().savedId).not.toBe(id)
  })

  it('says what went wrong instead of claiming it saved', async () => {
    state().replaceDocument(docFromEdges(['A-B']), 'Edge')
    __fake.failNextCall('Could not reach your account.')
    await state().saveCurrent('Doomed')

    expect(state().status?.tone).toBe('error')
    expect(state().dirty).toBe(true)
    expect(state().savedId).toBeNull()
  })

  it('deletes a saved graph, and the removal is a tombstone', async () => {
    state().replaceDocument(docFromEdges(['A-B']), 'Edge')
    await state().saveCurrent('Temp')
    const id = state().savedId!

    await state().removeDocument(id)
    expect(state().documents).toHaveLength(0)
    // Soft, so the delete can reach other devices instead of bouncing back.
    expect(__fake.allRows()).toHaveLength(1)
    expect(__fake.allRows()[0]!.deleted).toBe(true)
  })

  it('empties the list on sign-out and does not ask the account for one', async () => {
    state().replaceDocument(docFromEdges(['A-B']), 'Edge')
    await state().saveCurrent('Mine')
    expect(state().documents).toHaveLength(1)

    signedIn = false
    await state().refreshDocuments()
    expect(state().documents).toHaveLength(0)
  })

  it('keeps the last known list when a refresh fails', async () => {
    state().replaceDocument(docFromEdges(['A-B']), 'Edge')
    await state().saveCurrent('Mine')
    expect(state().documents).toHaveLength(1)

    __fake.failNextCall('offline')
    await state().refreshDocuments()
    // Blanking it would read as "you have no graphs", which is a lie.
    expect(state().documents).toHaveLength(1)
  })

  it('names an untitled document after whatever was loaded into it', () => {
    expect(state().name).toBe('Untitled graph')
    applyGenerator('petersen', {})
    expect(state().name).toBe('Petersen')
    runGraphCommand('K5')
    expect(state().name).toBe('K5')
  })

  it('never renames a document the user named', () => {
    state().setName('Homework 3')
    applyGenerator('complete', { n: 4 })
    expect(state().name).toBe('Homework 3')
  })

  it('takes the name recorded in an imported file', () => {
    importText('graph "kruskal example" { A -- B }')
    expect(state().name).toBe('kruskal example')
  })

  it('does not let a generated graph overwrite the saved graph it replaced', async () => {
    state().replaceDocument(docFromEdges(['A-B', 'B-C', 'C-A']), 'Triangle')
    await state().saveCurrent('Homework 3')
    const original = state().savedId!

    // Generating replaces everything on screen, so it detaches from the row.
    runGraphCommand('K5')
    expect(state().savedId).toBeNull()
    await state().saveCurrent('Homework 4')

    await state().refreshDocuments()
    expect(state().documents).toHaveLength(2)
    expect(__fake.rows().find((row) => row.id === original)!.vertexCount).toBe(3)
  })

  it('reports a failure instead of throwing on a missing document', async () => {
    await state().openDocument('nope')
    expect(state().status?.tone).toBe('error')
  })
})

describe('the working document is never kept locally', () => {
  it('writes nothing to local storage when a graph is edited', () => {
    state().replaceDocument(docFromEdges(['A-B', 'B-C']), 'Path')
    state().addVertexAt(5, 5)
    const keys = Object.keys(window.localStorage)
    expect(keys.filter((key) => key.startsWith('graphualize:session'))).toHaveLength(0)
    expect(keys.filter((key) => key.startsWith('graphualize:doc:'))).toHaveLength(0)
  })
})

describe('legacy local storage', () => {
  it('ignores a corrupt session instead of crashing on load', async () => {
    // The store is created at module scope, so a malformed payload here would
    // otherwise throw before any error boundary exists.
    for (const payload of [
      '{"graph":{"vertices":[null],"edges":[]}}',
      '{"graph":{"vertices":[{"id":"a"}],"edges":[null]}}',
      '{"graph":{"vertices":["A","B"],"edges":[]}}',
      '{"graph":{"vertices":[{"id":"a"},{"id":"a"}],"edges":[]}}',
      '{"graph":{"vertices":[{"id":"a","x":null}],"edges":[{"id":"e","source":"a","target":"ghost"}]}}',
      'not json at all',
      '[]',
    ]) {
      window.localStorage.setItem('graphualize:session:v1', payload)
      const { restoreSession } = await import('./documents')
      const restored = restoreSession()
      expect(() => (restored ? new Graph(restored.graph) : null)).not.toThrow()
      if (restored) {
        const ids = restored.graph.vertices.map((v) => v.id)
        expect(new Set(ids).size).toBe(ids.length)
        for (const edge of restored.graph.edges) {
          expect(ids).toContain(edge.source)
          expect(ids).toContain(edge.target)
        }
      }
    }
  })

})
