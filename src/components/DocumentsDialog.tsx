import { useEffect } from 'react'
import { Dialog } from './Dialog'
import { useEditor } from '../state/store'
import { useUi } from '../state/ui'
import { useAuth } from '../auth/store'

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
      description={
        source === 'cloud'
          ? 'Graphs are saved to your Google account, so they follow you between devices.'
          : canSignIn
            ? 'Graphs are saved in this browser. Sign in with Google to keep them in your account instead.'
            : 'Graphs are saved in this browser.'
      }
      width="max-w-xl"
    >
      {documents.length === 0 ? (
        <p className="py-6 text-center text-[0.8125rem] text-[var(--gz-muted)]">
          Nothing saved {source === 'cloud' ? 'to your account' : 'in this browser'} yet. Use File
          → Save to keep the graph you are working on.
        </p>
      ) : (
        <ul className="divide-y">
          {documents.map((entry) => (
            <li key={entry.id} className="flex items-center gap-3 py-2">
              <button
                type="button"
                onClick={() => {
                  void openDocument(entry.id, source)
                  close()
                }}
                className="min-w-0 flex-1 text-left"
              >
                <span className="block truncate text-[0.875rem] font-medium">
                  {entry.name}
                  {entry.id === savedId && savedWhere === source && (
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
                onClick={() => void removeDocument(entry.id, source)}
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
