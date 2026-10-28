import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { GraphBuilder, docFromEdges } from '../graph/model/builder'
import type { GraphDocument } from '../graph/model/types'

// Copying a share link (File menu, palette, the fallback dialog) and opening
// one on arrival. Cytoscape needs a real canvas, which jsdom does not provide,
// so the workbench is rendered around a stand-in for it.
vi.mock('../canvas/GraphCanvas', () => ({ GraphCanvas: () => <div data-testid="canvas" /> }))

const { useEditor } = await import('./store')
const { useUi } = await import('./ui')
const { copyShareLink, openSharedGraph, LONG_SHARE_LINK } = await import('./share')
const { encodeShareCode, decodeShareCode } = await import('../graph/serialization/link')
const { parseRoute, shareHash } = await import('../app/router')
const { MenuBar } = await import('../components/MenuBar')
const { CommandPalette } = await import('../components/CommandPalette')
const { ShareLinkDialog } = await import('../components/ShareLinkDialog')
const { App } = await import('../App')

const state = () => useEditor.getState()

/** Replaces `navigator.clipboard`; `undefined` removes it, as on an insecure page. */
const setClipboard = (clipboard: Partial<Clipboard> | undefined) => {
  Object.defineProperty(window.navigator, 'clipboard', {
    configurable: true,
    get: () => clipboard,
  })
}

/** A clipboard whose `writeText` succeeds, with the mock to assert on. */
const workingClipboard = () => {
  const writeText = vi.fn<(text: string) => Promise<void>>(() => Promise.resolve())
  setClipboard({ writeText })
  return writeText
}

const triangle = (): GraphDocument => {
  const builder = new GraphBuilder({ weighted: true })
  builder.addEdgeByLabel('A', 'B', 3)
  builder.addEdgeByLabel('B', 'C', 5)
  builder.addEdgeByLabel('C', 'A', 8)
  return builder.build()
}

/** The graph a copied URL carries, read back the way an arriving visitor's would be. */
const graphIn = async (url: string) => {
  const route = parseRoute(new URL(url).hash)
  expect(route.name).toBe('editor')
  const result = await decodeShareCode(route.shared)
  if (!result.ok) throw new Error(result.reason)
  return result
}

const labelsOf = (doc: GraphDocument) => doc.vertices.map((v) => v.label)

const codeFor = async (doc: GraphDocument, name: string) => {
  const result = await encodeShareCode({ name, doc })
  if (!result.ok) throw new Error(result.reason)
  return result.code
}

beforeEach(() => {
  window.localStorage.clear()
  window.history.replaceState(null, '', '/')
  state().newDocument()
  useUi.setState({ dialog: null, shareLink: null })
  state().setCommandPaletteOpen(false)
})

afterEach(() => {
  vi.unstubAllGlobals()
  setClipboard(undefined)
})

describe('copying a share link', () => {
  it('copies a link to this page that opens the graph on screen', async () => {
    const writeText = workingClipboard()
    state().replaceDocument(triangle(), 'Triangle', { title: 'Weighted triangle' })

    expect(await copyShareLink()).toBe(true)

    expect(writeText).toHaveBeenCalledTimes(1)
    const url = writeText.mock.calls[0]![0]
    const { protocol, host, pathname } = window.location
    expect(url.startsWith(`${protocol}//${host}${pathname}#/graph?d=1`)).toBe(true)
    expect(state().status).toMatchObject({ text: 'Link copied', tone: 'success' })

    const shared = await graphIn(url)
    expect(shared.name).toBe('Weighted triangle')
    expect(labelsOf(shared.document)).toEqual(['A', 'B', 'C'])
    expect(shared.document.weighted).toBe(true)
    expect(shared.document.edges.map((e) => e.weight)).toEqual([3, 5, 8])
  })

  it('leaves the query string out, so a sign-in code can never travel in a link', async () => {
    const writeText = workingClipboard()
    window.history.replaceState(null, '', '/app/?code=secret-oauth-code#/graph')
    state().replaceDocument(triangle(), 'Triangle')
    await copyShareLink()
    const url = writeText.mock.calls[0]![0]
    expect(url).not.toContain('secret')
    expect(new URL(url).pathname).toBe('/app/')
  })

  it('says how long a long link is, since some apps cut long links short', async () => {
    const writeText = workingClipboard()
    // Labels that do not compress, so the link is long for its size.
    const builder = new GraphBuilder()
    let seed = 11
    for (let i = 0; i < 300; i++) {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0
      builder.addVertex(`${seed.toString(36)}${i}`, i * 7, (i * 13) % 400)
    }
    state().replaceDocument(builder.build(), 'Noise')
    await copyShareLink()
    const url = writeText.mock.calls[0]![0]
    expect(url.length).toBeGreaterThan(LONG_SHARE_LINK)
    expect(state().status?.text).toMatch(/^Link copied\. It is [\d,]+ characters long/)
  })

  it('has nothing to share on an empty canvas', async () => {
    const writeText = workingClipboard()
    expect(await copyShareLink()).toBe(false)
    expect(writeText).not.toHaveBeenCalled()
    expect(state().status).toMatchObject({ tone: 'error', text: expect.stringMatching(/nothing to share/) })
  })

  it('says a graph is too large for a link instead of copying a broken one', async () => {
    const writeText = workingClipboard()
    const builder = new GraphBuilder()
    for (let i = 0; i < 2500; i++) builder.addVertex(`v${i}`)
    state().replaceDocument(builder.build(), 'Big')
    expect(await copyShareLink()).toBe(false)
    expect(writeText).not.toHaveBeenCalled()
    expect(state().status?.tone).toBe('error')
    expect(state().status?.text).toMatch(/cannot be shared as a link: it has 2,500 vertices.*Export it as a file/)
    expect(useUi.getState().shareLink).toBeNull()
  })

  it('shows the link to copy by hand when there is no clipboard at all', async () => {
    setClipboard(undefined)
    state().replaceDocument(triangle(), 'Triangle')
    expect(await copyShareLink()).toBe(false)

    const url = useUi.getState().shareLink
    expect(url).toContain('#/graph?d=')
    const { unmount } = render(<ShareLinkDialog />)
    const field = screen.getByRole('textbox', { name: 'Share link' })
    expect(field).toHaveValue(url)
    // Focused and selected, ready for the copy shortcut.
    expect(field).toHaveFocus()
    const input = field as HTMLInputElement
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, url!.length])

    // Leaving the workbench withdraws it, so it cannot reappear over another graph.
    unmount()
    expect(useUi.getState().shareLink).toBeNull()
  })

  it('shows the link when the clipboard refuses, and its Copy button tries again', async () => {
    // user-event installs a clipboard of its own, so it goes first.
    const user = userEvent.setup()
    const writeText = vi.fn<(text: string) => Promise<void>>(() =>
      Promise.reject(new DOMException('Denied', 'NotAllowedError')),
    )
    setClipboard({ writeText })
    state().replaceDocument(triangle(), 'Triangle')
    await copyShareLink()
    const url = useUi.getState().shareLink!
    expect(url).toBeTruthy()

    render(<ShareLinkDialog />)
    // Still refused: the dialog stays, and says what to do instead.
    await user.click(screen.getByRole('button', { name: 'Copy' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/Copying is blocked here/)

    // Allowed on the second try: copied, confirmed, and the dialog goes.
    const allowed = workingClipboard()
    await user.click(screen.getByRole('button', { name: 'Copy' }))
    expect(allowed).toHaveBeenCalledWith(url)
    await waitFor(() => expect(useUi.getState().shareLink).toBeNull())
    expect(state().status?.text).toBe('Link copied')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('asks for the clipboard during the click where ClipboardItem exists, for Safari', async () => {
    class FakeClipboardItem {
      constructor(readonly items: Record<string, Promise<Blob>>) {}
    }
    vi.stubGlobal('ClipboardItem', FakeClipboardItem)
    const written: string[] = []
    const write = vi.fn(async (items: FakeClipboardItem[]) => {
      const blob = await items[0]!.items['text/plain']!
      written.push(await blob.text())
    })
    const writeText = vi.fn(() => Promise.resolve())
    setClipboard({ write, writeText } as unknown as Clipboard)
    state().replaceDocument(triangle(), 'Triangle')

    const copied = copyShareLink()
    // Requested synchronously, before the link has even been encoded.
    expect(write).toHaveBeenCalledTimes(1)
    expect(await copied).toBe(true)
    expect(writeText).not.toHaveBeenCalled()
    expect(written).toHaveLength(1)
    expect(labelsOf((await graphIn(written[0]!)).document)).toEqual(['A', 'B', 'C'])
  })
})

describe('where copying a share link lives', () => {
  it('is in the File menu, disabled while there is nothing to share', async () => {
    const user = userEvent.setup()
    const writeText = workingClipboard()
    render(<MenuBar />)

    await user.click(screen.getByRole('button', { name: 'File' }))
    const item = screen.getByRole('menuitem', { name: 'Copy share link' })
    expect(item).toBeDisabled()

    act(() => state().replaceDocument(triangle(), 'Triangle', { title: 'From the menu' }))
    expect(item).toBeEnabled()
    await user.click(item)

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
    expect((await graphIn(writeText.mock.calls[0]![0])).name).toBe('From the menu')
    await waitFor(() => expect(state().status?.text).toBe('Link copied'))
  })

  it('is in the command palette', async () => {
    // jsdom has no layout, so it has no scrolling either.
    if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {}
    const user = userEvent.setup()
    const writeText = workingClipboard()
    state().replaceDocument(triangle(), 'Triangle')
    state().setCommandPaletteOpen(true)
    render(<CommandPalette />)

    await user.type(screen.getByRole('combobox', { name: 'Command search' }), 'share link')
    expect(screen.getAllByRole('option')[0]).toHaveTextContent('Copy share link')
    await user.keyboard('{Enter}')

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
    expect(state().commandPaletteOpen).toBe(false)
    await waitFor(() => expect(state().status?.text).toBe('Link copied'))
  })
})

describe('opening a share link', () => {
  it('opens the graph as a new, undoable replacement named from the link', async () => {
    state().replaceDocument(docFromEdges(['X-Y']), 'Before')
    const before = state().doc
    const code = await codeFor(triangle(), 'Homework 4')

    expect(await openSharedGraph(code)).toBe(true)

    expect(labelsOf(state().doc)).toEqual(['A', 'B', 'C'])
    expect(state().name).toBe('Homework 4')
    expect(state().savedId).toBeNull()
    expect(state().viewRequest?.kind).toBe('fit')
    expect(state().status).toMatchObject({ tone: 'success', text: 'Opened shared graph "Homework 4"' })

    state().undo()
    expect(state().doc).toEqual(before)
  })

  it('leaves the canvas alone and says why when the link is damaged', async () => {
    state().replaceDocument(docFromEdges(['X-Y']), 'Before')
    const before = state().doc
    const history = state().past.length

    expect(await openSharedGraph('1z.not-a-real-graph')).toBe(false)

    expect(state().doc).toBe(before)
    expect(state().past).toHaveLength(history)
    expect(state().status?.tone).toBe('error')
    expect(state().status?.text).toMatch(/^This share link cannot be opened: it is damaged or incomplete/)
  })
})

describe('arriving at the workbench by share link', () => {
  it('opens the graph, fits it, and strips the link from the address bar', async () => {
    const code = await codeFor(triangle(), 'Sent to you')
    window.history.replaceState(null, '', `/${shareHash(code)}`)

    render(<App />)

    await waitFor(() => expect(labelsOf(state().doc)).toEqual(['A', 'B', 'C']))
    expect(state().name).toBe('Sent to you')
    expect(state().doc.weighted).toBe(true)
    expect(state().viewRequest?.kind).toBe('fit')
    expect(window.location.hash).toBe('#/graph')
    expect(await screen.findByText('Opened shared graph "Sent to you"')).toBeInTheDocument()
  })

  it('reports a malformed link and leaves the canvas empty', async () => {
    window.history.replaceState(null, '', '/#/graph?d=1j.%7B%22v%22%3A')

    render(<App />)

    expect(
      await screen.findByText(/This share link cannot be opened: it is damaged or incomplete/),
    ).toBeInTheDocument()
    expect(state().doc.vertices).toHaveLength(0)
    expect(state().past).toHaveLength(0)
    expect(window.location.hash).toBe('#/graph')
  })
})
