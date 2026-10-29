import { useEffect, useRef, useState } from 'react'
import { useToast } from '../state/toast'
import { CloseIcon } from './Icons'
import '../styles/tools.css'

/**
 * Byrne's symbols for the tone, in place of words: a cobalt disc for done, a
 * chrome-yellow bar for a caution, a vermilion triangle for a failure.
 */
const GLYPH: Record<'success' | 'warning' | 'error', { glyph: string; ink?: string }> = {
  success: { glyph: 'disc' },
  warning: { glyph: 'bar', ink: 'yellow' },
  error: { glyph: 'triangle' },
}

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

  const glyph = GLYPH[toast.tone]

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
        className="gz-anim-pop gz-wb-toast"
      >
        <span className="gz-wb-toast-glyph" aria-hidden>
          <span className="gz-wb-sign" data-glyph={glyph.glyph} data-ink={glyph.ink} />
        </span>
        <div className="gz-wb-toast-body">
          <p className="gz-wb-toast-title">{toast.title}</p>
          {toast.detail && <p className="gz-wb-toast-detail">{toast.detail}</p>}
          {toast.actions && toast.actions.length > 0 && (
            <div className="gz-wb-toast-actions">
              {toast.actions.map((action) => (
                <button
                  key={action.label}
                  type="button"
                  className="gz-wb-toast-action"
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
          className="gz-wb-toast-close"
          onClick={(event) => close(event.currentTarget.closest('[data-testid="toast"]'))}
          aria-label="Dismiss"
        >
          <CloseIcon width={14} height={14} />
        </button>
      </div>
    </div>
  )
}
