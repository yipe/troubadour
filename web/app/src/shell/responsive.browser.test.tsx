import { QueryClientProvider } from "@tanstack/react-query"
import { createRoot } from "react-dom/client"
import { createMemoryRouter, RouterProvider } from "react-router"
import { afterEach, describe, expect, it } from "vitest"
import { page, userEvent } from "vitest/browser"
import { resetLive, useLiveStore, type LiveState } from "@troubadour/api/live"
import { keys, makeQueryClient } from "@troubadour/api/query"
import {
  campaign,
  entity,
  fact,
  message,
  mockFetch,
  player,
  savedSession,
  session,
  snapshotBase,
  voice,
} from "@troubadour/api/testing"
import { TooltipProvider } from "@troubadour/ui/tooltip"
import "../index.css"
import { SessionAudioProvider } from "../components/audio/SessionAudioProvider.tsx"
import { createRoutes } from "../routes.tsx"
import { shot } from "../../test/shot.ts"

const WIDTHS = [1440, 1024, 390] as const

const PLAYERS = [
  player({ id: "gm", name: "Alex", is_gm: true, dnd_class: "paladin" }),
  player({ id: "p1", name: "Maya", character: "Velis", dnd_class: "wizard" }),
  player({ id: "p2", name: "Sam", character: "Brann", dnd_class: "fighter" }),
]
const SESSIONS = [
  savedSession({
    id: "s2",
    n: 2,
    started_at: 1_760_700_000,
    title: "The Drowned Abbey",
    summary: "The party reached the abbey at low tide.",
    duration_s: 7200,
    lines: 410,
    talk: { gm: 3000, p1: 2000, p2: 1500 },
    scenes: [{ t: 0, title: "The doors", place: null }],
  }),
  savedSession({ id: "s1", n: 1, started_at: 1_760_000_000, title: "Bells", duration_s: 3600 }),
]
const at = (session_id: string, t: number) => ({ page: "", label: null, session_id, t })
const CAMPAIGN = campaign({
  written_up: { s2: "Sessions/s2.md" },
  entities: [
    entity({
      name: "Orsa",
      facts: [
        fact({ text: "The tide turns at the second bell.", source: at("s2", 5882) }),
        fact({ text: "Older fact.", source: at("s1", 30) }),
      ],
    }),
    entity({
      name: "Drowned Abbey",
      type: "place",
      facts: [fact({ text: "It floods at dusk.", source: at("s2", 90) })],
    }),
  ],
})

let unmount = () => {}
afterEach(() => {
  unmount()
  resetLive()
  document.body.innerHTML = ""
})

function mount(route: string, live: Partial<LiveState> = {}) {
  mockFetch(() => undefined)
  resetLive()
  useLiveStore.setState({
    loaded: true,
    connected: true,
    sessionAt: performance.now(),
    session: session({ status: "idle" }),
    players: PLAYERS,
    voices: [voice({ id: "v1", label: "Voice 1", status: "named", player_id: "gm" })],
    ...live,
  })
  const client = makeQueryClient()
  client.setQueryData(keys.sessions(), SESSIONS)
  client.setQueryData(keys.campaign(), CAMPAIGN)
  client.setQueryData(keys.campaigns(), {
    ...snapshotBase(),
    campaigns: [{ id: "main", name: "The Sunken Crown" }],
  })
  client.setQueryData(keys.classes(), [])
  const host = document.createElement("div")
  document.body.append(host)
  const root = createRoot(host)
  const router = createMemoryRouter(createRoutes(), { initialEntries: [route] })
  root.render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <SessionAudioProvider>
          <RouterProvider router={router} />
        </SessionAudioProvider>
      </TooltipProvider>
    </QueryClientProvider>,
  )
  unmount = () => root.unmount()
}

const rect = (el: Element | null | undefined) => {
  if (!el) throw new Error("element not found")
  return el.getBoundingClientRect()
}
const slot = (name: string) => document.querySelector(`[data-slot="${name}"]`)
// The page body is a `main` that scrolls itself, so the window alone never overflows.
const noSidewaysScroll = () => {
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth)
  for (const main of document.querySelectorAll("main"))
    expect(main.scrollWidth).toBeLessThanOrEqual(main.clientWidth)
}

describe.each(WIDTHS)("at %i px wide", (width) => {
  const resize = () => page.viewport(width, 900)

  it("Home: three cards, then two, then one", async () => {
    await resize()
    mount("/")
    await expect.element(page.getByRole("heading", { name: "The Sunken Crown" })).toBeVisible()
    const cards = [...document.querySelector('[data-testid="home-cards"]')!.children].map(rect)
    expect(cards).toHaveLength(3)
    const columns = new Set(cards.map((c) => Math.round(c.left))).size
    expect(columns).toBe(width >= 1280 ? 3 : width >= 768 ? 2 : 1)
    noSidewaysScroll()
    await shot(`responsive-home-${width}`)
  })

  it("Sessions: the list is a rail, then folds away", async () => {
    await resize()
    mount("/sessions")
    await expect.element(page.getByRole("heading", { name: "The Drowned Abbey" })).toBeVisible()
    const rail = rect(slot("rail"))
    const main = rect(slot("main"))
    if (width >= 768) {
      expect(rail.right).toBeLessThanOrEqual(main.left + 1)
    } else {
      await expect.element(page.getByRole("button", { name: "Show sessions" })).toBeVisible()
      expect(rail.height).toBe(0)
    }
    // Five stat tiles in a row, three, then two.
    const tiles = document.querySelectorAll('[data-slot="main"] .grid.grid-cols-2 > *')
    const perRow = [...tiles].filter((t) => rect(t).top === rect(tiles[0]).top).length
    expect(perRow).toBe(width >= 1280 ? 5 : width >= 768 ? 3 : 2)
    noSidewaysScroll()
    await shot(`responsive-sessions-${width}`)
  })

  it("Facts: the filters are a rail, then fold away", async () => {
    await resize()
    mount("/facts")
    await expect.element(page.getByRole("heading", { name: "Facts" })).toBeVisible()
    if (width >= 768) expect(rect(slot("rail")).right).toBeLessThanOrEqual(rect(slot("main")).left + 1)
    else {
      await expect.element(page.getByRole("button", { name: "Show filters" })).toBeVisible()
      await userEvent.click(page.getByRole("button", { name: "Show filters" }))
      expect(rect(slot("rail")).bottom).toBeLessThanOrEqual(rect(slot("main")).top + 1)
    }
    noSidewaysScroll()
    await shot(`responsive-facts-${width}`)
  })

  it("Live: the transcript always shows; the notebook sits beside it, then behind a switch", async () => {
    await resize()
    mount("/sessions/live", {
      session: session({ status: "running", title: "The drowned abbey" }),
      messages: [message({ id: "a", voice_id: "v1", t_start: 0, t_end: 300 })],
    })
    await expect.element(page.getByText("The drowned abbey")).toBeVisible()
    const rail = rect(document.querySelector("aside"))
    const transcript = rect(document.querySelector("section"))
    const notebook = rect(document.querySelectorAll("aside")[1])
    expect(transcript.width).toBeGreaterThan(0)
    if (width >= 1280) {
      expect(rail.right).toBeLessThanOrEqual(transcript.left + 1)
      expect(transcript.right).toBeLessThanOrEqual(notebook.left + 1)
    } else {
      expect(notebook.width).toBe(0)
      if (width >= 1024) expect(rail.right).toBeLessThanOrEqual(transcript.left + 1)
      else expect(rail.bottom).toBeLessThanOrEqual(transcript.top + 1)
      await userEvent.click(page.getByRole("button", { name: "notebook" }))
      expect(rect(document.querySelectorAll("aside")[1]).width).toBeGreaterThan(0)
      expect(rect(document.querySelector("section")).width).toBe(0)
      await userEvent.click(page.getByRole("button", { name: "transcript" }))
    }
    noSidewaysScroll()
    await shot(`responsive-live-${width}`)
  })
})
