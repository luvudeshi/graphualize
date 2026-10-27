import { afterEach, describe, expect, it, vi } from 'vitest'

// The keep-alive function lives in api/, where Vercel turns every file into a
// deployed function — so its test lives here instead of next to it.
const { pingSupabase, isAuthorized, GET } = await import('../../api/keepalive')

const config = { url: 'https://example.supabase.co/', key: 'anon-key' }
const respond = (status: number, statusText = '') =>
  vi.fn(async () => new Response('[]', { status, statusText }))

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('pingSupabase', () => {
  it('reads the graphs table once, with the publishable key and nothing else', async () => {
    const fetchImpl = respond(200)
    const result = await pingSupabase(config, fetchImpl)
    expect(result).toEqual({ ok: true, status: 200, detail: 'Supabase answered.' })
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://example.supabase.co/rest/v1/graphs?select=id&limit=1')
    expect(init.headers).toEqual({ apikey: 'anon-key' })
    expect(init.method ?? 'GET').toBe('GET')
  })

  it('names a paused project', async () => {
    const result = await pingSupabase(config, respond(540))
    expect(result.ok).toBe(false)
    expect(result.status).toBe(540)
    expect(result.detail).toMatch(/paused/i)
  })

  it('reports any other answer as a failure', async () => {
    const result = await pingSupabase(config, respond(503, 'Service Unavailable'))
    expect(result).toMatchObject({ ok: false, status: 503 })
    expect(result.detail).toContain('503')
  })

  it('turns an unresolvable host into a result, not a throw', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('fetch failed')
    })
    const result = await pingSupabase(config, fetchImpl)
    expect(result).toMatchObject({ ok: false, status: null })
    expect(result.detail).toMatch(/could not reach supabase/i)
  })

  it('makes no request when the deployment has no project configured', async () => {
    const fetchImpl = respond(200)
    const result = await pingSupabase({ url: '', key: undefined }, fetchImpl)
    expect(result.ok).toBe(false)
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

describe('isAuthorized', () => {
  const request = (authorization?: string) =>
    new Request('https://graphualize.vercel.app/api/keepalive', {
      headers: authorization ? { authorization } : {},
    })

  it('lets anyone in when no CRON_SECRET is set', () => {
    expect(isAuthorized(request(), undefined)).toBe(true)
  })

  it('requires the exact bearer secret when one is set', () => {
    expect(isAuthorized(request('Bearer s3cret'), 's3cret')).toBe(true)
    expect(isAuthorized(request('Bearer wrong'), 's3cret')).toBe(false)
    expect(isAuthorized(request(), 's3cret')).toBe(false)
  })
})

describe('GET /api/keepalive', () => {
  it('answers 200 with the result when Supabase answers', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key')
    vi.stubEnv('CRON_SECRET', '')
    vi.stubGlobal('fetch', respond(200))
    const response = await GET(new Request('https://graphualize.vercel.app/api/keepalive'))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ ok: true })
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it('answers 503 so a failed run shows up in the cron log', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key')
    vi.stubEnv('CRON_SECRET', '')
    vi.stubGlobal('fetch', respond(540))
    const response = await GET(new Request('https://graphualize.vercel.app/api/keepalive'))
    expect(response.status).toBe(503)
  })

  it('refuses a caller without the secret, before touching Supabase', async () => {
    vi.stubEnv('CRON_SECRET', 's3cret')
    const fetchImpl = respond(200)
    vi.stubGlobal('fetch', fetchImpl)
    const response = await GET(new Request('https://graphualize.vercel.app/api/keepalive'))
    expect(response.status).toBe(401)
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

describe('vercel.json', () => {
  it('calls the keep-alive twice a day, each job at most daily as the Hobby plan allows', async () => {
    const { readFileSync } = await import('node:fs')
    const { resolve } = await import('node:path')
    // Vitest runs from the project root.
    const config = JSON.parse(readFileSync(resolve(process.cwd(), 'vercel.json'), 'utf8'))
    // Hobby cron runs are best-effort within the hour; two a day 12 hours
    // apart keep the project well inside Supabase's week of grace even if
    // some runs are missed.
    expect(config.crons).toEqual([
      { path: '/api/keepalive', schedule: '0 3 * * *' },
      { path: '/api/keepalive', schedule: '0 15 * * *' },
    ])
  })
})
