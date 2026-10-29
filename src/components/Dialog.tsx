import { useEffect, useId, useRef, type ReactNode, type RefObject } from 'react'
import { CloseIcon } from './Icons'
import '../styles/dialogs.css'

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

export interface DialogProps {
  open: boolean
  title: string
  /** A short red small-caps line set above the title, like the plates' PROP. I. */
  marker?: string
  description?: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  /** Tailwind max-width class; defaults to a comfortable reading measure. */
  width?: string
  /**
   * Called on Escape before the dialog closes. Returning true means the
   * content handled it — backing out of an inline step — and the dialog stays.
   */
  onEscape?: () => boolean
  /**
   * The control to focus on opening, when it is not the first one — a name
   * field rather than the header's close button. Focusing it here, in the
   * same effect, leaves no moment where a keystroke lands somewhere else.
   */
  initialFocus?: RefObject<HTMLElement | null>
}

/** Modal dialog with a real focus trap and restored focus on close. */
export const Dialog = ({
  open,
  title,
  marker,
  description,
  onClose,
  children,
  footer,
  width = 'max-w-xl',
  onEscape,
  initialFocus,
}: DialogProps) => {
  const panelRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const descriptionId = useId()

  // Focus moves in when the dialog opens and back out when it closes. This
  // effect depends on `open` alone, so a changed `onClose` identity cannot
  // yank focus away from whatever the user is typing in.
  useEffect(() => {
    if (!open) return
    const restoreTo = document.activeElement as HTMLElement | null
    const panel = panelRef.current
    ;(initialFocus?.current ?? panel?.querySelector<HTMLElement>(FOCUSABLE) ?? panel)?.focus()
    return () => restoreTo?.focus?.()
  }, [open, initialFocus])

  useEffect(() => {
    if (!open) return
    const panel = panelRef.current

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        if (onEscape?.()) return
        onClose()
        return
      }
      if (event.key !== 'Tab' || !panel) return
      const focusable = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      )
      if (!focusable.length) {
        event.preventDefault()
        return
      }
      const firstEl = focusable[0]!
      const lastEl = focusable[focusable.length - 1]!
      if (event.shiftKey && document.activeElement === firstEl) {
        event.preventDefault()
        lastEl.focus()
      } else if (!event.shiftKey && document.activeElement === lastEl) {
        event.preventDefault()
        firstEl.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [open, onClose, onEscape])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:p-8">
      <div
        className="gz-wb-backdrop fixed inset-0 bg-black/35 backdrop-blur-[2px] dark:bg-black/60"
        onClick={onClose}
        aria-hidden
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className={`gz-wb-dialog gz-anim-pop relative z-10 my-auto w-full ${width} rounded-xl border bg-[var(--gz-elevated)] shadow-[var(--gz-shadow)]`}
      >
        <header className="flex items-start justify-between gap-4 border-b px-5 py-3.5">
          <div className="min-w-0">
            {marker && <span className="gz-wb-dialog-marker">{marker}</span>}
            <h2
              id={titleId}
              className="gz-wb-dialog-title text-[0.9375rem] font-semibold tracking-[-0.01em]"
            >
              {title}
            </h2>
            {description && (
              <p
                id={descriptionId}
                className="gz-wb-dialog-desc mt-0.5 text-[0.8125rem] text-[var(--gz-muted)]"
              >
                {description}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="gz-btn gz-wb-dialog-close -mr-1.5 -mt-1 shrink-0 px-1.5"
            aria-label="Close dialog"
          >
            <CloseIcon />
          </button>
        </header>
        <div className="gz-wb-dialog-body gz-scroll max-h-[min(70vh,44rem)] px-5 py-4">
          {children}
        </div>
        {footer && (
          <footer className="flex items-center justify-end gap-2 border-t px-5 py-3">
            {footer}
          </footer>
        )}
      </div>
    </div>
  )
}
