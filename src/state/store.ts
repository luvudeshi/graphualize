import { create } from 'zustand'
import { Graph, emptyDocument } from '../graph/model/graph'
import { absorbIds, nextEdgeId, nextVertexId, nextVertexLabel } from '../graph/model/ids'
import type { EdgeId, GraphDocument, GraphWitness, VertexId } from '../graph/model/types'
import { applyLayout, type LayoutName, type Positions } from '../graph/layout'
import type { AlgorithmOptions, AlgorithmRun, AlgorithmStep } from '../graph/algorithms/types'
import { algorithmById } from '../graph/algorithms'
import {
  clearSession,
  deleteDocument,
  listDocuments,
  loadDocument,
  restoreDocument,
  saveDocument,
  type DocumentSummary,
} from './documents'
import type { SavedGraph } from '../graph/serialization'
import {
  deleteCloudDocument,
  listCloudDocuments,
  loadCloudDocument,
  restoreCloudDocument,
  saveCloudDocument,
} from '../sync/cloud'
import {
  adoptionInFlight,
  adoptLocalGraphs,
  cloudLinkFor,
  forgetCloudLink,
  recordCloudLink,
  unlinkCloudEntry,
  type CloudLink,
} from '../sync/adopt'

export type Tool = 'select' | 'vertex' | 'edge' | 'erase'
/** Where a saved graph lives: this browser's local storage, or the signed-in account. */
export type SaveLocation = 'local' | 'cloud'
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

/**
 * What a delete removed, kept so it can be undone exactly: the document itself
 * for one saved in this browser, the links that pointed at it, and — when it
 * was the graph on screen — how the editor was tied to it.
 */
export interface DeletedGraph {
  id: string
  source: SaveLocation
  name: string
  /** The full document, for a graph saved in this browser. Null for the account's. */
  saved: SavedGraph | null
  links: Array<{ localId: string; link: CloudLink }>
  wasOpen: {
    doc: GraphDocument
    savedVersion: number | null
    localStamp: number | null
    dirty: boolean
  } | null
}

export interface EditorState {
  docId: string
  savedId: string | null
  /** Where `savedId` points. Null exactly when `savedId` is. */
  savedWhere: SaveLocation | null
  /**
   * The account entry this graph came from, kept after signing out has made
   * it unreachable. A save made signed out records it as the local copy's
   * origin, so the next sign-in updates that entry instead of adding a copy.
   */
  cloudOrigin: { id: string; version: number | null } | null
  /**
   * The local entry's `updatedAt` as this tab last read or wrote it. If the
   * stored one has moved on, another tab saved over it in the meantime.
   */
  localStamp: number | null
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
  /** Where `documents` came from, so opening or deleting one goes back to the same place. */
  documentsSource: SaveLocation
  /**
   * True since the account last failed to answer at all. While it is, the
   * list shows this browser's graphs, which is where saves are going; the
   * first call that gets through copies them across.
   */
  accountUnreachable: boolean
  /** The most recent delete, while it can still be undone. */
  lastDeleted: DeletedGraph | null

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
  /**
   * Restarts the running algorithm from its first step with `changes` merged
   * into its options: the player's From, To and Order choices. Pass
   * `target: undefined` to drop a target. Runs are deterministic, so this
   * shows exactly what starting afresh with those options would.
   */
  setAlgorithmOptions: (changes: AlgorithmOptions) => void
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
  /** `source` defaults to the account when signed in and this browser otherwise. */
  openDocument: (id: string, source?: SaveLocation) => Promise<void>
  /**
   * `offerUndo` is for the Open dialog, the one place an Undo is shown. Other
   * callers (the home page's list) confirm up front and say there is no undo.
   */
  removeDocument: (
    id: string,
    source?: SaveLocation,
    options?: { offerUndo?: boolean },
  ) => Promise<void>
  /** Puts the most recently deleted graph back, exactly as it was. */
  undoDelete: () => Promise<void>
  /** Forgets the most recent delete, once undoing it is no longer on offer. */
  dismissDeleted: () => void
  refreshDocuments: () => Promise<void>
  /** Drops what came from the account when the user signs out. */
  forgetDocuments: () => void
  /**
   * After sign-in has copied this browser's graphs into the account, points an
   * open graph that was saved here at its account entry instead.
   */
  followIntoAccount: () => void
  /**
   * Copies graphs saved in this browser into the account (`sync/adopt.ts`),
   * reports the outcome, and re-points the open graph at its account entry.
   */
  syncLocalIntoAccount: () => Promise<void>
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
 * Bumped whenever an Undo offer is withdrawn, so a delete that finishes after
 * its dialog closed does not quietly bring the offer back.
 */
let undoOfferGeneration = 0
/** Deletes in flight, by `source:id`, so a repeated click cannot delete twice. */
const deleting = new Set<string>()
let undoing = false

/**
 * Every session starts empty.
 *
 * The working document is not autosaved: a graph is kept by saving it — to the
 * account when signed in, to this browser otherwise — and nothing else. That is
 * a deliberate, visible rule rather than a half-promise: work that looks
 * persisted but silently is not is worse than work the app plainly told you it
 * would not keep. `ConfirmLeave` warns before a reload actually discards
 * anything.
 */
const initialSession = () => ({
  docId: newDocId(),
  savedId: null,
  savedWhere: null,
  name: 'Untitled graph',
  namedByUser: false,
  doc: emptyDocument(),
})

/** Everything that ties the working document to a saved copy, cleared. */
const UNSAVED = {
  savedId: null,
  savedWhere: null,
  savedVersion: null,
  cloudOrigin: null,
  localStamp: null,
} as const

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

  /**
   * Writes the working document to this browser. A graph already saved here
   * is overwritten in place; anything else becomes a new entry. Reports its
   * own failure and returns null when the browser refuses the write.
   *
   * `origin` is the account entry this content descends from, when there is
   * one: the local copy is linked to it with a stale stamp, so the next
   * sign-in uploads it there under the usual version check.
   */
  const saveLocally = (
    name: string,
    origin: { id: string | null; version: number | null } | null = null,
  ): { name: string; forked: boolean } | null => {
    const state = get()
    let existing = state.savedWhere === 'local' ? state.savedId : null
    const previous = existing
      ? listDocuments().find((candidate) => candidate.id === existing)
      : undefined
    // Another tab saved this graph after this one last read it. Writing over
    // that would discard its work, so this version becomes its own entry.
    const forked =
      !!previous && state.localStamp !== null && previous.updatedAt !== state.localStamp
    if (forked) existing = null
    const finalName = forked ? `${name} (copy)`.slice(0, 200) : name

    const id = existing ?? newDocId()
    const summary = saveDocument({
      id,
      name: finalName,
      graph: state.doc,
      createdAt: existing ? previous?.createdAt : undefined,
    })
    if (!summary) {
      get().notify(
        'This browser would not let Graphualize save (storage is full or blocked). Use File → Export to keep a copy.',
        'error',
      )
      return null
    }

    const descendsFrom = forked ? null : (origin ?? (existing ? null : state.cloudOrigin))
    if (descendsFrom?.id) {
      recordCloudLink(id, { cloudId: descendsFrom.id, version: descendsFrom.version, updatedAt: 0 })
    }

    set({
      ...UNSAVED,
      savedId: id,
      savedWhere: 'local',
      localStamp: summary.updatedAt,
      dirty: false,
      ...(forked ? { name: finalName } : {}),
    })
    // Read straight from storage rather than through refreshDocuments: signed
    // in, that would ask an account that just failed to answer, and replace
    // the message explaining what happened with a vaguer one.
    const current = get()
    if (!isSignedIn() || current.documentsSource === 'local' || current.accountUnreachable) {
      set({ documents: listDocuments(), documentsSource: 'local' })
    }
    return { name: finalName, forked }
  }

  const removeOnce = async (id: string, source: SaveLocation, offerUndo: boolean) => {
    const generation = undoOfferGeneration
    const before = get()
    const listedName = before.documents.find((entry) => entry.id === id)?.name
    const wasOpen =
      before.savedId === id && before.savedWhere === source
        ? {
            doc: before.doc,
            savedVersion: before.savedVersion,
            localStamp: before.localStamp,
            dirty: before.dirty,
          }
        : null

    let deleted: DeletedGraph | null
    if (source === 'local') {
      const saved = loadDocument(id)
      const link = cloudLinkFor(id)
      deleteDocument(id)
      forgetCloudLink(id)
      // An entry whose document had already gone missing cannot be put back.
      deleted = saved
        ? {
            id,
            source,
            name: saved.name,
            saved,
            links: link ? [{ localId: id, link }] : [],
            wasOpen,
          }
        : null
    } else {
      const result = await deleteCloudDocument(id)
      // Signed out while the request was out: the editor now belongs to the
      // signed-out state, so leave it — and the offer to undo — alone.
      if (!isSignedIn()) return
      if (!result.ok) {
        if (result.unreachable) set({ accountUnreachable: true })
        get().notify(result.message ?? 'That graph could not be deleted.', 'error')
        return
      }
      // Local copies of it must not later be uploaded into the tombstone.
      const links = unlinkCloudEntry(id)
      accountAnswered()
      deleted = {
        id,
        source,
        name: listedName ?? 'Untitled graph',
        saved: null,
        links,
        wasOpen,
      }
    }
    const state = get()
    if (state.savedId === id && state.savedWhere === source) {
      set({ ...UNSAVED, dirty: true })
    }
    if (offerUndo && generation === undoOfferGeneration) set({ lastDeleted: deleted })
    await get().refreshDocuments()
  }

  const undoOnce = async () => {
    const deleted = get().lastDeleted
    if (!deleted) return
    let restoredAs = deleted.id
    let restoredName = deleted.name
    if (deleted.source === 'local') {
      if (!deleted.saved) return
      // Something has been saved under this id since (another tab, most
      // likely). Putting the old graph back on top would destroy that, so it
      // comes back as a separate entry instead.
      const clash = loadDocument(deleted.id) !== null
      const copy = clash
        ? {
            ...deleted.saved,
            id: newDocId(),
            name: `${deleted.saved.name} (restored)`.slice(0, 200),
          }
        : deleted.saved
      if (!restoreDocument(copy)) {
        get().notify(`“${deleted.name}” could not be put back in this browser.`, 'error')
        return
      }
      restoredAs = copy.id
      restoredName = copy.name
    } else {
      const result = await restoreCloudDocument(deleted.id)
      if (!isSignedIn()) return
      if (!result.ok) {
        if (result.unreachable) set({ accountUnreachable: true })
        get().notify(result.message ?? `“${deleted.name}” could not be put back.`, 'error')
        return
      }
      accountAnswered()
    }
    if (restoredAs === deleted.id) {
      for (const { localId, link } of deleted.links) recordCloudLink(localId, link)
    }

    // If it was the graph on screen and nothing has been edited since, it is
    // that saved graph again — clean, and saving updates it as before. Any
    // edit since leaves the editor as an unsaved graph, which is the truth.
    const state = get()
    const open = deleted.wasOpen
    if (open && restoredAs === deleted.id && state.savedId === null && state.doc === open.doc) {
      set({
        savedId: deleted.id,
        savedWhere: deleted.source,
        savedVersion: open.savedVersion,
        localStamp: open.localStamp,
        dirty: open.dirty,
      })
    }
    set({ lastDeleted: null })
    get().notify(
      restoredAs === deleted.id
        ? `Restored “${restoredName}”`
        : `Restored as “${restoredName}”, because a graph was saved under the old one since.`,
      'success',
    )
    await get().refreshDocuments()
  }

  /** The account answered: if it had not been, carry across what piled up here. */
  const accountAnswered = () => {
    if (!get().accountUnreachable) return
    set({ accountUnreachable: false })
    void get().syncLocalIntoAccount()
  }

  return {
    docId: seed.docId,
    savedId: seed.savedId,
    savedWhere: seed.savedWhere,
    cloudOrigin: null,
    localStamp: null,
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
    // The account's graphs when signed in, this browser's otherwise.
    documents: [],
    documentsSource: 'local',
    accountUnreachable: false,
    lastDeleted: null,

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
          ...UNSAVED,
          ...(state.namedByUser ? {} : { name: options.title }),
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
      // A selected vertex is the source unless the caller named one. The
      // ordering is made explicit too, so the player's Order choice can show
      // what the run actually used.
      const resolved: AlgorithmOptions = {
        ...options,
        source: options.source ?? state.selectedVertices[0] ?? state.graph.vertexIds[0],
      }
      if (def.orderings) resolved.ordering = options.ordering ?? def.defaultOrdering
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

    setAlgorithmOptions: (changes) => {
      const session = get().algorithm
      if (!session) return
      get().startAlgorithm(session.algorithmId, { ...session.options, ...changes })
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
        ...UNSAVED,
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
      })
    },

    /**
     * Saves to the signed-in account, or to this browser when signed out.
     *
     * Signed out, the graph goes to local storage and is copied into the
     * account on the next sign-in (`sync/adopt.ts`). Signed in but unable to
     * reach the account — offline, the project down, or the session expired —
     * it is kept in this browser too, rather than the save simply failing, and
     * linked to the account entry it was meant for so the copy-across picks it
     * up later.
     */
    saveCurrent: async (name) => {
      const finalName = (name ?? get().name).trim() || 'Untitled graph'
      set({ name: finalName, namedByUser: true })
      const doc = get().doc

      if (!isSignedIn()) {
        const saved = saveLocally(finalName)
        if (saved) {
          get().notify(
            saved.forked
              ? `Another tab had saved over this graph, so this version was saved separately as "${saved.name}".`
              : `Saved "${saved.name}" in this browser`,
            saved.forked ? 'error' : 'success',
          )
        }
        return
      }

      set({ syncing: true })
      // While graphs from this browser are being copied into the account, this
      // one may be among them; waiting avoids inserting it a second time.
      await adoptionInFlight()
      const state = get()

      // A graph saved in this browser continues on the account entry its link
      // names, at the version its content is based on; one never uploaded
      // becomes a new entry.
      const localId = state.savedWhere === 'local' ? state.savedId : null
      const link = localId ? cloudLinkFor(localId) : null
      const target =
        state.savedWhere === 'cloud'
          ? { id: state.savedId, version: state.savedVersion }
          : link?.cloudId != null && link.version != null
            ? { id: link.cloudId, version: link.version }
            : { id: null, version: null }

      const result = await saveCloudDocument({
        id: target.id,
        name: finalName,
        graph: doc,
        expectedVersion: target.version,
      })
      set({ syncing: false })

      if (!result.ok || !result.data) {
        if (result.unreachable || result.noSession) {
          if (result.unreachable) set({ accountUnreachable: true })
          const saved = saveLocally(finalName, target)
          if (saved) {
            get().notify(
              result.unreachable
                ? `Could not reach your account, so "${saved.name}" was saved in this browser. It will be copied to your account once Graphualize can reach it again.`
                : `Your sign-in has expired, so "${saved.name}" was saved in this browser. Sign in again to copy it to your account.`,
              'error',
            )
          }
          return
        }
        get().notify(result.message ?? 'That graph could not be saved.', 'error')
        return
      }

      if (localId) {
        // Keep this browser's copy identical to what the account now holds, so
        // its link describes it truthfully. Recording the new version against
        // the old local content would let a later edit of that old content
        // pass the version check and overwrite this save.
        const previous = listDocuments().find((candidate) => candidate.id === localId)
        const summary = saveDocument({
          id: localId,
          name: finalName,
          graph: doc,
          createdAt: previous?.createdAt,
        })
        if (summary) {
          recordCloudLink(localId, {
            cloudId: result.data.id,
            version: result.data.version,
            updatedAt: summary.updatedAt,
          })
        }
      }

      set({
        ...UNSAVED,
        savedId: result.data.id,
        savedWhere: 'cloud',
        savedVersion: result.data.version,
        // What was saved is the document as it was when Save was pressed. An
        // edit made while the request was out is not in the account, so the
        // graph is still unsaved — and New, Open and leaving must still ask.
        dirty: get().doc !== doc,
      })
      // A conflict still counts as saved — both versions are in the account —
      // so it reports as a warning rather than a failure.
      get().notify(result.message ?? `Saved "${finalName}"`, result.message ? 'error' : 'success')
      accountAnswered()
      void get().refreshDocuments()
    },

    openDocument: async (id, source = isSignedIn() ? 'cloud' : 'local') => {
      let opened: { name: string; graph: GraphDocument; version: number | null; stamp: number | null }
      if (source === 'local') {
        const saved = loadDocument(id)
        if (!saved) {
          get().notify('That graph is no longer saved in this browser.', 'error')
          return
        }
        opened = { name: saved.name, graph: saved.graph, version: null, stamp: saved.updatedAt }
      } else {
        const before = get().doc
        set({ syncing: true })
        const result = await loadCloudDocument(id)
        set({ syncing: false })
        // The canvas stays usable while a graph loads. Work drawn in that time
        // was not covered by any "discard?" question, so it is not discarded.
        const now = get()
        if (result.ok && now.doc !== before && now.dirty && now.doc.vertices.length > 0) {
          get().notify(
            `You edited the graph while “${result.data?.name ?? 'that graph'}” was loading, so it was not opened. Open it again to replace your changes.`,
            'error',
          )
          return
        }

        if (!result.ok || !result.data) {
          if (result.unreachable) set({ accountUnreachable: true })
          get().notify(result.message ?? 'That graph could not be opened.', 'error')
          return
        }
        opened = { ...result.data, stamp: null }
        accountAnswered()
      }
      const { name, graph, version, stamp } = opened
      absorbIds(graph)
      stopPlayback()
      set({
        ...UNSAVED,
        docId: id,
        savedId: id,
        savedWhere: source,
        savedVersion: version,
        localStamp: stamp,
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

    removeDocument: async (id, source = get().documentsSource, options = {}) => {
      const key = `${source}:${id}`
      if (deleting.has(key)) return
      deleting.add(key)
      try {
        await removeOnce(id, source, options.offerUndo === true)
      } finally {
        deleting.delete(key)
      }
    },

    undoDelete: async () => {
      if (undoing) return
      undoing = true
      try {
        await undoOnce()
      } finally {
        undoing = false
      }
    },

    dismissDeleted: () => {
      undoOfferGeneration += 1
      set({ lastDeleted: null })
    },

    refreshDocuments: async () => {
      if (!isSignedIn()) {
        set({ documents: listDocuments(), documentsSource: 'local' })
        return
      }
      const result = await listCloudDocuments()
      // Signed out while the request was in flight: the account's list must
      // not land on top of this browser's.
      if (!isSignedIn()) return
      if (!result.ok || !result.data) {
        if (result.unreachable) {
          // Saves are going to this browser until the account is back, so this
          // browser's list is the one that is true right now.
          set({ accountUnreachable: true, documents: listDocuments(), documentsSource: 'local' })
          get().notify(
            'Could not reach your account, so these are the graphs saved in this browser.',
            'error',
          )
          return
        }
        // A failed refresh leaves the last known list alone rather than
        // blanking it — an empty list would read as "you have no graphs".
        if (result.message) get().notify(result.message, 'error')
        return
      }
      set({ documents: result.data, documentsSource: 'cloud' })
      accountAnswered()
    },

    forgetDocuments: () => {
      const state = get()
      set({
        ...(state.documentsSource === 'cloud' ? { documents: [] } : {}),
        accountUnreachable: false,
        // An account delete can only be undone while signed in to that account.
        ...(state.lastDeleted?.source === 'cloud' ? { lastDeleted: null } : {}),
        // A graph opened from this browser is still saved here. One opened from
        // the account can no longer be saved there, but where it came from is
        // kept, so saving it now links the local copy back to that entry.
        ...(state.savedWhere === 'cloud' && state.savedId
          ? { ...UNSAVED, cloudOrigin: { id: state.savedId, version: state.savedVersion } }
          : {}),
      })
    },

    followIntoAccount: () => {
      const state = get()
      if (state.savedWhere !== 'local' || !state.savedId) return
      const link = cloudLinkFor(state.savedId)
      if (link?.cloudId == null || link.version == null) return
      // Only when the account holds what is on screen. A local save the
      // upload has not caught up with stays pointed at this browser, and the
      // next save carries it across.
      const entry = listDocuments().find((candidate) => candidate.id === state.savedId)
      if (!entry || link.updatedAt < entry.updatedAt) return
      set({ ...UNSAVED, savedId: link.cloudId, savedWhere: 'cloud', savedVersion: link.version })
    },

    syncLocalIntoAccount: async () => {
      if (!isSignedIn()) return
      const outcome = await adoptLocalGraphs()
      // Signed out while uploading: the uploads stand, but the editor now
      // belongs to the signed-out state and must not be re-pointed.
      if (!isSignedIn()) return
      if (outcome.unreachable) set({ accountUnreachable: true })
      if (outcome.message) get().notify(outcome.message, outcome.failed > 0 ? 'error' : 'success')
      get().followIntoAccount()
      if (outcome.uploaded > 0) await get().refreshDocuments()
    },

    setName: (name) => {
      set({ name, namedByUser: true })
    },
  }
})
