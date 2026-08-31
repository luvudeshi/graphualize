import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

/**
 * Keeps a bug in one panel from taking down the whole workbench, and shows
 * something a human can act on instead of a blank page.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error('Graphualize caught an unexpected error', error, info.componentStack)
  }

  override render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <h1 className="text-[0.9375rem] font-semibold">Something went wrong in this panel.</h1>
        <p className="max-w-md text-[0.8125rem] text-[var(--gz-muted)]">
          {this.state.error.message || 'An unexpected error occurred.'} Your graph is still saved
          in this browser.
        </p>
        <button
          type="button"
          className="gz-btn gz-btn-primary px-3"
          onClick={() => this.setState({ error: null })}
        >
          Try again
        </button>
      </div>
    )
  }
}
