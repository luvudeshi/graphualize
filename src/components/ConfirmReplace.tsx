import { useEffect, useState } from 'react'
import { Dialog } from './Dialog'
import { useEditor } from '../state/store'
import { useUi } from '../state/ui'
import { performReplacement } from '../state/replace'
import { saveWithName } from '../state/save'

/**
 * Asks before New or Open throws away unsaved work.
 *
 * Three ways out, with the safe ones first: keep working (Cancel), save and
 * then carry on, or knowingly discard. "Save first" only continues once the
 * save has actually gone through — if it did not, nothing is replaced and the
 * dialog says so, rather than discarding work the user was trying to keep.
 */
export const ConfirmReplace = () => {
  const pending = useUi((s) => s.pendingReplacement)
  const clear = useUi((s) => s.clearReplacement)
  const name = useEditor((s) => s.name)
  const [saving, setSaving] = useState(false)
  const [problem, setProblem] = useState<'failed' | 'changed' | null>(null)

  // The question belongs to the workbench it was asked in. Leaving it (going
  // home) withdraws it, so it cannot reappear later over a different graph.
  useEffect(() => () => clear(), [clear])

  const close = () => {
    setProblem(null)
    clear()
  }

  const discard = () => {
    if (!pending) return
    const target = pending
    close()
    performReplacement(target)
  }

  const saveThenContinue = async () => {
    if (!pending || saving) return
    const target = pending
    const editor = useEditor.getState()
    // A graph never saved needs a name first: the Save dialog asks, and
    // carries on with this New or Open once it has saved.
    if (editor.savedId === null) {
      close()
      useUi.getState().setAfterSave(target)
      useUi.getState().openDialog('save')
      return
    }
    const before = editor.doc
    setSaving(true)
    setProblem(null)
    const outcome = await saveWithName(editor.name, false, { announceFailure: false })
    setSaving(false)
    const after = useEditor.getState()
    // Continue only if what is on screen is exactly what was just saved.
    if (after.doc !== before) {
      setProblem('changed')
      return
    }
    if (outcome.kind === 'failed' || after.dirty) {
      setProblem('failed')
      return
    }
    close()
    performReplacement(target)
  }

  const action =
    pending?.kind === 'open'
      ? pending.name
        ? `Opening “${pending.name}”`
        : 'Opening that saved graph'
      : 'Starting a new graph'

  return (
    <Dialog
      open={pending !== null}
      onClose={() => {
        if (!saving) close()
      }}
      title="Discard the graph you are working on?"
      description={`${action} replaces “${name}”, which has unsaved changes, and that cannot be undone.`}
      width="max-w-md"
      footer={
        <>
          <button type="button" className="gz-btn border px-3" onClick={close} disabled={saving}>
            Cancel
          </button>
          <button
            type="button"
            className="gz-btn border border-[var(--gz-danger)] px-3 text-[var(--gz-danger)] hover:bg-[color-mix(in_oklab,var(--gz-danger)_12%,transparent)]"
            onClick={discard}
            disabled={saving}
          >
            Discard changes
          </button>
          <button
            type="button"
            className="gz-btn gz-btn-primary px-3"
            onClick={() => void saveThenContinue()}
            disabled={saving}
          >
            {saving ? 'Saving…' : 'Save first'}
          </button>
        </>
      }
    >
      {problem ? (
        <p role="alert" className="text-[0.8125rem] leading-relaxed text-[var(--gz-danger)]">
          {problem === 'changed'
            ? 'The graph changed while it was saving, so nothing was replaced. Your graph is still here.'
            : 'That save did not go through, so nothing was replaced. Your graph is still here.'}
        </p>
      ) : (
        <p className="text-[0.8125rem] leading-relaxed text-[var(--gz-muted)]">
          Your saved graphs are not affected either way.
        </p>
      )}
    </Dialog>
  )
}
