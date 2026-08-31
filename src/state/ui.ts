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

interface UiState {
  dialog: DialogKind | null
  openDialog: (dialog: DialogKind) => void
  closeDialog: () => void
}

export const useUi = create<UiState>((set) => ({
  dialog: null,
  openDialog: (dialog) => set({ dialog }),
  closeDialog: () => set({ dialog: null }),
}))
