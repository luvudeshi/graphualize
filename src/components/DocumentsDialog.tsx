import { useEffect } from 'react'
import { Dialog } from './Dialog'
import { useEditor } from '../state/store'
import { useUi } from '../state/ui'

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
  const refresh = useEditor((s) => s.refreshDocuments)
  const openDocument = useEditor((s) => s.openDocument)
  const removeDocument = useEditor((s) => s.removeDocument)
  const savedId = useEditor((s) => s.savedId)

  useEffect(() => {
    if (open) void refresh()
  }, [open, refresh])

  return (
    <Dialog
      open={open}
      onClose={close}
      title="Saved graphs"
      description="Graphs are saved to your Google account, so they follow you between devices."
      width="max-w-xl"
    >
      {documents.length === 0 ? (
        <p className="py-6 text-center text-[0.8125rem] text-[var(--gz-muted)]">
          Nothing saved to your account yet. Use File → Save to keep the graph you are working
          on.
        </p>
      ) : (
        <ul className="divide-y">
          {documents.map((entry) => (
            <li key={entry.id} className="flex items-center gap-3 py-2">
              <button
                type="button"
                onClick={() => {
                  void openDocument(entry.id)
                  close()
                }}
                className="min-w-0 flex-1 text-left"
              >
                <span className="block truncate text-[0.875rem] font-medium">
                  {entry.name}
                  {entry.id === savedId && (
                    <span className="ml-2 gz-chip border-[var(--gz-accent)] text-[var(--gz-accent)]">
                      open
                    </span>
                  )}
                </span>
                <span className="gz-num block text-[0.6875rem] text-[var(--gz-faint)]">
                  {entry.vertexCount}v · {entry.edgeCount}e · {formatDate(entry.updatedAt)}
                </span>
              </button>
              <button
                type="button"
                className="gz-btn px-2 text-[var(--gz-danger)]"
                onClick={() => void removeDocument(entry.id)}
                aria-label={`Delete ${entry.name}`}
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  )
}
