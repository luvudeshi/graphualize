import { useEffect, useRef, useState } from 'react'
import { Dialog } from './Dialog'
import { useEditor } from '../state/store'
import { useUi } from '../state/ui'
import { copyToClipboard } from '../state/actions'
import { copiedMessage } from '../state/share'
import { formatShortcut } from '../utils/platform'

/**
 * The fallback for File → Copy share link when the clipboard said no: the
 * link in a field that is already selected, so one keystroke copies it, and a
 * button that tries the clipboard again from a fresh click.
 */
export const ShareLinkDialog = () => {
  const url = useUi((s) => s.shareLink)
  // The link belongs to the workbench it was copied in. Leaving it (going
  // home) withdraws it, so it cannot reappear later over a different graph.
  useEffect(() => () => useUi.getState().showShareLink(null), [])
  return url === null ? null : <ShareLinkBody url={url} />
}

/** Mounted only while open, so a new link never inherits the last one's hint. */
const ShareLinkBody = ({ url }: { url: string }) => {
  const close = () => useUi.getState().showShareLink(null)
  const [refused, setRefused] = useState(false)
  const fieldRef = useRef<HTMLInputElement>(null)

  // After the dialog's own focus handling, which picks its close button, so
  // the link is selected and one keystroke copies it.
  useEffect(() => {
    fieldRef.current?.focus()
    fieldRef.current?.select()
  }, [])

  const copy = async () => {
    if (await copyToClipboard(url)) {
      useEditor.getState().notify(copiedMessage(url), 'success')
      close()
      return
    }
    fieldRef.current?.select()
    setRefused(true)
  }

  return (
    <Dialog
      open
      onClose={close}
      title="Share link"
      description="Your browser did not let Graphualize copy it, so here it is to copy yourself."
      width="max-w-lg"
      footer={
        <>
          <button type="button" className="gz-btn border px-3" onClick={close}>
            Close
          </button>
          <button type="button" className="gz-btn gz-btn-primary px-3" onClick={() => void copy()}>
            Copy
          </button>
        </>
      }
    >
      <input
        ref={fieldRef}
        readOnly
        value={url}
        onFocus={(event) => event.currentTarget.select()}
        aria-label="Share link"
        className="gz-input gz-num"
        spellCheck={false}
      />
      <p
        role={refused ? 'alert' : undefined}
        className="mt-2 text-[0.75rem] text-[var(--gz-muted)]"
      >
        {refused
          ? `Copying is blocked here. Select the link and press ${formatShortcut('mod+C')}.`
          : `Press ${formatShortcut('mod+C')} to copy the selected link. Anyone with it can open this graph.`}
      </p>
    </Dialog>
  )
}
