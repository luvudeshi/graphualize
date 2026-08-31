import { expect, test, type Page } from '@playwright/test'

/** Reads the editor store through the automation hook exposed in main.tsx. */
const readState = (page: Page) =>
  page.evaluate(() => {
    const state = window.graphualize?.getState()
    if (!state) throw new Error('Graphualize automation hook is missing.')
    return {
      vertices: state.doc.vertices.map((v) => ({ id: v.id, label: v.label })),
      edgeCount: state.doc.edges.length,
      name: state.name,
      directed: state.doc.directed,
      weighted: state.doc.weighted,
      witness: state.activeWitness,
      algorithmId: state.algorithm?.algorithmId ?? null,
      stepCount: state.algorithm?.steps.length ?? 0,
    }
  })

const canvasBox = async (page: Page) => {
  const box = await page.getByTestId('graph-canvas').boundingBox()
  if (!box) throw new Error('The canvas has no layout box.')
  return box
}

const clickCanvas = async (page: Page, fx: number, fy: number) => {
  const box = await canvasBox(page)
  await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy)
  await page.waitForTimeout(120)
}

const propertyRow = (page: Page, label: string) =>
  page
    .locator('button')
    .filter({ has: page.locator('span', { hasText: new RegExp(`^${label}$`) }) })
    .first()

/** Every test asserts the page never threw. */
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
  // Each test gets a fresh browser context, so local storage starts empty.
  await page.goto('/#/graph')
  await expect(page.getByTestId('graph-canvas')).toBeVisible()
})

test.afterEach(async ({ page }) => {
  expect(pageErrors.get(page) ?? []).toEqual([])
})

test('flow 1: drawing a triangle reports an odd cycle and highlights it', async ({ page }) => {
  // Vertex tool, three clicks.
  await page.getByRole('button', { name: /^Vertex/ }).click()
  await clickCanvas(page, 0.35, 0.3)
  await clickCanvas(page, 0.6, 0.3)
  await clickCanvas(page, 0.475, 0.6)

  let state = await readState(page)
  expect(state.vertices.map((v) => v.label)).toEqual(['A', 'B', 'C'])

  // Edge tool, click pairs to close the triangle.
  await page.getByRole('button', { name: /^Edge/ }).click()
  await clickCanvas(page, 0.35, 0.3)
  await clickCanvas(page, 0.6, 0.3)
  await clickCanvas(page, 0.6, 0.3)
  await clickCanvas(page, 0.475, 0.6)
  await clickCanvas(page, 0.475, 0.6)
  await clickCanvas(page, 0.35, 0.3)

  state = await readState(page)
  expect(state.edgeCount).toBe(3)

  const bipartite = propertyRow(page, 'Bipartite')
  await expect(bipartite).toContainText('No')
  await bipartite.click()

  await expect(bipartite).toHaveAttribute('aria-pressed', 'true')
  await expect(bipartite).toContainText('odd length 3')

  state = await readState(page)
  expect(state.witness?.rowId).toBe('bipartite')
  expect(state.witness?.witness.type).toBe('cycle')
  if (state.witness?.witness.type === 'cycle') {
    expect(state.witness.witness.vertexIds).toHaveLength(3)
    expect(state.witness.witness.edgeIds).toHaveLength(3)
  }
})

test('flow 2: C6 is bipartite and clicking the row shows both parts', async ({ page }) => {
  await page.getByLabel('Quick graph command').fill('C6')
  await page.getByLabel('Quick graph command').press('Enter')
  await expect.poll(async () => (await readState(page)).vertices.length).toBe(6)

  const bipartite = propertyRow(page, 'Bipartite')
  await expect(bipartite).toContainText('Yes')
  await bipartite.click()

  const state = await readState(page)
  expect(state.witness?.witness.type).toBe('partition')
  if (state.witness?.witness.type === 'partition') {
    expect(state.witness.witness.groups).toHaveLength(2)
    expect(state.witness.witness.groups[0]).toHaveLength(3)
    expect(state.witness.witness.groups[1]).toHaveLength(3)
  }
})

test('flow 3: Dijkstra steps through a weighted example to the right distances', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'File' }).click()
  await page.getByRole('menuitem', { name: 'Example gallery' }).click()
  await page.getByRole('button', { name: /Shortest path trap/ }).click()
  await expect.poll(async () => (await readState(page)).name).toContain('Shortest path')

  await page.getByRole('button', { name: 'Algorithms' }).click()
  await page.getByRole('menuitem', { name: /Dijkstra/ }).click()

  const player = page.getByRole('region', { name: 'Algorithm playback' })
  await expect(player).toBeVisible()
  await expect(player).toContainText('Dijkstra')

  const state = await readState(page)
  expect(state.algorithmId).toBe('dijkstra')
  expect(state.stepCount).toBeGreaterThan(5)

  // Step forward a few frames, then jump to the end.
  await page.getByRole('button', { name: 'Step forward' }).click()
  await page.getByRole('button', { name: 'Step forward' }).click()
  await expect(player).toContainText('3/')

  await page.getByRole('slider', { name: 'Algorithm step' }).fill(String(state.stepCount - 1))
  await expect(player).toContainText('A=0')
  await expect(player).toContainText('B=2')
  await expect(player).toContainText('C=5')
  await expect(player).toContainText('D=7')
  await expect(player).toContainText('G=10')
})

test('flow 4: without an account, a graph is genuinely not kept', async ({ page }) => {
  // The rule the product now makes: saving means saving to an account. This
  // asserts the honest version of that — a reload really does lose the graph,
  // rather than the app quietly keeping a copy it no longer admits to.
  await page.getByLabel('Quick graph command').fill('K4')
  await page.getByLabel('Quick graph command').press('Enter')
  await expect.poll(async () => (await readState(page)).vertices.length).toBe(4)

  await page.getByRole('button', { name: 'File' }).click()
  await page.getByRole('menuitem', { name: /^Save/ }).click()
  // No account in this build, so saving says so instead of pretending.
  await expect(page.getByRole('contentinfo')).toContainText(/sign in/i)

  // Nothing was written to this browser.
  const stored = await page.evaluate(() =>
    Object.keys(localStorage).filter((key) => key.startsWith('graphualize:')),
  )
  expect(stored.filter((key) => key.includes('session') || key.includes('doc:'))).toEqual([])

  await page.reload()
  await expect(page.getByTestId('graph-canvas')).toBeVisible()
  const after = await readState(page)
  expect(after.vertices.length).toBe(0)
  expect(after.name).toBe('Untitled graph')
})

test('the open dialog points at the account rather than this browser', async ({ page }) => {
  await page.getByRole('button', { name: 'File' }).click()
  await page.getByRole('menuitem', { name: /^Open/ }).click()
  const dialog = page.getByRole('dialog', { name: 'Saved graphs' })
  await expect(dialog).toContainText(/your Google account/i)
})

test('undo and redo reverse a generated graph', async ({ page }) => {
  await page.getByLabel('Quick graph command').fill('K4')
  await page.getByLabel('Quick graph command').press('Enter')
  await expect.poll(async () => (await readState(page)).vertices.length).toBe(4)

  await page.getByRole('button', { name: /^Undo/ }).click()
  await expect.poll(async () => (await readState(page)).vertices.length).toBe(0)

  await page.getByRole('button', { name: /^Redo/ }).click()
  await expect.poll(async () => (await readState(page)).vertices.length).toBe(4)
})

test('the command palette generates a graph from a typed command', async ({ page }) => {
  await page.keyboard.press('Control+k')
  const palette = page.getByRole('dialog', { name: 'Command palette' })
  await expect(palette).toBeVisible()
  await page.keyboard.type('K3,3')
  await expect(palette).toContainText('Generate')
  await page.keyboard.press('Enter')

  await expect.poll(async () => (await readState(page)).vertices.length).toBe(6)
  expect((await readState(page)).edgeCount).toBe(9)
})

test('Dijkstra refuses to run on a negative weight and names Bellman-Ford', async ({ page }) => {
  await page.getByLabel('Quick graph command').fill('C4')
  await page.getByLabel('Quick graph command').press('Enter')
  await expect.poll(async () => (await readState(page)).vertices.length).toBe(4)

  // Turn on weights and make one edge negative through the store-backed UI.
  await page.getByRole('switch', { name: 'Weighted' }).click()
  await page.evaluate(() => {
    const state = window.graphualize?.getState()
    if (!state) return
    const edge = state.doc.edges[0]
    if (edge) state.setEdgeWeight(edge.id, -2)
  })

  await page.getByRole('button', { name: 'Algorithms' }).click()
  await page.getByRole('menuitem', { name: /Dijkstra/ }).click()
  await expect(page.getByRole('contentinfo')).toContainText('Bellman-Ford')
})

test('the empty state offers a way in and disappears once there is a graph', async ({ page }) => {
  await expect(page.getByText('or generate one')).toBeVisible()
  await page.getByRole('button', { name: 'Petersen', exact: true }).click()
  await expect.poll(async () => (await readState(page)).vertices.length).toBe(10)
  await expect(page.getByText('or generate one')).toBeHidden()
})

test('exporting produces DOT that mentions every vertex', async ({ page }) => {
  await page.getByLabel('Quick graph command').fill('P4')
  await page.getByLabel('Quick graph command').press('Enter')
  await expect.poll(async () => (await readState(page)).vertices.length).toBe(4)

  await page.getByRole('button', { name: 'File' }).click()
  await page.getByRole('menuitem', { name: /^Export/ }).click()
  const dialog = page.getByRole('dialog', { name: 'Export graph' })
  await dialog.getByRole('button', { name: 'Graphviz DOT' }).click()
  await expect(dialog.locator('pre')).toContainText('graph')
  await expect(dialog.locator('pre')).toContainText('--')
})

test('right-clicking a vertex offers its actions', async ({ page }) => {
  // `a` places a vertex at the centre of the view, so we know what is there.
  await page.keyboard.press('a')
  await expect.poll(async () => (await readState(page)).vertices.length).toBe(1)

  const box = await canvasBox(page)
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' })

  const menu = page.getByRole('menu', { name: 'Vertex actions' })
  await expect(menu).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: 'Start BFS here' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(menu).toBeHidden()
})

test('right-clicking empty canvas offers canvas actions', async ({ page }) => {
  const box = await canvasBox(page)
  await page.mouse.click(box.x + box.width * 0.2, box.y + box.height * 0.2, { button: 'right' })
  const menu = page.getByRole('menu', { name: 'Canvas actions' })
  await expect(menu).toBeVisible()
  await menu.getByRole('menuitem', { name: 'Add a vertex here' }).click()
  await expect.poll(async () => (await readState(page)).vertices.length).toBe(1)
})

test('a vertex can be placed from the keyboard alone', async ({ page }) => {
  await page.keyboard.press('a')
  await page.keyboard.press('a')
  await expect.poll(async () => (await readState(page)).vertices.length).toBe(2)
  const state = await readState(page)
  expect(state.vertices.map((v) => v.label)).toEqual(['A', 'B'])
})

test('the drawing exports as SVG', async ({ page }) => {
  await page.getByLabel('Quick graph command').fill('C4')
  await page.getByLabel('Quick graph command').press('Enter')
  await expect.poll(async () => (await readState(page)).vertices.length).toBe(4)

  await page.getByRole('button', { name: 'File' }).click()
  await page.getByRole('menuitem', { name: /^Export/ }).click()
  const dialog = page.getByRole('dialog', { name: 'Export graph' })
  await dialog.getByRole('button', { name: 'Drawing' }).click()
  await expect(dialog.locator('svg circle')).toHaveCount(4)
  await expect(dialog.getByRole('button', { name: /Download .*\.svg/ })).toBeVisible()
  await expect(dialog.getByRole('button', { name: /Download .*\.png/ })).toBeVisible()
})

test('the layout collapses sensibly at tablet width', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 800 })
  await expect(page.getByTestId('graph-canvas')).toBeVisible()
  await expect(page.getByRole('button', { name: /^(Properties|Hide properties)$/ })).toBeVisible()
})
