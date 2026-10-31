import { screen, waitFor } from "@testing-library/react"
import type { RouteObject } from "react-router"
import { afterEach, describe, expect, it, vi } from "vitest"
import { keys } from "@troubadour/api/query"
import { player, savedSession, session } from "@troubadour/api/testing"
import { createRoutes } from "./routes.tsx"
import { renderApp } from "./test/render.tsx"

const idle = session({ status: "idle" })
const saved = [savedSession({ id: "12" })]
const returning = {
  live: { session: idle, players: [player({ id: "p1" })] },
  queryData: [[keys.sessions(), saved]] as [readonly string[], unknown][],
}

function patternsOf(routes: RouteObject[]): string[] {
  return routes.flatMap((r) => [...(r.path ? [r.path] : []), ...patternsOf(r.children ?? [])])
}

afterEach(() => vi.unstubAllEnvs())

describe("old URLs", () => {
  const cases: [string, string][] = [
    ["/setup", "/sessions/new"],
    ["/session", "/sessions/live"],
    ["/history", "/sessions"],
    ["/history/12", "/sessions/12"],
    ["/sessions/12/transcript", "/sessions/12"],
    ["/campaign", "/codex"],
    ["/campaign/Captain%20Orsa%20Vell", "/codex/Captain%20Orsa%20Vell"],
  ]
  it.each(cases)("%s goes to %s", async (from, to) => {
    // A running session keeps /session from bouncing on to /sessions.
    const { router } = renderApp({
      ...returning,
      live: { ...returning.live, session: session() },
      route: from,
    })
    await waitFor(() => expect(router.state.location.pathname).toBe(to))
    await waitFor(() => expect(screen.getAllByRole("heading")[0]).toBeInTheDocument())
  })
})

describe("the dev gallery", () => {
  it("is routed in dev builds", () => {
    expect(patternsOf(createRoutes())).toContain("/dev/ui")
  })

  it("does not exist in production", async () => {
    vi.stubEnv("DEV", false)
    expect(patternsOf(createRoutes())).not.toContain("/dev/ui")
    renderApp({ ...returning, route: "/dev/ui" })
    expect(await screen.findByText("Page not found")).toBeInTheDocument()
  })
})

describe("startup", () => {
  it("waits for the server's first snapshot", async () => {
    renderApp({ live: { loaded: false }, route: "/" })
    // The wait screen is shown twice in a row (router fallback, then the gate), so retry past a swap.
    await waitFor(() => expect(screen.getByText("Waiting for the Troubadour server…")).toBeInTheDocument())
  })

  it("sends a first run (no players, no sessions) to the wizard", async () => {
    const { router } = renderApp({ live: { session: idle }, queryData: [[keys.sessions(), []]] })
    await waitFor(() => expect(router.state.location.pathname).toBe("/welcome/campaign"))
  })

  it("does not treat a campaign with saved sessions as a first run", async () => {
    const { router } = renderApp({ live: { session: idle }, queryData: [[keys.sessions(), saved]] })
    expect(await screen.findByRole("heading", { name: "Home" })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe("/")
  })

  it("sends a running or paused session to Live on first load only", async () => {
    const { router } = renderApp({ ...returning, live: { ...returning.live, session: session() } })
    await waitFor(() => expect(router.state.location.pathname).toBe("/sessions/live"))
    await router.navigate("/")
    expect(await screen.findByRole("heading", { name: "Home" })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe("/")
  })

  it("leaves a deep link alone even while a session runs", async () => {
    const { router } = renderApp({
      ...returning,
      live: { ...returning.live, session: session({ status: "paused" }) },
      route: "/timeline",
      queryData: [...returning.queryData, [keys.timeline(), { sessions: [] }]],
    })
    expect(await screen.findByRole("heading", { name: "The story so far" })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe("/timeline")
  })

  it("sends /sessions/live to /sessions when nothing is running", async () => {
    const { router } = renderApp({ ...returning, route: "/sessions/live" })
    await waitFor(() => expect(router.state.location.pathname).toBe("/sessions"))
  })

  it("shows the Live page while a session runs", async () => {
    renderApp({ ...returning, live: { ...returning.live, session: session() }, route: "/sessions/live" })
    expect(await screen.findByRole("button", { name: /End session/ })).toBeInTheDocument()
  })
})

describe("not found", () => {
  it("links home", async () => {
    renderApp({ ...returning, route: "/nowhere" })
    expect(await screen.findByRole("link", { name: "Back to Home" })).toHaveAttribute("href", "/")
  })
})
