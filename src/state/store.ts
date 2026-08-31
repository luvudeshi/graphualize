import { create } from 'zustand'
import { Graph, emptyDocument } from '../graph/model/graph'
import { absorbIds, nextEdgeId, nextVertexId, nextVertexLabel } from '../graph/model/ids'
import type { EdgeId, GraphDocument, GraphWitness, VertexId } from '../graph/model/types'
import { applyLayout, type LayoutName, type Positions } from '../graph/layout'
import type { AlgorithmOptions, AlgorithmRun, AlgorithmStep } from '../graph/algorithms/types'
import { algorithmById } from '../graph/algorithms'
import { clearSession, type DocumentSummary } from './documents'
import {
  deleteCloudDocument,
  listCloudDocuments,
  loadCloudDocument,
  saveCloudDocument,
} from '../sync/cloud'

export type Tool = 'select' | 'vertex' | 'edge' | 'erase'
export type ThemePreference = 'light' | 'dark' | 'system'

export interface ViewRequest {
  kind: 'fit' | 'reset' | 'zoomIn' | 'zoomOut'
  nonce: number
}

export interface StatusMessage {
  text: string
  tone: 'info' | 'success' | 'error'
  nonce: number
}

export interface AlgorithmSession {
  algorithmId: string
  title: string
  steps: AlgorithmStep[]
  result?: AlgorithmRun['result']
  index: number
  playing: boolean
  options: AlgorithmOptions
}

interface HistoryEntry {
  doc: GraphDocument
  label: string
}

const HISTORY_LIMIT = 120

const cloneDoc = (doc: GraphDocument): GraphDocument => ({
  vertices: doc.vertices.map((v) => ({ ...v })),
  edges: doc.edges.map((e) => ({ ...e })),
  directed: doc.directed,
  weighted: doc.weighted,
})

const newDocId = () => `doc-${Date.now().toString(36)}-${nextVertexId()}`

export interface EditorState {
  docId: string
  savedId: string | null
  name: string
  /** False while the name is one Graphualize chose rather than the user. */
  namedByUser: boolean
  doc: GraphDocument
  graph: Graph
  dirty: boolean
  /**
   * The saved row's version, so a stale write can be detected rather than
   * silently overwriting another device's newer copy. Null until first saved.
   */
  savedVersion: number | null
  /** True while a save or a list refresh is in flight. */
  syncing: boolean

  past: HistoryEntry[]
  future: HistoryEntry[]

  tool: Tool
  selectedVertices: VertexId[]
  selectedEdges: EdgeId[]
  pendingEdgeSource: VertexId | null

  activeWitness: { rowId: string; witness: GraphWitness } | null
  algorithm: AlgorithmSession | null
  playbackSpeed: number

  theme: ThemePreference
  inspectorOpen: boolean
  commandPaletteOpen: boolean
  shortcutsOpen: boolean
  status: StatusMessage | null
  viewRequest: ViewRequest | null
  documents: DocumentSummary[]

  /* actions */
  setTool: (tool: Tool) => void
  addVertexAt: (x: number, y: number) => VertexId
  renameVertex: (id: VertexId, label: string) => void
  addEdge: (source: VertexId, target: VertexId) => EdgeId | null
  setEdgeWeight: (id: EdgeId, weight: number) => void
  reverseEdge: (id: EdgeId) => void
  deleteSelection: () => void
  deleteElements: (vertices: VertexId[], edges: EdgeId[]) => void
  commitPositions: (positions: Positions, label?: string, coalesce?: boolean) => void
  select: (vertices: VertexId[], edges: EdgeId[]) => void
  clearSelection: () => void
  setPendingEdgeSource: (id: VertexId | null) => void

  undo: () => void
  redo: () => void

  replaceDocument: (
    doc: GraphDocument,
    label: string,
    options?: { relayout?: boolean; title?: string },
  ) => void
  setDirected: (directed: boolean) => void
  setWeighted: (weighted: boolean) => void
  runLayout: (name: LayoutName) => void
  clearGraph: () => void

  setWitness: (rowId: string, witness: GraphWitness | undefined) => void
  clearWitness: () => void

  startAlgorithm: (algorithmId: string, options?: AlgorithmOptions) => void
  stopAlgorithm: () => void
  stepForward: () => void
  stepBackward: () => void
  goToStep: (index: number) => void
  setPlaying: (playing: boolean) => void
  setPlaybackSpeed: (speed: number) => void

  setTheme: (theme: ThemePreference) => void
  setInspectorOpen: (open: boolean) => void
  setCommandPaletteOpen: (open: boolean) => void
  setShortcutsOpen: (open: boolean) => void
  notify: (text: string, tone?: StatusMessage['tone']) => void
  requestView: (kind: ViewRequest['kind']) => void

  newDocument: () => void
  saveCurrent: (name?: string) => Promise<void>
  openDocument: (id: string) => Promise<void>
  removeDocument: (id: string) => Promise<void>
  refreshDocuments: () => Promise<void>
  /** Drops the in-memory list when the user signs out. */
  forgetDocuments: () => void
  setName: (name: string) => void
}

let statusCounter = 0
let viewCounter = 0

/**
 * Whether there is an account to save to.
 *
 * Imported lazily through a getter rather than at module scope: the auth store
 * imports nothing from here, and keeping it that way is what stops a cycle.
 */
let signedInProbe: () => boolean = () => false
export const setSignedInProbe = (probe: () => boolean): void => {
  signedInProbe = probe
}
const isSignedIn = () => signedInProbe()

/**
 * Every session starts empty.
 *
 * Graphualize used to keep the working document in local storage and restore it
 * on reload. It no longer does: a graph is kept by saving it to an account, and
 * nothing else. That is a deliberate, visible rule rather than a half-promise —
 * work that looks persisted but silently is not is worse than work the app
 * plainly told you it would not keep. `ConfirmLeave` warns before a reload
 * actually discards anything.
 */
const initialSession = () => ({
  docId: newDocId(),
  savedId: null,
  name: 'Untitled graph',
  namedByUser: false,
  doc: emptyDocument(),
})

export const useEditor = create<EditorState>((set, get) => {
  const seed = initialSession()

  /**
   * Applies a mutation with undo support.
   *
   * When the mutation changes the *structure*, any active witness or algorithm
   * run describes a graph that no longer exists, so both are dropped. That is
   * what stops the inspector saying "Bridges 0" while two edges are still drawn
   * as bridges.
   */
  const commit = (
    label: string,
    mutate: (doc: GraphDocument) => GraphDocument | void,
    options: { coalesce?: boolean } = {},
  ): void => {
    const state = get()
    const before = cloneDoc(state.doc)
    const draft = cloneDoc(state.doc)
    const result = mutate(draft) ?? draft
    const graph = new Graph(result)
    const structureChanged = graph.structureKey() !== state.graph.structureKey()

    // A held arrow key must not flood the history with one entry per repeat.
    const previous = state.past[state.past.length - 1]
    const past =
      options.coalesce && previous?.label === label
        ? state.past
        : [...state.past, { doc: before, label }].slice(-HISTORY_LIMIT)

    set({
      doc: result,
      graph,
      past,
      future: [],
      dirty: true,
      ...(structureChanged ? { activeWitness: null, algorithm: null } : {}),
    })
  }

  const stopPlayback = () => {
    const session = get().algorithm
    if (session?.playing) set({ algorithm: { ...session, playing: false } })
  }

  return {
    docId: seed.docId,
    savedId: seed.savedId,
    name: seed.name,
    namedByUser: seed.namedByUser,
    doc: seed.doc,
    graph: new Graph(seed.doc),
    dirty: false,
    savedVersion: null,
    syncing: false,

    past: [],
    future: [],

    tool: 'select',
    selectedVertices: [],
    selectedEdges: [],
    pendingEdgeSource: null,

    activeWitness: null,
    algorithm: null,
    playbackSpeed: 1.2,

    theme: 'system',
    inspectorOpen: true,
    commandPaletteOpen: false,
    shortcutsOpen: false,
    status: null,
    viewRequest: null,
    // Populated from the account once signed in. Signed out there is nothing
    // to list, because there is nowhere to save to.
    documents: [],

    setTool: (tool) => set({ tool, pendingEdgeSource: null }),

    addVertexAt: (x, y) => {
      const id = nextVertexId()
      commit('Add vertex', (doc) => {
        doc.vertices.push({ id, label: nextVertexLabel(doc), x, y })
      })
      set({ selectedVertices: [id], selectedEdges: [] })
      return id
    },

    renameVertex: (id, label) => {
      const trimmed = label.trim()
      if (!trimmed) return
      commit('Rename vertex', (doc) => {
        const v = doc.vertices.find((candidate) => candidate.id === id)
        if (v) v.label = trimmed
      })
    },

    addEdge: (source, target) => {
      const state = get()
      if (!state.graph.hasVertex(source) || !state.graph.hasVertex(target)) return null
      if (state.graph.hasEdge(source, target)) {
        get().notify('That edge already exists.', 'error')
        return null
      }
      const id = nextEdgeId()
      commit('Add edge', (doc) => {
        doc.edges.push(doc.weighted ? { id, source, target, weight: 1 } : { id, source, target })
      })
      set({ selectedVertices: [], selectedEdges: [id] })
      return id
    },

    setEdgeWeight: (id, weight) => {
      if (!Number.isFinite(weight)) {
        get().notify('Edge weights must be finite numbers.', 'error')
        return
      }
      commit('Change weight', (doc) => {
        const e = doc.edges.find((candidate) => candidate.id === id)
        if (e) e.weight = weight
      })
    },

    reverseEdge: (id) => {
      commit('Reverse edge', (doc) => {
        const e = doc.edges.find((candidate) => candidate.id === id)
        if (e) {
          const source = e.source
          e.source = e.target
          e.target = source
        }
      })
    },

    deleteElements: (vertices, edges) => {
      if (!vertices.length && !edges.length) return
      const vertexSet = new Set(vertices)
      const edgeSet = new Set(edges)
      commit(
        vertices.length && edges.length
          ? 'Delete selection'
          : vertices.length
            ? 'Delete vertices'
            : 'Delete edges',
        (doc) => {
          doc.vertices = doc.vertices.filter((v) => !vertexSet.has(v.id))
          doc.edges = doc.edges.filter(
            (e) => !edgeSet.has(e.id) && !vertexSet.has(e.source) && !vertexSet.has(e.target),
          )
        },
      )
      set({ selectedVertices: [], selectedEdges: [], activeWitness: null })
    },

    deleteSelection: () => {
      const { selectedVertices, selectedEdges } = get()
      get().deleteElements(selectedVertices, selectedEdges)
    },

    commitPositions: (positions, label = 'Move', coalesce = false) => {
      const ids = Object.keys(positions)
      if (!ids.length) return
      const current = get().doc
      const changed = ids.some((id) => {
        const v = current.vertices.find((candidate) => candidate.id === id)
        return v && (Math.abs(v.x - positions[id]!.x) > 0.01 || Math.abs(v.y - positions[id]!.y) > 0.01)
      })
      if (!changed) return
      commit(
        label,
        (doc) => {
          for (const v of doc.vertices) {
            const p = positions[v.id]
            if (p) {
              v.x = p.x
              v.y = p.y
            }
          }
        },
        { coalesce },
      )
    },

    select: (vertices, edges) => set({ selectedVertices: vertices, selectedEdges: edges }),

    clearSelection: () => set({ selectedVertices: [], selectedEdges: [] }),
    setPendingEdgeSource: (id) => set({ pendingEdgeSource: id }),

    undo: () => {
      const state = get()
      const entry = state.past[state.past.length - 1]
      if (!entry) return
      set({
        doc: entry.doc,
        graph: new Graph(entry.doc),
        algorithm: null,
        past: state.past.slice(0, -1),
        future: [{ doc: cloneDoc(state.doc), label: entry.label }, ...state.future].slice(
          0,
          HISTORY_LIMIT,
        ),
        selectedVertices: [],
        selectedEdges: [],
        activeWitness: null,
        dirty: true,
      })
      get().notify(`Undo ${entry.label.toLowerCase()}`)
    },

    redo: () => {
      const state = get()
      const entry = state.future[0]
      if (!entry) return
      set({
        doc: entry.doc,
        graph: new Graph(entry.doc),
        algorithm: null,
        past: [...state.past, { doc: cloneDoc(state.doc), label: entry.label }].slice(
          -HISTORY_LIMIT,
        ),
        future: state.future.slice(1),
        selectedVertices: [],
        selectedEdges: [],
        activeWitness: null,
        dirty: true,
      })
      get().notify(`Redo ${entry.label.toLowerCase()}`)
    },

    replaceDocument: (doc, label, options) => {
      absorbIds(doc)
      const state = get()
      commit(label, () => cloneDoc(doc))
      set({
        selectedVertices: [],
        selectedEdges: [],
        activeWitness: null,
        algorithm: null,
        pendingEdgeSource: null,
      })
      // A title means the document was *replaced* — generated, imported or
      // loaded from an example — rather than edited. The result is a different
      // graph, so it stops pointing at the saved entry it displaced: pressing
      // Save must not overwrite the graph that was on screen a moment ago. The
      // name follows only when the user has not chosen one.
      if (options?.title !== undefined) {
        set({
          docId: state.savedId === null ? state.docId : newDocId(),
          savedId: null,
          ...(state.namedByUser ? {} : { name: options.title }),
          savedVersion: null,
        })
      }
      if (options?.relayout !== false) get().requestView('fit')
    },

    setDirected: (directed) => {
      if (get().doc.directed === directed) return
      commit(directed ? 'Switch to directed' : 'Switch to undirected', (doc) => {
        doc.directed = directed
      })
      set({ algorithm: null, activeWitness: null })
    },

    setWeighted: (weighted) => {
      if (get().doc.weighted === weighted) return
      commit(weighted ? 'Enable weights' : 'Disable weights', (doc) => {
        doc.weighted = weighted
        if (weighted) for (const e of doc.edges) e.weight = e.weight ?? 1
      })
      set({ algorithm: null, activeWitness: null })
    },

    runLayout: (name) => {
      const state = get()
      if (!state.graph.order) return
      const positions = applyLayout(state.graph, name, {
        partition: undefined,
        spacing: 110,
      })
      commit(`Layout: ${name}`, (doc) => {
        for (const v of doc.vertices) {
          const p = positions[v.id]
          if (p) {
            v.x = p.x
            v.y = p.y
          }
        }
      })
      get().requestView('fit')
    },

    clearGraph: () => {
      get().replaceDocument(
        { ...emptyDocument(), directed: get().doc.directed, weighted: get().doc.weighted },
        'Clear graph',
      )
    },

    setWitness: (rowId, witness) => {
      if (!witness) {
        set({ activeWitness: null })
        return
      }
      const current = get().activeWitness
      if (current?.rowId === rowId) set({ activeWitness: null })
      else set({ activeWitness: { rowId, witness }, algorithm: null })
    },

    clearWitness: () => set({ activeWitness: null }),

    startAlgorithm: (algorithmId, options = {}) => {
      const def = algorithmById(algorithmId)
      const state = get()
      if (!def) return
      const resolved: AlgorithmOptions = {
        ...options,
        source: options.source ?? state.selectedVertices[0] ?? state.graph.vertexIds[0],
      }
      const blocked = def.precondition?.(state.graph, resolved)
      if (blocked) {
        get().notify(blocked, 'error')
        return
      }
      const run = def.run(state.graph, resolved)
      if (run.error) {
        get().notify(run.error, 'error')
        return
      }
      set({
        activeWitness: null,
        algorithm: {
          algorithmId,
          title: run.title,
          steps: run.steps,
          result: run.result,
          index: 0,
          playing: false,
          options: resolved,
        },
      })
    },

    stopAlgorithm: () => set({ algorithm: null }),

    stepForward: () => {
      const session = get().algorithm
      if (!session) return
      if (session.index >= session.steps.length - 1) {
        set({ algorithm: { ...session, index: session.steps.length - 1, playing: false } })
        return
      }
      set({ algorithm: { ...session, index: session.index + 1 } })
    },

    stepBackward: () => {
      const session = get().algorithm
      if (!session) return
      set({ algorithm: { ...session, index: Math.max(0, session.index - 1), playing: false } })
    },

    goToStep: (index) => {
      const session = get().algorithm
      if (!session) return
      const clamped = Math.max(0, Math.min(session.steps.length - 1, index))
      set({ algorithm: { ...session, index: clamped } })
    },

    setPlaying: (playing) => {
      const session = get().algorithm
      if (!session) return
      const atEnd = session.index >= session.steps.length - 1
      set({
        algorithm: {
          ...session,
          playing,
          index: playing && atEnd ? 0 : session.index,
        },
      })
    },

    setPlaybackSpeed: (speed) => set({ playbackSpeed: speed }),

    setTheme: (theme) => set({ theme }),
    setInspectorOpen: (open) => set({ inspectorOpen: open }),
    setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),
    setShortcutsOpen: (open) => set({ shortcutsOpen: open }),

    notify: (text, tone = 'info') =>
      set({ status: { text, tone, nonce: ++statusCounter } }),

    requestView: (kind) => set({ viewRequest: { kind, nonce: ++viewCounter } }),

    newDocument: () => {
      stopPlayback()
      clearSession()
      set({
        docId: newDocId(),
        savedId: null,
        name: 'Untitled graph',
        namedByUser: false,
        doc: emptyDocument(),
        graph: new Graph(emptyDocument()),
        past: [],
        future: [],
        selectedVertices: [],
        selectedEdges: [],
        activeWitness: null,
        algorithm: null,
        dirty: false,
        savedVersion: null,
      })
    },

    /**
     * Saves to the signed-in account. There is nowhere else to save to.
     *
     * A signed-out save is refused with a sentence saying why, rather than
     * writing to local storage the app has stopped reading.
     */
    saveCurrent: async (name) => {
      const state = get()
      const finalName = (name ?? state.name).trim() || 'Untitled graph'
      set({ name: finalName, namedByUser: true })

      if (!isSignedIn()) {
        get().notify('Sign in to save this graph to your account.', 'error')
        return
      }

      set({ syncing: true })
      const result = await saveCloudDocument({
        id: state.savedId,
        name: finalName,
        graph: state.doc,
        expectedVersion: state.savedVersion,
      })
      set({ syncing: false })

      if (!result.ok || !result.data) {
        get().notify(result.message ?? 'That graph could not be saved.', 'error')
        return
      }

      set({
        savedId: result.data.id,
        savedVersion: result.data.version,
        dirty: false,
      })
      // A conflict still counts as saved — both versions are in the account —
      // so it reports as a warning rather than a failure.
      get().notify(result.message ?? `Saved "${finalName}"`, result.message ? 'error' : 'success')
      void get().refreshDocuments()
    },

    openDocument: async (id) => {
      set({ syncing: true })
      const result = await loadCloudDocument(id)
      set({ syncing: false })

      if (!result.ok || !result.data) {
        get().notify(result.message ?? 'That graph could not be opened.', 'error')
        return
      }
      const { name, graph, version } = result.data
      absorbIds(graph)
      stopPlayback()
      set({
        docId: id,
        savedId: id,
        savedVersion: version,
        name,
        namedByUser: true,
        doc: graph,
        graph: new Graph(graph),
        past: [],
        future: [],
        selectedVertices: [],
        selectedEdges: [],
        activeWitness: null,
        algorithm: null,
        dirty: false,
      })
      get().requestView('fit')
      get().notify(`Opened "${name}"`, 'success')
    },

    removeDocument: async (id) => {
      const result = await deleteCloudDocument(id)
      if (!result.ok) {
        get().notify(result.message ?? 'That graph could not be deleted.', 'error')
        return
      }
      if (get().savedId === id) set({ savedId: null, savedVersion: null, dirty: true })
      await get().refreshDocuments()
    },

    refreshDocuments: async () => {
      if (!isSignedIn()) {
        set({ documents: [] })
        return
      }
      const result = await listCloudDocuments()
      if (!result.ok || !result.data) {
        // A failed refresh leaves the last known list alone rather than
        // blanking it — an empty list would read as "you have no graphs".
        if (result.message) get().notify(result.message, 'error')
        return
      }
      set({ documents: result.data })
    },

    forgetDocuments: () => set({ documents: [], savedId: null, savedVersion: null }),

    setName: (name) => {
      set({ name, namedByUser: true })
    },
  }
})
