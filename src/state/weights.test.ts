import { beforeEach, describe, expect, it } from 'vitest'
import { docFromEdges } from '../graph/model/builder'
import { useEditor } from './store'
import { applyGenerator, applyTransformById, runGraphCommand } from './actions'

const state = () => useEditor.getState()
const weights = () => state().doc.edges.map((e) => e.weight)

beforeEach(() => {
  window.localStorage.clear()
  state().newDocument()
})

describe('generating with edge weights', () => {
  it('turns "K6 w2-20" into a weighted K6 with weights in the range', () => {
    expect(state().doc.weighted).toBe(false)
    expect(runGraphCommand('K6 w2-20')).toBe(true)
    expect(state().doc.weighted).toBe(true)
    expect(state().doc.edges).toHaveLength(15)
    expect(weights().every((w) => Number.isInteger(w) && w! >= 2 && w! <= 20)).toBe(true)
    // Not all the same, or Dijkstra would be BFS again.
    expect(new Set(weights()).size).toBeGreaterThan(1)
    expect(state().name).toBe('K6')
    expect(state().status?.text).toBe('Generated K6 with random weights 2–20')
  })

  it('gives the same weights for the same command and seed', () => {
    runGraphCommand('grid(3,4) w1-9', 4)
    const first = weights()
    runGraphCommand('grid(3,4) w1-9', 4)
    expect(weights()).toEqual(first)
    runGraphCommand('grid(3,4) w1-9', 5)
    expect(weights()).not.toEqual(first)
  })

  it('keeps plain commands following the document, exactly as before', () => {
    runGraphCommand('K5')
    expect(state().doc.weighted).toBe(false)
    expect(state().status?.text).toBe('Generated K5')

    state().setWeighted(true)
    runGraphCommand('K5')
    expect(state().doc.weighted).toBe(true)
    expect(weights()).toEqual(Array(10).fill(1))
  })

  it('can make an unweighted graph from a weighted document', () => {
    state().setWeighted(true)
    expect(applyGenerator('cycle', { n: 5 }, 1, null)).toBe(true)
    expect(state().doc.weighted).toBe(false)
  })

  it('refuses a backwards range and leaves the graph alone', () => {
    runGraphCommand('C5')
    const before = JSON.stringify(state().doc)
    expect(runGraphCommand('K6 w9-1')).toBe(false)
    expect(state().status?.tone).toBe('error')
    expect(state().status?.text).toMatch(/smallest weight \(9\)/)
    expect(JSON.stringify(state().doc)).toBe(before)
  })
})

describe('assigning random weights to the graph on screen', () => {
  it('is a single undo step that turns the graph weighted', () => {
    state().replaceDocument(docFromEdges(['A-B', 'B-C', 'C-D', 'D-A', 'A-C']), 'Drawn')
    const before = JSON.stringify(state().doc)
    const depth = state().past.length

    expect(applyTransformById('random-weights')).toBe(true)
    expect(state().past.length).toBe(depth + 1)
    expect(state().doc.weighted).toBe(true)
    expect(weights().every((w) => w! >= 1 && w! <= 9)).toBe(true)
    const after = JSON.stringify(state().doc)

    state().undo()
    expect(JSON.stringify(state().doc)).toBe(before)
    expect(state().doc.weighted).toBe(false)

    state().redo()
    expect(JSON.stringify(state().doc)).toBe(after)
  })

  it('reports a graph with no edges instead of changing anything', () => {
    state().addVertexAt(0, 0)
    const depth = state().past.length
    expect(applyTransformById('random-weights')).toBe(false)
    expect(state().status?.tone).toBe('error')
    expect(state().past.length).toBe(depth)
  })

  it('weighs by drawn length in one undo step too', () => {
    runGraphCommand('petersen')
    const depth = state().past.length
    expect(applyTransformById('length-weights')).toBe(true)
    expect(state().past.length).toBe(depth + 1)
    expect(new Set(weights())).toEqual(new Set([6, 10, 14]))
  })
})
