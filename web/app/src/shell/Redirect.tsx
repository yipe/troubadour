import { Navigate, useParams, useSearchParams } from "react-router"

/** Old URL to new: `to` receives the old route's params (already decoded) and its query string. */
export function Redirect({
  to,
}: {
  to: (params: Readonly<Record<string, string | undefined>>, search: URLSearchParams) => string
}) {
  const [search] = useSearchParams()
  return <Navigate to={to(useParams(), search)} replace />
}
