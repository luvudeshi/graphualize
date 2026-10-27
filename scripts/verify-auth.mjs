#!/usr/bin/env node
/**
 * Checks that Google sign-in is actually configured correctly, rather than
 * assuming it.
 *
 * Two levels:
 *
 *   npm run verify:auth
 *     Local only. Confirms the client env is present and well-formed and that
 *     no secret has leaked into a tracked file.
 *
 *   SUPABASE_ACCESS_TOKEN=sbp_... npm run verify:auth
 *     Also queries the Supabase Management API and reports, for real: whether
 *     the Google provider is enabled, what SITE_URL is set to, which redirect
 *     URLs are allow-listed, and whether localhost and production are among
 *     them.
 *
 * The token is read from the environment and never written anywhere.
 */
import { readFile, access } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)

const GREEN = '[32m'
const RED = '[31m'
const YELLOW = '[33m'
const DIM = '[2m'
const RESET = '[0m'

let failures = 0
let warnings = 0

const pass = (message) => console.log(`${GREEN}  ok${RESET}  ${message}`)
const fail = (message, hint) => {
  failures += 1
  console.log(`${RED}fail${RESET}  ${message}`)
  if (hint) console.log(`${DIM}      ${hint}${RESET}`)
}
const warn = (message, hint) => {
  warnings += 1
  console.log(`${YELLOW}warn${RESET}  ${message}`)
  if (hint) console.log(`${DIM}      ${hint}${RESET}`)
}
const section = (title) => console.log(`\n${title}`)

const exists = async (path) => {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

const readEnvFile = async (path) => {
  if (!(await exists(path))) return null
  const text = await readFile(path, 'utf8')
  const entries = {}
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line)
    if (!match) continue
    entries[match[1]] = match[2].trim().replace(/^["']|["']$/g, '')
  }
  return entries
}

/* ------------------------------------------------------------------ */
/* 1. Local environment                                                */
/* ------------------------------------------------------------------ */

section('Local environment')

const env = (await readEnvFile('.env.local')) ?? (await readEnvFile('.env')) ?? {}
const projectUrl = process.env.VITE_SUPABASE_URL ?? env.VITE_SUPABASE_URL ?? ''
const anonKey = process.env.VITE_SUPABASE_ANON_KEY ?? env.VITE_SUPABASE_ANON_KEY ?? ''

if (!projectUrl) {
  warn(
    'VITE_SUPABASE_URL is not set.',
    'Graphualize runs anonymously with no account UI. Copy .env.example to .env.local to enable sign-in.',
  )
} else if (!/^https:\/\/[a-z0-9-]+\.supabase\.(co|in)$/.test(projectUrl)) {
  fail(`VITE_SUPABASE_URL does not look like a project URL: ${projectUrl}`)
} else {
  pass(`Project URL ${projectUrl}`)
}

if (projectUrl && !anonKey) {
  fail('VITE_SUPABASE_ANON_KEY is missing while VITE_SUPABASE_URL is set.')
} else if (anonKey) {
  // Both the legacy JWT anon key and the newer publishable key are fine.
  const legacyJwt = anonKey.split('.').length === 3
  const publishable = anonKey.startsWith('sb_publishable_')
  if (legacyJwt || publishable) pass('Publishable key present and well-formed.')
  else fail('VITE_SUPABASE_ANON_KEY is neither a JWT nor an sb_publishable_ key.')

  if (anonKey.startsWith('sb_secret_') || anonKey.startsWith('sbp_')) {
    fail(
      'That is a SECRET key, not a publishable one.',
      'Rotate it immediately — anything in a VITE_* variable is compiled into the browser bundle.',
    )
  }
  if (legacyJwt) {
    try {
      const payload = JSON.parse(Buffer.from(anonKey.split('.')[1], 'base64url').toString())
      if (payload.role === 'service_role') {
        fail(
          'This is the SERVICE-ROLE key. It bypasses row-level security.',
          'Rotate it now and replace it with the anon/publishable key.',
        )
      } else if (payload.role === 'anon') {
        pass('Key role is "anon", as it should be.')
      }
    } catch {
      /* Not decodable; the shape check above already ran. */
    }
  }
}

/* ------------------------------------------------------------------ */
/* 2. Nothing secret is tracked by git                                 */
/* ------------------------------------------------------------------ */

section('Secret hygiene')

try {
  // --cached --others --exclude-standard is "everything git would commit":
  // tracked files plus untracked ones that are not ignored. Plain `ls-files`
  // would pass vacuously in a repository with nothing committed yet, which is
  // exactly when a secret is most likely to be sitting in the working tree.
  const { stdout } = await run(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard'],
    { cwd: process.cwd() },
  )
  const tracked = stdout.split('\n').filter(Boolean)
  const trackedEnv = tracked.filter((f) => /(^|\/)\.env($|\.)/.test(f) && f !== '.env.example')
  if (trackedEnv.length) {
    fail(
      `git would commit ${trackedEnv.join(', ')}`,
      'Add it to .gitignore (and `git rm --cached` it), then rotate anything that was inside.',
    )
  } else {
    pass('No .env file is tracked or committable.')
  }

  const suspicious = []
  for (const file of tracked) {
    if (!/\.(ts|tsx|js|mjs|json|md|html|yml|yaml)$/.test(file)) continue
    let text
    try {
      text = await readFile(file, 'utf8')
    } catch {
      continue
    }
    // GOCSPX- is the Google OAuth client-secret prefix; sbp_ is a Supabase
    // personal access token; sb_secret_ is a Supabase secret key.
    if (/GOCSPX-[\w-]{10,}/.test(text)) suspicious.push(`${file}: Google client secret`)
    if (/\bsbp_[a-f0-9]{40,}/.test(text)) suspicious.push(`${file}: Supabase access token`)
    if (/\bsb_secret_[\w-]{10,}/.test(text)) suspicious.push(`${file}: Supabase secret key`)
    if (/"role"\s*:\s*"service_role"/.test(text)) suspicious.push(`${file}: service-role JWT`)
  }
  if (suspicious.length) {
    for (const hit of suspicious) fail(`Secret committed — ${hit}`, 'Rotate it, then remove it.')
  } else {
    pass(`No secret found in ${tracked.length} committable file(s).`)
  }
} catch {
  warn('Not a git repository, so the tracked-file scan was skipped.')
}

/* ------------------------------------------------------------------ */
/* 3. The live project                                                 */
/* ------------------------------------------------------------------ */

section('Project reachability')

// Needs no token, so it runs for everyone. A free-tier project that sat idle
// for a week is paused, and a paused project's hostname stops resolving —
// sign-in then fails with nothing more helpful than "Failed to fetch".
if (!projectUrl) {
  warn('No project URL, so reachability was not checked.')
} else {
  const dashboard = `https://supabase.com/dashboard/project/${/^https:\/\/([a-z0-9-]+)\./.exec(projectUrl)?.[1] ?? ''}`
  try {
    const response = await fetch(`${projectUrl}/auth/v1/health`, {
      headers: anonKey ? { apikey: anonKey } : {},
      signal: AbortSignal.timeout(10_000),
    })
    if (response.status === 540) {
      fail('The project is PAUSED.', `Resume it at ${dashboard} (data is kept).`)
    } else if (response.ok) {
      pass('The project answers.')
    } else {
      warn(`The project answered ${response.status} on /auth/v1/health.`)
    }
  } catch (error) {
    const code = error?.cause?.code
    if (code === 'ENOTFOUND') {
      fail(
        'The project hostname does not resolve: it is paused (free tier, after a week idle) or deleted.',
        `Resume it at ${dashboard}. The keep-alive cron in vercel.json stops this recurring.`,
      )
    } else {
      fail(`Could not reach the project (${code ?? error.message}).`)
    }
  }
}

section('Supabase project')

const token = process.env.SUPABASE_ACCESS_TOKEN
const refFromUrl = /^https:\/\/([a-z0-9-]+)\.supabase\./.exec(projectUrl)?.[1]
const ref = process.env.SUPABASE_PROJECT_REF ?? refFromUrl

if (!token) {
  warn(
    'SUPABASE_ACCESS_TOKEN is not set, so the live project was not checked.',
    'Re-run as: SUPABASE_ACCESS_TOKEN=sbp_... npm run verify:auth',
  )
} else if (!ref) {
  warn('No project ref available; set VITE_SUPABASE_URL or SUPABASE_PROJECT_REF.')
} else {
  const api = async (path) => {
    const response = await fetch(`https://api.supabase.com/v1/projects/${ref}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText} on ${path}`)
    }
    return response.json()
  }

  try {
    // Only a healthy project passes. `INACTIVE` is how the Management API
    // reports a paused one; the transitional states are worth a warning,
    // since sign-in may not work until they settle.
    const project = await api('')
    const TRANSITIONAL = ['COMING_UP', 'RESTORING', 'RESTARTING', 'UPGRADING', 'RESIZING']
    if (project.status === 'ACTIVE_HEALTHY') {
      pass('Project status: ACTIVE_HEALTHY.')
    } else if (TRANSITIONAL.includes(project.status)) {
      warn(`Project status: ${project.status}. Sign-in may not work until it is ACTIVE_HEALTHY.`)
    } else {
      fail(
        `Project status: ${project.status ?? 'unknown'}.`,
        project.status === 'INACTIVE' || project.status === 'PAUSING'
          ? 'The project is paused. Resume it from the Supabase dashboard.'
          : 'Check the project in the Supabase dashboard.',
      )
    }

    const auth = await api('/config/auth')

    if (auth.external_google_enabled) pass('Google provider is enabled.')
    else
      fail(
        'Google provider is DISABLED on this project.',
        'Authentication > Sign In / Providers > Google, or re-run the setup script.',
      )

    if (auth.external_google_client_id) {
      pass(`Google client id is set (…${String(auth.external_google_client_id).slice(-24)}).`)
    } else {
      fail('No Google client id is configured.')
    }

    const siteUrl = auth.site_url ?? ''
    const extra = String(auth.uri_allow_list ?? '')
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)
    const all = [siteUrl, ...extra].filter(Boolean)

    console.log(`${DIM}      SITE_URL: ${siteUrl || '(unset)'}${RESET}`)
    for (const entry of extra) console.log(`${DIM}      allowed:  ${entry}${RESET}`)

    const matches = (predicate) => all.some(predicate)

    if (matches((u) => /^http:\/\/localhost:5173(\/|$|\*)/.test(u))) {
      pass('Development redirect http://localhost:5173 is allowed.')
    } else {
      fail(
        'http://localhost:5173 is not in the redirect allow-list.',
        'Sign-in will fail locally with "requested path is invalid".',
      )
    }

    if (matches((u) => /^http:\/\/localhost:4173(\/|$|\*)/.test(u))) {
      pass('Preview redirect http://localhost:4173 is allowed.')
    } else {
      warn('http://localhost:4173 is not allowed; `npm run preview` sign-in will fail.')
    }

    const production = all.filter((u) => u.startsWith('https://'))
    if (production.length) {
      pass(`Production redirect(s) allowed: ${production.join(', ')}`)
    } else {
      warn(
        'No https:// redirect URL is configured.',
        'Add your deployed origin before shipping, or sign-in will only work locally.',
      )
    }

    if (siteUrl.startsWith('http://localhost')) {
      warn(
        'SITE_URL points at localhost.',
        'It is the fallback Supabase uses when a redirect is not allow-listed; in production it should be the deployed origin.',
      )
    }

    // --- the graphs table, via the Management API's SQL endpoint ---
    try {
      const response = await fetch(
        `https://api.supabase.com/v1/projects/${ref}/database/query`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query: `select
                (select count(*) from pg_tables
                   where schemaname = 'public' and tablename = 'graphs') as table_count,
                (select coalesce(bool_or(relrowsecurity), false) from pg_class
                   where relname = 'graphs') as rls_enabled,
                (select count(*) from pg_policies where tablename = 'graphs') as policy_count`,
          }),
        },
      )
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
      const rows = await response.json()
      const row = Array.isArray(rows) ? rows[0] : rows

      if (Number(row?.table_count) === 1) pass('The graphs table exists.')
      else
        fail(
          'The graphs table does not exist — saving will fail.',
          'Run supabase/migrations/0001_graphs.sql against this project.',
        )

      if (row?.rls_enabled === true) pass('Row-level security is enabled on graphs.')
      else if (Number(row?.table_count) === 1)
        fail(
          'Row-level security is OFF on the graphs table.',
          'Every account could read every other account’s graphs. Re-run the migration.',
        )

      const policies = Number(row?.policy_count ?? 0)
      if (policies >= 4) pass(`${policies} row-level security policies are in place.`)
      else if (Number(row?.table_count) === 1)
        fail(
          `Only ${policies} policy/policies on graphs; expected 4 (select, insert, update, delete).`,
        )
    } catch (error) {
      warn(`Could not inspect the database schema: ${error.message}`)
    }

    // The redirect URI Google itself must know about. Getting this wrong is
    // the single most common cause of a failed OAuth setup, so it is printed
    // verbatim for copy-paste.
    console.log(
      `${DIM}      Google's Authorized redirect URI must be exactly:${RESET}\n` +
        `      https://${ref}.supabase.co/auth/v1/callback`,
    )
  } catch (error) {
    fail(`Could not read the project configuration: ${error.message}`)
  }
}

/* ------------------------------------------------------------------ */

console.log('')
if (failures > 0) {
  console.log(`${RED}${failures} problem(s)${RESET}, ${warnings} warning(s).`)
  process.exit(1)
}
console.log(`${GREEN}All checks passed${RESET}${warnings ? `, ${warnings} warning(s).` : '.'}`)
