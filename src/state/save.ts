/**
 * What Save, Save as and Cmd+S do — the part between the click and the store.
 *
 * The store knows how to save. This decides *how to ask*: the first save of a
 * graph opens the Save dialog so it gets a real name and the user sees where
 * it is going; later saves go straight through; and every outcome ends in a
 * toast that says what happened, in words, with a way forward when it failed.
 */
import { useEditor, type SaveOutcome } from './store'
import { useUi } from './ui'
import { useToast } from './toast'

const where = (location: 'local' | 'cloud') =>
  location === 'cloud' ? 'To your Google account' : 'In this browser'

/**
 * Turns a save's outcome into the toast that reports it.
 *
 * "Try again" is a fresh Save of the graph as it is when clicked — its name
 * now, the saved copy it is tied to now — never a replay of the attempt that
 * failed: by then the graph may have been renamed, or replaced altogether.
 */
export const announceSave = (outcome: SaveOutcome): void => {
  const { show } = useToast.getState()
  switch (outcome.kind) {
    case 'saved':
      show({ tone: 'success', title: `Saved “${outcome.name}”`, detail: where(outcome.where) })
      return
    case 'savedElsewhere':
      show({
        tone: 'warning',
        title: `Saved “${outcome.name}” in this browser`,
        detail:
          outcome.reason === 'unreachable'
            ? 'Your account could not be reached. It will be copied there once it can.'
            : 'Your sign-in has expired. Sign in again to copy it to your account.',
      })
      return
    case 'savedAsCopy':
      show({
        tone: 'warning',
        title: `Saved as “${outcome.name}”`,
        detail:
          outcome.reason === 'otherTab'
            ? 'Another tab had changed this graph, so both versions were kept.'
            : 'It had newer changes from another device, so both versions were kept.',
      })
      return
    case 'failed':
      show({
        tone: 'error',
        title: 'Could not save',
        detail: outcome.message,
        actions: [
          { label: 'Try again', run: () => requestSave() },
          { label: 'Export instead', run: () => useUi.getState().openDialog('export') },
        ],
      })
  }
}

/**
 * Saves the graph under `name`, as a new copy when `asCopy`, and reports it.
 * A Save as that fails leaves the graph tied to the copy it came from, so
 * nothing about the original is lost by trying.
 */
/**
 * The save in progress, if any. Saves never overlap: two at once would both
 * send the same expected version, and the second would find its own first
 * write and report a conflict that never happened.
 */
let inFlight: Promise<SaveOutcome> | null = null

export const saveWithName = async (
  name: string,
  asCopy = false,
  options: { announceFailure?: boolean } = {},
): Promise<SaveOutcome> => {
  const previous = inFlight
  const run = (async () => {
    if (previous) await previous.catch(() => null)
    return saveNow(name, asCopy, options)
  })()
  inFlight = run
  try {
    return await run
  } finally {
    if (inFlight === run) inFlight = null
  }
}

const saveNow = async (
  name: string,
  asCopy: boolean,
  options: { announceFailure?: boolean },
): Promise<SaveOutcome> => {
  // Read after any earlier save has finished, so this one starts from the
  // version that save left behind.
  const editor = useEditor.getState()
  const retie = asCopy ? editor.detachFromSaved() : null
  const outcome = await useEditor.getState().saveCurrent(name)
  if (outcome.kind === 'failed') {
    retie?.()
    // The Save dialog shows a failure inline, beside the name being saved; a
    // toast as well would say the same thing twice.
    if (options.announceFailure === false) return outcome
  }
  announceSave(outcome)
  return outcome
}

/**
 * File → Save, Cmd/Ctrl+S, the header button and the palette.
 *
 * A graph never saved before gets the dialog. One already saved and unchanged
 * gets a reassurance rather than a pointless write. Anything else saves now.
 */
export const requestSave = (): void => {
  const editor = useEditor.getState()
  if (editor.syncing) return
  if (editor.savedId === null) {
    useUi.getState().openDialog('save')
    return
  }
  if (!editor.dirty) {
    // The status bar is the announced channel; the toast is what is seen.
    editor.notify('All changes saved', 'success')
    useToast.getState().show({
      tone: 'success',
      title: 'All changes saved',
      detail: where(editor.savedWhere ?? 'local'),
    })
    return
  }
  void saveWithName(editor.name)
}

/** File → Save as…, Shift+Cmd/Ctrl+S: always asks for a name, always a new copy. */
export const requestSaveAs = (): void => {
  if (useEditor.getState().syncing) return
  useUi.getState().openDialog('saveAs')
}
