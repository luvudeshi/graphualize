import { create } from 'zustand'

export type DialogKind =
  | 'generate'
  | 'examples'
  | 'import'
  | 'export'
  | 'documents'
  | 'algorithms'
  | 'shortcuts'
  | 'about'
  | 'save'
  | 'saveAs'

/**
 * Something about to replace the working graph: starting a new one, or opening
 * a saved one. Held here while the user decides what to do with unsaved work.
 */
export type Replacement =
  | { kind: 'new' }
  | { kind: 'open'; id: string; source: 'local' | 'cloud'; name?: string }

interface UiState {
  dialog: DialogKind | null
  openDialog: (dialog: DialogKind) => void
  closeDialog: () => void
  /** Set while the discard-unsaved-work confirmation is showing. */
  pendingReplacement: Replacement | null
  /**
   * What to do once the Save dialog has saved: "Save first" on a graph never
   * saved asks for its name, then carries on with the New or Open it was
   * guarding. Cancelling the dialog drops it, leaving the graph where it was.
   */
  afterSave: Replacement | null
  setAfterSave: (replacement: Replacement | null) => void
  askToReplace: (replacement: Replacement) => void
  clearReplacement: () => void
  /** A share link the clipboard refused, shown for copying by hand. */
  shareLink: string | null
  showShareLink: (url: string | null) => void
}

export const useUi = create<UiState>((set) => ({
  dialog: null,
  openDialog: (dialog) => set({ dialog }),
  closeDialog: () => set({ dialog: null }),
  pendingReplacement: null,
  afterSave: null,
  setAfterSave: (replacement) => set({ afterSave: replacement }),
  askToReplace: (replacement) => set({ pendingReplacement: replacement }),
  clearReplacement: () => set({ pendingReplacement: null }),
  shareLink: null,
  showShareLink: (url) => set({ shareLink: url }),
}))
