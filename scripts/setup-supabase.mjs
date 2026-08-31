#!/usr/bin/env node
/**
 * One-command Supabase setup for Graphualize's Google sign-in.
 *
 * Everything here is scripted because it can be. The only step that genuinely
 * needs a human is creating the Google OAuth client, which requires a Google
 * login and a consent screen; this script stops there, prints the exact value
 * to paste, and picks up again when you re-run it with the credentials.
 *
 *   Pass 1 — create and configure the project:
 *     SUPABASE_ACCESS_TOKEN=sbp_... node scripts/setup-supabase.mjs
 *
 *   Pass 2 — after creating the Google client:
 *     SUPABASE_ACCESS_TOKEN=sbp_... \
 *     GOOGLE_CLIENT_ID=....apps.googleusercontent.com \
 *     GOOGLE_CLIENT_SECRET=GOCSPX-... \
 *     node scripts/setup-supabase.mjs
 *
 * Options (all optional):
 *   SUPABASE_PROJECT_REF   use this existing project instead of creating one
 *   SUPABASE_ORG_ID        which organization to create under
 *   SUPABASE_REGION        default us-east-1
 *   SITE_URL               production origin, e.g. https://graphualize.app
 *
 * Secrets are read from the environment and written only to `.env.local`,
 * which is gitignored — and only the publishable values go there. The Google
 * client secret is sent straight to Supabase and never touches disk.
 */
import { writeFile, readFile, access } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { createInterface } from 'node:readline/promises'

const API = 'https://api.supabase.com/v1'
const token = process.env.SUPABASE_ACCESS_TOKEN

const B = '[1m'
const GREEN = '[32m'
const RED = '[31m'
const YELLOW = '[33m'
const DIM = '[2m'
const RESET = '[0m'

const say = (message = '') => console.log(message)
const ok = (message) => say(`${GREEN}✓${RESET} ${message}`)
const info = (message) => say(`${DIM}·${RESET} ${message}`)
const warn = (message) => say(`${YELLOW}!${RESET} ${message}`)

const die = (message, hint) => {
  say(`\n${RED}✗ ${message}${RESET}`)
  if (hint) say(`${DIM}  ${hint}${RESET}`)
  process.exit(1)
}

if (!token) {
  die(
    'SUPABASE_ACCESS_TOKEN is not set.',
    'Create one at https://supabase.com/dashboard/account/tokens and prefix the command with it.',
  )
}
if (!token.startsWith('sbp_')) {
  die('That does not look like a Supabase personal access token (they start with "sbp_").')
}

const api = async (path, options = {}) => {
  let response
  try {
    response = await fetch(`${API}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    })
  } catch (error) {
    die(
      `Could not reach ${API} (${error.message}).`,
      'Check your network — a proxy or firewall may be blocking api.supabase.com.',
    )
  }
  const text = await response.text()
  const body = text ? JSON.parse(text) : {}
  if (!response.ok) {
    die(
      `Supabase API ${response.status} on ${options.method ?? 'GET'} ${path}`,
      body.message ?? body.error ?? text.slice(0, 300),
    )
  }
  return body
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const ask = async (question) => {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const answer = await rl.question(question)
  rl.close()
  return answer.trim()
}

const exists = async (path) => {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

say(`\n${B}Graphualize — Supabase setup${RESET}\n`)

/* ------------------------------------------------------------------ */
/* 1. Find or create the project                                       */
/* ------------------------------------------------------------------ */

let ref = process.env.SUPABASE_PROJECT_REF
let projectUrl

if (!ref) {
  const projects = await api('/projects')
  const existing = projects.find((p) => /graphualize/i.test(p.name))

  if (existing) {
    ref = existing.id
    ok(`Reusing existing project "${existing.name}" (${ref}).`)
  } else {
    const orgs = await api('/organizations')
    if (!orgs.length) {
      die(
        'This account has no organizations.',
        'Create one at https://supabase.com/dashboard and re-run.',
      )
    }

    let orgId = process.env.SUPABASE_ORG_ID
    if (!orgId) {
      if (orgs.length === 1) {
        orgId = orgs[0].id
        info(`Using organization "${orgs[0].name}".`)
      } else {
        say('\nWhich organization should the project belong to?')
        orgs.forEach((org, index) => say(`  ${index + 1}. ${org.name} (${org.id})`))
        const choice = await ask('\nNumber: ')
        orgId = orgs[Number(choice) - 1]?.id
        if (!orgId) die('That was not one of the options.')
      }
    }

    const region = process.env.SUPABASE_REGION ?? 'us-east-1'
    // Generated here, shown once, never stored. Graphualize's client never
    // uses it — it only matters if you later connect to Postgres directly.
    const dbPass = randomBytes(24).toString('base64url')

    say(`\nCreating project "graphualize" in ${region}…`)
    const created = await api('/projects', {
      method: 'POST',
      body: JSON.stringify({
        name: 'graphualize',
        organization_id: orgId,
        region,
        db_pass: dbPass,
      }),
    })
    ref = created.id
    ok(`Created project ${ref}.`)
    say('')
    warn('Database password (shown once — save it in your password manager):')
    say(`  ${dbPass}`)
    say('')
  }
}

projectUrl = `https://${ref}.supabase.co`

/* Wait until the project can answer configuration calls. */
say('Waiting for the project to finish provisioning…')
for (let attempt = 0; attempt < 60; attempt += 1) {
  const project = await api(`/projects/${ref}`)
  if (project.status === 'ACTIVE_HEALTHY') {
    ok('Project is healthy.')
    break
  }
  if (attempt === 59) die(`Project is still "${project.status}" after five minutes.`)
  process.stdout.write(`${DIM}  ${project.status}…${RESET}\r`)
  await sleep(5000)
}

/* ------------------------------------------------------------------ */
/* 2. Publishable key -> .env.local                                    */
/* ------------------------------------------------------------------ */

const keys = await api(`/projects/${ref}/api-keys`)
const anonKey =
  keys.find((k) => k.name === 'anon' || k.type === 'publishable')?.api_key ??
  keys.find((k) => k.name === 'anon')?.api_key

if (!anonKey) die('Could not read the project’s publishable (anon) key.')
ok('Read the publishable key.')

const envBody = [
  '# Written by scripts/setup-supabase.mjs. Gitignored.',
  '# Both values are publishable and are meant to reach the browser.',
  `VITE_SUPABASE_URL=${projectUrl}`,
  `VITE_SUPABASE_ANON_KEY=${anonKey}`,
  '',
].join('\n')

if (await exists('.env.local')) {
  const current = await readFile('.env.local', 'utf8')
  if (current.trim() !== envBody.trim()) {
    await writeFile('.env.local.previous', current, 'utf8')
    info('Existing .env.local backed up to .env.local.previous.')
  }
}
await writeFile('.env.local', envBody, 'utf8')
ok('Wrote .env.local.')

/* ------------------------------------------------------------------ */
/* 3. Redirect URLs                                                    */
/* ------------------------------------------------------------------ */

const productionUrl = process.env.SITE_URL?.replace(/\/$/, '')

/*
 * Vite dev runs on 5173 and `vite preview` on 4173. Both are allow-listed so
 * that sign-in works in development and against a production build locally.
 *
 * SITE_URL is what Supabase falls back to when a redirect is not allow-listed,
 * so it becomes the production origin as soon as there is one; until then it
 * stays on the dev server, which is where sign-in will actually be used.
 */
const redirects = [
  'http://localhost:5173',
  'http://localhost:5173/**',
  'http://localhost:4173',
  'http://localhost:4173/**',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:5173/**',
]
if (productionUrl) redirects.unshift(productionUrl, `${productionUrl}/**`)

const authPatch = {
  site_url: productionUrl ?? 'http://localhost:5173',
  uri_allow_list: redirects.join(','),
}

/* ------------------------------------------------------------------ */
/* 4. Google provider                                                  */
/* ------------------------------------------------------------------ */

const clientId = process.env.GOOGLE_CLIENT_ID
const clientSecret = process.env.GOOGLE_CLIENT_SECRET
const callback = `${projectUrl}/auth/v1/callback`

if (clientId && clientSecret) {
  if (!clientId.endsWith('.apps.googleusercontent.com')) {
    warn('GOOGLE_CLIENT_ID does not end in .apps.googleusercontent.com — check you copied the client ID, not the project id.')
  }
  Object.assign(authPatch, {
    external_google_enabled: true,
    external_google_client_id: clientId,
    external_google_secret: clientSecret,
  })
}

await api(`/projects/${ref}/config/auth`, {
  method: 'PATCH',
  body: JSON.stringify(authPatch),
})
ok('Updated redirect URLs.')
if (clientId && clientSecret) ok('Enabled the Google provider.')

/* ------------------------------------------------------------------ */
/* 5. Report                                                           */
/* ------------------------------------------------------------------ */

const finalConfig = await api(`/projects/${ref}/config/auth`)

say(`\n${B}Result${RESET}`)
say(`  Project ref   ${ref}`)
say(`  Project URL   ${projectUrl}`)
say(`  SITE_URL      ${finalConfig.site_url}`)
say(`  Redirects     ${String(finalConfig.uri_allow_list).split(',').join('\n                ')}`)
say(`  Google        ${finalConfig.external_google_enabled ? `${GREEN}enabled${RESET}` : `${YELLOW}not yet enabled${RESET}`}`)

if (!finalConfig.external_google_enabled) {
  say(`\n${B}One manual step — this is the only part that cannot be scripted:${RESET}`)
  say('')
  say('  1. Open https://console.cloud.google.com/apis/credentials')
  say('  2. Create credentials > OAuth client ID > Web application')
  say('  3. Under "Authorized redirect URIs", add exactly this line:')
  say('')
  say(`       ${B}${callback}${RESET}`)
  say('')
  say('  4. Create, then copy the Client ID and Client secret and re-run:')
  say('')
  say(`       SUPABASE_ACCESS_TOKEN=sbp_... \\`)
  say(`       GOOGLE_CLIENT_ID=... \\`)
  say(`       GOOGLE_CLIENT_SECRET=... \\`)
  say(`       node scripts/setup-supabase.mjs`)
  say('')
} else {
  say(`\n${GREEN}Google sign-in is configured.${RESET}`)
  say(`${DIM}Run "npm run dev" and click Continue with Google.${RESET}`)
  if (!productionUrl) {
    say(
      `${DIM}When you have a production URL, re-run with SITE_URL=https://your-domain to add it.${RESET}`,
    )
  }
  say('')
}
