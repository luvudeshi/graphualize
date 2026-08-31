/**
 * Rescues graphs saved before saving required an account.
 *
 * Earlier builds kept saved graphs in this browser's local storage. Now they
 * live in an account, and the app no longer reads the old location — so without
 * this, upgrading would look exactly like every one of those graphs being
 * deleted. On the first sign-in that finds them, they are uploaded once and the
 * local originals are left untouched.
 *
 * The originals are deliberately *not* deleted afterwards. If the upload turns
 * out to have gone somewhere the user did not expect — the wrong Google
 * account, most obviously — the only copy must still exist. They are removed
 * only when the user asks.
 */
import { listDocuments, loadDocument, deleteDocument } from '../state/documents'
import { saveCloudDocument } from './cloud'

const ADOPTED_KEY = 'graphualize:adopted:v1'

/** Ids already uploaded, so signing in twice does not duplicate everything. */
const alreadyAdopted = (): Set<string> => {
  try {
    const raw = window.localStorage.getItem(ADOPTED_KEY)
    if (!raw) return new Set()
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? new Set(parsed.filter((x) => typeof x === 'string')) : new Set()
  } catch {
    return new Set()
  }
}

const rememberAdopted = (ids: Set<string>): void => {
  try {
    window.localStorage.setItem(ADOPTED_KEY, JSON.stringify([...ids]))
  } catch {
    /* Storage refused; the worst case is offering the same graphs again. */
  }
}

/** How many local graphs are still waiting to be moved into an account. */
export const pendingLocalGraphCount = (): number => {
  const adopted = alreadyAdopted()
  return listDocuments().filter((entry) => !adopted.has(entry.id)).length
}

export interface AdoptOutcome {
  uploaded: number
  failed: number
  message: string | null
}

/**
 * Uploads every local graph that has not been uploaded before.
 *
 * Names are kept as they are and no attempt is made to match them against
 * what is already in the account: two graphs called "Untitled graph" are two
 * graphs. Guessing that they are the same would silently destroy one.
 */
export const adoptLocalGraphs = async (): Promise<AdoptOutcome> => {
  const adopted = alreadyAdopted()
  const pending = listDocuments().filter((entry) => !adopted.has(entry.id))
  if (pending.length === 0) return { uploaded: 0, failed: 0, message: null }

  let uploaded = 0
  let failed = 0

  for (const entry of pending) {
    const saved = loadDocument(entry.id)
    if (!saved) {
      // The index knows about it but the document is gone. Nothing to upload,
      // and nothing to keep pointing at.
      adopted.add(entry.id)
      continue
    }
    const result = await saveCloudDocument({
      id: null,
      name: saved.name,
      graph: saved.graph,
      expectedVersion: null,
    })
    if (result.ok) {
      uploaded += 1
      adopted.add(entry.id)
    } else {
      failed += 1
    }
  }

  rememberAdopted(adopted)

  if (uploaded === 0 && failed > 0) {
    return { uploaded, failed, message: 'Your older graphs could not be copied to your account.' }
  }
  if (failed > 0) {
    return {
      uploaded,
      failed,
      message: `Copied ${uploaded} older graph${uploaded === 1 ? '' : 's'} to your account. ${failed} could not be copied.`,
    }
  }
  return {
    uploaded,
    failed,
    message: `Copied ${uploaded} older graph${uploaded === 1 ? '' : 's'} from this browser into your account.`,
  }
}

/** Removes the local originals, once the user has confirmed they are safe. */
export const discardLocalOriginals = (): number => {
  const entries = listDocuments()
  for (const entry of entries) deleteDocument(entry.id)
  try {
    window.localStorage.removeItem(ADOPTED_KEY)
  } catch {
    /* Nothing depends on this being cleared. */
  }
  return entries.length
}
