import { useEffect, useRef, useState } from 'react'
import { useToast } from '../state/toast'
import { AlertIcon, CheckIcon, CloseIcon } from './Icons'

/** How long each tone stays up on its own. An error waits to be dismissed. */
const LIFETIME: Record<'success' | 'warning' | 'error', number | null> = {
  success: 3200,
  warning: 7000,
  error: null,
}

/**
 * The toast card, bottom centre above the status bar.
 *
 * It is the visible answer; the status bar's live region remains the one that
 * is announced, so a screen reader does not hear every save twice. It holds
 * still while the pointer or focus is on it, so its actions can be reached.
 *
 * It sits beneath the modal layer (z-40 against the dialogs' z-50): an open
 * dialog's backdrop covers it, so it can never block a dialog's buttons or be
 * clicked from outside a dialog's focus trap.
 */
export const Toaster = () => {
  const toast = useToast((s) => s.toast)
  const dismiss = useToast((s) => s.dismiss)
  // Which toast is being held, not whether one is: a held toast that goes away
  // (dismissed, replaced) never fires mouseleave or blur, and a boolean would
  // stay stuck and stop every later toast from leaving on its own.
  const [heldId, setHeldId] = useState<number | null>(null)
  // Where focus was before it moved into the toast, to send it back there
  // when the toast goes rather than dropping it on <body>.
  const returnFocus = useRef<HTMLElement | null>(null)
  const held = toast !== null && heldId === toast.id

  useEffect(() => {
    if (!toast || held) return
    const lifetime = LIFETIME[toast.tone]
    if (lifetime === null) return
    const handle = window.setTimeout(() => dismiss(toast.id), lifetime)
    return () => window.clearTimeout(handle)
  }, [toast, held, dismiss])

  if (!toast) return null

  const close = (container: HTMLElement | null) => {
    const hadFocus = container?.contains(document.activeElement) ?? false
    dismiss(toast.id)
    if (hadFocus) {
      const target = returnFocus.current
      ;(target?.isConnected ? target : document.querySelector<HTMLElement>('[data-save-button]'))?.focus()
    }
    returnFocus.current = null
  }

  const accent =
    toast.tone === 'success'
      ? 'text-[var(--gz-success)]'
      : toast.tone === 'warning'
        ? 'text-[var(--gz-warning)]'
        : 'text-[var(--gz-danger)]'

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-10 z-40 flex justify-center px-4">
      <div
        key={toast.id}
        data-testid="toast"
        data-tone={toast.tone}
        onMouseEnter={() => setHeldId(toast.id)}
        onMouseLeave={() => setHeldId(null)}
        onFocus={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            returnFocus.current = event.relatedTarget as HTMLElement | null
          }
          setHeldId(toast.id)
        }}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setHeldId(null)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') close(event.currentTarget)
        }}
        className="gz-anim-pop pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border bg-[var(--gz-elevated)] px-3.5 py-3 shadow-[var(--gz-shadow)]"
      >
        <span className={`mt-0.5 shrink-0 ${accent}`}>
          {toast.tone === 'success' ? (
            <CheckIcon width={18} height={18} />
          ) : (
            <AlertIcon width={18} height={18} />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[0.8125rem] font-semibold">{toast.title}</p>
          {toast.detail && (
            <p className="mt-0.5 text-[0.75rem] leading-relaxed text-[var(--gz-muted)]">
              {toast.detail}
            </p>
          )}
          {toast.actions && toast.actions.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {toast.actions.map((action) => (
                <button
                  key={action.label}
                  type="button"
                  className="gz-btn border px-2 text-[0.75rem]"
                  onClick={(event) => {
                    close(event.currentTarget.closest('[data-testid="toast"]'))
                    action.run()
                  }}
                >
                  {action.label}
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          type="button"
          className="gz-btn -mr-1 -mt-1 shrink-0 px-1 text-[var(--gz-faint)] hover:text-[var(--gz-text)]"
          onClick={(event) => close(event.currentTarget.closest('[data-testid="toast"]'))}
          aria-label="Dismiss"
        >
          <CloseIcon width={14} height={14} />
        </button>
      </div>
    </div>
  )
}
