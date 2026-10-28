import { expect, test, type Page } from '@playwright/test'

/** The facts about the open graph a share link has to carry. */
const readGraph = (page: Page) =>
  page.evaluate(() => {
    const state = window.graphualize?.getState()
    if (!state) throw new Error('Graphualize automation hook is missing.')
    return {
      name: state.name,
      labels: state.doc.vertices.map((v) => v.label),
      edgeCount: state.doc.edges.length,
      weights: state.doc.edges.map((e) => e.weight ?? null),
      directed: state.doc.directed,
      weighted: state.doc.weighted,
    }
  })

/** Every test asserts the page never threw. */
const watchErrors = (page: Page) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().includes('net::')) errors.push(message.text())
  })
  return errors
}

test('a copied share link opens the same graph in another tab', async ({ page, context, baseURL }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: baseURL })
  const errors = watchErrors(page)

  await page.goto('/#/graph?g=petersen')
  await expect.poll(async () => (await readGraph(page)).labels.length).toBe(10)
  await page.evaluate(() => {
    const state = window.graphualize!.getState()
    state.setDirected(true)
    state.setWeighted(true)
    state.setEdgeWeight(state.doc.edges[0]!.id, 4.5)
    window.graphualize!.getState().renameVertex(state.doc.vertices[0]!.id, 'Zürich 東京')
    window.graphualize!.getState().setName('Shared “Petersen”')
  })
  const sent = await readGraph(page)

  await page.getByRole('button', { name: 'File' }).click()
  await page.getByRole('menuitem', { name: 'Copy share link' }).click()
  await expect(page.getByRole('status')).toHaveText('Link copied')
  const url = await page.evaluate(() => navigator.clipboard.readText())
  expect(url).toMatch(/#\/graph\?d=1[jz]\.[A-Za-z0-9_-]+$/)

  const other = await context.newPage()
  const otherErrors = watchErrors(other)
  await other.goto(url)
  await expect.poll(async () => (await readGraph(other)).labels.length).toBe(10)
  expect(await readGraph(other)).toEqual(sent)
  await expect(other.getByRole('status')).toHaveText(/Opened shared graph/)
  // Consumed once and dropped from the address bar, like every arrival command.
  expect(new URL(other.url()).hash).toBe('#/graph')

  expect([...errors, ...otherErrors]).toEqual([])
})

test('a damaged share link says so and leaves the canvas empty', async ({ page }) => {
  const errors = watchErrors(page)
  await page.goto('/#/graph?d=1z.this-is-not-a-graph')
  await expect(page.getByRole('status')).toHaveText(/This share link cannot be opened/)
  expect((await readGraph(page)).labels).toEqual([])
  expect(new URL(page.url()).hash).toBe('#/graph')
  expect(errors).toEqual([])
})
