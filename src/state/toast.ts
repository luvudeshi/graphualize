/**
 * One short-lived message card, for outcomes worth noticing — a save, most of
 * all. The status bar keeps narrating everything else; a toast is for the few
 * moments where "did that work?" deserves an answer the user cannot miss.
 *
 * Only one is shown at a time: a newer one replaces the last, which is what
 * repeated saves want (the latest outcome is the one that matters).
 */
import { create } from 'zustand'

export interface ToastAction {
  label: string
  run: () => void
}

export interface Toast {
  id: number
  tone: 'success' | 'warning' | 'error'
  title: string
  detail?: string
  actions?: ToastAction[]
}

interface ToastState {
  toast: Toast | null
  show: (toast: Omit<Toast, 'id'>) => void
  dismiss: (id?: number) => void
}

let counter = 0

export const useToast = create<ToastState>((set, get) => ({
  toast: null,
  show: (toast) => set({ toast: { ...toast, id: ++counter } }),
  // With an id, only that toast: a timer from an older one must not close a newer one.
  dismiss: (id) => {
    if (id === undefined || get().toast?.id === id) set({ toast: null })
  },
}))
