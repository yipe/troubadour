import { Outlet } from "react-router"
import { ErrorBanner } from "./ErrorBanner.tsx"
import { TopNav } from "./TopNav.tsx"

/** The nav, the server error strip, and a body that fills the rest of the viewport. */
export function AppLayout() {
  return (
    <div className="flex h-dvh flex-col">
      <TopNav />
      <ErrorBanner />
      <main className="min-h-0 flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  )
}
