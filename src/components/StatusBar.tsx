import { useEffect, useState } from 'react'
import { useEditor } from '../state/store'
import { useAuth } from '../auth/store'

import type { GraphWitness } from '../graph/model/types'
import '../styles/tools.css'

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

  const savedState = syncing
    ? { text: 'saving…', glyph: 'ring' }
    : savedId
      ? dirty
        ? { text: 'unsaved changes', glyph: 'bar' }
        : savedWhere === 'cloud'
          ? { text: 'saved to your account', glyph: 'disc' }
          : { text: 'saved in this browser', glyph: 'disc' }
      : hasContent
        ? signedOut
          ? { text: 'not saved — saving keeps it in this browser', glyph: 'bar' }
          : { text: 'not saved yet', glyph: 'bar' }
        : signedOut
          ? { text: 'not signed in', glyph: 'ring' }
          : { text: 'not saved yet', glyph: 'ring' }

  return (
    <footer className="gz-wb-status">
      {/* The live region holds only the transient message: announcing the tool
          hint on every tool change would be noise. */}
      <span className="gz-wb-status-line">
        <span role="status" aria-live="polite" className="gz-wb-status-msg" data-tone={visible?.tone}>
          {/* Keyed by message, so the same sentence twice in a row (two
              saves, say) is a new node each time — and is announced each
              time — instead of an unchanged text node that is heard once. */}
          {visible && <span key={visible.nonce}>{visible.text}</span>}
        </span>
        {!visible && (
          <span className="gz-wb-status-hint">
            <span className="gz-wb-status-tool">{tool}</span> {TOOL_HINTS[tool]}
          </span>
        )}
      </span>

      {witness && (
        <button
          type="button"
          onClick={clearWitness}
          className="gz-wb-witness"
          title="Clear the highlight"
        >
          <span className="gz-wb-sign" data-glyph="triangle" aria-hidden />
          <span className="gz-wb-witness-caption">{witnessCaption ?? 'highlighting'}</span>
          <span className="gz-wb-witness-clear">clear</span>
        </button>
      )}

      {/* Where the graph is kept is the thing worth knowing at a glance:
          nothing is autosaved, and "saved" means different things signed in
          and signed out. */}
      <span className="gz-wb-saved">
        <span className="gz-wb-sign" data-glyph={savedState.glyph} aria-hidden />
        {savedState.text}
      </span>
    </footer>
  )
}
