import { useEffect } from 'react'
import { useEditor } from '../state/store'
import { useUi } from '../state/ui'
import { getCanvasInstance } from '../canvas/instance'
import { replaceWorkingGraph } from '../state/replace'
import { requestSave, requestSaveAs } from '../state/save'

const isTypingTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    target.isContentEditable ||
    target.getAttribute('role') === 'textbox'
  )
}

const NUDGE = 8

/**
 * Where a keyboard-placed vertex should go: the middle of what you are looking
 * at, nudged along a diagonal if that spot is already taken so repeated
 * presses do not stack vertices on top of each other.
 */
const centreOfView = (occupied: { x: number; y: number }[]): { x: number; y: number } => {
  const instance = getCanvasInstance()
  let x = 0
  let y = 0
  if (instance) {
    const zoom = instance.zoom()
    const pan = instance.pan()
    x = (instance.width() / 2 - pan.x) / zoom
    y = (instance.height() / 2 - pan.y) / zoom
  }
  for (let attempt = 0; attempt < 40; attempt++) {
    const candidate = { x: x + attempt * 42, y: y + attempt * 30 }
    const clash = occupied.some(
      (p) => Math.hypot(p.x - candidate.x, p.y - candidate.y) < 40,
    )
    if (!clash) return { x: Math.round(candidate.x), y: Math.round(candidate.y) }
  }
  return { x: Math.round(x), y: Math.round(y) }
}

/** Global keyboard shortcuts. Text inputs always win. */
export const useShortcuts = (): void => {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const store = useEditor.getState()
      const ui = useUi.getState()
      const mod = event.metaKey || event.ctrlKey
      const typing = isTypingTarget(event.target)

      // Save works from anywhere — including while typing in the graph's name
      // or the quick box, which is exactly when people reach for it. The
      // browser's own "Save page" must never open instead, even while a
      // dialog or question is up; there it simply does nothing.
      if (mod && event.key.toLowerCase() === 's') {
        event.preventDefault()
        if (
          ui.pendingReplacement ||
          ui.dialog ||
          ui.shareLink !== null ||
          store.commandPaletteOpen ||
          store.shortcutsOpen
        ) {
          return
        }
        if (event.shiftKey) requestSaveAs()
        else requestSave()
        return
      }

      // The discard-unsaved-work question is modal: nothing may change the
      // graph it is asking about, or open something on top of it. Its own
      // dialog handles Escape and Tab.
      if (ui.pendingReplacement) return

      // Shortcuts that must work even while a dialog or field has focus.
      if (mod && event.key.toLowerCase() === 'k' && !ui.dialog) {
        event.preventDefault()
        store.setCommandPaletteOpen(!store.commandPaletteOpen)
        return
      }
      if (event.key === 'Escape') {
        if (store.commandPaletteOpen) {
          store.setCommandPaletteOpen(false)
          return
        }
        if (ui.dialog) return // the dialog handles its own Escape
        if (typing) {
          ;(event.target as HTMLElement).blur()
          return
        }
        if (store.pendingEdgeSource) {
          store.setPendingEdgeSource(null)
          return
        }
        if (store.activeWitness) {
          store.clearWitness()
          return
        }
        if (store.algorithm) {
          store.stopAlgorithm()
          return
        }
        store.clearSelection()
        return
      }

      if (typing || ui.dialog || store.commandPaletteOpen) return

      if (mod) {
        const key = event.key.toLowerCase()
        if (key === 'z') {
          event.preventDefault()
          if (event.shiftKey) store.redo()
          else store.undo()
          return
        }
        if (key === 'y') {
          event.preventDefault()
          store.redo()
          return
        }
        if (key === 'o') {
          event.preventDefault()
          ui.openDialog('documents')
          return
        }
        if (key === 'n') {
          event.preventDefault()
          replaceWorkingGraph({ kind: 'new' })
          return
        }
        if (key === 'a') {
          event.preventDefault()
          store.select(store.graph.vertexIds, store.graph.edgeIds)
          return
        }
        return
      }

      switch (event.key) {
        case 'v':
        case 'V':
          store.setTool('select')
          return
        case 'n':
        case 'N':
          store.setTool('vertex')
          return
        case 'e':
        case 'E':
          store.setTool('edge')
          return
        case 'x':
        case 'X':
          store.setTool('erase')
          return
        case 'a':
        case 'A': {
          // Placing a vertex without a mouse: the canvas itself cannot take
          // keyboard focus, so this is how the drawing surface is reachable.
          event.preventDefault()
          const { x, y } = centreOfView(store.doc.vertices)
          store.addVertexAt(x, y)
          return
        }
        case 'f':
        case 'F':
          store.requestView('fit')
          return
        case '?':
          ui.openDialog('shortcuts')
          return
        case 'Delete':
        case 'Backspace':
          if (store.selectedVertices.length || store.selectedEdges.length) {
            event.preventDefault()
            store.deleteSelection()
          }
          return
        case ' ':
          if (store.algorithm) {
            event.preventDefault()
            store.setPlaying(!store.algorithm.playing)
          }
          return
        case 'ArrowRight':
        case 'ArrowLeft':
        case 'ArrowUp':
        case 'ArrowDown': {
          if (store.algorithm && (event.key === 'ArrowRight' || event.key === 'ArrowLeft')) {
            event.preventDefault()
            if (event.key === 'ArrowRight') store.stepForward()
            else store.stepBackward()
            return
          }
          if (!store.selectedVertices.length) return
          event.preventDefault()
          const dx = event.key === 'ArrowRight' ? NUDGE : event.key === 'ArrowLeft' ? -NUDGE : 0
          const dy = event.key === 'ArrowDown' ? NUDGE : event.key === 'ArrowUp' ? -NUDGE : 0
          const positions: Record<string, { x: number; y: number }> = {}
          for (const v of store.doc.vertices) {
            positions[v.id] = store.selectedVertices.includes(v.id)
              ? { x: v.x + dx, y: v.y + dy }
              : { x: v.x, y: v.y }
          }
          store.commitPositions(positions, 'Nudge', true)
          return
        }
        default:
          return
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}
