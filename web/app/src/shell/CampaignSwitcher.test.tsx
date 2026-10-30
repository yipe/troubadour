import { fireEvent, screen, waitFor } from "@testing-library/react"
import { useLocation } from "react-router"
import { afterEach, describe, expect, it, vi } from "vitest"
import { notify } from "@troubadour/ui/toast"
import { keys } from "@troubadour/api/query"
import { bodyOf, campaignJob, campaign, httpError, mockFetch, session } from "@troubadour/api/testing"
import { renderWithProviders } from "../test/render.tsx"
import { CampaignSwitcher } from "./CampaignSwitcher.tsx"

vi.mock("@troubadour/ui/toast", () => ({ notify: vi.fn() }))

const TWO = {
  campaign: "main",
  campaigns: [
    { id: "main", name: "Phandelver", table_name: "" },
    { id: "c2", name: "Morvath", table_name: "" },
  ],
}

function setup(options: { status?: "idle" | "running"; jobs?: boolean } = {}) {
  return renderWithProviders(<CampaignSwitcher />, {
    live: { session: session({ status: options.status ?? "idle" }) },
    queryData: [
      [keys.campaigns(), TWO],
      [keys.campaign(), campaign({ jobs: options.jobs ? [campaignJob({ id: "j", state: "running" })] : [] })],
    ],
  })
}

function Where() {
  const l = useLocation()
  return <p data-testid="where">{l.pathname + l.search}</p>
}

const openMenu = () => fireEvent.click(screen.getByRole("button", { name: "Campaign" }))

afterEach(() => {
  vi.restoreAllMocks()
  vi.mocked(notify).mockClear()
})

describe("CampaignSwitcher", () => {
  it("lists the campaigns, checks the open one, and opens another", async () => {
    const { writes } = mockFetch((c) => (c.url === "/api/campaigns/c2/open" ? TWO : []))
    setup()
    expect(screen.getByRole("button", { name: "Campaign" })).toHaveTextContent("Phandelver")
    openMenu()
    const items = await screen.findAllByRole("menuitem")
    expect(items.map((i) => i.textContent)).toEqual(["Phandelver", "Morvath", "New campaign…", "Rename…"])
    fireEvent.click(screen.getByRole("menuitem", { name: "Morvath" }))
    await waitFor(() => expect(writes().map((c) => c.url)).toEqual(["/api/campaigns/c2/open"]))
  })

  it("goes to the new-campaign step", async () => {
    mockFetch(() => [])
    renderWithProviders(
      <>
        <CampaignSwitcher />
        <Where />
      </>,
      {
        live: { session: session() },
        queryData: [
          [keys.campaigns(), TWO],
          [keys.campaign(), campaign()],
        ],
      },
    )
    openMenu()
    fireEvent.click(await screen.findByRole("menuitem", { name: "New campaign…" }))
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/welcome/campaign?new=1"))
  })

  it.each([
    ["a session runs", { status: "running" as const }],
    ["a campaign job is busy", { jobs: true }],
  ])("can't switch while %s", async (_why, options) => {
    mockFetch(() => [])
    setup(options)
    openMenu()
    expect(await screen.findByRole("menuitem", { name: "Morvath" })).toHaveAttribute("aria-disabled", "true")
    expect(screen.getByRole("menuitem", { name: "Phandelver" })).not.toHaveAttribute("aria-disabled", "true")
  })

  it("shows the server's reason when a switch is refused", async () => {
    mockFetch((c) =>
      c.url.endsWith("/open")
        ? httpError(400, "Wait for the campaign jobs to finish before switching campaigns.")
        : [],
    )
    setup()
    openMenu()
    fireEvent.click(await screen.findByRole("menuitem", { name: "Morvath" }))
    await waitFor(() =>
      expect(notify).toHaveBeenCalledWith(expect.stringMatching(/campaign jobs/), { tone: "danger" }),
    )
  })

  it("renames the open campaign", async () => {
    const { writes } = mockFetch((c) => (c.method === "PATCH" ? { id: "main", name: "Lost Mine" } : []))
    setup()
    openMenu()
    fireEvent.click(await screen.findByRole("menuitem", { name: "Rename…" }))
    const input = await screen.findByRole("textbox", { name: "Campaign name" })
    expect(input).toHaveValue("Phandelver")
    fireEvent.change(input, { target: { value: " Lost Mine " } })
    fireEvent.click(screen.getByRole("button", { name: "Save" }))
    await waitFor(() =>
      expect(writes().map((c) => [c.method, c.url])).toEqual([["PATCH", "/api/campaigns/main"]]),
    )
    expect(bodyOf(writes()[0]!)).toEqual({ name: "Lost Mine", table_name: "" })
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    expect(screen.getByRole("button", { name: "Campaign" })).toHaveTextContent("Lost Mine")
  })

  it("edits the table name in the same dialog", async () => {
    const { writes } = mockFetch((c) => (c.method === "PATCH" ? { id: "main", name: "Phandelver" } : []))
    setup()
    openMenu()
    fireEvent.click(await screen.findByRole("menuitem", { name: "Rename…" }))
    fireEvent.change(await screen.findByRole("textbox", { name: "Table name" }), {
      target: { value: " Magic Mushroom Mob " },
    })
    fireEvent.click(screen.getByRole("button", { name: "Save" }))
    await waitFor(() => expect(writes()).toHaveLength(1))
    expect(bodyOf(writes()[0]!)).toEqual({ name: "Phandelver", table_name: "Magic Mushroom Mob" })
  })

  it("rejects empty and over-long names without calling the server", async () => {
    const { writes } = mockFetch(() => [])
    setup()
    openMenu()
    fireEvent.click(await screen.findByRole("menuitem", { name: "Rename…" }))
    const input = await screen.findByRole("textbox", { name: "Campaign name" })
    fireEvent.change(input, { target: { value: "   " } })
    fireEvent.click(screen.getByRole("button", { name: "Save" }))
    expect(await screen.findByText("Give the campaign a name.")).toBeInTheDocument()
    fireEvent.change(input, { target: { value: "x".repeat(61) } })
    fireEvent.click(screen.getByRole("button", { name: "Save" }))
    expect(await screen.findByText(/60 characters/)).toBeInTheDocument()
    expect(writes()).toEqual([])
  })
})
