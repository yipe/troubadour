import { Navigate, useParams } from "react-router"

/** Old URL to new: `to` receives the old route's params (already decoded). */
export function Redirect({ to }: { to: (params: Readonly<Record<string, string | undefined>>) => string }) {
  return <Navigate to={to(useParams())} replace />
}
