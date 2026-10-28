import { beforeEach, describe, expect, it } from 'vitest'
import { useEditor } from './store'
import { addTypedEdges, previewEdgeList, runGraphCommand, runQuickInput } from './actions'
import { docFromEdges } from '../graph/model/builder'

const state = () => useEditor.getState()

const labels = () => state().doc.vertices.map((v) => v.label)

/** Every edge on screen as labels, `A-B` or `A>B` when directed, sorted. */
const edges = () => {
  const { doc } = state()
  const label = new Map(doc.vertices.map((v) => [v.id, v.label]))
  return doc.edges
    .map((e) => `${label.get(e.source)}${doc.directed ? '>' : '-'}${label.get(e.target)}`)
    .sort()
}

beforeEach(() => {
  window.localStorage.clear()
  state().newDocument()
  useEditor.setState({ status: null })
})

describe('typing edges into the quick box', () => {
  it('draws a graph from nothing', () => {
    expect(runQuickInput('A-B, B-C, C-A')).toBe('done')
    expect(labels()).toEqual(['A', 'B', 'C'])
    expect(edges()).toEqual(['A-B', 'B-C', 'C-A'])
    expect(state().status).toMatchObject({ text: 'Added 3 edges and 3 vertices', tone: 'success' })
  })

  it('adds to the graph on screen instead of replacing it', () => {
    runGraphCommand('K4')
    const before = state().doc
    expect(runQuickInput('A-E, E-b')).toBe('done')
    expect(state().doc.vertices).toHaveLength(5)
    expect(state().doc.edges).toHaveLength(8)
    expect(state().doc.vertices.slice(0, 4)).toEqual(before.vertices)
    expect(state().status?.text).toBe('Added 2 edges and 1 vertex')
  })

  it('is one undo step, however much it adds', () => {
    runGraphCommand('C4')
    const before = state().doc
    const depth = state().past.length
    runQuickInput('A-x, x-y, y-z, z-C, A-C:3')
    expect(state().past).toHaveLength(depth + 1)
    expect(state().doc.weighted).toBe(true)

    state().undo()
    expect(state().doc).toEqual(before)
    expect(state().status?.text).toBe('Undo add 5 edges')
    state().redo()
    expect(state().doc.edges).toHaveLength(9)
  })

  it('is an edit, so the graph keeps its name and saved entry', async () => {
    runGraphCommand('P3')
    await state().saveCurrent('My path')
    const { savedId, docId } = state()
    runQuickInput('C-D')
    expect(state()).toMatchObject({ name: 'My path', savedId, docId, dirty: true })
  })

  it('selects what it added', () => {
    runGraphCommand('P2')
    runQuickInput('B-C')
    const added = state().doc.vertices.find((v) => v.label === 'C')!
    expect(state().selectedVertices).toEqual([added.id])
    expect(state().selectedEdges).toEqual([state().doc.edges[1]!.id])
  })

  it('reports duplicates, and adds nothing to the history when everything was there', () => {
    runGraphCommand('C3')
    const depth = state().past.length
    expect(runQuickInput('B-A, A-C')).toBe('done')
    expect(state().past).toHaveLength(depth)
    expect(state().status).toMatchObject({
      text: 'Nothing added. Skipped B–A and A–C, already in the graph.',
      tone: 'info',
    })
  })

  it('adds the new edges and names the skipped ones', () => {
    runGraphCommand('P3')
    runQuickInput('A-B, C-D')
    expect(state().doc.edges).toHaveLength(3)
    expect(state().status?.text).toBe(
      'Added 1 edge and 1 vertex. Skipped A–B, already in the graph.',
    )
  })

  it('switches an empty graph to directed for arrows, and says so', () => {
    runQuickInput('a->b->c')
    expect(state().doc.directed).toBe(true)
    expect(edges()).toEqual(['a>b', 'b>c'])
    expect(state().status?.text).toBe(
      'Added 2 edges and 3 vertices. Switched to directed for the arrows.',
    )
  })

  it('keeps a drawn undirected graph undirected, and explains the arrows', () => {
    runGraphCommand('P3')
    runQuickInput('C->D')
    expect(state().doc.directed).toBe(false)
    expect(state().status?.text).toContain('arrows are read as plain edges')
  })

  it('turns weights on for a typed weight', () => {
    runGraphCommand('P3')
    runQuickInput('C-A:4')
    expect(state().doc.weighted).toBe(true)
    expect(state().doc.edges.map((e) => e.weight)).toEqual([1, 1, 4])
    expect(state().status?.text).toBe('Added 1 edge. Turned on weights.')
  })

  it('matches labels without regard to case when that is unambiguous', () => {
    runGraphCommand('P3')
    runQuickInput('a-c')
    expect(state().doc.vertices).toHaveLength(3)
    expect(edges()).toEqual(['A-B', 'A-C', 'B-C'])
  })

  it('says when a label could have meant more than one vertex', () => {
    state().replaceDocument(docFromEdges(['AB-Ab']), 'Pair')
    expect(previewEdgeList('ab-AB')?.notes).toEqual(['“ab” is ambiguous'])
    runQuickInput('ab-AB')
    expect(labels()).toEqual(['AB', 'Ab', 'ab'])
    expect(state().status?.text).toBe(
      'Added 1 edge and 1 vertex. “ab” matched more than one vertex up to case, so it is a new vertex.',
    )
  })

  it('refuses an edge list too long to be typed', () => {
    const long = Array.from({ length: 501 }, (_, i) => `v${i}-v${i + 1}`).join(', ')
    expect(addTypedEdges(long)).toBe('failed')
    expect(state().doc.vertices).toHaveLength(0)
    expect(state().status?.tone).toBe('error')
  })

  it('leaves input that is not an edge list for the caller to report', () => {
    expect(runQuickInput('banana')).toBe('unrecognised')
    expect(runQuickInput('A-')).toBe('unrecognised')
    expect(state().past).toHaveLength(0)
    expect(state().status).toBeNull()
  })
})

describe('graph commands still win', () => {
  it.each([
    ['K5', 5, 10],
    ['C8', 8, 8],
    ['grid(3,4)', 12, 17],
    ['petersen', 10, 15],
    ['K3,4', 7, 12],
  ])('%s generates its graph, replacing the one on screen', (command, order, size) => {
    state().replaceDocument(docFromEdges(['X-Y']), 'Edge')
    expect(runQuickInput(command)).toBe('done')
    expect(state().doc.vertices).toHaveLength(order)
    expect(state().doc.edges).toHaveLength(size)
    expect(labels()).not.toContain('X')
  })

  it('keeps a generator refusal in the status bar rather than calling it unrecognised', () => {
    expect(runQuickInput('K5000')).toBe('failed')
    expect(state().status?.tone).toBe('error')
    expect(state().status?.text).toContain('too large')
  })
})

describe('previewing an edge list', () => {
  it('describes what Enter would do without doing it', () => {
    runGraphCommand('P3')
    const before = state().doc
    const preview = previewEdgeList('A-C, C-D, A-B')
    expect(preview?.title).toBe('Add 2 edges, 1 new vertex')
    expect(preview?.notes).toEqual(['A–B already there'])
    expect(state().doc).toBe(before)
  })

  it('mentions the mode changes it would make', () => {
    expect(previewEdgeList('a->b:2')?.notes).toEqual(['switches to directed', 'turns on weights'])
    expect(previewEdgeList('a->b:2')?.title).toBe('Add 1 edge, 2 new vertices')
  })

  it('says when there is nothing to add', () => {
    runGraphCommand('P2')
    expect(previewEdgeList('B-A')?.title).toBe('Nothing to add')
  })

  it('is null for anything that is not an edge list', () => {
    expect(previewEdgeList('K5')).toBeNull()
    expect(previewEdgeList('dijkstra')).toBeNull()
  })
})
