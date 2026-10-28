/**
 * Share links, from the workbench's side: copying a link to the graph on
 * screen, and opening one that arrived in the URL.
 *
 * The encoding itself lives in `graph/serialization/link.ts` and knows nothing
 * about windows or clipboards. This module adds the parts that do: where the
 * page is served from, the clipboard and its fallbacks, and the status bar.
 */
import { useEditor } from './store'
import { useUi } from './ui'
import { copyToClipboard } from './actions'
import { shareHash } from '../app/router'
import { decodeShareCode, encodeShareCode } from '../graph/serialization/link'

export type ShareLinkResult = { ok: true; url: string } | { ok: false; reason: string }

/**
 * Past this many characters a link still works in every browser, but chat
 * apps and mail clients start cutting long URLs short, so the confirmation
 * says how long it is.
 */
export const LONG_SHARE_LINK = 2000

/**
 * The full URL for a share code. Built from the protocol, host and path only:
 * the query string can hold things that must never travel in a link someone
 * else will open, such as an OAuth `?code=` on the way back from sign-in.
 */
export const shareUrlFor = (code: string): string => {
  const { protocol, host, pathname } = window.location
  return `${protocol}//${host}${pathname}${shareHash(code)}`
}

/** A link to the graph on screen, or the sentence explaining why there is none. */
export const createShareLink = async (): Promise<ShareLinkResult> => {
  const { name, doc } = useEditor.getState()
  if (doc.vertices.length === 0) {
    return { ok: false, reason: 'There is nothing to share yet. Draw a graph first.' }
  }
  const encoded = await encodeShareCode({ name, doc })
  if (!encoded.ok) {
    return {
      ok: false,
      reason: `This graph cannot be shared as a link: ${encoded.reason} Export it as a file instead.`,
    }
  }
  return { ok: true, url: shareUrlFor(encoded.code) }
}

/**
 * Asks for the clipboard *now*, during the click, and fills it in once the
 * link is ready.
 *
 * Safari lets a page write to the clipboard only during the gesture that asked
 * for it, and encoding is asynchronous (it compresses), so by the time the
 * link exists the click is over and `writeText` is refused. A `ClipboardItem`
 * built from a promise is the sanctioned way around that. False when the API
 * is missing or the write was refused, so the caller can try something else.
 */
const writeWhenReady = async (pending: Promise<ShareLinkResult>): Promise<boolean> => {
  if (typeof ClipboardItem === 'undefined' || typeof navigator.clipboard?.write !== 'function') {
    return false
  }
  try {
    const blob = pending.then((link) => {
      if (!link.ok) throw new Error(link.reason)
      return new Blob([link.url], { type: 'text/plain' })
    })
    // The caller reports a failed link itself; this rejection is expected.
    blob.catch(() => {})
    await navigator.clipboard.write([new ClipboardItem({ 'text/plain': blob })])
    return true
  } catch {
    return false
  }
}

export const copiedMessage = (url: string): string =>
  url.length > LONG_SHARE_LINK
    ? `Link copied. It is ${url.length.toLocaleString('en-US')} characters long, so some apps may cut it short.`
    : 'Link copied'

/**
 * File → Copy share link. Puts a link to the graph on screen on the clipboard
 * and says so in the status bar; when no clipboard route works — no API at
 * all, or permission refused — the link is shown in a dialog to copy by hand.
 * A graph too large for a link is reported, never truncated into a broken one.
 *
 * Resolves to true when the link reached the clipboard.
 */
export const copyShareLink = async (): Promise<boolean> => {
  const pending = createShareLink()
  const early = writeWhenReady(pending)
  const link = await pending
  const notify = useEditor.getState().notify
  if (!link.ok) {
    notify(link.reason, 'error')
    return false
  }
  if ((await early) || (await copyToClipboard(link.url))) {
    notify(copiedMessage(link.url), 'success')
    return true
  }
  useUi.getState().showShareLink(link.url)
  return false
}

/**
 * Opens the graph a share link carries as a new, undoable replacement —
 * exactly like a generator command, because nothing is lost: Undo brings back
 * whatever was on screen. A link that cannot be read leaves the canvas alone
 * and says why.
 */
export const openSharedGraph = async (code: string): Promise<boolean> => {
  const result = await decodeShareCode(code)
  const state = useEditor.getState()
  if (!result.ok) {
    state.notify(`This share link cannot be opened: ${result.reason}`, 'error')
    return false
  }
  state.replaceDocument(result.document, 'Open shared graph', { title: result.name })
  state.notify(`Opened shared graph "${result.name}"`, 'success')
  return true
}
