import { useEffect, useState } from 'react'
import { useEditor } from '../state/store'
import { openEditor } from '../app/router'
import { relativeTime } from '../utils/time'
import { Dialog } from '../components/Dialog'
import { TrashIcon, GoogleIcon } from '../components/Icons'
import { useAuth } from '../auth/store'
import { pendingLocalGraphCount } from '../sync/adopt'

/**
 * The graphs this browser has saved, listed on the home page so that reopening
 * one does not require going into the workbench and through a dialog first.
 *
 * Renders nothing at all when there is nothing saved. A landing page should not
 * show a first-time visitor an empty shelf — the section simply does not exist
 * until it has something to hold.
 */

const INITIALLY_SHOWN = 6

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`

/**
 * The card's accessible name.
 *
 * Without this the computed name is the visible text — "Homework 3 3v · 3e ·
 * just now" — which a screen reader pronounces as "three vee dot three ee".
 * Spelling it out also separates the card from its delete button, whose name
 * would otherwise be a substring of it.
 */
const cardLabel = (name: string, vertices: number, edges: number, updatedAt: number) =>
  `Open ${name}, ${plural(vertices, 'vertex').replace('vertexs', 'vertices')}, ${plural(edges, 'edge')}, saved ${relativeTime(updatedAt)}`

/**
 * Both destructive-ish actions on this list confirm through the same dialog, so
 * the state is one value rather than two booleans that could both be true.
 */
type Pending =
  | { kind: 'open'; id: string; name: string }
  | { kind: 'delete'; id: string; name: string; vertexCount: number; edgeCount: number }

export const SavedGraphs = () => {
  const documents = useEditor((s) => s.documents)
  const refresh = useEditor((s) => s.refreshDocuments)
  const removeDocument = useEditor((s) => s.removeDocument)
  const status = useAuth((s) => s.status)
  const signIn = useAuth((s) => s.signInWithGoogle)
  const [showAll, setShowAll] = useState(false)
  const [pending, setPending] = useState<Pending | null>(null)

  // Coming back from the workbench after saving needs a re-read to show the
  // new entry. Signed out this returns an empty list without a request.
  useEffect(() => {
    void refresh()
  }, [refresh, status])

  /**
   * Opening a saved graph replaces the working document and clears its undo
   * history — so if there is unsaved work on the canvas right now, this click
   * would destroy it with nothing to undo. The confirmation appears only in
   * that case; the common path (nothing in progress, or everything saved) opens
   * immediately.
   */
  const open = (id: string, name: string) => {
    const { dirty, doc } = useEditor.getState()
    if (dirty && doc.vertices.length > 0) {
      setPending({ kind: 'open', id, name })
      return
    }
    openEditor(`doc:${id}`)
  }

  const confirm = () => {
    if (!pending) return
    const target = pending
    setPending(null)
    if (target.kind === 'open') openEditor(`doc:${target.id}`)
    else void removeDocument(target.id)
  }

  // Signed out there is nothing saved and nowhere to save to. Rather than an
  // empty shelf, say what signing in is actually for — and say it only to
  // someone who has something to lose, or something already here.
  if (status === 'signedOut') {
    const stranded = pendingLocalGraphCount()
    return (
      <div className="mt-12 rounded-xl border bg-[var(--gz-panel)] px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="max-w-xl">
            <p className="text-[0.875rem] font-medium">Sign in to keep your graphs</p>
            <p className="mt-1 text-[0.8125rem] leading-relaxed text-[var(--gz-muted)]">
              {stranded > 0
                ? `Graphs are saved to your Google account. ${stranded} graph${stranded === 1 ? '' : 's'} saved here by an older version will be copied across the first time you sign in.`
                : 'Graphs are saved to your Google account, so they follow you between devices. Without one, a graph is gone when you close the tab.'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void signIn()}
            className="gz-btn border gap-2 px-3 py-2"
          >
            <GoogleIcon />
            Continue with Google
          </button>
        </div>
      </div>
    )
  }

  if (documents.length === 0) return null

  const visible = showAll ? documents : documents.slice(0, INITIALLY_SHOWN)
  const hidden = documents.length - visible.length

  return (
    <div className="mt-12">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <p className="gz-label">Your graphs</p>
        <span className="text-[0.75rem] text-[var(--gz-faint)]">Saved in this browser</span>
      </div>

      <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {visible.map((entry) => (
          // `group` drives the delete button's reveal on hover. The button is
          // always in the DOM and always focusable — only its opacity changes —
          // so it stays reachable by keyboard and to a screen reader.
          <li key={entry.id} className="group relative">
            <button
              type="button"
              onClick={() => open(entry.id, entry.name)}
              aria-label={cardLabel(
                entry.name,
                entry.vertexCount,
                entry.edgeCount,
                entry.updatedAt,
              )}
              className="w-full rounded-lg border py-2.5 pl-3 pr-10 text-left transition-colors hover:border-[var(--gz-accent)] hover:bg-[var(--gz-accent-soft)]"
            >
              <span className="block truncate text-[0.8125rem] font-medium">{entry.name}</span>
              <span className="gz-num mt-0.5 block text-[0.6875rem] text-[var(--gz-faint)]">
                {entry.vertexCount}v · {entry.edgeCount}e · {relativeTime(entry.updatedAt)}
              </span>
            </button>

            <button
              type="button"
              onClick={() =>
                setPending({
                  kind: 'delete',
                  id: entry.id,
                  name: entry.name,
                  vertexCount: entry.vertexCount,
                  edgeCount: entry.edgeCount,
                })
              }
              aria-label={`Delete ${entry.name}`}
              className="absolute right-1.5 top-1.5 rounded-md p-1.5 text-[var(--gz-faint)] opacity-0 transition-opacity hover:bg-[color-mix(in_oklab,var(--gz-danger)_12%,transparent)] hover:text-[var(--gz-danger)] focus:opacity-100 focus:outline-none focus-visible:ring-1 group-hover:opacity-100"
            >
              <TrashIcon width={14} height={14} />
            </button>
          </li>
        ))}
      </ul>

      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="mt-2 text-[0.75rem] text-[var(--gz-muted)] underline underline-offset-2 hover:text-[var(--gz-text)]"
        >
          Show {hidden} more
        </button>
      )}

      {pending?.kind === 'open' && (
        <Dialog
          open
          onClose={() => setPending(null)}
          title="Discard the graph you are working on?"
          description={`Opening “${pending.name}” replaces what is currently on the canvas, and that cannot be undone. Save it first if you want to keep it.`}
          width="max-w-md"
          footer={
            <>
              <button type="button" className="gz-btn border px-3" onClick={() => setPending(null)}>
                Cancel
              </button>
              <button type="button" className="gz-btn gz-btn-primary px-3" onClick={confirm}>
                Open “{pending.name}”
              </button>
            </>
          }
        >
          <p className="text-[0.8125rem] leading-relaxed text-[var(--gz-muted)]">
            Your saved graphs are not affected either way.
          </p>
        </Dialog>
      )}

      {pending?.kind === 'delete' && (
        <Dialog
          open
          onClose={() => setPending(null)}
          title={`Delete “${pending.name}”?`}
          description="This removes it from this browser permanently. There is no undo, and no copy anywhere else."
          width="max-w-md"
          footer={
            <>
              <button type="button" className="gz-btn border px-3" onClick={() => setPending(null)}>
                Cancel
              </button>
              {/* Destructive styling, and Cancel first, so the safe choice is
                  the one under the cursor's resting position. */}
              <button
                type="button"
                className="gz-btn border border-[var(--gz-danger)] px-3 text-[var(--gz-danger)] hover:bg-[color-mix(in_oklab,var(--gz-danger)_12%,transparent)]"
                onClick={confirm}
              >
                Delete
              </button>
            </>
          }
        >
          {/* The size is here so you can tell two similarly-named graphs apart
              before destroying one of them. */}
          <p className="gz-num text-[0.8125rem] text-[var(--gz-muted)]">
            {pending.vertexCount} vertices · {pending.edgeCount} edges
          </p>
          <p className="mt-3 text-[0.8125rem] leading-relaxed text-[var(--gz-muted)]">
            To keep a copy instead, open it and use File → Export.
          </p>
        </Dialog>
      )}
    </div>
  )
}
