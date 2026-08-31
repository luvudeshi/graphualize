import { useEffect, useRef, useState } from 'react'
import { initialsFor, useAuth, type AuthProfile } from './store'
import { GoogleIcon } from '../components/Icons'

/**
 * Google's own mark on a neutral button, per Google's branding requirements for
 * "Sign in with Google": their logo, unmodified, and wording from their
 * approved list.
 */
const SignInButton = ({ compact }: { compact: boolean }) => {
  const status = useAuth((s) => s.status)
  const signIn = useAuth((s) => s.signInWithGoogle)
  const pending = status === 'signingIn'

  return (
    <button
      type="button"
      onClick={() => void signIn()}
      disabled={pending}
      className={`gz-btn border ${compact ? 'px-2' : 'px-3'} gap-2 disabled:opacity-60`}
    >
      <GoogleIcon />
      <span className={compact ? 'hidden sm:inline' : ''}>
        {pending ? 'Opening Google…' : 'Continue with Google'}
      </span>
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
      className="flex shrink-0 items-center justify-center rounded-full bg-[var(--gz-accent-soft)] font-semibold text-[var(--gz-accent)]"
      style={{ width: size, height: size, fontSize: size * 0.42 }}
    >
      {initials}
    </span>
  )
}

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
        <span className="hidden max-w-32 truncate text-[0.8125rem] sm:inline">{label}</span>
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Account"
          className="gz-anim-pop absolute right-0 top-[calc(100%+6px)] z-40 w-64 rounded-lg border bg-[var(--gz-elevated)] p-1 shadow-[var(--gz-shadow)]"
        >
          <div className="flex items-center gap-2.5 px-2.5 py-2">
            <Avatar profile={profile} size={32} />
            <div className="min-w-0">
              {profile.name && (
                <p className="truncate text-[0.8125rem] font-medium">{profile.name}</p>
              )}
              {profile.email && (
                <p className="truncate text-[0.75rem] text-[var(--gz-muted)]">{profile.email}</p>
              )}
            </div>
          </div>

          {/* Saying what signing in does *not* do matters as much as what it
              does: the graphs are still local, and the user should not assume
              they are backed up. */}
          <p className="border-t px-2.5 py-2 text-[0.75rem] leading-relaxed text-[var(--gz-faint)]">
            Your graphs are still stored in this browser. Signing out keeps them.
          </p>

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false)
              void signOut()
            }}
            className="flex w-full items-center rounded-md px-2.5 py-[5px] text-left text-[0.8125rem] transition-colors hover:bg-[color-mix(in_oklab,var(--gz-border)_55%,transparent)] focus:bg-[color-mix(in_oklab,var(--gz-border)_55%,transparent)] focus:outline-none"
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
