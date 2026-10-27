import { beforeEach, describe, expect, it, vi } from 'vitest'
import { docFromEdges } from '../graph/model/builder'

/**
 * Everything else tests against `test/fakeCloud.ts`. These test the real
 * `cloud.ts` against a stub Supabase client, for the parts the fake cannot
 * speak to: how a failed response is classified, and exactly which filters a
 * write carries.
 */

interface Response {
  data: unknown
  error: { message: string; code?: string; name?: string } | null
  status: number
}

/** Every query-builder method called, in order, for assertions. */
let calls: Array<[string, unknown[]]> = []
/** What the next awaited query resolves to. */
let respond: () => Response | Promise<Response> = () => ({ data: [], error: null, status: 200 })
let session: { user: { id: string } } | null = { user: { id: 'user-1' } }
let sessionError: { name: string; message: string } | null = null

const builder = (): unknown =>
  new Proxy(
    {},
    {
      get(_target, key) {
        if (key === 'then') {
          return (resolve: (value: Response) => void, reject: (reason: unknown) => void) =>
            Promise.resolve()
              .then(respond)
              .then(resolve, reject)
        }
        return (...args: unknown[]) => {
          calls.push([String(key), args])
          return builder()
        }
      },
    },
  )

vi.mock('../auth/client', () => ({
  getSupabase: () => ({
    from: (table: string) => {
      calls.push(['from', [table]])
      return builder()
    },
    auth: { getSession: async () => ({ data: { session }, error: sessionError }) },
  }),
}))

const { listCloudDocuments, saveCloudDocument } = await import('./cloud')

beforeEach(() => {
  calls = []
  respond = () => ({ data: [], error: null, status: 200 })
  session = { user: { id: 'user-1' } }
  sessionError = null
})

const input = { id: 'row-1', name: 'G', graph: docFromEdges(['A-B']), expectedVersion: 3 }

describe('classifying a failed call', () => {
  it.each([
    ['a fetch that never completed', { message: 'TypeError: Failed to fetch' }, 0],
    ['a paused Supabase project', { message: 'Project paused' }, 540],
    ['a gateway error', { message: 'Bad gateway' }, 502],
    ['a Cloudflare origin error', { message: 'Web server is down' }, 521],
  ])('treats %s as unreachable', async (_label, error, status) => {
    respond = () => ({ data: null, error, status })
    const result = await listCloudDocuments()
    expect(result.ok).toBe(false)
    expect(result.unreachable).toBe(true)
  })

  it('does not treat a refusal from the database as unreachable', async () => {
    // Falling back to a local save here would hide a real problem.
    respond = () => ({ data: null, error: { message: 'denied', code: '42501' }, status: 403 })
    const result = await listCloudDocuments()
    expect(result.unreachable).toBeUndefined()
    expect(result.message).toMatch(/not allowed/)
  })

  it('explains a missing table in both of the ways PostgREST reports it', async () => {
    for (const code of ['42P01', 'PGRST205']) {
      respond = () => ({ data: null, error: { message: 'missing', code }, status: 404 })
      expect((await listCloudDocuments()).message).toMatch(/migration/)
    }
  })

  it('turns a thrown network error into a result instead of a rejection', async () => {
    respond = () => Promise.reject(new TypeError('Failed to fetch'))
    const result = await listCloudDocuments()
    expect(result.unreachable).toBe(true)
  })
})

describe('saving', () => {
  it('never updates a deleted row', async () => {
    respond = () => ({ data: { id: 'row-1', version: 4 }, error: null, status: 200 })
    await saveCloudDocument(input)
    const update = calls.findIndex(([method]) => method === 'update')
    expect(update).toBeGreaterThan(-1)
    const filters = calls.slice(update).map(([method, args]) => `${method}:${String(args[0])}`)
    expect(filters).toContain('eq:id')
    expect(filters).toContain('eq:version')
    expect(filters).toContain('is:deleted_at')
  })

  it('says so when the session is gone, rather than only asking to sign in', async () => {
    session = null
    const result = await saveCloudDocument(input)
    expect(result.ok).toBe(false)
    expect(result.noSession).toBe(true)
    expect(calls.some(([method]) => method === 'update' || method === 'insert')).toBe(false)
  })

  it('treats a session refresh that could not connect as unreachable', async () => {
    session = null
    sessionError = { name: 'AuthRetryableFetchError', message: 'Failed to fetch' }
    const result = await saveCloudDocument(input)
    expect(result.unreachable).toBe(true)
  })
})
