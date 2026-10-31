import { QueryClientProvider } from "@tanstack/react-query"
import { createRoot } from "react-dom/client"
import { createMemoryRouter, RouterProvider } from "react-router"
import { afterEach, expect, it } from "vitest"
import { page } from "vitest/browser"
import { resetLive, useLiveStore } from "@troubadour/api/live"
import { keys, makeQueryClient } from "@troubadour/api/query"
import { campaign, mockFetch, player, savedSession, session, snapshotBase } from "@troubadour/api/testing"
import { TooltipProvider } from "@troubadour/ui/tooltip"
import "../index.css"
import { SessionAudioProvider } from "../components/audio/SessionAudioProvider.tsx"
import { applyTheme, type Theme } from "@troubadour/ui/theme-choice"
import { createRoutes } from "../routes.tsx"

let unmount = () => {}
afterEach(() => {
  unmount()
  resetLive()
  document.body.innerHTML = ""
  delete document.documentElement.dataset.theme
})

function mountHome() {
  mockFetch(() => undefined)
  resetLive()
  useLiveStore.setState({
    loaded: true,
    connected: true,
    sessionAt: performance.now(),
    session: session({ status: "idle" }),
    players: [player({ id: "gm", name: "Alex", is_gm: true, dnd_class: "paladin" })],
  })
  const client = makeQueryClient()
  client.setQueryData(keys.sessions(), [savedSession({ id: "s1", n: 1, title: "Bells", duration_s: 3600 })])
  client.setQueryData(keys.campaign(), campaign({}))
  client.setQueryData(keys.campaigns(), {
    ...snapshotBase(),
    campaigns: [{ id: "main", name: "The Sunken Crown" }],
  })
  client.setQueryData(keys.classes(), [])
  const host = document.createElement("div")
  document.body.append(host)
  const root = createRoot(host)
  root.render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <SessionAudioProvider>
          <RouterProvider router={createMemoryRouter(createRoutes(), { initialEntries: ["/"] })} />
        </SessionAudioProvider>
      </TooltipProvider>
    </QueryClientProvider>,
  )
  unmount = () => root.unmount()
}

const bodyBackground = () => getComputedStyle(document.body).backgroundColor
const tokenCanvas = () => {
  const probe = document.createElement("div")
  probe.style.backgroundColor = "var(--color-bg-canvas)"
  document.body.append(probe)
  const colour = getComputedStyle(probe).backgroundColor
  probe.remove()
  return colour
}

it("Home paints the canvas token of each theme, and the three differ", async () => {
  mountHome()
  await expect.element(page.getByTestId("home-cards")).toBeVisible()
  const seen = new Map<Theme, string>()
  for (const theme of ["dark", "light", "midnight"] as const) {
    applyTheme(theme)
    expect(bodyBackground()).toBe(tokenCanvas())
    seen.set(theme, bodyBackground())
  }
  expect(new Set(seen.values()).size).toBe(3)
})
