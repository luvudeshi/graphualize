import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Dialog } from './Dialog'
import { useEditor } from '../state/store'
import { useUi } from '../state/ui'
import { useAuth } from '../auth/store'
import { replaceWorkingGraph } from '../state/replace'
import '../styles/dialogs2.css'

const formatDate = (ms: number) =>
  new Date(ms).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })

export const DocumentsDialog = ({ open }: { open: boolean }) => {
  const close = useUi((s) => s.closeDialog)
  const documents = useEditor((s) => s.documents)
  const source = useEditor((s) => s.documentsSource)
  const savedWhere = useEditor((s) => s.savedWhere)
  const canSignIn = useAuth((s) => s.status === 'signedOut')
  const refresh = useEditor((s) => s.refreshDocuments)
  const removeDocument = useEditor((s) => s.removeDocument)
  const undoDelete = useEditor((s) => s.undoDelete)
  const dismissDeleted = useEditor((s) => s.dismissDeleted)
  const lastDeleted = useEditor((s) => s.lastDeleted)
  const savedId = useEditor((s) => s.savedId)
  // The row whose Delete was pressed and is waiting for a second, deliberate click.
  const [confirming, setConfirming] = useState<string | null>(null)
  // A delete or an undo is in flight; every destructive control waits for it.
  const [busy, setBusy] = useState(false)
  const undoRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const promptId = useId()

  // Undo is offered only for a delete made in this dialog while it is open:
  // opening it withdraws any older offer, and closing it withdraws this one.
  useEffect(() => {
    if (!open) return
    dismissDeleted()
    void refresh()
  }, [open, refresh, dismissDeleted])

  // A deleted row takes the focus with it; Undo is the natural next stop —
  // once the delete has finished and the button is enabled, since focusing a
  // disabled button does nothing.
  useEffect(() => {
    if (lastDeleted && !busy) undoRef.current?.focus()
  }, [lastDeleted, busy])

  const closeDialog = () => {
    setConfirming(null)
    dismissDeleted()
    close()
  }

  // Escape backs out of the inline confirmation first, rather than closing
  // the dialog and taking the list (and any Undo) with it.
  const onEscape = useCallback(() => {
    if (confirming === null) return false
    setConfirming(null)
    return true
  }, [confirming])

  const remove = async (id: string) => {
    setConfirming(null)
    setBusy(true)
    try {
      await removeDocument(id, source, { offerUndo: true })
    } finally {
      setBusy(false)
    }
  }

  const undo = async () => {
    const restoring = lastDeleted?.id
    setBusy(true)
    try {
      await undoDelete()
    } finally {
      setBusy(false)
    }
    // Back to the restored row, or failing that the list, never <body>.
    const row = restoring
      ? listRef.current?.querySelector<HTMLElement>(`[data-row-id="${CSS.escape(restoring)}"] button`)
      : null
    ;(row ?? listRef.current?.querySelector<HTMLElement>('button'))?.focus()
  }

  const where = source === 'cloud' ? 'your account, on every device' : 'this browser'

  return (
    <Dialog
      open={open}
      onClose={closeDialog}
      onEscape={onEscape}
      title="Saved graphs"
      description={
        source === 'cloud'
          ? 'Graphs are saved to your Google account, so they follow you between devices.'
          : canSignIn
            ? 'Graphs are saved in this browser. Sign in with Google to keep them in your account instead.'
            : 'Graphs are saved in this browser.'
      }
      width="max-w-xl"
    >
      {lastDeleted && (
        <div role="status" className="gz-wb-dlg-notice gz-wb-dlg-undo">
          <span className="min-w-0 truncate italic">Deleted “{lastDeleted.name}”.</span>
          <button
            ref={undoRef}
            type="button"
            className="gz-wb-dlg-red-link"
            onClick={() => void undo()}
            disabled={busy}
          >
            Undo
          </button>
        </div>
      )}

      {documents.length === 0 ? (
        <p className="gz-wb-dlg-caption gz-wb-dlg-ledger-empty">
          Nothing saved {source === 'cloud' ? 'to your account' : 'in this browser'} yet. Use File
          → Save to keep the graph you are working on.
        </p>
      ) : (
        <ul ref={listRef} className="gz-wb-dlg-ledger">
          {documents.map((entry) =>
            confirming === entry.id ? (
              // Asking in place keeps the list in view, so it is plain which
              // graph is about to go. Cancel sits where Delete was, so a
              // double-click on Delete lands on Cancel, not on the deletion.
              <li key={entry.id} data-row-id={entry.id} className="flex-wrap">
                <span id={promptId} className="gz-wb-dlg-ledger-ask">
                  Delete “{entry.name}” from {where}?
                </span>
                <button
                  type="button"
                  className="gz-btn gz-wb-dlg-btn-danger"
                  onClick={(event) => {
                    // The second click of a double-click is not a decision.
                    if (event.detail > 1) return
                    void remove(entry.id)
                  }}
                  disabled={busy}
                  aria-label={`Confirm deleting ${entry.name}`}
                  aria-describedby={promptId}
                >
                  Delete
                </button>
                <button
                  type="button"
                  className="gz-btn gz-btn-outline"
                  onClick={() => setConfirming(null)}
                  aria-describedby={promptId}
                  autoFocus
                >
                  Cancel
                </button>
              </li>
            ) : (
              <li key={entry.id} data-row-id={entry.id}>
                <button
                  type="button"
                  onClick={() => {
                    // Close first: if opening it would discard unsaved work,
                    // the confirmation appears on its own, not on top of this.
                    closeDialog()
                    replaceWorkingGraph({ kind: 'open', id: entry.id, source, name: entry.name })
                  }}
                  className="gz-wb-dlg-ledger-open"
                >
                  <span className="gz-wb-dlg-ledger-name">
                    <span>{entry.name}</span>
                    {entry.id === savedId && savedWhere === source && (
                      <span className="gz-wb-dlg-open-mark">open</span>
                    )}
                  </span>
                  <span className="gz-wb-dlg-ledger-meta">
                    {entry.vertexCount} {entry.vertexCount === 1 ? 'vertex' : 'vertices'} ·{' '}
                    {entry.edgeCount} {entry.edgeCount === 1 ? 'edge' : 'edges'} ·{' '}
                    <i>{formatDate(entry.updatedAt)}</i>
                  </span>
                </button>
                <button
                  type="button"
                  className="gz-wb-dlg-red-link"
                  onClick={() => setConfirming(entry.id)}
                  disabled={busy}
                  aria-label={`Delete ${entry.name}`}
                >
                  Delete
                </button>
              </li>
            ),
          )}
        </ul>
      )}
    </Dialog>
  )
}
