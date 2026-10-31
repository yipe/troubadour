import { useRouteError } from "react-router"
import { ErrorFallback } from "./ErrorBoundary.tsx"

/** The router's `errorElement`: a render or loader error in any route. */
export function RouteError() {
  const error = useRouteError()
  console.error(error)
  return <ErrorFallback error={error} />
}
