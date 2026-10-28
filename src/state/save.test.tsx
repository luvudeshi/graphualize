import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { docFromEdges } from '../graph/model/builder'

// The save experience: the first save asks for a name, later saves go
// straight through, and every outcome is said out loud in a toast.
vi.mock('../sync/cloud', () => import('../test/fakeCloud'))

const { __fake } = await import('../test/fakeCloud')
const { useEditor, setSignedInProbe } = await import('./store')
const { useUi } = await import('./ui')
const { useToast } = await import('./toast')
const { useAuth } = await import('../auth/store')
const { requestSave, requestSaveAs, saveWithName } = await import('./save')
const { SaveDialog } = await import('../components/SaveDialog')
const { Toaster } = await import('../components/Toaster')
const { MenuBar } = await import('../components/MenuBar')
const { useShortcuts } = await import('../hooks/useShortcuts')
const { listDocuments, saveDocument } = await import('./documents')

const state = () => useEditor.getState()
const toast = () => useToast.getState().toast
let signedIn = false

const signIn = (yes: boolean) => {
  signedIn = yes
  useAuth.setState({
    status: yes ? 'signedIn' : 'signedOut',
    profile: yes ? { id: 'u', email: 'ada@example.com', name: 'Ada', avatarUrl: null } : null,
  })
}

const draw = () => state().replaceDocument(docFromEdges(['A-B', 'B-C']), 'Path')

/** The parts of the workbench a save touches. */
const Workbench = () => {
  useShortcuts()
  return (
    <>
      <SaveDialog />
      <Toaster />
    </>
  )
}

beforeEach(() => {
  window.localStorage.clear()
  __fake.reset()
  setSignedInProbe(() => signedIn)
  signIn(false)
  state().newDocument()
  useUi.setState({ dialog: null, pendingReplacement: null })
  useToast.setState({ toast: null })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('the first save asks for a name', () => {
  it('opens the Save dialog instead of saving silently', () => {
    draw()
    requestSave()
    expect(useUi.getState().dialog).toBe('save')
    expect(listDocuments()).toHaveLength(0)
  })

  it('offers the current name, selected, so typing replaces it', async () => {
    draw()
    state().setName('Homework 5')
    render(<Workbench />)
    act(() => requestSave())
    const input = await screen.findByLabelText('Name')
    expect(input).toHaveValue('Homework 5')
    await waitFor(() => expect(input).toHaveFocus())
    const field = input as HTMLInputElement
    expect([field.selectionStart, field.selectionEnd]).toEqual([0, 'Homework 5'.length])
  })

  it('says where it is saving: this browser when signed out', async () => {
    draw()
    render(<Workbench />)
    act(() => requestSave())
    expect(await screen.findByText('This browser')).toBeInTheDocument()
    expect(screen.getByText(/Sign in \(top right\)/)).toBeInTheDocument()
  })

  it('says where it is saving: the account, by email, when signed in', async () => {
    signIn(true)
    draw()
    render(<Workbench />)
    act(() => requestSave())
    expect(await screen.findByText('Your Google account')).toBeInTheDocument()
    expect(screen.getByText('ada@example.com')).toBeInTheDocument()
  })

  it('saves under the typed name on Enter, closes, and says so', async () => {
    const user = userEvent.setup()
    draw()
    render(<Workbench />)
    act(() => requestSave())
    const input = await screen.findByLabelText('Name')
    await user.clear(input)
    await user.type(input, 'Lecture 3 example{Enter}')
    await waitFor(() => expect(useUi.getState().dialog).toBeNull())
    expect(listDocuments().map((entry) => entry.name)).toEqual(['Lecture 3 example'])
    expect(state().name).toBe('Lecture 3 example')
    expect(screen.getByTestId('toast')).toHaveTextContent('Saved “Lecture 3 example”')
    expect(screen.getByTestId('toast')).toHaveTextContent('In this browser')
  })

  it('saves to the account when signed in', async () => {
    const user = userEvent.setup()
    signIn(true)
    draw()
    render(<Workbench />)
    act(() => requestSave())
    await user.click(await screen.findByRole('button', { name: 'Save' }))
    await waitFor(() => expect(__fake.rows()).toHaveLength(1))
    expect(toast()?.detail).toBe('To your Google account')
  })

  it('will not save an empty name', async () => {
    const user = userEvent.setup()
    draw()
    render(<Workbench />)
    act(() => requestSave())
    await user.clear(await screen.findByLabelText('Name'))
    // Marked unavailable rather than disabled, so it keeps focus; Enter does nothing.
    expect(screen.getByRole('button', { name: 'Save' })).toHaveAttribute('aria-disabled', 'true')
    await user.keyboard('{Enter}')
    expect(listDocuments()).toHaveLength(0)
    expect(useUi.getState().dialog).toBe('save')
  })

  it('keeps the dialog open with the reason when the save fails', async () => {
    const user = userEvent.setup()
    signIn(true)
    __fake.failNextCall('This account is not allowed to do that.')
    draw()
    render(<Workbench />)
    act(() => requestSave())
    await user.click(await screen.findByRole('button', { name: 'Save' }))
    expect(await screen.findByText(/not allowed/)).toBeInTheDocument()
    expect(useUi.getState().dialog).toBe('save')
    // Back on the name, which the error now describes, ready to try again.
    const input = screen.getByLabelText('Name')
    await waitFor(() => expect(input).toHaveFocus())
    expect(input).toHaveAccessibleDescription(/not allowed/)
    // Said once, in the dialog — not again in a toast behind it.
    expect(toast()).toBeNull()
  })
})

describe('saving a graph that is already saved', () => {
  const saveFirst = async () => {
    draw()
    await saveWithName('Kept')
    useToast.setState({ toast: null })
  }

  it('saves straight away, without the dialog, and says so', async () => {
    await saveFirst()
    state().addVertexAt(9, 9)
    requestSave()
    expect(useUi.getState().dialog).toBeNull()
    await waitFor(() => expect(listDocuments()[0]!.vertexCount).toBe(4))
    expect(toast()?.title).toBe('Saved “Kept”')
  })

  it('does not write again when nothing changed, and says it is all saved', async () => {
    await saveFirst()
    const before = listDocuments()[0]!.updatedAt
    requestSave()
    expect(toast()?.title).toBe('All changes saved')
    expect(listDocuments()[0]!.updatedAt).toBe(before)
  })

  it('offers Try again and Export instead when it fails, and Try again works', async () => {
    signIn(true)
    await saveFirst()
    state().addVertexAt(9, 9)
    __fake.failNextCall('This account is not allowed to do that.')
    requestSave()
    await waitFor(() => expect(toast()?.tone).toBe('error'))
    expect(toast()?.actions?.map((action) => action.label)).toEqual(['Try again', 'Export instead'])

    toast()!.actions![0]!.run()
    await waitFor(() => expect(toast()?.tone).toBe('success'))
    expect(__fake.rows()[0]!.vertexCount).toBe(4)
  })

  it('Export instead opens the Export dialog', async () => {
    signIn(true)
    await saveFirst()
    state().addVertexAt(9, 9)
    __fake.failNextCall('nope')
    requestSave()
    await waitFor(() => expect(toast()?.tone).toBe('error'))
    toast()!.actions![1]!.run()
    expect(useUi.getState().dialog).toBe('export')
  })

  it('warns, rather than celebrates, when the account was unreachable', async () => {
    signIn(true)
    await saveFirst()
    state().addVertexAt(9, 9)
    __fake.setOffline(true)
    requestSave()
    await waitFor(() => expect(toast()?.tone).toBe('warning'))
    expect(toast()?.title).toBe('Saved “Kept” in this browser')
    expect(toast()?.detail).toMatch(/could not be reached/)
  })

  it('names the copy when another device had newer changes', async () => {
    signIn(true)
    await saveFirst()
    __fake.bumpElsewhere(state().savedId!)
    state().addVertexAt(9, 9)
    requestSave()
    await waitFor(() => expect(toast()?.tone).toBe('warning'))
    expect(toast()?.title).toBe('Saved as “Kept (test device)”')
    // The editor is now that copy, under that name — and it is saved.
    expect(state().name).toBe('Kept (test device)')
    expect(state().dirty).toBe(false)
  })

  it('names the copy when another tab had saved over it', async () => {
    await saveFirst()
    const id = state().savedId!
    await new Promise((resolve) => setTimeout(resolve, 3))
    saveDocument({ id, name: 'Kept', graph: docFromEdges(['X-Y']) })
    state().addVertexAt(9, 9)
    requestSave()
    await waitFor(() => expect(toast()?.title).toBe('Saved as “Kept (copy)”'))
    expect(toast()?.tone).toBe('warning')
  })
})

describe('Save a copy as…', () => {
  it('asks for a name, suggesting "copy", and saves a new entry beside the original', async () => {
    const user = userEvent.setup()
    draw()
    await saveWithName('Original')
    const originalId = state().savedId
    render(<Workbench />)
    act(() => requestSaveAs())
    const input = await screen.findByLabelText('Name')
    expect(input).toHaveValue('Original copy')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(listDocuments()).toHaveLength(2))
    expect(state().savedId).not.toBe(originalId)
    expect(state().name).toBe('Original copy')
    expect(listDocuments().find((entry) => entry.id === originalId)!.name).toBe('Original')
  })

  it('stays tied to the original when the copy fails to save', async () => {
    const user = userEvent.setup()
    signIn(true)
    draw()
    await saveWithName('Original')
    const before = { id: state().savedId, version: state().savedVersion, name: state().name }
    render(<Workbench />)
    act(() => requestSaveAs())
    __fake.failNextCall('nope')
    await user.click(await screen.findByRole('button', { name: 'Save' }))
    await screen.findByText('nope')
    expect({ id: state().savedId, version: state().savedVersion, name: state().name }).toEqual(before)
  })
})

describe('found in review', () => {
  it('a rename counts as a change: Save writes the new name, not "All changes saved"', async () => {
    draw()
    await saveWithName('Pentagon')
    useToast.setState({ toast: null })
    state().setName('Renamed pentagon')
    expect(state().dirty).toBe(true)
    requestSave()
    await waitFor(() => expect(listDocuments()[0]!.name).toBe('Renamed pentagon'))
    expect(toast()?.title).toBe('Saved “Renamed pentagon”')
  })

  it('a rename made while the save is out keeps the graph unsaved', async () => {
    signIn(true)
    draw()
    await saveWithName('Before')
    state().addVertexAt(1, 1)
    const release = __fake.holdSaves()
    const saving = saveWithName('Before')
    await waitFor(() => expect(state().syncing).toBe(true))
    state().setName('After')
    release()
    await saving
    expect(state().dirty).toBe(true)
  })

  it('a toast dismissed while hovered does not stop later toasts leaving on their own', async () => {
    render(<Toaster />)
    act(() => useToast.getState().show({ tone: 'success', title: 'First' }))
    const first = screen.getByTestId('toast')
    act(() => {
      first.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    })
    act(() => screen.getByRole('button', { name: 'Dismiss' }).click())
    vi.useFakeTimers()
    act(() => useToast.getState().show({ tone: 'success', title: 'Second' }))
    act(() => vi.advanceTimersByTime(3300))
    expect(screen.queryByTestId('toast')).toBeNull()
  })

  it('dismissing a toast from the keyboard puts focus back where it was', async () => {
    const user = userEvent.setup()
    render(
      <>
        <button type="button">Before</button>
        <Toaster />
      </>,
    )
    act(() => useToast.getState().show({ tone: 'error', title: 'Could not save' }))
    screen.getByRole('button', { name: 'Before' }).focus()
    await user.tab()
    expect(screen.getByRole('button', { name: 'Dismiss' })).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(screen.getByRole('button', { name: 'Before' })).toHaveFocus()
  })

  it('the same message twice in a row changes the announced text, so it is heard twice', async () => {
    const { StatusBar } = await import('../components/StatusBar')
    render(<StatusBar />)
    act(() => state().notify('All changes saved', 'success'))
    const first = screen.getByText('All changes saved')
    act(() => state().notify('All changes saved', 'success'))
    const second = screen.getByText('All changes saved')
    // A fresh node inside the live region each time, with the text unchanged.
    expect(second).not.toBe(first)
    expect(first.isConnected).toBe(false)
    expect(screen.getByRole('status')).toHaveTextContent(/^All changes saved$/)
  })

  it('the menus call it Save as…', async () => {
    const user = userEvent.setup()
    render(<MenuBar />)
    await user.click(screen.getByRole('button', { name: 'File' }))
    expect(screen.getByRole('menuitem', { name: /^Save as/ })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: /save a copy/i })).toBeNull()
  })
})

describe('found in the behaviour review', () => {
  const replace = import('./replace')
  const hasUnsavedWork = replace.then((m) => m.hasUnsavedWork)
  const replaceWorkingGraph = replace.then((m) => m.replaceWorkingGraph)

  it('Try again saves the graph as it is now, under its current name', async () => {
    signIn(true)
    draw()
    await saveWithName('Kept')
    state().addVertexAt(9, 9)
    __fake.failNextCall('nope')
    requestSave()
    await waitFor(() => expect(toast()?.tone).toBe('error'))
    state().setName('Renamed by user')
    toast()!.actions![0]!.run()
    await waitFor(() => expect(toast()?.tone).toBe('success'))
    expect(state().name).toBe('Renamed by user')
    expect(__fake.rows().map((row) => row.name)).toEqual(['Renamed by user'])
  })

  it('a failed save\'s toast goes away when the graph on screen is replaced', async () => {
    signIn(true)
    draw()
    await saveWithName('Kept')
    state().addVertexAt(9, 9)
    __fake.failNextCall('nope')
    requestSave()
    await waitFor(() => expect(toast()?.tone).toBe('error'))
    useEditor.setState({ dirty: false })
    ;(await hasUnsavedWork)()
    ;(await replaceWorkingGraph)({ kind: 'new' })
    expect(toast()).toBeNull()
  })

  it('two saves at once do not invent a conflict with themselves', async () => {
    signIn(true)
    draw()
    await saveWithName('Kept')
    state().addVertexAt(9, 9)
    await Promise.all([saveWithName('Kept'), saveWithName('Kept')])
    expect(__fake.rows().map((row) => row.name)).toEqual(['Kept'])
    expect(toast()?.title).toBe('Saved “Kept”')
  })

  it('a rename typed during a save that lands as a copy is kept', async () => {
    signIn(true)
    draw()
    await saveWithName('Kept')
    __fake.bumpElsewhere(state().savedId!)
    state().addVertexAt(9, 9)
    const release = __fake.holdSaves()
    const saving = saveWithName('Kept')
    await waitFor(() => expect(state().syncing).toBe(true))
    state().setName('My new title')
    release()
    await saving
    expect(state().name).toBe('My new title')
    expect(state().dirty).toBe(true)
  })

  it('leaving the workbench withdraws the Save dialog and any New/Open waiting on it', () => {
    draw()
    const { unmount } = render(<Workbench />)
    act(() => {
      useUi.getState().setAfterSave({ kind: 'new' })
      useUi.getState().openDialog('save')
    })
    unmount()
    expect(useUi.getState().dialog).toBeNull()
    expect(useUi.getState().afterSave).toBeNull()
  })

  it('Cmd/Ctrl+S does nothing over the share-link dialog', () => {
    draw()
    render(<Workbench />)
    act(() => useUi.getState().showShareLink('https://example.test/#/graph?d=1j.x'))
    const event = new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true })
    act(() => {
      window.dispatchEvent(event)
    })
    expect(event.defaultPrevented).toBe(true)
    expect(useUi.getState().dialog).toBeNull()
    act(() => useUi.getState().showShareLink(null))
  })
})

describe('the toast', () => {
  it('leaves on its own after a success, but an error stays until dismissed', () => {
    vi.useFakeTimers()
    render(<Toaster />)
    act(() => useToast.getState().show({ tone: 'success', title: 'Saved' }))
    act(() => vi.advanceTimersByTime(3300))
    expect(screen.queryByTestId('toast')).toBeNull()

    act(() => useToast.getState().show({ tone: 'error', title: 'Could not save' }))
    act(() => vi.advanceTimersByTime(60_000))
    expect(screen.getByTestId('toast')).toHaveTextContent('Could not save')
  })

  it('holds still while the pointer is on it', () => {
    vi.useFakeTimers()
    render(<Toaster />)
    act(() => useToast.getState().show({ tone: 'success', title: 'Saved' }))
    act(() => {
      screen.getByTestId('toast').dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    })
    act(() => vi.advanceTimersByTime(10_000))
    expect(screen.getByTestId('toast')).toBeInTheDocument()
  })

  it('a newer toast replaces the last, and the old timer cannot close it', () => {
    vi.useFakeTimers()
    render(<Toaster />)
    act(() => useToast.getState().show({ tone: 'success', title: 'First' }))
    act(() => vi.advanceTimersByTime(3000))
    act(() => useToast.getState().show({ tone: 'success', title: 'Second' }))
    act(() => vi.advanceTimersByTime(500))
    expect(screen.getByTestId('toast')).toHaveTextContent('Second')
  })

  it('can be dismissed', async () => {
    const user = userEvent.setup()
    render(<Toaster />)
    act(() => useToast.getState().show({ tone: 'error', title: 'Could not save' }))
    await user.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByTestId('toast')).toBeNull()
  })
})

describe('the Save button in the header', () => {
  it('shows unsaved work, then Saved once it is kept', async () => {
    draw()
    render(<MenuBar />)
    expect(screen.getByRole('button', { name: 'Save (unsaved changes)' })).toBeInTheDocument()
    await act(async () => {
      await saveWithName('Kept')
    })
    expect(screen.getByRole('button', { name: 'Saved — no unsaved changes' })).toBeInTheDocument()
    act(() => state().addVertexAt(4, 4))
    expect(screen.getByRole('button', { name: 'Save (unsaved changes)' })).toBeInTheDocument()
  })

  it('opens the Save dialog for a graph never saved', async () => {
    const user = userEvent.setup()
    draw()
    render(<MenuBar />)
    await user.click(screen.getByRole('button', { name: 'Save (unsaved changes)' }))
    expect(useUi.getState().dialog).toBe('save')
  })
})

describe('shortcuts', () => {
  it('Cmd/Ctrl+S saves even while typing in a field, and never opens the browser\'s Save page', () => {
    draw()
    render(
      <>
        <Workbench />
        <input aria-label="Graph name" />
      </>,
    )
    const field = screen.getByLabelText('Graph name')
    field.focus()
    const event = new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true })
    act(() => {
      field.dispatchEvent(event)
    })
    expect(event.defaultPrevented).toBe(true)
    expect(useUi.getState().dialog).toBe('save')
  })

  it('Cmd/Ctrl+S inside another dialog only keeps the browser from saving the page', () => {
    draw()
    render(<Workbench />)
    act(() => useUi.setState({ dialog: 'export' }))
    const event = new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true })
    act(() => {
      window.dispatchEvent(event)
    })
    expect(event.defaultPrevented).toBe(true)
    expect(useUi.getState().dialog).toBe('export')
  })


  it('Cmd/Ctrl+S saves (asking first time) and Shift adds "as a copy"', () => {
    draw()
    render(<Workbench />)
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true }))
    })
    expect(useUi.getState().dialog).toBe('save')
    act(() => useUi.setState({ dialog: null }))
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'S', ctrlKey: true, shiftKey: true, bubbles: true }),
      )
    })
    expect(useUi.getState().dialog).toBe('saveAs')
  })
})
