import { Navigate, Outlet } from "react-router"
import { useLive } from "@troubadour/api/live"
import { paths } from "../paths.ts"

/** `/sessions/live` only makes sense while a session exists. */
export function LiveGuard() {
  const status = useLive((s) => s.session?.status ?? "idle")
  return status === "idle" ? <Navigate to={paths.sessions()} replace /> : <Outlet />
}
