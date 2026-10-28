/**
 * The one way the workbench replaces the graph on screen.
 *
 * Starting a new graph and opening a saved one both clear the undo history, so
 * whatever was on the canvas is gone for good. When that would destroy work —
 * there are unsaved changes and something is actually drawn — the user is
 * asked first (`ConfirmReplace`), exactly as the home page already does for
 * opening a saved graph. When nothing would be lost it simply happens.
 */
import { useEditor } from './store'
import { useUi, type Replacement } from './ui'
import { useToast } from './toast'

/** True when replacing the working graph now would lose something. */
export const hasUnsavedWork = (): boolean => {
  const { dirty, doc } = useEditor.getState()
  return dirty && doc.vertices.length > 0
}

/** Replaces the working graph, with no questions asked. */
export const performReplacement = (replacement: Replacement): void => {
  // A failed save's toast is about the graph that is going; its actions
  // ("Try again") must not be left to act on the one that replaces it.
  if (useToast.getState().toast?.tone === 'error') useToast.getState().dismiss()
  const editor = useEditor.getState()
  if (replacement.kind === 'new') editor.newDocument()
  else void editor.openDocument(replacement.id, replacement.source)
}

/**
 * A replacement the user has already agreed to elsewhere — the home page asks
 * before opening a saved graph, then hands over to the workbench through the
 * URL. One-shot: it covers exactly that graph, once, so the same question is
 * not asked twice in a row and nothing else slips through on its back.
 */
let preapproved: Replacement | null = null

const sameReplacement = (a: Replacement, b: Replacement): boolean =>
  a.kind === 'new'
    ? b.kind === 'new'
    : b.kind === 'open' && a.id === b.id && a.source === b.source

export const preapproveReplacement = (replacement: Replacement): void => {
  preapproved = replacement
}

/** Replaces the working graph, asking first if that would discard unsaved work. */
export const replaceWorkingGraph = (replacement: Replacement): void => {
  const approved = preapproved !== null && sameReplacement(preapproved, replacement)
  preapproved = null
  if (!approved && hasUnsavedWork()) {
    useUi.getState().askToReplace(replacement)
    return
  }
  performReplacement(replacement)
}
