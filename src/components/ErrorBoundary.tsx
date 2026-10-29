import { Component, type ErrorInfo, type ReactNode } from 'react'
import '../styles/dialogs2.css'

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
      <div className="gz-wb-dlg-erratum">
        <div className="gz-wb-dlg-erratum-frame">
          <p className="gz-wb-dlg-marker" aria-hidden="true">
            Erratum.
          </p>
          <h1>Something went wrong in this panel.</h1>
          <p className="gz-wb-dlg-caption">
            {this.state.error.message || 'An unexpected error occurred.'} Your graph is still saved
            in this browser.
          </p>
          <button
            type="button"
            className="gz-btn gz-btn-primary mt-1"
            onClick={() => this.setState({ error: null })}
          >
            Try again
          </button>
        </div>
      </div>
    )
  }
}
