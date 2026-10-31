import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { keys } from "@troubadour/api/query"
import { bodyOf, campaign, httpError, mockFetch, savedSession, session } from "@troubadour/api/testing"
import { renderApp } from "../../test/render.tsx"

const ONE = { campaign: "main", campaigns: [{ id: "main", name: "Blank", table_name: "" }] }

function setup(route: string, sessions: unknown[] = []) {
  const server = mockFetch((c) => {
    if (c.method === "POST" && c.url === "/api/campaigns")
      return { id: "c2", name: bodyOf<{ name: string }>(c).name, table_name: "" }
    if (c.method === "POST" && c.url === "/api/campaigns/c2/open")
      return {
        campaign: "c2",
        campaigns: [...ONE.campaigns, { id: "c2", name: "Sunken Crown", table_name: "" }],
      }
    if (c.method === "PATCH" && c.url === "/api/campaigns/main")
      return { id: "main", name: bodyOf<{ name: string }>(c).name ?? "Blank", table_name: "" }
    if (c.url === "/api/sessions") return sessions
    if (c.url === "/api/campaign") return campaign()
    return []
  })
  const app = renderApp({
    route,
    live: { session: session({ status: "idle" }) },
    queryData: [
      [keys.campaigns(), ONE],
      [keys.sessions(), sessions],
    ],
  })
  return { ...app, ...server }
}

const rail = () => screen.getByRole("navigation", { name: "Setup steps" })

afterEach(() => vi.restoreAllMocks())

describe("welcome wizard", () => {
  it("shows the step from the URL, with done, current and upcoming states in the rail", async () => {
    setup("/welcome/microphone")
    expect(await screen.findByText("Step 3 of 5")).toBeInTheDocument()
    const states = Array.from(rail().querySelectorAll("[data-state]")).map((e) =>
      e.getAttribute("data-state"),
    )
    expect(states).toEqual(["done", "done", "current", "upcoming", "upcoming"])
    expect(within(rail()).getByRole("link", { name: /The table/ })).toHaveAttribute("href", "/welcome/table")
    expect(within(rail()).getByRole("button", { name: /Existing notes/ })).toBeDisabled()
  })

  it("moves with Back and Continue, and the rail jumps back to a finished step", async () => {
    const { router } = setup("/welcome/table")
    fireEvent.click(await screen.findByRole("button", { name: /Continue to microphone/ }))
    await waitFor(() => expect(router.state.location.pathname).toBe("/welcome/microphone"))
    fireEvent.click(screen.getByRole("button", { name: "Back" }))
    await waitFor(() => expect(router.state.location.pathname).toBe("/welcome/table"))
    fireEvent.click(await screen.findByRole("button", { name: /Continue to microphone/ }))
    await screen.findByText("Step 3 of 5")
    fireEvent.click(within(rail()).getByRole("link", { name: /Campaign/ }))
    await waitFor(() => expect(router.state.location.pathname).toBe("/welcome/campaign"))
  })

  it("renames the open campaign when it has no sessions", async () => {
    const { router, writes } = setup("/welcome/campaign")
    const name = await screen.findByLabelText("Campaign name")
    await waitFor(() => expect(name).toHaveValue("Blank"))
    fireEvent.change(name, { target: { value: "Sunken Crown" } })
    fireEvent.click(screen.getByRole("button", { name: /Continue to the table/ }))
    await waitFor(() => expect(router.state.location.pathname).toBe("/welcome/table"))
    expect(writes()).toEqual([
      { method: "PATCH", url: "/api/campaigns/main", body: { name: "Sunken Crown" } },
    ])
  })

  it("saves the table name with the campaign", async () => {
    const { router, writes } = setup("/welcome/campaign")
    const name = await screen.findByLabelText("Campaign name")
    await waitFor(() => expect(name).toHaveValue("Blank"))
    fireEvent.change(screen.getByLabelText("Your table’s name"), {
      target: { value: " Magic Mushroom Mob " },
    })
    fireEvent.click(screen.getByRole("button", { name: /Continue to the table/ }))
    await waitFor(() => expect(router.state.location.pathname).toBe("/welcome/table"))
    expect(writes()).toEqual([
      { method: "PATCH", url: "/api/campaigns/main", body: { table_name: "Magic Mushroom Mob" } },
    ])
  })

  it("creates and opens a campaign when the open one has sessions", async () => {
    const { router, writes } = setup("/welcome/campaign", [savedSession({ id: "1" })])
    const name = await screen.findByLabelText("Campaign name")
    expect(name).toHaveValue("")
    fireEvent.change(name, { target: { value: "Sunken Crown" } })
    fireEvent.click(screen.getByRole("button", { name: /Continue to the table/ }))
    await waitFor(() => expect(router.state.location.pathname).toBe("/welcome/table"))
    expect(writes().map((w) => `${w.method} ${w.url}`)).toEqual([
      "POST /api/campaigns",
      "POST /api/campaigns/c2/open",
    ])
  })

  it("retrying after a failed open does not create a second campaign", async () => {
    let opens = 0
    const server = mockFetch((c) => {
      if (c.method === "POST" && c.url === "/api/campaigns")
        return { id: "c2", name: "Sunken Crown", table_name: "" }
      if (c.method === "POST" && c.url === "/api/campaigns/c2/open")
        return opens++ === 0
          ? httpError(500, "Busy")
          : {
              campaign: "c2",
              campaigns: [...ONE.campaigns, { id: "c2", name: "Sunken Crown", table_name: "" }],
            }
      return []
    })
    const { router } = renderApp({
      route: "/welcome/campaign?new=1",
      live: { session: session({ status: "idle" }) },
      queryData: [[keys.campaigns(), ONE]],
    })
    fireEvent.change(await screen.findByLabelText("Campaign name"), { target: { value: "Sunken Crown" } })
    fireEvent.click(screen.getByRole("button", { name: /Continue to the table/ }))
    await waitFor(() => expect(opens).toBe(1))
    await waitFor(() => expect(screen.getByRole("button", { name: /Continue to the table/ })).toBeEnabled())
    fireEvent.click(screen.getByRole("button", { name: /Continue to the table/ }))
    await waitFor(() => expect(router.state.location.pathname).toBe("/welcome/table"))
    expect(server.writes().map((w) => `${w.method} ${w.url}`)).toEqual([
      "POST /api/campaigns",
      "POST /api/campaigns/c2/open",
      "POST /api/campaigns/c2/open",
    ])
  })

  it("?new=1 always creates, even beside an empty campaign", async () => {
    const { router, writes } = setup("/welcome/campaign?new=1")
    const name = await screen.findByLabelText("Campaign name")
    expect(name).toHaveValue("")
    fireEvent.change(name, { target: { value: "Sunken Crown" } })
    fireEvent.click(screen.getByRole("button", { name: /Continue to the table/ }))
    await waitFor(() => expect(router.state.location.pathname).toBe("/welcome/table"))
    expect(router.state.location.search).toBe("")
    expect(writes()[0]).toEqual({ method: "POST", url: "/api/campaigns", body: { name: "Sunken Crown" } })
  })

  it("Finish goes home", async () => {
    const { router } = setup("/welcome/privacy")
    fireEvent.click(await screen.findByRole("button", { name: "Finish" }))
    await waitFor(() => expect(router.state.location.pathname).toBe("/"))
  })

  it("Skip on the notes step moves on", async () => {
    const { router } = setup("/welcome/notes")
    fireEvent.click(await screen.findByRole("button", { name: "Skip" }))
    await waitFor(() => expect(router.state.location.pathname).toBe("/welcome/privacy"))
  })

  it("an unknown step goes back to the first", async () => {
    const { router } = setup("/welcome/nonsense")
    await waitFor(() => expect(router.state.location.pathname).toBe("/welcome/campaign"))
  })
})
