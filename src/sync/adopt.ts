/**
 * Moves graphs saved in this browser into the signed-in account.
 *
 * Signed out, File → Save writes to this browser's local storage. Signing in
 * should not leave that work behind, so on every sign-in the graphs saved here
 * are uploaded — and a graph that was uploaded before but has been edited here
 * since is uploaded again, onto the same account entry rather than as a new
 * one. That is what lets someone work signed out, sign in, and find the latest
 * version of each graph in their account exactly once.
 *
 * The local originals are deliberately *not* deleted afterwards. If the upload
 * turns out to have gone somewhere the user did not expect — the wrong Google
 * account, most obviously — the only copy must still exist. They are removed
 * only when the user asks.
 */
import { listDocuments, loadDocument, deleteDocument } from '../state/documents'
import { saveCloudDocument } from './cloud'

/**
 * v1 was a bare list of uploaded ids. v2 also records which account entry each
 * one became and how far it had got, so a later edit can follow it there.
 */
const LEGACY_ADOPTED_KEY = 'graphualize:adopted:v1'
const LINKS_KEY = 'graphualize:adopted:v2'

/**
 * Where a graph saved in this browser lives in the account, if anywhere yet.
 *
 * The invariant every writer keeps: the local copy *as of `updatedAt`* is the
 * content of account entry `cloudId` at `version`. A local save after that
 * makes the local copy newer, and the next upload sends it with `version` as
 * the expected one — so if the account entry moved on in the meantime, the
 * version check keeps both instead of writing over it.
 */
export interface CloudLink {
  /** The account entry it descends from. Null when there is none to update. */
  cloudId: string | null
  /** That entry's version the local content is based on. */
  version: number | null
  /** The local `updatedAt` that matches it. A newer local save means "upload again". */
  updatedAt: number
}

type Links = Record<string, CloudLink>

const isLink = (value: unknown): value is CloudLink => {
  if (typeof value !== 'object' || value === null) return false
  const link = value as Record<string, unknown>
  return (
    (link.cloudId === null || typeof link.cloudId === 'string') &&
    (link.version === null || typeof link.version === 'number') &&
    typeof link.updatedAt === 'number'
  )
}

const parse = (raw: string | null): unknown => {
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

const writeLinks = (links: Links): void => {
  try {
    window.localStorage.setItem(LINKS_KEY, JSON.stringify(links))
  } catch {
    /* Storage refused; the worst case is offering the same graphs again. */
  }
}

/**
 * Reads the link map, migrating v1 records into it the first time.
 *
 * A v1 record says only "this id was uploaded", with no account entry to
 * update. It becomes a link with no `cloudId`, stamped with the local copy's
 * current `updatedAt` — so an untouched graph is not uploaded again, but one
 * edited from now on is, as a new entry. One extra entry is the price of not
 * knowing where the first upload went; losing the edit would be worse.
 */
const readLinks = (): Links => {
  const links: Links = {}
  try {
    const current = parse(window.localStorage.getItem(LINKS_KEY))
    if (typeof current === 'object' && current !== null && !Array.isArray(current)) {
      for (const [id, link] of Object.entries(current)) {
        if (isLink(link)) links[id] = link
      }
    }
    const legacyRaw = window.localStorage.getItem(LEGACY_ADOPTED_KEY)
    if (legacyRaw !== null) {
      const legacy = parse(legacyRaw)
      if (Array.isArray(legacy)) {
        const stamps = new Map(listDocuments().map((entry) => [entry.id, entry.updatedAt]))
        for (const id of legacy) {
          if (typeof id === 'string' && !(id in links)) {
            links[id] = { cloudId: null, version: null, updatedAt: stamps.get(id) ?? 0 }
          }
        }
      }
      writeLinks(links)
      window.localStorage.removeItem(LEGACY_ADOPTED_KEY)
    }
  } catch {
    /* Unreadable records read as "nothing uploaded yet". */
  }
  return links
}

/**
 * Every write re-reads the map and changes one entry, rather than writing back
 * a snapshot taken earlier: another tab, or a save made while an upload was in
 * flight, may have recorded a link in the meantime.
 */
const updateLinks = (change: (links: Links) => void): void => {
  const links = readLinks()
  change(links)
  writeLinks(links)
}

/** The account entry a graph saved in this browser descends from, if any. */
export const cloudLinkFor = (localId: string): CloudLink | null => readLinks()[localId] ?? null

/** Records that a graph saved in this browser now corresponds to `link`. */
export const recordCloudLink = (localId: string, link: CloudLink): void =>
  updateLinks((links) => {
    links[localId] = link
  })

/** Forgets the link, when the local graph itself has been deleted. */
export const forgetCloudLink = (localId: string): void =>
  updateLinks((links) => {
    delete links[localId]
  })

/**
 * An account entry was deleted. Local copies that pointed at it keep their
 * stamp — so an untouched one is not resurrected — but lose the target, so an
 * edited one is uploaded as a new, visible entry rather than into the deleted
 * one.
 */
export const unlinkCloudEntry = (cloudId: string): Array<{ localId: string; link: CloudLink }> => {
  const before: Array<{ localId: string; link: CloudLink }> = []
  updateLinks((links) => {
    for (const [localId, link] of Object.entries(links)) {
      if (link.cloudId === cloudId) {
        before.push({ localId, link: { ...link } })
        link.cloudId = null
        link.version = null
      }
    }
  })
  // Returned so an undone delete can put the links back as they were.
  return before
}

const needsUpload = (link: CloudLink | undefined, updatedAt: number): boolean =>
  !link || link.updatedAt < updatedAt

/** How many graphs saved in this browser are not yet (or no longer) in an account. */
export const pendingLocalGraphCount = (): number => {
  const links = readLinks()
  return listDocuments().filter((entry) => needsUpload(links[entry.id], entry.updatedAt)).length
}

/** Whether this particular graph saved here still has changes the account lacks. */
export const isPendingUpload = (localId: string): boolean => {
  const entry = listDocuments().find((candidate) => candidate.id === localId)
  return !!entry && needsUpload(readLinks()[localId], entry.updatedAt)
}

export interface AdoptOutcome {
  uploaded: number
  failed: number
  /** True when the account stopped answering part-way, so the rest was not tried. */
  unreachable: boolean
  message: string | null
}

const plural = (count: number) => `${count} graph${count === 1 ? '' : 's'}`

const runAdoption = async (): Promise<AdoptOutcome> => {
  let uploaded = 0
  let failed = 0
  let unreachable = false

  const candidates = listDocuments().map((entry) => entry.id)
  for (const id of candidates) {
    // Re-read per graph: another tab may have uploaded it while this one was
    // busy with the previous graph.
    const saved = loadDocument(id)
    const link = readLinks()[id]
    if (!saved) {
      // The index knows about it but the document is gone. Nothing to upload,
      // and nothing to keep pointing at.
      if (!link) recordCloudLink(id, { cloudId: null, version: null, updatedAt: Number.MAX_SAFE_INTEGER })
      continue
    }
    if (!needsUpload(link, saved.updatedAt)) continue
    if (unreachable) {
      failed += 1
      continue
    }

    const target = link?.cloudId != null && link.version != null ? link : null
    const result = await saveCloudDocument({
      id: target?.cloudId ?? null,
      name: saved.name,
      graph: saved.graph,
      expectedVersion: target?.version ?? null,
    })
    if (result.ok && result.data) {
      uploaded += 1
      // `saved.updatedAt`, not the index's: it is the stamp of exactly the
      // content that was just uploaded.
      recordCloudLink(id, {
        cloudId: result.data.id,
        version: result.data.version,
        updatedAt: saved.updatedAt,
      })
    } else {
      failed += 1
      if (result.unreachable) unreachable = true
    }
  }

  if (uploaded === 0 && failed === 0) return { uploaded, failed, unreachable, message: null }
  if (uploaded === 0) {
    return {
      uploaded,
      failed,
      unreachable,
      message: 'Graphs saved in this browser could not be copied to your account.',
    }
  }
  if (failed > 0) {
    return {
      uploaded,
      failed,
      unreachable,
      message: `Copied ${plural(uploaded)} from this browser to your account. ${failed} could not be copied.`,
    }
  }
  return {
    uploaded,
    failed,
    unreachable,
    message: `Copied ${plural(uploaded)} from this browser into your account.`,
  }
}

/**
 * Runs one adoption at a time — per tab through a shared promise, and across
 * tabs through the Web Locks API where the browser has it. Supabase announces
 * a sign-in to every open tab, and two tabs uploading the same graphs at once
 * would put each one in the account twice. The second tab waits, then finds
 * the links the first one recorded and has nothing left to do.
 */
let inFlight: Promise<AdoptOutcome> | null = null

const withCrossTabLock = <T>(work: () => Promise<T>): Promise<T> => {
  const locks = typeof navigator === 'undefined' ? undefined : navigator.locks
  if (!locks?.request) return work()
  return locks.request('graphualize:adopt', () => work()) as Promise<T>
}

/** The adoption currently running in this tab, if any, so a save can wait for it. */
export const adoptionInFlight = (): Promise<AdoptOutcome> | null => inFlight

/**
 * Uploads every graph saved in this browser that the account does not have
 * yet, or has an older version of.
 *
 * Names are kept as they are and no attempt is made to match them against
 * what is already in the account: two graphs called "Untitled graph" are two
 * graphs. Guessing that they are the same would silently destroy one.
 *
 * An update goes through the same version check as any other save, so if the
 * account entry moved on elsewhere in the meantime the local version is kept
 * alongside it rather than written over it.
 */
export const adoptLocalGraphs = (): Promise<AdoptOutcome> => {
  const previous = (inFlight ?? Promise.resolve(null)).catch(() => null)
  const run = previous.then(() => withCrossTabLock(runAdoption))
  const tracked = run.finally(() => {
    if (inFlight === tracked) inFlight = null
  })
  inFlight = tracked
  return tracked
}

/** Removes the local originals, once the user has confirmed they are safe. */
export const discardLocalOriginals = (): number => {
  const entries = listDocuments()
  for (const entry of entries) deleteDocument(entry.id)
  try {
    window.localStorage.removeItem(LEGACY_ADOPTED_KEY)
    window.localStorage.removeItem(LINKS_KEY)
  } catch {
    /* Nothing depends on this being cleared. */
  }
  return entries.length
}
