import { beforeEach, describe, expect, it, vi } from 'vitest'
import { docFromEdges } from '../graph/model/builder'
import { Graph } from '../graph/model/graph'

// Saving goes to the account, never to this browser, so the store is tested
// against an in-memory stand-in for the cloud rather than local storage.
vi.mock('../sync/cloud', () => import('../test/fakeCloud'))

const { __fake } = await import('../test/fakeCloud')
const { useEditor, setSignedInProbe } = await import('./store')
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

describe('saving to an account', () => {
  it('refuses to save at all when signed out', async () => {
    signedIn = false
    state().replaceDocument(docFromEdges(['A-B', 'B-C']), 'Path')
    await state().saveCurrent('Homework 3')

    expect(__fake.rows()).toHaveLength(0)
    expect(state().savedId).toBeNull()
    expect(state().status?.tone).toBe('error')
    expect(state().status?.text).toMatch(/sign in/i)
    // The name the user typed is still kept, so signing in and saving works.
    expect(state().name).toBe('Homework 3')
  })

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
