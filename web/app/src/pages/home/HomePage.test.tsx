import { screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { keys } from "@troubadour/api/query"
import { campaign, entity, fact, player, savedSession, snapshotBase } from "@troubadour/api/testing"
import { renderWithProviders } from "../../test/render.tsx"
import { Component as HomePage } from "./index.tsx"

const s1 = savedSession({ id: "s1", n: 1, started_at: 1_760_000_000, title: "Bells", duration_s: 3600 })
const s2 = savedSession({
  id: "s2",
  n: 2,
  started_at: 1_760_700_000,
  title: "The Drowned Abbey",
  summary: "The party reached the abbey at low tide.",
  duration_s: 7200,
  talk: { p1: 60 },
})
const at = (session_id: string, t: number) => ({ page: "", label: null, session_id, t })

/** A review with a fact and a spelling to go (or all decided). */
function review(decided: boolean) {
  const status = decided ? "accepted" : "open"
  return {
    session_id: "s2",
    written_up: true,
    items: [
      { id: "a", kind: "fact", status },
      { id: "b", kind: "spelling", status },
      { id: "c", kind: "entry", status: "accepted" },
    ],
    counts: { total: 3, done: decided ? 3 : 1, fact: 1, spelling: 1, entry: 1 },
  }
}

function home(over: { reviewed?: boolean; decided?: boolean } = {}) {
  const sessions = [{ ...s2, reviewed_at: over.reviewed ? 5 : null }, s1]
  return renderWithProviders(<HomePage />, {
    live: { players: [player({ id: "p1", name: "Sam", character: "Pip", trained: true })] },
    queryData: [
      [keys.sessions(), sessions],
      [
        keys.campaign(),
        campaign({
          written_up: { s2: "Sessions/s2.md" },
          entities: [
            entity({
              name: "Orsa",
              facts: [
                fact({ text: "Older fact.", source: at("s1", 30) }),
                fact({ text: "The tide turns at the second bell.", source: at("s2", 5882) }),
              ],
            }),
          ],
        }),
      ],
      [keys.campaigns(), { ...snapshotBase(), campaigns: [{ id: "main", name: "The Sunken Crown" }] }],
      [keys.review("s2"), review(!!over.decided)],
    ],
  })
}

describe("Home", () => {
  it("shows the last session's title, summary and number", () => {
    home()
    expect(screen.getByRole("heading", { name: "The Drowned Abbey" })).toBeInTheDocument()
    expect(screen.getByText("The party reached the abbey at low tide.")).toBeInTheDocument()
    expect(screen.getByText("Session 2")).toBeInTheDocument()
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("The Sunken Crown")
  })

  it("offers the next session number", () => {
    home()
    expect(screen.getByRole("button", { name: /Prepare next session/ })).toHaveAttribute(
      "href",
      "/sessions/new",
    )
  })

  it("shows the review banner with open counts, and hides it once decided", () => {
    const { unmount } = home()
    expect(screen.getByText("Session 2 is waiting for review")).toBeInTheDocument()
    expect(screen.getByText(/1 fact · 1 spelling, found by the local model/)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Start review" })).toHaveAttribute(
      "href",
      "/sessions/s2/review",
    )
    unmount()
    home({ decided: true })
    expect(screen.queryByText(/waiting for review/)).not.toBeInTheDocument()
  })

  it("hides the banner for a reviewed session", () => {
    home({ reviewed: true })
    expect(screen.queryByText(/waiting for review/)).not.toBeInTheDocument()
  })

  it("lists the newest facts first, with the session and time", () => {
    home()
    const facts = screen.getAllByText(/second bell|Older fact/)
    expect(facts.map((f) => f.textContent)).toEqual(["The tide turns at the second bell.", "Older fact."])
    expect(screen.getByText("S2 · 1:38:02")).toBeInTheDocument()
  })

  it("lists the players with their voice status", () => {
    home()
    expect(screen.getByText("Pip")).toBeInTheDocument()
    expect(screen.getByText("Trained")).toBeInTheDocument()
    expect(screen.queryByText(/voices trained/)).not.toBeInTheDocument()
  })

  it("says so when there are no sessions", () => {
    renderWithProviders(<HomePage />, {
      queryData: [
        [keys.sessions(), []],
        [keys.campaign(), campaign()],
      ],
    })
    expect(screen.getByText("No sessions yet")).toBeInTheDocument()
    expect(screen.getAllByRole("button", { name: "Prepare next session" }).length).toBeGreaterThan(0)
  })

  it("points the primary button back to a running session", () => {
    renderWithProviders(<HomePage />, {
      live: { session: { status: "running" } as never },
      queryData: [
        [keys.sessions(), [s1]],
        [keys.campaign(), campaign()],
      ],
    })
    expect(screen.getByRole("button", { name: /Back to the session/ })).toHaveAttribute(
      "href",
      "/sessions/live",
    )
  })
})
