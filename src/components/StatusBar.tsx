import { useEffect, useState } from 'react'
import { useEditor } from '../state/store'
import { useAuth } from '../auth/store'

import type { GraphWitness } from '../graph/model/types'

/** A short description of what is currently highlighted, for the footer chip. */
const captionFor = (witness: GraphWitness): string => {
  if ('caption' in witness && witness.caption) return witness.caption
  switch (witness.type) {
    case 'partition':
      return witness.captions?.join(' | ') ?? 'partition'
    case 'coloring':
      return `${witness.count} colour${witness.count === 1 ? '' : 's'}`
    case 'vertices':
      return `${witness.vertexIds.length} vertices`
    case 'edges':
    case 'matching':
    case 'tree':
      return `${witness.edgeIds.length} edges`
    default:
      return 'highlighting'
  }
}

const TOOL_HINTS: Record<string, string> = {
  select: 'Drag to move · Shift-click to add to the selection · drag on empty space to box-select',
  vertex: 'Click empty space to add a vertex · double-click a vertex to rename it',
  edge: 'Click a vertex then another, or drag between them',
  erase: 'Click a vertex or edge to delete it',
}

export const StatusBar = () => {
  const status = useEditor((s) => s.status)
  const tool = useEditor((s) => s.tool)
  const dirty = useEditor((s) => s.dirty)
  const syncing = useEditor((s) => s.syncing)
  const hasContent = useEditor((s) => s.doc.vertices.length > 0)
  const signedOut = useAuth((s) => s.status === 'signedOut')
  const savedId = useEditor((s) => s.savedId)
  const savedWhere = useEditor((s) => s.savedWhere)
  const witness = useEditor((s) => s.activeWitness)
  const witnessCaption = witness ? captionFor(witness.witness) : null
  const clearWitness = useEditor((s) => s.clearWitness)
  // Remember which message has timed out rather than mirroring the message
  // itself, so nothing is set synchronously while rendering.
  const [expiredNonce, setExpiredNonce] = useState(-1)

  useEffect(() => {
    if (!status) return
    const handle = window.setTimeout(
      () => setExpiredNonce(status.nonce),
      status.tone === 'error' ? 6000 : 3200,
    )
    return () => window.clearTimeout(handle)
  }, [status])

  const visible = status && status.nonce !== expiredNonce ? status : null

  const tone =
    visible?.tone === 'error'
      ? 'text-[var(--gz-danger)]'
      : visible?.tone === 'success'
        ? 'text-[var(--gz-success)]'
        : 'text-[var(--gz-text)]'

  return (
    <footer className="flex h-7 shrink-0 items-center gap-3 border-t bg-[var(--gz-panel)] px-3 text-[0.6875rem]">
      {/* The live region holds only the transient message: announcing the tool
          hint on every tool change would be noise. */}
      <span className="min-w-0 flex-1 truncate">
        <span role="status" aria-live="polite" className={tone}>
          {visible?.text ?? ''}
        </span>
        {!visible && <span className="text-[var(--gz-faint)]">{TOOL_HINTS[tool]}</span>}
      </span>

      {witness && (
        <button
          type="button"
          onClick={clearWitness}
          className="gz-chip max-w-[22rem] shrink-0 overflow-hidden border-[var(--gz-accent)] text-[var(--gz-accent)]"
          title="Clear the highlight"
        >
          <span className="truncate">{witnessCaption ?? 'highlighting'}</span>
          <span aria-hidden>·</span>
          <span>clear</span>
        </button>
      )}

      {/* Where the graph is kept is the thing worth knowing at a glance:
          nothing is autosaved, and "saved" means different things signed in
          and signed out. */}
      <span className="shrink-0 text-[var(--gz-faint)]">
        {syncing
          ? 'saving…'
          : savedId
            ? dirty
              ? 'unsaved changes'
              : savedWhere === 'cloud'
                ? 'saved to your account'
                : 'saved in this browser'
            : hasContent
              ? signedOut
                ? 'not saved — saving keeps it in this browser'
                : 'not saved yet'
              : signedOut
                ? 'not signed in'
                : 'not saved yet'}
      </span>
    </footer>
  )
}
