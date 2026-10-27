import { useEffect, useState } from 'react'
import { useEditor, type SaveLocation } from '../state/store'
import { openEditor } from '../app/router'
import { relativeTime } from '../utils/time'
import { Dialog } from '../components/Dialog'
import { TrashIcon, GoogleIcon } from '../components/Icons'
import { useAuth } from '../auth/store'
import { pendingLocalGraphCount } from '../sync/adopt'
import { preapproveReplacement } from '../state/replace'

/**
 * The graphs saved to the account — or, signed out, to this browser — listed
 * on the home page so that reopening one does not require going into the
 * workbench and through a dialog first.
 *
 * Renders no list at all when there is nothing saved. A landing page should not
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
  | { kind: 'open'; id: string; name: string; source: SaveLocation }
  | {
      kind: 'delete'
      id: string
      name: string
      vertexCount: number
      edgeCount: number
      source: SaveLocation
    }

/** The arrival command that opens a saved graph; see `useArrivalCommand` in App. */
const openCommand = (id: string, source: SaveLocation) =>
  `${source === 'local' ? 'local' : 'doc'}:${id}`

/**
 * Signed out, saving works and stays in this browser. This says what an
 * account adds on top — and, when graphs here are not in the account yet, that
 * they will come along. `pending` counts only those: a graph already copied
 * across and not edited since is in the account, and saying otherwise would
 * be untrue.
 */
const SignInNudge = ({ pending, onSignIn }: { pending: number; onSignIn: () => void }) => (
  <div className="rounded-xl border bg-[var(--gz-panel)] px-5 py-4">
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div className="max-w-xl">
        <p className="text-[0.875rem] font-medium">
          {pending > 0 ? 'Keep these in your Google account' : 'Saving keeps graphs in this browser'}
        </p>
        <p className="mt-1 text-[0.8125rem] leading-relaxed text-[var(--gz-muted)]">
          {pending > 0
            ? `${pending === 1 ? '1 graph here is' : `${pending} graphs here are`} not in your account yet. Sign in to copy ${pending === 1 ? 'it' : 'them'} across and open ${pending === 1 ? 'it' : 'them'} on any device.`
            : 'Sign in with Google to save to your account instead, so your graphs follow you between devices.'}
        </p>
      </div>
      <button type="button" onClick={onSignIn} className="gz-btn border gap-2 px-3 py-2">
        <GoogleIcon />
        Continue with Google
      </button>
    </div>
  </div>
)

export const SavedGraphs = () => {
  const documents = useEditor((s) => s.documents)
  const source = useEditor((s) => s.documentsSource)
  const accountUnreachable = useEditor((s) => s.accountUnreachable)
  const refresh = useEditor((s) => s.refreshDocuments)
  const removeDocument = useEditor((s) => s.removeDocument)
  const status = useAuth((s) => s.status)
  const signIn = useAuth((s) => s.signInWithGoogle)
  const [showAll, setShowAll] = useState(false)
  const [pending, setPending] = useState<Pending | null>(null)

  // Coming back from the workbench after saving needs a re-read to show the
  // new entry. Signed out this reads this browser's list, without a request.
  useEffect(() => {
    // Until the session is restored it is not known whose list to read.
    if (status !== 'loading') void refresh()
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
      setPending({ kind: 'open', id, name, source })
      return
    }
    openEditor(openCommand(id, source))
  }

  const confirm = () => {
    if (!pending) return
    const target = pending
    setPending(null)
    if (target.kind === 'open') {
      // Already confirmed here, so the workbench must not ask the same thing again.
      preapproveReplacement({ kind: 'open', id: target.id, source: target.source })
      openEditor(openCommand(target.id, target.source))
    } else void removeDocument(target.id, target.source)
  }

  // Until the session is restored, and then until the account's list has
  // arrived, it is not known what to show; showing this browser's list for a
  // moment first would flicker. The exception is an account that cannot be
  // reached, where this browser's list is the true one.
  if (status === 'loading') return null
  if (status === 'signedIn' && source === 'local' && !accountUnreachable) return null

  const nudge =
    status === 'signedOut' ? (
      <SignInNudge pending={pendingLocalGraphCount()} onSignIn={() => void signIn()} />
    ) : null

  if (documents.length === 0) return nudge ? <div className="mt-12">{nudge}</div> : null

  const visible = showAll ? documents : documents.slice(0, INITIALLY_SHOWN)
  const hidden = documents.length - visible.length

  return (
    <div className="mt-12">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <p className="gz-label">Your graphs</p>
        <span className="text-[0.75rem] text-[var(--gz-faint)]">
          {source === 'local' ? 'Saved in this browser' : 'In your Google account'}
        </span>
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
                  source,
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

      {nudge && <div className="mt-4">{nudge}</div>}

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
          description={
            pending.source === 'local'
              ? 'This removes it from this browser permanently. There is no undo, and no copy anywhere else in this browser.'
              : 'This removes it from your account, on every device. There is no undo.'
          }
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
