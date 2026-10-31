import { fireEvent, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { keys } from "@troubadour/api/query"
import { campaign, campaignJob, mockFetch } from "@troubadour/api/testing"
import { renderWithProviders } from "../../test/render.tsx"
import { UpgradeBanner } from "./UpgradeBanner.tsx"

afterEach(() => vi.restoreAllMocks())

const upgrades = (ids: string[]) => ({
  sessions: ids.map((id, i) => ({ id, n: i + 1, stale: ["talk"] })),
  current: { talk: 1 },
})

function server(ids: string[]) {
  return mockFetch((c) => {
    if (c.url === "/api/sessions/upgrades") return upgrades(ids)
    if (c.url === "/api/sessions/upgrade")
      return ids.map((id) =>
        campaignJob({ id: `j-${id}`, kind: "refresh" as never, title: id, state: "queued" }),
      )
    return new Response(null, { status: 500 })
  })
}

describe("UpgradeBanner", () => {
  it("is absent when every session is current", async () => {
    const { calls } = server([])
    renderWithProviders(<UpgradeBanner />)
    await waitFor(() => expect(calls.some((c) => c.url === "/api/sessions/upgrades")).toBe(true))
    expect(screen.queryByRole("region", { name: "Upgrade old sessions" })).toBeNull()
  })

  it("counts the old sessions and starts the upgrade queue", async () => {
    const { writes } = server(["a", "b", "c"])
    renderWithProviders(<UpgradeBanner />)
    expect(await screen.findByText("3 sessions were processed by an older Troubadour")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Upgrade" }))
    await waitFor(() => expect(writes()).toHaveLength(1))
    expect(writes()[0]).toMatchObject({ method: "POST", url: "/api/sessions/upgrade" })
  })

  it("shows the queue instead of the button while sessions are being upgraded", async () => {
    server(["a", "b"])
    renderWithProviders(<UpgradeBanner />, {
      queryData: [
        [
          keys.campaign(),
          campaign({
            jobs: [
              campaignJob({
                id: "j1",
                kind: "refresh" as never,
                title: "a",
                state: "running",
                message: "Counting",
              }),
              campaignJob({ id: "j2", kind: "refresh" as never, title: "b", state: "queued" }),
            ],
          }),
        ],
      ],
    })
    expect(await screen.findByText("Upgrading 2 sessions")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Upgrade" })).toBeDisabled()
  })

  it("says so when a session is running", async () => {
    server(["a"])
    renderWithProviders(<UpgradeBanner />, { live: { session: { status: "running" } as never } })
    expect(await screen.findByText(/Wait for the session to end/)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Upgrade" })).toBeDisabled()
  })
})
