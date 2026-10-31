import { QueryClientProvider, type QueryKey } from "@tanstack/react-query"
import { render } from "@testing-library/react"
import type { ReactElement } from "react"
import { createMemoryRouter, MemoryRouter, RouterProvider } from "react-router"
import { resetLive, useLiveStore, type LiveState } from "@troubadour/api/live"
import { makeQueryClient } from "@troubadour/api/query"
import { TooltipProvider } from "@troubadour/ui/tooltip"
import { SessionAudioProvider } from "../components/audio/SessionAudioProvider.tsx"
import { createRoutes } from "../routes.tsx"
import "./setup.ts"

export interface RenderOptions {
  route?: string
  /** Seeds the live store, which starts out `loaded` (the server has answered). */
  live?: Partial<LiveState>
  /** Seeds the query cache: `[key, data]` pairs. */
  queryData?: [QueryKey, unknown][]
}

function seed({ live, queryData = [] }: RenderOptions) {
  resetLive()
  // `sessionAt` is when `session` arrived; left at 0, a running session's clock would add the test process's uptime.
  useLiveStore.setState({ loaded: true, connected: true, sessionAt: performance.now(), ...live })
  const client = makeQueryClient()
  for (const [key, data] of queryData) client.setQueryData(key, data)
  return client
}

/** A component in a fresh query client, a memory router at `route`, and a seeded live store. */
export function renderWithProviders(ui: ReactElement, options: RenderOptions = {}) {
  const client = seed(options)
  const result = render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <SessionAudioProvider>
          <MemoryRouter initialEntries={[options.route ?? "/"]}>{ui}</MemoryRouter>
        </SessionAudioProvider>
      </TooltipProvider>
    </QueryClientProvider>,
  )
  return { ...result, client }
}

/** The whole route table (gate, layouts, lazy pages) in a memory router. */
export function renderApp(options: RenderOptions = {}) {
  const client = seed(options)
  const router = createMemoryRouter(createRoutes(), { initialEntries: [options.route ?? "/"] })
  const result = render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <SessionAudioProvider>
          <RouterProvider router={router} />
        </SessionAudioProvider>
      </TooltipProvider>
    </QueryClientProvider>,
  )
  return { ...result, client, router }
}
