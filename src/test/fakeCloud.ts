/**
 * An in-memory stand-in for `src/sync/cloud.ts`.
 *
 * Tests mock the real module with this one, so the store's save/open/list/delete
 * paths are exercised exactly as they run in the browser — including the
 * version check and the conflict branch — without a database, a network, or a
 * signed-in user.
 *
 * It reproduces the behaviours the store depends on, not the whole of Postgres:
 * optimistic concurrency on `version`, soft deletion, and newest-first
 * ordering.
 */
import type { GraphDocument } from '../graph/model/types'
import type { DocumentSummary } from '../state/documents'

interface Row {
  id: string
  name: string
  graph: GraphDocument
  version: number
  vertexCount: number
  edgeCount: number
  createdAt: number
  updatedAt: number
  deleted: boolean
}

const rows = new Map<string, Row>()
let nextId = 1
let clock = 1_000
/** Set by a test to make the next call fail, as a dropped connection would. */
let failNext: string | null = null
/** While true every call fails as if the project could not be reached at all. */
let offline = false
/** While true a save finds no session, as when the refresh token has expired. */
let sessionGone = false

export const __fake = {
  reset() {
    rows.clear()
    nextId = 1
    clock = 1_000
    failNext = null
    offline = false
    sessionGone = false
  },
  /** Every live row, for assertions. */
  rows: () => [...rows.values()].filter((row) => !row.deleted),
  /** Rows including tombstones, to prove deletes are soft. */
  allRows: () => [...rows.values()],
  failNextCall(message: string) {
    failNext = message
  },
  /** Every call fails as `unreachable` until switched back, like a paused project. */
  setOffline(value: boolean) {
    offline = value
  },
  /** The next saves find no session, until switched back. */
  setSessionGone(value: boolean) {
    sessionGone = value
  },
  /** Soft-deletes a row, as deleting it on another device would. */
  deleteElsewhere(id: string) {
    const row = rows.get(id)
    if (row) row.deleted = true
  },
  /** Simulates another device writing, so the next save sees a stale version. */
  bumpElsewhere(id: string) {
    const row = rows.get(id)
    if (row) {
      row.version += 1
      row.updatedAt = ++clock
    }
  },
  seed(name: string, graph: GraphDocument): string {
    const id = `cloud-${nextId++}`
    rows.set(id, {
      id,
      name,
      graph,
      version: 1,
      vertexCount: graph.vertices.length,
      edgeCount: graph.edges.length,
      createdAt: ++clock,
      updatedAt: clock,
      deleted: false,
    })
    return id
  },
}

const UNREACHABLE = {
  ok: false,
  message: 'Could not reach your account. Check your connection and try again.',
  unreachable: true,
} as const

const takeFailure = (): { ok: false; message: string; unreachable?: boolean } | null => {
  if (offline) return UNREACHABLE
  const message = failNext
  failNext = null
  return message === null ? null : { ok: false, message }
}

const summary = (row: Row): DocumentSummary => ({
  id: row.id,
  name: row.name,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
  vertexCount: row.vertexCount,
  edgeCount: row.edgeCount,
})

export const deviceName = () => 'test device'

export const isNetworkFailure = (error: { message?: string; name?: string } | null | undefined) =>
  !!error &&
  (/fetch|network|load failed/i.test(error.message ?? '') ||
    error.name === 'AuthRetryableFetchError')

export const listCloudDocuments = async () => {
  const failure = takeFailure()
  if (failure) return failure
  return {
    ok: true,
    message: null,
    data: [...rows.values()]
      .filter((row) => !row.deleted)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map(summary),
  }
}

export const loadCloudDocument = async (id: string) => {
  const failure = takeFailure()
  if (failure) return failure
  const row = rows.get(id)
  if (!row || row.deleted) {
    return { ok: false, message: 'That graph is no longer in your account.' }
  }
  return {
    ok: true,
    message: null,
    // Cloned, so a test mutating the opened document cannot reach back into
    // the store the way a real network round trip never could.
    data: {
      name: row.name,
      graph: JSON.parse(JSON.stringify(row.graph)) as GraphDocument,
      version: row.version,
    },
  }
}

export const saveCloudDocument = async (input: {
  id: string | null
  name: string
  graph: GraphDocument
  expectedVersion: number | null
}) => {
  const failure = takeFailure()
  if (failure) return failure
  if (sessionGone) {
    return { ok: false, message: 'Sign in to save this graph to your account.', noSession: true }
  }

  const write = (id: string, version: number, name: string) => {
    rows.set(id, {
      id,
      name,
      graph: JSON.parse(JSON.stringify(input.graph)) as GraphDocument,
      version,
      vertexCount: input.graph.vertices.length,
      edgeCount: input.graph.edges.length,
      createdAt: rows.get(id)?.createdAt ?? ++clock,
      updatedAt: ++clock,
      deleted: false,
    })
  }

  if (input.id === null || input.expectedVersion === null) {
    const id = `cloud-${nextId++}`
    write(id, 1, input.name)
    return { ok: true, message: null, data: { id, version: 1 } }
  }

  const existing = rows.get(input.id)
  if (existing && !existing.deleted && existing.version === input.expectedVersion) {
    write(input.id, input.expectedVersion + 1, input.name)
    return { ok: true, message: null, data: { id: input.id, version: input.expectedVersion + 1 } }
  }

  // Stale or missing: keep both sides rather than choosing one.
  const copyId = `cloud-${nextId++}`
  const copyName = `${input.name} (${deviceName()})`
  write(copyId, 1, copyName)
  return {
    ok: true,
    message: `“${input.name}” had newer changes from elsewhere, so this version was saved as “${copyName}”. Both are in your account.`,
    data: {
      id: copyId,
      version: 1,
      conflictWith: { name: existing?.name ?? input.name, device: 'another device' },
    },
  }
}

export const deleteCloudDocument = async (id: string) => {
  const failure = takeFailure()
  if (failure) return failure
  const row = rows.get(id)
  if (row) row.deleted = true
  return { ok: true, message: null, data: null }
}
