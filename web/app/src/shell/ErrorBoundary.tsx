import { Component, type ErrorInfo, type ReactNode } from "react"
import { Button } from "@troubadour/ui/button"

export function ErrorFallback({ error }: { error: unknown }) {
  const message = error instanceof Error ? error.message : String(error)
  return (
    <div className="flex h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="font-serif text-18 font-bold text-ink">Something broke. Reload to continue.</h1>
      <pre className="max-w-xl overflow-auto rounded-md bg-sunken p-3 text-left text-12 whitespace-pre-wrap text-ink-muted">
        {message}
      </pre>
      <Button variant="primary" onClick={() => location.reload()}>
        Reload
      </Button>
    </div>
  )
}

/** Last resort for errors outside the router (providers, the router itself). */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack)
  }

  override render() {
    return this.state.error ? <ErrorFallback error={this.state.error} /> : this.props.children
  }
}
