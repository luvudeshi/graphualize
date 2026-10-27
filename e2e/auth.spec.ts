import { expect, test, type Page } from '@playwright/test'

/**
 * These run against a build with no Supabase environment, which is the default
 * and the case that matters most: Graphualize has always been usable without an
 * account, and adding sign-in must not change that for anyone who never signs
 * in. The signed-in states are covered by component tests, which can mock a
 * session without a live project.
 */

const pageErrors = new WeakMap<Page, string[]>()

test.beforeEach(async ({ page }) => {
  const errors: string[] = []
  pageErrors.set(page, errors)
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().includes('net::')) {
      errors.push(message.text())
    }
  })
})

test.afterEach(async ({ page }) => {
  expect(pageErrors.get(page) ?? []).toEqual([])
})

test('an unconfigured build shows no account UI on either route', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await expect(page.getByRole('button', { name: /continue with google/i })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /account:/i })).toHaveCount(0)

  await page.goto('/#/graph')
  await expect(page.getByRole('button', { name: 'File' })).toBeVisible()
  await expect(page.getByRole('button', { name: /continue with google/i })).toHaveCount(0)
})

test('the full anonymous workflow is untouched by the auth layer', async ({ page }) => {
  await page.goto('/#/graph')

  // Generate, inspect, highlight a witness, undo — the core loop, signed out.
  await page.getByLabel('Quick graph command').fill('C5')
  await page.getByLabel('Quick graph command').press('Enter')
  await expect(page.getByText('Generated C5')).toBeVisible()

  const bipartite = page
    .locator('button')
    .filter({ has: page.locator('span', { hasText: /^Bipartite$/ }) })
    .first()
  await bipartite.click()
  await expect(page.getByText(/cycle of odd length 5/i)).toBeVisible()

  await page.keyboard.press('Control+z')
  await expect(page.getByText(/Undo generate c5/i)).toBeVisible()
})

test('the tool works fully without an account', async ({ page }) => {
  // "Anonymous usage keeps working" means the whole workbench: drawing,
  // analysing, exporting and saving (to this browser) all work signed out.
  await page.goto('/#/graph')
  await page.getByLabel('Quick graph command').fill('K4')
  await page.getByLabel('Quick graph command').press('Enter')
  await expect(page.getByText('Generated K4')).toBeVisible()

  // Analysis works.
  const bipartite = page
    .locator('button')
    .filter({ has: page.locator('span', { hasText: /^Bipartite$/ }) })
    .first()
  await bipartite.click()
  await expect(page.getByText(/cycle of odd length 3/i)).toBeVisible()

  // Export works, so there is always a way to keep a graph without an account.
  await page.getByRole('button', { name: 'File' }).click()
  await page.getByRole('menuitem', { name: /^Export/ }).click()
  await expect(page.getByRole('dialog', { name: 'Export graph' })).toContainText('graph')
  await page.keyboard.press('Escape')

  // But nothing is written to this browser, and a reload starts clean.
  await page.reload()
  await expect(page.getByTestId('graph-canvas')).toBeVisible()
  await expect(page.getByLabel('Graph name')).toHaveValue('Untitled graph')
})

test('no Supabase network call is made when auth is unconfigured', async ({ page }) => {
  const supabaseCalls: string[] = []
  await page.route('**/*', (route) => {
    const url = route.request().url()
    if (url.includes('supabase.co') || url.includes('supabase.com')) supabaseCalls.push(url)
    return route.continue()
  })

  await page.goto('/#/graph')
  await page.getByLabel('Quick graph command').fill('K4')
  await page.getByLabel('Quick graph command').press('Enter')
  await page.waitForTimeout(500)

  expect(supabaseCalls).toEqual([])
})
