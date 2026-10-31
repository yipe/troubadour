import type { QueryClient } from "@tanstack/react-query"
import { QueryClientProvider } from "@tanstack/react-query"
import { RouterProvider, type createBrowserRouter } from "react-router"
import { Toaster } from "@troubadour/ui/toast"
import { TooltipProvider } from "@troubadour/ui/tooltip"
import { SessionAudioProvider } from "./components/audio/SessionAudioProvider.tsx"

export function App({
  client,
  router,
}: {
  client: QueryClient
  router: ReturnType<typeof createBrowserRouter>
}) {
  return (
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <SessionAudioProvider>
          <RouterProvider router={router} />
        </SessionAudioProvider>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  )
}
