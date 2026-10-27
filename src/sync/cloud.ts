/**
 * Saved graphs, in the signed-in user's account.
 *
 * This is the cloud half of what `state/documents.ts` does against local
 * storage, and it deliberately exposes the same shapes so the editor store can
 * talk to either without knowing which. Every call returns a result rather than
 * throwing: a save that failed because the network dropped is a sentence the
 * user should read, not a crash.
 *
 * Row-level security is what scopes these queries to one account — there is no
 * `where user_id = ...` anywhere below, because the database applies it. The
 * client only ever supplies `user_id` on insert, which the policy then checks.
 */
import { getSupabase } from '../auth/client'
import type { GraphDocument } from '../graph/model/types'
import type { DocumentSummary } from '../state/documents'
import { serializeGraph, parseGraphualizeJson } from '../graph/serialization'

export interface CloudResult<T> {
  ok: boolean
  data?: T
  /** A sentence to show the user. Null when everything worked. */
  message: string | null
  /**
   * True when the account could not be reached at all — no network, or the
   * Supabase project is down — as opposed to the account refusing the request.
   * The caller can then keep the user's work somewhere else instead.
   */
  unreachable?: boolean
  /** True when the stored session is gone (expired or revoked) by the time of the call. */
  noSession?: boolean
}

const ok = <T>(data: T): CloudResult<T> => ({ ok: true, data, message: null })
const fail = <T>(message: string): CloudResult<T> => ({ ok: false, message })

const UNREACHABLE = 'Could not reach your account. Check your connection and try again.'

/** supabase-js reports a failed `fetch` as an error whose message names it. */
export const isNetworkFailure = (
  error: { message?: string; name?: string } | null | undefined,
): boolean =>
  !!error &&
  (/fetch|network|load failed/i.test(error.message ?? '') ||
    error.name === 'AuthRetryableFetchError')

/**
 * HTTP statuses that mean "nothing usable answered", as opposed to the
 * database refusing the request: 0 for a fetch that never completed, the
 * gateway errors, Cloudflare's 52x, and 540, which Supabase returns for a
 * paused project.
 */
const isOutageStatus = (status: number | undefined): boolean =>
  status === 0 ||
  status === 502 ||
  status === 503 ||
  status === 504 ||
  status === 540 ||
  (status !== undefined && status >= 520 && status <= 530)

const unreachable = <T>(): CloudResult<T> => ({
  ok: false,
  message: UNREACHABLE,
  unreachable: true,
})

/** Turns a Postgres error into a result, keeping "could not connect" distinguishable. */
const failWith = <T>(error: { code?: string; message: string }, status?: number): CloudResult<T> =>
  isNetworkFailure(error) || isOutageStatus(status) ? unreachable() : fail(explain(error))

/**
 * The calls below are written to return results, but supabase-js can still
 * throw (a DNS failure surfaces as a rejected `fetch` in some paths). This
 * keeps the promise of "never throws" true regardless.
 */
const guarded =
  <A extends unknown[], T>(call: (...args: A) => Promise<CloudResult<T>>) =>
  async (...args: A): Promise<CloudResult<T>> => {
    try {
      return await call(...args)
    } catch (error) {
      if (isNetworkFailure(error as Error)) return unreachable()
      return fail(error instanceof Error ? error.message : 'Something went wrong talking to your account.')
    }
  }

/**
 * Turns a Postgres error into something worth reading.
 *
 * `42P01` is "relation does not exist" — the one error that is a setup problem
 * rather than a runtime one, and the only one where telling the user exactly
 * what to do is possible.
 */
const explain = (error: { code?: string; message: string }): string => {
  if (error.code === '42P01' || error.code === 'PGRST205') {
    return 'The graphs table does not exist yet. Run the migration in supabase/migrations/0001_graphs.sql.'
  }
  if (error.code === '42501' || error.code === 'PGRST301') {
    return 'This account is not allowed to do that. Check the row-level security policies.'
  }
  if (error.code === '23514') {
    return 'That graph is too large to save.'
  }
  if (isNetworkFailure(error)) return UNREACHABLE
  return error.message
}

/** A device label, so a conflict can say where the other edit came from. */
const DEVICE_KEY = 'graphualize:device:v1'

export const deviceName = (): string => {
  try {
    const existing = window.localStorage.getItem(DEVICE_KEY)
    if (existing) return existing
    const platform = /Mac/i.test(navigator.userAgent)
      ? 'Mac'
      : /Win/i.test(navigator.userAgent)
        ? 'Windows'
        : /Android|iPhone|iPad/i.test(navigator.userAgent)
          ? 'phone'
          : 'this device'
    window.localStorage.setItem(DEVICE_KEY, platform)
    return platform
  } catch {
    return 'this device'
  }
}

interface GraphRow {
  id: string
  name: string
  document: unknown
  vertex_count: number
  edge_count: number
  version: number
  origin_device: string | null
  created_at: string
  updated_at: string
}

const summaryOf = (row: GraphRow): DocumentSummary => ({
  id: row.id,
  name: row.name,
  createdAt: Date.parse(row.created_at),
  updatedAt: Date.parse(row.updated_at),
  vertexCount: row.vertex_count,
  edgeCount: row.edge_count,
})

/** Every graph in this account, newest first. Tombstones are excluded. */
export const listCloudDocuments = guarded(async (): Promise<CloudResult<DocumentSummary[]>> => {
  const supabase = getSupabase()
  if (!supabase) return fail('Sign-in is not configured in this build.')

  const { data, error, status } = await supabase
    .from('graphs')
    .select('id,name,vertex_count,edge_count,version,origin_device,created_at,updated_at')
    .is('deleted_at', null)
    .order('updated_at', { ascending: false })

  if (error) return failWith(error, status)
  return ok((data as GraphRow[]).map(summaryOf))
})

export const loadCloudDocument = guarded(async (
  id: string,
): Promise<CloudResult<{ name: string; graph: GraphDocument; version: number }>> => {
  const supabase = getSupabase()
  if (!supabase) return fail('Sign-in is not configured in this build.')

  const { data, error, status } = await supabase
    .from('graphs')
    .select('id,name,document,version')
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle()

  if (error) return failWith(error, status)
  if (!data) return fail('That graph is no longer in your account.')

  try {
    // The stored document goes back through the same validating parser as an
    // imported file. A row edited by hand, or written by an older build, must
    // not be trusted just because it came from the database.
    const saved = parseGraphualizeJson(JSON.stringify(data.document))
    return ok({ name: data.name as string, graph: saved.graph, version: data.version as number })
  } catch {
    return fail('That graph could not be read. It may have been saved by a newer version.')
  }
})

export interface SaveOutcome {
  id: string
  version: number
  /** Set when someone else's newer version was found and kept alongside. */
  conflictWith?: { name: string; device: string | null }
}

/**
 * Writes a graph to the account.
 *
 * `expectedVersion` is how a stale write is caught: the update only matches a
 * row still at that version, so if another device has written since, zero rows
 * come back. Nothing is overwritten — the incoming graph is saved as a separate
 * entry naming where it came from, and the user decides which to keep. A
 * machine never silently discards someone's work.
 */
export const saveCloudDocument = guarded(async (input: {
  id: string | null
  name: string
  graph: GraphDocument
  expectedVersion: number | null
}): Promise<CloudResult<SaveOutcome>> => {
  const supabase = getSupabase()
  if (!supabase) return fail('Sign-in is not configured in this build.')

  // Reading the session can need a token refresh, which is a network call.
  const { data: session, error: sessionError } = await supabase.auth.getSession()
  if (isNetworkFailure(sessionError)) return unreachable()
  const userId = session.session?.user?.id
  if (!userId) {
    return { ok: false, message: 'Sign in to save this graph to your account.', noSession: true }
  }

  const document = JSON.parse(
    JSON.stringify(serializeGraph({ id: input.id ?? 'graph', name: input.name, graph: input.graph })),
  ) as Record<string, unknown>

  const row = {
    user_id: userId,
    name: input.name,
    document,
    vertex_count: input.graph.vertices.length,
    edge_count: input.graph.edges.length,
    origin_device: deviceName(),
  }

  if (input.id === null || input.expectedVersion === null) {
    const { data, error, status } = await supabase
      .from('graphs')
      .insert({ ...row, version: 1 })
      .select('id,version')
      .single()
    if (error) return failWith(error, status)
    return ok({ id: data.id as string, version: data.version as number })
  }

  // `deleted_at is null` matters: a delete only sets the tombstone and leaves
  // the version alone, so without it a stale write would "succeed" into a
  // deleted graph that no list ever shows again.
  const { data, error, status } = await supabase
    .from('graphs')
    .update({ ...row, version: input.expectedVersion + 1 })
    .eq('id', input.id)
    .eq('version', input.expectedVersion)
    .is('deleted_at', null)
    .select('id,version')
    .maybeSingle()

  if (error) return failWith(error, status)
  if (data) return ok({ id: data.id as string, version: data.version as number })

  // Zero rows matched: the row moved on, or was deleted, since this device last
  // read it. Keep both sides rather than choosing one.
  const { data: current } = await supabase
    .from('graphs')
    .select('name,origin_device')
    .eq('id', input.id)
    .maybeSingle()

  const copyName = `${input.name} (${deviceName()})`.slice(0, 200)
  const {
    data: copy,
    error: copyError,
    status: copyStatus,
  } = await supabase
    .from('graphs')
    .insert({ ...row, name: copyName, version: 1 })
    .select('id,version')
    .single()

  if (copyError) return failWith(copyError, copyStatus)
  return {
    ok: true,
    data: {
      id: copy.id as string,
      version: copy.version as number,
      conflictWith: {
        name: (current?.name as string) ?? input.name,
        device: (current?.origin_device as string) ?? null,
      },
    },
    message: `“${input.name}” had newer changes from elsewhere, so this version was saved as “${copyName}”. Both are in your account.`,
  }
})

/** Soft delete, so the removal reaches every device instead of bouncing back. */
export const deleteCloudDocument = guarded(async (id: string): Promise<CloudResult<null>> => {
  const supabase = getSupabase()
  if (!supabase) return fail('Sign-in is not configured in this build.')

  const { error, status } = await supabase
    .from('graphs')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)

  if (error) return failWith(error, status)
  return ok(null)
})
