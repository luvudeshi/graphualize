import { useEffect, useRef, useState } from 'react'
import { initialsFor, useAuth, type AuthProfile } from './store'
import { GoogleIcon } from '../components/Icons'
// The sheet and its item are drawn by the header's styles on either page.
import '../styles/header.css'

/**
 * Google's own mark on a neutral button, per Google's branding requirements for
 * "Sign in with Google": their logo, unmodified, and wording from their
 * approved list.
 */
const SignInButton = ({ compact }: { compact: boolean }) => {
  const status = useAuth((s) => s.status)
  const signIn = useAuth((s) => s.signInWithGoogle)
  const pending = status === 'signingIn'
  const label = pending ? 'Opening Google…' : 'Continue with Google'

  return (
    <button
      type="button"
      onClick={() => void signIn()}
      disabled={pending}
      // A compact button hides its words on a phone, leaving only the logo, so
      // it says them to assistive technology instead.
      aria-label={compact ? label : undefined}
      className={`gz-btn border ${compact ? 'px-2' : 'px-3'} gap-2 disabled:opacity-60`}
    >
      <GoogleIcon />
      <span className={compact ? 'hidden sm:inline' : ''}>{label}</span>
    </button>
  )
}

const Avatar = ({ profile, size = 24 }: { profile: AuthProfile; size?: number }) => {
  // A Google avatar URL can 404 once the photo changes, so a failed load falls
  // back to initials rather than leaving a broken image in the header.
  const [failed, setFailed] = useState(false)
  const initials = initialsFor(profile)

  if (profile.avatarUrl && !failed) {
    return (
      <img
        src={profile.avatarUrl}
        alt=""
        width={size}
        height={size}
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className="shrink-0 rounded-full object-cover"
        style={{ width: size, height: size }}
      />
    )
  }
  return (
    <span
      aria-hidden="true"
      className="gz-wb-avatar-initials flex shrink-0 items-center justify-center rounded-full"
      style={{ width: size, height: size, fontSize: size * 0.42 }}
    >
      {initials}
    </span>
  )
}

/*
 * The control is a keycap (`.gz-btn`) and its sheet is glass (`.gz-glass`),
 * both from index.css; what is on the sheet (`gz-wb-account-*`, and the
 * `gz-wb-item` it shares with the menus) is set in styles/header.css. None of
 * it depends on where the control is mounted, so it is drawn the same in the
 * workbench's masthead and in the home page's header.
 */
const SignedInMenu = ({ profile }: { profile: AuthProfile }) => {
  const signOut = useAuth((s) => s.signOut)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const label = profile.name ?? profile.email ?? 'your account'

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account: ${label}`}
        className="gz-btn gap-2 px-1.5"
      >
        <Avatar profile={profile} />
        <span className="gz-wb-account-name hidden max-w-32 truncate text-[0.8125rem] sm:inline">{label}</span>
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Account"
          className="gz-glass gz-wb-account-sheet gz-anim-pop absolute right-0 top-[calc(100%+6px)] z-40 w-64"
        >
          <div className="gz-wb-account-who">
            <Avatar profile={profile} size={32} />
            <div className="gz-wb-account-id">
              {profile.name && <p className="gz-wb-account-id-name">{profile.name}</p>}
              {profile.email && <p className="gz-wb-account-id-mail">{profile.email}</p>}
            </div>
          </div>

          {/* Where saves go is the one thing signing in changes, so it is said
              here plainly — along with the fact that signing out loses nothing. */}
          <p className="gz-wb-account-note">
            Graphs you save go to your Google account. Signing out keeps them there, and
            saving then keeps graphs in this browser.
          </p>

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false)
              void signOut()
            }}
            className="gz-wb-item"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  )
}

/**
 * The account control for either header.
 *
 * Renders nothing at all when authentication is not configured — which is the
 * case in the `file://` build, in the test runner, and in any checkout without
 * a Supabase project. Graphualize has always worked without an account and
 * still does; this is an addition to the header, never a gate in front of it.
 */
export const AccountMenu = ({ compact = false }: { compact?: boolean }) => {
  const status = useAuth((s) => s.status)
  const profile = useAuth((s) => s.profile)

  if (status === 'unconfigured') return null
  // `loading` resolves from local storage in a tick or two. Rendering a
  // sign-in button first would make an already-signed-in user's header flicker
  // from "Continue with Google" to their own face on every single refresh.
  if (status === 'loading') return <div aria-hidden="true" className="h-7 w-7" />
  if (status === 'signedIn' && profile) return <SignedInMenu profile={profile} />
  return <SignInButton compact={compact} />
}

/** A one-line, dismissible report of a failed sign-in. */
export const AuthErrorNotice = () => {
  const error = useAuth((s) => s.error)
  const dismiss = useAuth((s) => s.dismissError)
  if (!error) return null
  return (
    <div
      role="status"
      className="mx-auto mt-3 flex max-w-3xl items-start gap-3 rounded-md border border-[var(--gz-danger)] bg-[color-mix(in_oklab,var(--gz-danger)_10%,transparent)] px-3 py-2 text-[0.8125rem] text-[var(--gz-danger)]"
    >
      <span className="flex-1">Sign-in did not complete. {error}</span>
      <button type="button" onClick={dismiss} className="shrink-0 underline">
        Dismiss
      </button>
    </div>
  )
}
