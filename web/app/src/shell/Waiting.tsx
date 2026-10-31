/** Shown until the server's first snapshot (and the first page chunk) arrive. */
export function Waiting() {
  return (
    <div className="flex h-dvh items-center justify-center text-14 text-ink-muted">
      Waiting for the Troubadour server…
    </div>
  )
}
