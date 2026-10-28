import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ExportDialog } from './TransferDialogs'
import { useEditor } from '../state/store'
import { docFromEdges } from '../graph/model/builder'

const state = () => useEditor.getState()

const openTikz = async (user: ReturnType<typeof userEvent.setup>) => {
  render(<ExportDialog open />)
  const dialog = screen.getByRole('dialog', { name: 'Export graph' })
  await user.click(within(dialog).getByRole('button', { name: 'Drawing' }))
  await user.click(within(dialog).getByRole('button', { name: 'TikZ' }))
  return dialog
}

const source = (dialog: HTMLElement) => dialog.querySelector('pre')?.textContent ?? ''

// jsdom has no object URLs; the download test stands them in.
const { createObjectURL, revokeObjectURL } = URL

beforeEach(() => {
  window.localStorage.clear()
  state().newDocument()
  state().replaceDocument(docFromEdges(['A-B', 'B-C', 'C-A']), 'Triangle', { title: 'Triangle' })
})

afterEach(() => {
  vi.restoreAllMocks()
  URL.createObjectURL = createObjectURL
  URL.revokeObjectURL = revokeObjectURL
})

describe('Export dialog, TikZ', () => {
  it('previews the TikZ source of the open graph', async () => {
    const dialog = await openTikz(userEvent.setup())
    const tikz = source(dialog)
    expect(tikz).toContain('\\begin{tikzpicture}')
    expect(tikz.match(/\\node\[vertex\]/g)).toHaveLength(3)
    expect(tikz).not.toContain('\\documentclass')
    // PNG and the SVG-only toggles have no meaning for source code.
    expect(within(dialog).queryByRole('button', { name: /\.png$/ })).toBeNull()
    expect(within(dialog).queryByLabelText('Dark drawing')).toBeNull()
    expect(within(dialog).getByRole('button', { name: 'Download triangle.tex' })).toBeVisible()
  })

  it('wraps the picture in a document when asked', async () => {
    const user = userEvent.setup()
    const dialog = await openTikz(user)
    await user.click(within(dialog).getByRole('checkbox', { name: 'Standalone document' }))
    expect(source(dialog)).toContain('\\documentclass[tikz, border=4pt]{standalone}')
    expect(source(dialog)).toContain('\\end{document}')
  })

  it('copies exactly what it previews', async () => {
    const user = userEvent.setup()
    const dialog = await openTikz(user)
    await user.click(within(dialog).getByRole('button', { name: 'Copy' }))
    expect(await navigator.clipboard.readText()).toBe(source(dialog))
  })

  it('downloads the source as a .tex file', async () => {
    const user = userEvent.setup()
    const dialog = await openTikz(user)
    let saved: Blob | undefined
    URL.createObjectURL = vi.fn((blob: Blob) => {
      saved = blob
      return 'blob:tikz'
    })
    URL.revokeObjectURL = vi.fn()
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    await user.click(within(dialog).getByRole('button', { name: 'Download triangle.tex' }))
    expect(click).toHaveBeenCalledTimes(1)
    expect((click.mock.contexts[0] as HTMLAnchorElement).download).toBe('triangle.tex')
    expect(await saved?.text()).toBe(source(dialog))
  })

  it('carries the highlight on screen, and leaves it out when asked', async () => {
    const graph = state().graph
    state().setWitness('bipartite', {
      type: 'cycle',
      vertexIds: graph.vertices.map((v) => v.id),
      edgeIds: graph.edges.map((e) => e.id),
    })
    const user = userEvent.setup()
    const dialog = await openTikz(user)
    expect(source(dialog)).toContain('\\draw[edge, on cycle]')
    expect(source(dialog)).toContain('\\definecolor{gzcycle}')

    await user.click(within(dialog).getByRole('checkbox', { name: 'Keep the highlight' }))
    expect(source(dialog)).not.toContain('on cycle')
  })

  it('says when the labels need LuaLaTeX or XeLaTeX rather than pdfLaTeX', async () => {
    state().replaceDocument(docFromEdges(['東京-大阪', 'α-β′']), 'Rail', { title: 'Rail' })
    const user = userEvent.setup()
    const dialog = await openTikz(user)
    const note = within(dialog).getByRole('note')
    expect(note).toHaveTextContent('(東 京 大 阪)')
    expect(note).toHaveTextContent('compile with LuaLaTeX or XeLaTeX, with a CJK setup')
    // Greek letters and primes are written as math, which compiles anywhere.
    expect(note).not.toHaveTextContent('α')
    expect(source(dialog)).toContain('{$\\alpha$};')

    await user.click(within(dialog).getByRole('checkbox', { name: 'Standalone document' }))
    expect(source(dialog).split('\n')[0]).toBe('% !TEX program = lualatex')
  })

  it('has nothing to add when pdfLaTeX typesets every label', async () => {
    const dialog = await openTikz(userEvent.setup())
    expect(within(dialog).queryByRole('note')).toBeNull()
    expect(source(dialog)).not.toContain('LuaLaTeX')
  })

  it('still offers SVG and PNG first', async () => {
    const user = userEvent.setup()
    render(<ExportDialog open />)
    const dialog = screen.getByRole('dialog', { name: 'Export graph' })
    await user.click(within(dialog).getByRole('button', { name: 'Drawing' }))
    expect(dialog.querySelectorAll('svg circle')).toHaveLength(3)
    expect(within(dialog).getByRole('button', { name: 'Download triangle.svg' })).toBeVisible()
    expect(within(dialog).getByRole('button', { name: 'Download triangle.png' })).toBeVisible()
  })
})
