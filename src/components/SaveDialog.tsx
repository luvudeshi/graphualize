import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { Dialog } from './Dialog'
import { useEditor } from '../state/store'
import { useUi } from '../state/ui'
import { useAuth } from '../auth/store'
import { saveWithName } from '../state/save'
import { performReplacement } from '../state/replace'

const MAX_NAME = 200

/**
 * The first save of a graph, and every Save as.
 *
 * Nothing in it is disabled while a save is out — a disabled control that has
 * focus drops it to <body>, losing a keyboard user's place. Repeat presses are
 * simply ignored instead, and a failure puts focus back on the name.
 *
 * It asks for the one thing worth asking — a name — and says where the graph
 * is going, because that differs signed in and signed out and is otherwise
 * invisible. The name is pre-selected so typing replaces it and Enter saves.
 * A failed save keeps the dialog open with the reason, so nothing typed is
 * lost; a save that landed somewhere unexpected closes it and says so in the
 * toast.
 */
export const SaveDialog = () => {
  const dialog = useUi((s) => s.dialog)
  const currentName = useEditor((s) => s.name)

  // The question belongs to the workbench it was asked in, like the discard
  // question: leaving (going home) withdraws it and anything waiting on it,
  // so it cannot reappear later over a different graph.
  useEffect(
    () => () => {
      const ui = useUi.getState()
      ui.setAfterSave(null)
      if (ui.dialog === 'save' || ui.dialog === 'saveAs') ui.closeDialog()
    },
    [],
  )

  if (dialog !== 'save' && dialog !== 'saveAs') return null
  const asCopy = dialog === 'saveAs'
  // Mounted fresh each time it opens, so it starts from the graph's name as it
  // is now, and nothing typed survives into the next opening.
  return (
    <SaveDialogBody
      key={dialog}
      asCopy={asCopy}
      initialName={asCopy ? `${currentName} copy`.slice(0, MAX_NAME) : currentName}
    />
  )
}

const SaveDialogBody = ({ asCopy, initialName }: { asCopy: boolean; initialName: string }) => {
  const closeDialog = useUi((s) => s.closeDialog)
  const setAfterSave = useUi((s) => s.setAfterSave)
  const authStatus = useAuth((s) => s.status)
  const email = useAuth((s) => s.profile?.email ?? null)
  const [name, setName] = useState(initialName)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const hintId = useId()
  const errorId = useId()

  // Closing without saving abandons any New or Open that was waiting on it.
  const close = () => {
    setAfterSave(null)
    closeDialog()
  }

  const trimmed = name.trim()

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!trimmed || saving) return
    setSaving(true)
    setError(null)
    const outcome = await saveWithName(trimmed, asCopy, { announceFailure: false })
    setSaving(false)
    if (outcome.kind === 'failed') {
      setError(outcome.message)
      inputRef.current?.focus()
      return
    }
    const next = useUi.getState().afterSave
    setAfterSave(null)
    closeDialog()
    if (next) performReplacement(next)
  }

  const destination =
    authStatus === 'signedIn'
      ? { place: 'Your Google account', note: email }
      : {
          place: 'This browser',
          note:
            authStatus === 'signedOut'
              ? 'Sign in (top right) to save to your Google account.'
              : null,
        }

  return (
    <Dialog
      open
      onClose={() => {
        if (!saving) close()
      }}
      title={asCopy ? 'Save as' : 'Save graph'}
      marker={asCopy ? 'A copy' : 'Save'}
      width="max-w-md"
      initialFocus={inputRef}
      footer={
        <>
          <button
            type="button"
            className="gz-btn border px-3 aria-disabled:opacity-50"
            onClick={() => {
              if (!saving) close()
            }}
            aria-disabled={saving || undefined}
          >
            Cancel
          </button>
          <button
            type="submit"
            form="gz-save-form"
            className="gz-btn gz-btn-primary px-3 aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
            aria-disabled={!trimmed || saving || undefined}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <form id="gz-save-form" onSubmit={(event) => void submit(event)}>
        <label className="gz-label block" htmlFor="gz-save-name">
          Name
        </label>
        <input
          id="gz-save-name"
          ref={inputRef}
          value={name}
          maxLength={MAX_NAME}
          onChange={(event) => setName(event.target.value)}
          // Selected whenever it takes focus, so typing replaces the name.
          onFocus={(event) => event.currentTarget.select()}
          aria-describedby={error ? `${errorId} ${hintId}` : hintId}
          aria-invalid={error ? true : undefined}
          readOnly={saving}
          className="gz-input gz-wb-save-name mt-1.5"
          placeholder="Untitled graph"
          autoComplete="off"
          spellCheck={false}
        />

        <div id={hintId} className="gz-wb-save-dest">
          <span className="gz-label shrink-0 whitespace-nowrap">Saves to</span>
          <span className="min-w-0">
            <span className="gz-wb-save-place">{destination.place}</span>
            {destination.note && <span className="gz-wb-hint break-words">{destination.note}</span>}
          </span>
        </div>

        {/* Not an alert: the status bar has already announced the failure,
            and focus returns to the name, which this describes — so it is
            heard once, where the user is. */}
        {error && (
          <p id={errorId} className="gz-wb-save-error">
            {error}
          </p>
        )}
      </form>
    </Dialog>
  )
}
