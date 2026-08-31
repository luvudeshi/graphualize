import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Session, User } from '@supabase/supabase-js'

/**
 * The tests below never reach the network. `getSupabase` is mocked, and each
 * test decides whether authentication is configured at all — which is the point
 * of most of them: Graphualize's contract is that an unconfigured or broken
 * auth layer is invisible rather than fatal.
 */
const signInWithOAuth = vi.fn(async () => ({ data: {}, error: null }))
const signOut = vi.fn(async () => ({ error: null }))
const getSession = vi.fn(async () => ({ data: { session: null as Session | null }, error: null }))
const onAuthStateChange = vi.fn(
  (_handler: (event: string, session: Session | null) => void) => ({
    data: { subscription: { unsubscribe: vi.fn() } },
  }),
)

let configured = true

vi.mock('./client', () => ({
  isAuthConfigured: () => configured,
  supabaseUrl: () => 'https://example.supabase.co',
  getSupabase: () =>
    configured
      ? { auth: { signInWithOAuth, signOut, getSession, onAuthStateChange } }
      : null,
  resetSupabaseForTests: () => {},
}))

const { useAuth, resetAuthSubscriptionForTests, initialsFor } = await import('./store')
const { AccountMenu } = await import('./AccountMenu')

const userWith = (meta: Record<string, unknown>, email = 'ada@example.com'): User =>
  ({ id: 'user-1', email, user_metadata: meta }) as unknown as User

const sessionFor = (user: User): Session => ({ user }) as unknown as Session

beforeEach(() => {
  configured = true
  vi.clearAllMocks()
  getSession.mockResolvedValue({ data: { session: null }, error: null })
  window.localStorage.clear()
  window.sessionStorage.clear()
  resetAuthSubscriptionForTests()
})

describe('the test environment itself', () => {
  it('never sees a developer’s real Supabase project', () => {
    // Vite loads .env.local into test runs. If that leaked through, this suite
    // would exercise different branches on a configured machine than in CI,
    // and a test that reached initialize() would hit a live project. The
    // vitest config pins these empty; this asserts the pin is still there.
    expect(import.meta.env.VITE_SUPABASE_URL || '').toBe('')
    expect(import.meta.env.VITE_SUPABASE_ANON_KEY || '').toBe('')
  })
})

describe('when Supabase is not configured', () => {
  it('reports "unconfigured" rather than an error', () => {
    configured = false
    resetAuthSubscriptionForTests()
    useAuth.getState().initialize()
    expect(useAuth.getState().status).toBe('unconfigured')
  })

  it('renders no account UI at all, so anonymous use is untouched', () => {
    configured = false
    resetAuthSubscriptionForTests()
    const { container } = render(<AccountMenu />)
    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByText(/continue with google/i)).not.toBeInTheDocument()
  })

  it('never calls Supabase, even if something invokes the actions', async () => {
    configured = false
    resetAuthSubscriptionForTests()
    await useAuth.getState().signInWithGoogle()
    await useAuth.getState().signOut()
    expect(signInWithOAuth).not.toHaveBeenCalled()
    expect(signOut).not.toHaveBeenCalled()
  })
})

describe('restoring a session', () => {
  it('signs the user in from persisted storage on load', async () => {
    getSession.mockResolvedValue({
      data: { session: sessionFor(userWith({ full_name: 'Ada Lovelace' })) },
      error: null,
    })
    useAuth.getState().initialize()
    await waitFor(() => expect(useAuth.getState().status).toBe('signedIn'))
    expect(useAuth.getState().profile?.name).toBe('Ada Lovelace')
  })

  it('lands on signed out when there is no stored session', async () => {
    useAuth.getState().initialize()
    await waitFor(() => expect(useAuth.getState().status).toBe('signedOut'))
    expect(useAuth.getState().profile).toBeNull()
  })

  it('degrades to signed out when the project is unreachable', async () => {
    getSession.mockRejectedValue(new Error('network down'))
    useAuth.getState().initialize()
    await waitFor(() => expect(useAuth.getState().status).toBe('signedOut'))
    // The failure is not surfaced: being offline is not a sign-in error.
    expect(useAuth.getState().error).toBeNull()
  })

  it('subscribes to auth changes exactly once across repeated initialize calls', () => {
    useAuth.getState().initialize()
    useAuth.getState().initialize()
    useAuth.getState().initialize()
    expect(onAuthStateChange).toHaveBeenCalledTimes(1)
  })

  it('follows a sign-out that happened in another tab', async () => {
    getSession.mockResolvedValue({
      data: { session: sessionFor(userWith({ full_name: 'Ada' })) },
      error: null,
    })
    useAuth.getState().initialize()
    await waitFor(() => expect(useAuth.getState().status).toBe('signedIn'))

    const handler = onAuthStateChange.mock.calls[0]![0]
    handler('SIGNED_OUT', null)
    expect(useAuth.getState().status).toBe('signedOut')
    expect(useAuth.getState().profile).toBeNull()
  })
})

describe('signing in', () => {
  it('asks Google for a code flow back to this origin', async () => {
    await useAuth.getState().signInWithGoogle()
    expect(signInWithOAuth).toHaveBeenCalledTimes(1)
    const options = signInWithOAuth.mock.calls[0]![0] as {
      provider: string
      options: { redirectTo: string; queryParams: Record<string, string> }
    }
    expect(options.provider).toBe('google')
    expect(options.options.redirectTo).toBe(
      `${window.location.origin}${window.location.pathname}`,
    )
    // A refresh token needs both of these; without them the session dies early.
    expect(options.options.queryParams.access_type).toBe('offline')
  })

  it('remembers the route so the user comes back to where they were', async () => {
    window.location.hash = '#/graph'
    await useAuth.getState().signInWithGoogle()
    expect(window.sessionStorage.getItem('graphualize:auth:return-to')).toBe('#/graph')
  })

  it('never puts the route in redirectTo, which has to stay allow-listable', async () => {
    window.location.hash = '#/graph'
    await useAuth.getState().signInWithGoogle()
    const options = signInWithOAuth.mock.calls[0]![0] as { options: { redirectTo: string } }
    expect(options.options.redirectTo).not.toContain('#')
    expect(options.options.redirectTo).not.toContain('?')
  })

  it('reports a refused sign-in instead of hanging in a pending state', async () => {
    signInWithOAuth.mockResolvedValueOnce({
      data: {},
      error: { message: 'provider is not enabled' },
    } as never)
    await useAuth.getState().signInWithGoogle()
    expect(useAuth.getState().status).toBe('signedOut')
    expect(useAuth.getState().error).toMatch(/not enabled/)
  })
})

describe('signing out', () => {
  it('clears the profile', async () => {
    getSession.mockResolvedValue({
      data: { session: sessionFor(userWith({ full_name: 'Ada' })) },
      error: null,
    })
    useAuth.getState().initialize()
    await waitFor(() => expect(useAuth.getState().status).toBe('signedIn'))

    await useAuth.getState().signOut()
    expect(signOut).toHaveBeenCalled()
    expect(useAuth.getState().status).toBe('signedOut')
    expect(useAuth.getState().profile).toBeNull()
  })

  it('signs out locally even when the server call fails', async () => {
    // supabase-js clears the stored session before it calls the server, so the
    // user is signed out on this device regardless. Leaving them looking signed
    // in, or showing an error, would both be wrong.
    useAuth.setState({
      status: 'signedIn',
      profile: { id: 'u', email: 'a@b.c', name: 'Ada', avatarUrl: null },
    })
    signOut.mockRejectedValueOnce(new Error('network down'))
    await useAuth.getState().signOut()
    expect(useAuth.getState().status).toBe('signedOut')
    expect(useAuth.getState().profile).toBeNull()
    expect(useAuth.getState().error).toBeNull()
  })

  it('leaves every saved graph in place', async () => {
    // The promise of "anonymous usage keeps working" is worthless if signing
    // out takes the user's work with it.
    window.localStorage.setItem('graphualize:index:v1', '[{"id":"doc-1","name":"Homework"}]')
    window.localStorage.setItem('graphualize:doc:doc-1', '{"graph":{}}')
    window.localStorage.setItem('graphualize:session:v1', '{"name":"Untitled graph"}')

    await useAuth.getState().signOut()

    expect(window.localStorage.getItem('graphualize:index:v1')).toContain('Homework')
    expect(window.localStorage.getItem('graphualize:doc:doc-1')).toBeTruthy()
    expect(window.localStorage.getItem('graphualize:session:v1')).toBeTruthy()
  })
})

describe('the profile shown in the header', () => {
  it('reads Google’s metadata shape', async () => {
    getSession.mockResolvedValue({
      data: {
        session: sessionFor(
          userWith({ full_name: 'Ada Lovelace', avatar_url: 'https://img/a.png' }),
        ),
      },
      error: null,
    })
    useAuth.getState().initialize()
    await waitFor(() => expect(useAuth.getState().status).toBe('signedIn'))
    const profile = useAuth.getState().profile!
    expect(profile.name).toBe('Ada Lovelace')
    expect(profile.avatarUrl).toBe('https://img/a.png')
    expect(profile.email).toBe('ada@example.com')
  })

  it('accepts the alternative keys Google sometimes sends', async () => {
    getSession.mockResolvedValue({
      data: { session: sessionFor(userWith({ name: 'Grace', picture: 'https://img/g.png' })) },
      error: null,
    })
    useAuth.getState().initialize()
    await waitFor(() => expect(useAuth.getState().profile?.name).toBe('Grace'))
    expect(useAuth.getState().profile?.avatarUrl).toBe('https://img/g.png')
  })

  it('survives a user with no metadata whatsoever', async () => {
    getSession.mockResolvedValue({
      data: { session: sessionFor(userWith({})) },
      error: null,
    })
    useAuth.getState().initialize()
    await waitFor(() => expect(useAuth.getState().status).toBe('signedIn'))
    const profile = useAuth.getState().profile!
    expect(profile.name).toBeNull()
    expect(profile.avatarUrl).toBeNull()
    expect(initialsFor(profile)).toBe('A')
  })

  it('builds initials from a name, an email, or nothing', () => {
    const base = { id: 'x', email: null, avatarUrl: null }
    expect(initialsFor({ ...base, name: 'Ada Lovelace' })).toBe('AL')
    expect(initialsFor({ ...base, name: 'Ada' })).toBe('A')
    expect(initialsFor({ ...base, name: null, email: 'grace.hopper@navy.mil' })).toBe('GH')
    expect(initialsFor({ ...base, name: null, email: 'ada@example.com' })).toBe('A')
    expect(initialsFor({ ...base, name: null })).toBe('?')
  })
})

describe('the account menu', () => {
  it('offers Continue with Google when signed out', async () => {
    useAuth.setState({ status: 'signedOut', profile: null })
    render(<AccountMenu />)
    expect(screen.getByRole('button', { name: /continue with google/i })).toBeInTheDocument()
  })

  it('shows nothing rather than a sign-in button while the session loads', () => {
    // Otherwise every refresh flashes "Continue with Google" at a user who is
    // already signed in.
    useAuth.setState({ status: 'loading', profile: null })
    render(<AccountMenu />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('shows the name and avatar once signed in', () => {
    useAuth.setState({
      status: 'signedIn',
      profile: {
        id: 'u',
        email: 'ada@example.com',
        name: 'Ada Lovelace',
        avatarUrl: 'https://img/a.png',
      },
    })
    const { container } = render(<AccountMenu />)
    expect(screen.getByRole('button', { name: /account: ada lovelace/i })).toBeInTheDocument()
    // The avatar is decorative (alt=""), so it has no img role to query by:
    // the accessible name comes from the button's aria-label instead.
    expect(container.querySelector('img')).toHaveAttribute('src', 'https://img/a.png')
  })

  it('signs out from the menu', async () => {
    const user = userEvent.setup()
    useAuth.setState({
      status: 'signedIn',
      profile: { id: 'u', email: 'ada@example.com', name: 'Ada', avatarUrl: null },
    })
    render(<AccountMenu />)
    await user.click(screen.getByRole('button', { name: /account: ada/i }))
    await user.click(screen.getByRole('menuitem', { name: 'Sign out' }))
    expect(signOut).toHaveBeenCalledTimes(1)
  })

  it('is honest that graphs are still local', async () => {
    const user = userEvent.setup()
    useAuth.setState({
      status: 'signedIn',
      profile: { id: 'u', email: 'ada@example.com', name: 'Ada', avatarUrl: null },
    })
    render(<AccountMenu />)
    await user.click(screen.getByRole('button', { name: /account: ada/i }))
    expect(screen.getByText(/still stored in this browser/i)).toBeInTheDocument()
  })
})
