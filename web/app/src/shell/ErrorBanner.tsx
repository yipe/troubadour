import { useLive } from "@troubadour/api/live"

/** `session.error` (e.g. the models failed to load) as a strip under the nav. */
export function ErrorBanner() {
  const error = useLive((s) => s.session?.error)
  if (!error) return null
  return (
    <div role="alert" className="border-b border-line bg-danger-soft px-5 py-2 text-13 text-danger">
      {error}
    </div>
  )
}
