import { useEffect, useRef } from "react"
import { Navigate, Outlet, useLocation } from "react-router"
import { useLive } from "@troubadour/api/live"
import { useSessions } from "@troubadour/api/sessions"
import { paths } from "../paths.ts"
import { Waiting } from "./Waiting.tsx"

/**
 * Holds the whole app until the server's first snapshot arrives, then makes the one-time startup
 * redirects from `/`: a first run goes to the wizard, a session already in progress goes to Live.
 * Once the gate has let the user in, Home is left alone.
 */
export function RootGate() {
  const loaded = useLive((s) => s.loaded)
  const seated = useLive((s) => s.players.length)
  const status = useLive((s) => s.session?.status ?? "idle")
  const sessions = useSessions()
  const { pathname } = useLocation()
  // A ref, not state: it only has to survive until the next render, and the Navigate below (or the
  // user) changes the location anyway.
  const admitted = useRef(false)
  // The saved-session list decides "first run". A failed fetch must not trap the user on the wait screen.
  const waitingForSessions = pathname === "/" && sessions.isPending

  useEffect(() => {
    if (loaded && !waitingForSessions) admitted.current = true
  })

  if (!loaded || waitingForSessions) return <Waiting />
  // oxlint-disable-next-line react/refs -- read on purpose: the flag is only written after commit
  if (!admitted.current && pathname === "/") {
    const firstRun = seated === 0 && sessions.data?.length === 0
    if (firstRun) return <Navigate to={paths.welcome("campaign")} replace />
    if (status === "running" || status === "paused") return <Navigate to={paths.live()} replace />
  }
  return <Outlet />
}
