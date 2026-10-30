import { useEffect, useState } from "react"
import { useLiveStore, type LiveState } from "./store.ts"

export function useLive<T>(selector: (state: LiveState) => T): T {
  return useLiveStore(selector)
}

/** Current session seconds, interpolated client-side from the last `session.t` while running. */
export function sessionTimeNow(): number {
  const { session, sessionAt } = useLiveStore.getState()
  if (!session) return 0
  if (session.status !== "running") return session.t
  const rate =
    session.source?.kind === "file" || session.source?.kind === "session" ? session.source.speed : 1
  return session.t + ((performance.now() - sessionAt) / 1000) * rate
}

export function useSessionTime(intervalMs = 500): number {
  const status = useLiveStore((s) => s.session?.status)
  const [, tick] = useState(0)
  useEffect(() => {
    if (status !== "running") return
    const id = setInterval(() => tick((n) => n + 1), intervalMs)
    return () => clearInterval(id)
  }, [status, intervalMs])
  return sessionTimeNow()
}

/** No session is running or paused: what jobs that use the voice model wait for. */
export function useIdle(): boolean {
  return useLiveStore((s) => (s.session?.status ?? "idle") === "idle")
}
