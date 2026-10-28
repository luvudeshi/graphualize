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
  askToReplace: (replacement: Replacement) => void
  clearReplacement: () => void
}

export const useUi = create<UiState>((set) => ({
  dialog: null,
  openDialog: (dialog) => set({ dialog }),
  closeDialog: () => set({ dialog: null }),
  pendingReplacement: null,
  askToReplace: (replacement) => set({ pendingReplacement: replacement }),
  clearReplacement: () => set({ pendingReplacement: null }),
}))
