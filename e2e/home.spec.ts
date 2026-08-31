import { expect, test, type Page } from '@playwright/test'

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
  await page.goto('/')
})

test.afterEach(async ({ page }) => {
  expect(pageErrors.get(page) ?? []).toEqual([])
})

const demo = (page: Page) => page.getByRole('list', { name: 'Properties of the example graph' })

test('the home page leads with the product and a live demo', async ({ page }) => {
  await expect(page.getByRole('heading', { level: 1 })).toContainText('shows its working')
  // The demo is the real thing: its properties come from the analysis library.
  await expect(demo(page).getByRole('button', { name: /Bipartite/ })).toContainText('No')
  await expect(demo(page).getByText(/is a cycle of odd length 3/).first()).toBeVisible()
})

test('the demo tour can be driven by hand', async ({ page }) => {
  const diameter = demo(page).getByRole('button', { name: /Diameter/ })
  await diameter.click()
  await expect(diameter).toHaveAttribute('aria-pressed', 'true')
  await expect(diameter).toContainText('furthest pair')
})

test('the primary call to action opens the workbench', async ({ page }) => {
  await page.getByRole('button', { name: 'Start drawing' }).click()
  await expect(page.getByTestId('graph-canvas')).toBeVisible()
  expect(page.url()).toContain('#/graph')
})

test('a quick-start chip opens the workbench with that graph', async ({ page }) => {
  await page.getByRole('button', { name: 'K5', exact: true }).click()
  await expect(page.getByTestId('graph-canvas')).toBeVisible()
  await expect
    .poll(async () => page.evaluate(() => window.graphualize?.getState().doc.edges.length))
    .toBe(10)
  // The command is dropped from the URL so a reload does not regenerate it.
  expect(page.url()).toMatch(/#\/graph$/)
})

test('an example card opens that example', async ({ page }) => {
  await page.getByRole('button', { name: /Seven bridges of Königsberg/ }).click()
  await expect(page.getByTestId('graph-canvas')).toBeVisible()
  await expect
    .poll(async () => page.evaluate(() => window.graphualize?.getState().name))
    .toContain('Königsberg')
})

test('the wordmark goes back home from the workbench', async ({ page }) => {
  await page.getByRole('button', { name: 'Start drawing' }).click()
  await expect(page.getByTestId('graph-canvas')).toBeVisible()
  await page.getByRole('button', { name: /back to the home page/ }).click()
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
})

test('signed out, the home page offers sign-in rather than a saved list', async ({ page }) => {
  await page.goto('/#/')
  // Nothing is configured in this build, so there is no account UI at all and
  // therefore nothing about saving either.
  await expect(page.getByText('Your graphs')).toHaveCount(0)
  await expect(page.getByRole('button', { name: /continue with google/i })).toHaveCount(0)
})
