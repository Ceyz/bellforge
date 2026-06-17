import { Component, type ErrorInfo, type ReactNode } from 'react'

/** App error boundary: a thrown render error shows a recoverable forge card
    instead of a blank app. Kept dependency-light (plain elements, no motion/Button)
    so the FALLBACK itself can't crash. Place one at the top level (last resort) and
    one per routed page (keyed by pathname so navigating away clears the error). */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // No telemetry endpoint — surface to the console for debugging.
    console.error('Bellforge UI error:', error, info.componentStack)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center">
        <div className="max-w-md rounded-card border border-ink-600 bg-ink-800/60 p-8">
          <h2 className="font-display text-xl text-text-hi">Something cracked in the forge</h2>
          <p className="mt-3 text-sm leading-relaxed text-text-mid">
            A part of the interface hit an unexpected error. Your wallet and funds are untouched — nothing was
            signed or sent.
          </p>
          <p className="mt-3 break-words rounded-btn bg-ink-900 p-2.5 font-mono text-[11px] text-text-lo">
            {error.message || 'Unknown error'}
          </p>
          <div className="mt-5 flex justify-center gap-3">
            <button
              type="button"
              onClick={() => this.setState({ error: null })}
              className="rounded-btn bg-gradient-to-b from-forge-400 to-forge-600 px-4 py-2 text-sm font-semibold text-ink-950 transition hover:brightness-110"
            >
              Try again
            </button>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded-btn border border-ink-600 bg-ink-800 px-4 py-2 text-sm font-medium text-text-hi transition hover:border-zinc-500"
            >
              Reload
            </button>
          </div>
        </div>
      </div>
    )
  }
}
