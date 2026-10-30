import { screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, expect, it, vi } from "vitest"
import { keys } from "@troubadour/api/query"
import { campaign, entity, fact, factSuggestion, mockFetch } from "@troubadour/api/testing"
import { Route, Routes, useLocation } from "react-router"
import { renderWithProviders } from "../../test/render.tsx"
import { AppearancesChart } from "./AppearancesChart.tsx"
import { Component as CodexPage } from "./index.tsx"

afterEach(() => vi.restoreAllMocks())

const orsa = entity({
  name: "Orsa Vell",
  type: "npc",
  aliases: ["The Captain"],
  heard_as: ["Orsa Bell"],
  heard_as_suggested: ["Orsa Fell"],
  description: "Captain of the [[Gull's Debt]].",
  facts: [fact({ id: "f1", text: "Orsa owes Pip 20 gold." })],
})
const debt = entity({
  name: "Gull's Debt",
  type: "item",
  facts: [fact({ text: "Sails with [[Orsa Vell]]." })],
})
const abbey = entity({ name: "Drowned Abbey", type: "place", status: "suggested" })
const ward = entity({ name: "Tide Ward", type: "npc", suggested_facts: [factSuggestion({ text: "Hums." })] })

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>
}

function page(route: string) {
  return renderWithProviders(
    <>
      <Routes>
        <Route path="/codex" element={<CodexPage />} />
        <Route path="/codex/:entry" element={<CodexPage />} />
      </Routes>
      <Where />
    </>,
    {
      route,
      queryData: [
        [keys.campaign(), campaign({ entities: [orsa, debt, abbey, ward] })],
        [[...keys.campaign(), ...keys.entity("Orsa Vell")], { ...orsa, appearances: [] }],
      ],
    },
  )
}

const rail = () => screen.getByRole("navigation", { name: "Codex entries" })

it("/codex opens the first entry", async () => {
  page("/codex")
  await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/codex/Orsa%20Vell"))
  expect(screen.getByRole("heading", { name: "Orsa Vell" })).toBeInTheDocument()
})

it("searches names, aliases and heard-as spellings", async () => {
  page("/codex/Orsa%20Vell")
  const search = screen.getByRole("searchbox", { name: "Search the codex" })
  await userEvent.type(search, "orsa bell")
  expect(within(rail()).getAllByRole("link")).toHaveLength(1)
  await userEvent.clear(search)
  await userEvent.type(search, "captain")
  expect(within(rail()).getAllByRole("link")).toHaveLength(1)
  expect(within(rail()).getByRole("link", { name: /Orsa Vell/ })).toBeInTheDocument()
})

it("filters by type and by needs review, and counts what needs review", async () => {
  page("/codex/Orsa%20Vell")
  await userEvent.click(screen.getByRole("button", { name: "Places" }))
  expect(within(rail()).getAllByRole("link")).toHaveLength(1)
  await userEvent.click(screen.getByRole("button", { name: "All" }))
  // Orsa has a suggested spelling, the abbey is suggested, Tide Ward has a suggested fact.
  await userEvent.click(screen.getByRole("button", { name: "Needs review 3" }))
  expect(within(rail()).getAllByRole("link")).toHaveLength(3)
})

it("keeps the selection in the URL and banners a suggested entry", async () => {
  page("/codex/Orsa%20Vell")
  await userEvent.click(within(rail()).getByRole("link", { name: /Drowned Abbey/ }))
  expect(screen.getByTestId("where")).toHaveTextContent("/codex/Drowned%20Abbey")
  expect(screen.getByRole("heading", { name: "Drowned Abbey" })).toBeInTheDocument()
  expect(screen.getByText(/Suggested from a session/)).toBeInTheDocument()
})

it("lists connected entries and the Obsidian link", () => {
  page("/codex/Orsa%20Vell")
  const connected = screen.getByText("Connected").parentElement!
  expect(within(connected).getByRole("link", { name: "Gull's Debt" })).toBeInTheDocument()
  expect(screen.getByRole("link", { name: "Open in Obsidian" })).toHaveAttribute(
    "href",
    expect.stringContaining("obsidian://open?vault=abc123"),
  )
})

it("shows aliases and both kinds of heard-as chip", () => {
  page("/codex/Orsa%20Vell")
  const main = screen.getByRole("heading", { name: "Orsa Vell" }).closest("div")!.parentElement!
  expect(within(main).getByText("The Captain")).toBeInTheDocument()
  expect(within(main).getByText("Orsa Bell")).toBeInTheDocument()
  expect(screen.getByRole("button", { name: "Accept" })).toBeInTheDocument()
})

it("adds a fact to the entry", async () => {
  const { writes } = mockFetch(({ method }) =>
    method === "POST" ? { ...orsa, facts: [...orsa.facts, fact({ text: "Hates rain." })] } : undefined,
  )
  page("/codex/Orsa%20Vell")
  await userEvent.type(screen.getByRole("textbox", { name: "Add a fact" }), "Hates rain.{Enter}")
  await waitFor(() => expect(writes()).toHaveLength(1))
  expect(writes()[0]?.body).toMatchObject({ text: "Hates rain." })
  await waitFor(() => expect(screen.getByText("Hates rain.")).toBeInTheDocument())
})

it("renders a column for every session and a baseline tick for zero", () => {
  const { container } = renderWithProviders(
    <AppearancesChart
      appearances={[
        { session_id: "a", n: 1, count: 0 },
        { session_id: "b", n: 2, count: 4 },
      ]}
    />,
  )
  expect(screen.getAllByTestId("appearance")).toHaveLength(2)
  expect(screen.getByText("S1")).toBeInTheDocument()
  expect(container.querySelectorAll(".h-px")).toHaveLength(1)
})
