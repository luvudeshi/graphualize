/**
 * Authentication state.
 *
 * Deliberately separate from `state/store.ts`: the editor store is the graph,
 * its history and the user's work, and it must not gain a dependency on whether
 * someone is signed in. Nothing in `src/graph/` or the editor store imports
 * this file. Delete this directory and Graphualize still works.
 */
import { create } from 'zustand'
import type { Session, User } from '@supabase/supabase-js'
import { getSupabase, isAuthConfigured } from './client'
import { setSignedInProbe, useEditor } from '../state/store'
import { adoptLocalGraphs } from '../sync/adopt'
import {
  cleanOAuthParamsFromUrl,
  consumeRememberedRoute,
  isOAuthReturn,
  oauthErrorFromUrl,
  redirectTarget,
  rememberRoute,
} from './redirect'

/**
 * `unconfigured` is a first-class state, not an error. It is what every test
 * run, every `file://` copy and every fork without a Supabase project sees, and
 * it must render as "no account UI at all" rather than as a broken sign-in.
 */
export type AuthStatus =
  | 'unconfigured'
  | 'loading'
  | 'signedOut'
  | 'signingIn'
  | 'signedIn'

/** The handful of profile fields the UI shows, normalised away from Google's shape. */
export interface AuthProfile {
  id: string
  email: string | null
  name: string | null
  avatarUrl: string | null
}

export interface AuthState {
  status: AuthStatus
  profile: AuthProfile | null
  error: string | null
  initialize: () => void
  signInWithGoogle: () => Promise<void>
  signOut: () => Promise<void>
  dismissError: () => void
}

/**
 * Google fills different metadata keys depending on the provider version, and
 * a user who signed up another way may have none of them. Everything is
 * optional and the UI falls back to initials, so a missing avatar is a visual
 * detail rather than a crash.
 */
const profileFromUser = (user: User): AuthProfile => {
  const meta = user.user_metadata ?? {}
  const pick = (...keys: string[]): string | null => {
    for (const key of keys) {
      const value = meta[key]
      if (typeof value === 'string' && value.trim() !== '') return value.trim()
    }
    return null
  }
  return {
    id: user.id,
    email: user.email ?? pick('email'),
    name: pick('full_name', 'name', 'user_name', 'preferred_username'),
    avatarUrl: pick('avatar_url', 'picture'),
  }
}

const stateFromSession = (session: Session | null) =>
  session?.user
    ? { status: 'signedIn' as const, profile: profileFromUser(session.user) }
    : { status: 'signedOut' as const, profile: null }

/**
 * Everything the editor needs to do when the account changes.
 *
 * Signing in adopts any graphs left over from before saving required an
 * account, then loads the account's list. Signing out drops the list from
 * memory — signed out there is nowhere to save, so there is nothing to show.
 */
let adoptedThisSession = false

const onSignedIn = async (): Promise<void> => {
  const editor = useEditor.getState()
  if (!adoptedThisSession) {
    adoptedThisSession = true
    const outcome = await adoptLocalGraphs()
    if (outcome.message) editor.notify(outcome.message, outcome.failed > 0 ? 'error' : 'success')
  }
  await editor.refreshDocuments()
}

const onSignedOut = (): void => {
  adoptedThisSession = false
  useEditor.getState().forgetDocuments()
}

let subscribed = false

export const useAuth = create<AuthState>((set) => ({
  status: isAuthConfigured() ? 'loading' : 'unconfigured',
  profile: null,
  error: null,

  /**
   * Restores an existing session and then keeps following it.
   *
   * `getSession()` reads the persisted tokens synchronously from storage, which
   * is what makes a refresh keep you signed in. `onAuthStateChange` then covers
   * the rest of the lifecycle: the token refresh timer, a sign-out performed in
   * another tab, and the `SIGNED_IN` that arrives after the PKCE code in the
   * URL has been exchanged.
   */
  initialize: () => {
    const supabase = getSupabase()
    if (!supabase) {
      set({ status: 'unconfigured', profile: null })
      return
    }
    if (subscribed) return
    subscribed = true

    const returning = isOAuthReturn()
    const providerError = oauthErrorFromUrl()
    if (providerError) {
      set({ error: providerError })
      cleanOAuthParamsFromUrl()
    }

    supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (error) {
          set({ status: 'signedOut', profile: null, error: error.message })
          return
        }
        set(stateFromSession(data.session))
        if (data.session) void onSignedIn()
      })
      .catch(() => {
        // Offline, or the project is unreachable. The workbench does not
        // depend on any of this, so it degrades to "signed out" and says
        // nothing further.
        set({ status: 'signedOut', profile: null })
      })

    supabase.auth.onAuthStateChange((event, session) => {
      const wasSignedIn = useAuth.getState().status === 'signedIn'
      set({ ...stateFromSession(session), ...(session ? { error: null } : {}) })

      if (session && !wasSignedIn) void onSignedIn()
      if (!session && wasSignedIn) onSignedOut()

      if (event === 'SIGNED_IN' && returning) {
        cleanOAuthParamsFromUrl()
        consumeRememberedRoute()
      }
    })
  },

  signInWithGoogle: async () => {
    const supabase = getSupabase()
    if (!supabase) return
    set({ status: 'signingIn', error: null })
    rememberRoute()
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: redirectTarget(),
        // Google only returns a refresh token when it is asked to, and only
        // re-consents when told to; without these a returning user can end up
        // with a session that cannot be refreshed.
        queryParams: { access_type: 'offline', prompt: 'consent' },
      },
    })
    if (error) {
      set({ status: 'signedOut', error: error.message })
      return
    }
    // On success the browser is navigating away; leaving the status at
    // `signingIn` keeps the button in its pending state until it does.
  },

  /**
   * Ends the session and nothing else.
   *
   * Saved graphs, the working document and every editor preference live under
   * `graphualize:*` in local storage and are untouched. Signing out returns the
   * user to exactly the anonymous experience they would have had without ever
   * signing in — with their work still in front of them.
   */
  signOut: async () => {
    const supabase = getSupabase()
    if (!supabase) return
    try {
      await supabase.auth.signOut()
    } catch {
      /* Falls through: the local session is gone either way. */
    }
    // Unconditionally signed out, even when the network call failed. supabase-js
    // clears the stored session before it calls the server, so the user IS
    // signed out on this device; reporting an error here — or worse, leaving
    // their face in the header — would describe a state that no longer exists.
    // The server-side token revocation is what may not have happened, and that
    // resolves on its own when the refresh token next fails.
    set({ status: 'signedOut', profile: null, error: null })
    onSignedOut()
  },

  dismissError: () => set({ error: null }),
}))

// The editor store asks "is anyone signed in?" before saving. It imports
// nothing from here; the answer is handed to it instead.
setSignedInProbe(() => useAuth.getState().status === 'signedIn')

/** Test seam: lets a test re-run `initialize` against a fresh mock. */
export const resetAuthSubscriptionForTests = (): void => {
  subscribed = false
  useAuth.setState({
    status: isAuthConfigured() ? 'loading' : 'unconfigured',
    profile: null,
    error: null,
  })
}

/**
 * Initials for the avatar fallback: "Ada Lovelace" becomes "AL".
 *
 * Falling back to an email uses only the local part — the domain is not part of
 * anyone's name, and "ada@example.com" should read as "A", not "AE".
 */
export const initialsFor = (profile: AuthProfile): string => {
  const source = profile.name ?? profile.email?.split('@')[0] ?? '?'
  const words = source.split(/[\s._-]+/).filter(Boolean)
  const letters = words.slice(0, 2).map((word) => word[0] ?? '')
  return (letters.join('') || source[0] || '?').toUpperCase()
}
