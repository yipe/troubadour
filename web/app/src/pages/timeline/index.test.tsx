import { screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { VirtuosoMockContext } from "react-virtuoso"
import { Route, Routes, useLocation } from "react-router"
import { afterEach, expect, it, vi } from "vitest"
import { keys } from "@troubadour/api/query"
import type { TimelineSession } from "@troubadour/api/timeline"
import { mockFetch, player } from "@troubadour/api/testing"
import { renderWithProviders } from "../../test/render.tsx"
import { Component as TimelinePage } from "./index.tsx"

afterEach(() => vi.restoreAllMocks())

const PLAYERS = [
  player({ id: "gm", name: "Alex", is_gm: true }),
  player({ id: "pip", name: "Pip" }),
  player({ id: "velis", name: "Velis" }),
]

const tl = (n: number, over: Partial<TimelineSession> = {}): TimelineSession => ({
  id: `s${n}`,
  n,
  date: `2026-09-${String(((n - 1) % 28) + 1).padStart(2, "0")}`,
  title: `Title ${n}`,
  places: [],
  talk: {},
  new_entities: [],
  facts_accepted: 0,
  ...over,
})

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>
}

function show(sessions: TimelineSession[]) {
  // The API sends newest first.
  const data = { sessions: [...sessions].sort((a, b) => b.n - a.n) }
  mockFetch(() => data)
  return renderWithProviders(
    <VirtuosoMockContext.Provider value={{ viewportHeight: 600, itemHeight: 60 }}>
      <Routes>
        <Route path="/timeline" element={<TimelinePage />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </VirtuosoMockContext.Provider>,
    { route: "/timeline", live: { players: PLAYERS }, queryData: [[keys.timeline(), data]] },
  )
}

it("shows the count, a legend and one row per session, newest first", () => {
  show([tl(1, { places: ["Saltreach"] }), tl(2), tl(3, { places: ["Marrow Street"] })])
  expect(screen.getByRole("heading", { name: "The story so far" })).toBeInTheDocument()
  expect(screen.getByText("3 sessions · newest first · scrolls as the campaign grows")).toBeInTheDocument()
  expect(screen.getByText("Alex (GM)")).toBeInTheDocument()
  const links = screen.getAllByRole("link", { name: /^S\d$/ })
  expect(links.map((l) => l.textContent)).toEqual(["S3", "S2", "S1"])
  expect(screen.getByText("Sep 3")).toBeInTheDocument()
})

it("names the top player without the GM", () => {
  show([tl(1, { talk: { gm: 600, pip: 100, velis: 60 } })])
  // 100 of 760 seconds in all.
  expect(screen.getByText("Top player: Pip 13% · 0:12")).toBeInTheDocument()
})

it("links new faces to the codex and opens the session when its row is clicked", async () => {
  show([tl(1, { title: "Bells", new_entities: [{ name: "Diamond", type: "item" }] })])
  expect(screen.getByRole("link", { name: "Diamond" })).toHaveAttribute("href", "/codex/Diamond")
  await userEvent.click(screen.getByText("Bells"))
  expect(screen.getByTestId("where")).toHaveTextContent("/sessions/s1")
})

it("labels where the party arrives and draws the newest row as current", () => {
  show([tl(1, { places: ["Saltreach"] }), tl(2, { places: ["Saltreach"] }), tl(3, { places: ["Docks"] })])
  const rows = screen.getAllByRole("row").slice(1)
  expect(within(rows[0]!).getByText("Docks")).toBeInTheDocument()
  expect(rows[0]).toHaveClass("bg-accent-soft")
  expect(within(rows[1]!).queryByText("Saltreach")).not.toBeInTheDocument()
  expect(within(rows[2]!).getByText("Saltreach")).toBeInTheDocument()
})

it("holds up with 60 sessions by rendering only a window of rows", () => {
  show(Array.from({ length: 60 }, (_, i) => tl(i + 1, { places: [`P${i % 4}`] })))
  expect(screen.getByText("60 sessions · newest first · scrolls as the campaign grows")).toBeInTheDocument()
  const rendered = screen.getAllByRole("row").length - 1
  expect(rendered).toBeGreaterThan(0)
  expect(rendered).toBeLessThan(40)
})
