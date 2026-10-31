import { Link } from "react-router"
import { EmptyState } from "@troubadour/ui/empty-state"
import { paths } from "../paths.ts"

export function NotFound() {
  return (
    <EmptyState
      className="py-24"
      title="Page not found"
      body="There is nothing at this address."
      action={<Link to={paths.home()}>Back to Home</Link>}
    />
  )
}
