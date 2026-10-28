import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEffect } from 'react'
import { docFromEdges } from '../graph/model/builder'

// New and Open throwing away unsaved work: the guard, the dialog that asks,
// and every way into it (menu, palette, shortcut, Open dialog).
vi.mock('../sync/cloud', () => import('../test/fakeCloud'))

const { __fake } = await import('../test/fakeCloud')
const { useEditor, setSignedInProbe } = await import('./store')
const { useUi } = await import('./ui')
const { hasUnsavedWork, replaceWorkingGraph, preapproveReplacement } = await import('./replace')
const { ConfirmReplace } = await import('../components/ConfirmReplace')
const { SaveDialog } = await import('../components/SaveDialog')
const { DocumentsDialog } = await import('../components/DocumentsDialog')
const { useShortcuts } = await import('../hooks/useShortcuts')
const { saveDocument, listDocuments } = await import('./documents')

const state = () => useEditor.getState()
let signedIn = false

/** Puts unsaved work on the canvas: a triangle nobody has saved. */
const drawUnsaved = () => {
  state().replaceDocument(docFromEdges(['A-B', 'B-C', 'C-A']), 'Triangle')
  state().addVertexAt(5, 5)
}

beforeEach(() => {
  window.localStorage.clear()
  __fake.reset()
  signedIn = false
  setSignedInProbe(() => signedIn)
  state().newDocument()
  useUi.setState({ dialog: null, pendingReplacement: null })
})

describe('the guard', () => {
  it('replaces straight away when nothing would be lost', () => {
    state().replaceDocument(docFromEdges(['A-B']), 'Edge')
    state().saveCurrent('Kept')
    replaceWorkingGraph({ kind: 'new' })
    expect(useUi.getState().pendingReplacement).toBeNull()
    expect(state().doc.vertices).toHaveLength(0)
  })

  it('treats an empty canvas as nothing to lose, even if it is marked changed', () => {
    state().addVertexAt(1, 1)
    state().deleteElements(state().doc.vertices.map((v) => v.id), [])
    expect(state().dirty).toBe(true)
    expect(hasUnsavedWork()).toBe(false)
  })

  it('asks instead of replacing when there is unsaved work', () => {
    drawUnsaved()
    replaceWorkingGraph({ kind: 'new' })
    expect(useUi.getState().pendingReplacement).toEqual({ kind: 'new' })
    expect(state().doc.vertices).toHaveLength(4)
  })
})

describe('the confirmation', () => {
  it('Cancel keeps the graph exactly as it was', async () => {
    const user = userEvent.setup()
    drawUnsaved()
    const before = state().doc
    render(<ConfirmReplace />)
    replaceWorkingGraph({ kind: 'new' })
    await user.click(await screen.findByRole('button', { name: 'Cancel' }))
    expect(state().doc).toBe(before)
    expect(state().dirty).toBe(true)
    expect(useUi.getState().pendingReplacement).toBeNull()
  })

  it('names what is being replaced and what is replacing it', async () => {
    drawUnsaved()
    state().setName('Homework 4')
    render(<ConfirmReplace />)
    replaceWorkingGraph({ kind: 'open', id: 'x', source: 'local', name: 'Petersen' })
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('Opening “Petersen” replaces “Homework 4”')
  })

  it('Discard changes goes ahead', async () => {
    const user = userEvent.setup()
    drawUnsaved()
    render(<ConfirmReplace />)
    replaceWorkingGraph({ kind: 'new' })
    await user.click(await screen.findByRole('button', { name: 'Discard changes' }))
    expect(state().doc.vertices).toHaveLength(0)
  })

  it('Save first on a graph never saved asks for its name, then goes ahead', async () => {
    const user = userEvent.setup()
    drawUnsaved()
    state().setName('Worth keeping')
    render(
      <>
        <ConfirmReplace />
        <SaveDialog />
      </>,
    )
    replaceWorkingGraph({ kind: 'new' })
    await user.click(await screen.findByRole('button', { name: 'Save first' }))
    const dialog = await screen.findByRole('dialog', { name: 'Save graph' })
    expect(state().doc.vertices).toHaveLength(4)
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(state().doc.vertices).toHaveLength(0))
    expect(listDocuments().map((entry) => entry.name)).toEqual(['Worth keeping'])
  })

  it('cancelling that name dialog keeps the graph and forgets the New', async () => {
    const user = userEvent.setup()
    drawUnsaved()
    render(
      <>
        <ConfirmReplace />
        <SaveDialog />
      </>,
    )
    replaceWorkingGraph({ kind: 'new' })
    await user.click(await screen.findByRole('button', { name: 'Save first' }))
    await user.click(await screen.findByRole('button', { name: 'Cancel' }))
    expect(state().doc.vertices).toHaveLength(4)
    expect(useUi.getState().afterSave).toBeNull()
  })

  it('Save first on a saved graph saves, then goes ahead', async () => {
    const user = userEvent.setup()
    drawUnsaved()
    await state().saveCurrent('Saved before')
    state().addVertexAt(7, 7)
    render(<ConfirmReplace />)
    replaceWorkingGraph({ kind: 'new' })
    await user.click(await screen.findByRole('button', { name: 'Save first' }))
    await waitFor(() => expect(state().doc.vertices).toHaveLength(0))
    expect(listDocuments()[0]!.vertexCount).toBe(5)
  })

  it('Save first replaces nothing when the save fails', async () => {
    const user = userEvent.setup()
    signedIn = true
    drawUnsaved()
    await state().saveCurrent('Saved before')
    state().addVertexAt(7, 7)
    __fake.failNextCall('This account is not allowed to do that.')
    render(<ConfirmReplace />)
    replaceWorkingGraph({ kind: 'new' })
    await user.click(await screen.findByRole('button', { name: 'Save first' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/nothing was replaced/i)
    expect(state().doc.vertices).toHaveLength(5)
    expect(useUi.getState().pendingReplacement).toEqual({ kind: 'new' })
  })

  it('opens the chosen graph once confirmed', async () => {
    const user = userEvent.setup()
    saveDocument({ id: 'saved-1', name: 'Saved one', graph: docFromEdges(['X-Y']) })
    drawUnsaved()
    render(<ConfirmReplace />)
    replaceWorkingGraph({ kind: 'open', id: 'saved-1', source: 'local', name: 'Saved one' })
    await user.click(await screen.findByRole('button', { name: 'Discard changes' }))
    await waitFor(() => expect(state().name).toBe('Saved one'))
    expect(state().savedId).toBe('saved-1')
  })
})

describe('every way in is guarded', () => {
  const Shortcuts = () => {
    useShortcuts()
    useEffect(() => {}, [])
    return null
  }

  it('Cmd/Ctrl+N asks before discarding', () => {
    drawUnsaved()
    render(<Shortcuts />)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', ctrlKey: true, bubbles: true }))
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', ctrlKey: true, bubbles: true }))
    expect(useUi.getState().pendingReplacement).toEqual({ kind: 'new' })
    expect(state().doc.vertices).toHaveLength(4)
  })

  it('picking a graph in the Open dialog asks before discarding', async () => {
    const user = userEvent.setup()
    saveDocument({ id: 'saved-1', name: 'Saved one', graph: docFromEdges(['X-Y']) })
    drawUnsaved()
    await state().refreshDocuments()
    render(<DocumentsDialog open />)
    await user.click(screen.getByRole('button', { name: /^Saved one/ }))
    expect(useUi.getState().pendingReplacement).toEqual({
      kind: 'open',
      id: 'saved-1',
      source: 'local',
      name: 'Saved one',
    })
    expect(state().doc.vertices).toHaveLength(4)
  })
})

describe('deleting from the Open dialog', () => {
  const openDialogWith = async (names: string[]) => {
    names.forEach((name, index) =>
      saveDocument({ id: `doc-${index}`, name, graph: docFromEdges(['A-B']) }),
    )
    await state().refreshDocuments()
    useUi.setState({ dialog: 'documents' })
    return render(<DocumentsDialog open />)
  }

  it('asks once more before deleting, and Cancel keeps it', async () => {
    const user = userEvent.setup()
    await openDialogWith(['Keep me'])
    await user.click(screen.getByRole('button', { name: 'Delete Keep me' }))
    expect(listDocuments()).toHaveLength(1)
    expect(screen.getByText(/from this browser\?/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(listDocuments()).toHaveLength(1)
  })

  it('deletes on the second click, and Undo puts it back exactly', async () => {
    const user = userEvent.setup()
    await openDialogWith(['Doomed'])
    const original = window.localStorage.getItem('graphualize:doc:doc-0')
    const [entry] = listDocuments()

    await user.click(screen.getByRole('button', { name: 'Delete Doomed' }))
    await user.click(screen.getByRole('button', { name: 'Confirm deleting Doomed' }))
    expect(listDocuments()).toHaveLength(0)
    expect(await screen.findByText('Deleted “Doomed”.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(listDocuments()).toHaveLength(1))
    // Same id, same timestamps, same bytes: as if it had never been deleted.
    expect(listDocuments()[0]).toEqual(entry)
    expect(window.localStorage.getItem('graphualize:doc:doc-0')).toBe(original)
    expect(screen.queryByText('Deleted “Doomed”.')).toBeNull()
  })

  it('stops offering Undo once the dialog closes', async () => {
    const user = userEvent.setup()
    await openDialogWith(['Gone'])
    await user.click(screen.getByRole('button', { name: 'Delete Gone' }))
    await user.click(screen.getByRole('button', { name: 'Confirm deleting Gone' }))
    expect(state().lastDeleted).not.toBeNull()
    await user.click(screen.getByRole('button', { name: /close/i }))
    expect(state().lastDeleted).toBeNull()
  })
})

describe('found in review', () => {
  const Shortcuts = () => {
    useShortcuts()
    return null
  }

  it('keyboard shortcuts cannot change the graph behind the question', () => {
    drawUnsaved()
    render(<Shortcuts />)
    replaceWorkingGraph({ kind: 'new' })
    const before = state().doc
    for (const init of [
      { key: 'a' },
      { key: 'Delete' },
      { key: 'z', ctrlKey: true },
      { key: 'k', ctrlKey: true },
      { key: 'o', ctrlKey: true },
    ]) {
      window.dispatchEvent(new KeyboardEvent('keydown', { ...init, bubbles: true }))
    }
    expect(state().doc).toBe(before)
    expect(state().commandPaletteOpen).toBe(false)
    expect(useUi.getState().dialog).toBeNull()
  })

  it('Save first replaces nothing if the graph changed while it was saving', async () => {
    const user = userEvent.setup()
    signedIn = true
    drawUnsaved()
    await state().saveCurrent('Saved before')
    state().addVertexAt(7, 7)
    render(<ConfirmReplace />)
    replaceWorkingGraph({ kind: 'new' })
    const release = __fake.holdSaves()
    await user.click(await screen.findByRole('button', { name: 'Save first' }))
    // An edit lands while the save is out.
    await waitFor(() => expect(state().syncing).toBe(true))
    state().addVertexAt(40, 40)
    release()
    expect(await screen.findByRole('alert')).toHaveTextContent(/changed while it was saving/i)
    expect(state().doc.vertices).toHaveLength(6)
  })

  it('leaving the workbench withdraws the question', () => {
    drawUnsaved()
    const { unmount } = render(<ConfirmReplace />)
    replaceWorkingGraph({ kind: 'new' })
    expect(useUi.getState().pendingReplacement).not.toBeNull()
    unmount()
    expect(useUi.getState().pendingReplacement).toBeNull()
  })

  it('a replacement confirmed on the home page is not asked about again, once', () => {
    saveDocument({ id: 'saved-1', name: 'Saved one', graph: docFromEdges(['X-Y']) })
    drawUnsaved()
    preapproveReplacement({ kind: 'open', id: 'saved-1', source: 'local' })
    replaceWorkingGraph({ kind: 'open', id: 'saved-1', source: 'local' })
    expect(useUi.getState().pendingReplacement).toBeNull()
    expect(state().savedId).toBe('saved-1')

    // The approval is spent: unsaved work after that is asked about again.
    state().addVertexAt(3, 3)
    replaceWorkingGraph({ kind: 'open', id: 'saved-1', source: 'local' })
    expect(useUi.getState().pendingReplacement).not.toBeNull()
  })

  it('an approval for one graph does not cover another', () => {
    drawUnsaved()
    preapproveReplacement({ kind: 'open', id: 'a', source: 'local' })
    replaceWorkingGraph({ kind: 'new' })
    expect(useUi.getState().pendingReplacement).toEqual({ kind: 'new' })
  })
})

describe('found in review: the Open dialog', () => {
  const openWith = async (names: string[]) => {
    names.forEach((name, index) =>
      saveDocument({ id: `doc-${index}`, name, graph: docFromEdges(['A-B']) }),
    )
    await state().refreshDocuments()
    useUi.setState({ dialog: 'documents' })
    return render(<DocumentsDialog open />)
  }

  it('a double-click on Delete does not delete', async () => {
    const user = userEvent.setup()
    await openWith(['Careful'])
    await user.dblClick(screen.getByRole('button', { name: 'Delete Careful' }))
    expect(listDocuments()).toHaveLength(1)
  })

  it('Escape backs out of the inline confirmation and keeps the dialog open', async () => {
    const user = userEvent.setup()
    await openWith(['Escapee'])
    await user.click(screen.getByRole('button', { name: 'Delete Escapee' }))
    await user.keyboard('{Escape}')
    expect(screen.queryByText(/from this browser\?/)).toBeNull()
    expect(screen.getByRole('dialog', { name: 'Saved graphs' })).toBeInTheDocument()
    expect(listDocuments()).toHaveLength(1)
  })

  it('moves focus to Undo after a delete', async () => {
    const user = userEvent.setup()
    await openWith(['Focus'])
    await user.click(screen.getByRole('button', { name: 'Delete Focus' }))
    await user.click(screen.getByRole('button', { name: 'Confirm deleting Focus' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Undo' })).toHaveFocus())
  })

  it('opening the dialog withdraws an older offer to undo', async () => {
    useEditor.setState({
      lastDeleted: { id: 'old', source: 'local', name: 'Old', saved: null, links: [], wasOpen: null },
    })
    await openWith(['Fresh'])
    expect(screen.queryByText('Deleted “Old”.')).toBeNull()
  })
})
