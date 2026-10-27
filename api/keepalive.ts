/**
 * Keeps the free-tier Supabase project from pausing.
 *
 * Supabase pauses a free project after a week without activity. A paused
 * project's hostname stops resolving, which takes Google sign-in and account
 * saves down with it — and nothing says so until someone tries to sign in.
 * That happened once and went unnoticed for two months.
 *
 * Vercel Cron calls this once a day (see `vercel.json`). It makes one cheap
 * database read with the publishable anon key; row-level security returns an
 * empty list, but the query itself counts as activity. It reads nothing private
 * and writes nothing, so it is harmless if anyone else calls it too — and when
 * `CRON_SECRET` is set in the Vercel project, only Vercel Cron can.
 *
 * Self-contained on purpose: this file is deployed as its own function, and a
 * relative import would need an explicit `.js` extension at runtime under
 * `"type": "module"`. The logic is exported so it can be tested directly.
 */

export interface PingResult {
  ok: boolean
  /** The HTTP status Supabase answered with, or null when nothing answered. */
  status: number | null
  detail: string
}

export interface PingConfig {
  url: string | undefined
  key: string | undefined
}

const TIMEOUT_MS = 10_000

/**
 * One read against the project. Never throws: every outcome, including a
 * paused or unreachable project, comes back as a result to report.
 */
export const pingSupabase = async (
  { url, key }: PingConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<PingResult> => {
  const base = url?.trim().replace(/\/$/, '')
  if (!base || !key?.trim()) {
    return {
      ok: false,
      status: null,
      detail: 'VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are not set for this deployment.',
    }
  }

  try {
    // `apikey` alone, not a Bearer token: the newer publishable keys are not
    // JWTs, and the gateway accepts `apikey` for the anon role either way.
    const response = await fetchImpl(`${base}/rest/v1/graphs?select=id&limit=1`, {
      headers: { apikey: key.trim() },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (response.ok) {
      return { ok: true, status: response.status, detail: 'Supabase answered.' }
    }
    if (response.status === 540) {
      return {
        ok: false,
        status: 540,
        detail: 'The Supabase project is paused. Resume it from its dashboard.',
      }
    }
    return {
      ok: false,
      status: response.status,
      detail: `Supabase answered ${response.status} ${response.statusText}.`.trim(),
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    return {
      ok: false,
      status: null,
      detail: `Could not reach Supabase (${reason}). A paused project stops resolving in DNS; resume it from its dashboard.`,
    }
  }
}

/** Whether the request may run the ping: anyone, unless `CRON_SECRET` is set. */
export const isAuthorized = (request: Request, secret: string | undefined): boolean =>
  !secret || request.headers.get('authorization') === `Bearer ${secret}`

export async function GET(request: Request): Promise<Response> {
  if (!isAuthorized(request, process.env.CRON_SECRET)) {
    return new Response('Unauthorized', { status: 401 })
  }
  const result = await pingSupabase({
    url: process.env.VITE_SUPABASE_URL,
    key: process.env.VITE_SUPABASE_ANON_KEY,
  })
  // A failure is a 503 so it shows up as a failed run in Vercel's cron log.
  return Response.json(result, {
    status: result.ok ? 200 : 503,
    headers: { 'cache-control': 'no-store' },
  })
}
