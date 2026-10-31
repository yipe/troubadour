import { screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { Route, Routes, useLocation } from "react-router"
import { afterEach, expect, it, vi } from "vitest"
import { keys } from "@troubadour/api/query"
import { bodyOf, campaign, entity, fact, mockFetch, player, savedSession } from "@troubadour/api/testing"
import { renderWithProviders } from "../../test/render.tsx"
import { Component as FactsPage } from "./index.tsx"

afterEach(() => vi.restoreAllMocks())

const pip = player({ id: "p1", name: "Sam", character: "Pip" })
const gm = player({ id: "p2", name: "Alex", character: "", is_gm: true })
const src = { page: "p", label: null, session_id: "s1", t: 60 }

const data = campaign({
  facts: [fact({ text: "A storm is coming.", confidence: "theory" })],
  entities: [
    entity({
      name: "Orsa Vell",
      type: "npc",
      facts: [
        fact({
          id: "f1",
          text: "Owes Pip gold.",
          confidence: "once",
          said_by: { name: "Pip", player_id: "p1" },
          source: src,
        }),
        fact({
          id: "f2",
          text: "Hates the tide.",
          confidence: "gm",
          said_by: { name: "Alex", player_id: "p2" },
        }),
      ],
    }),
    entity({
      name: "The Abbey",
      type: "place",
      facts: [fact({ id: "f3", text: "Drowned.", confidence: "gm" })],
    }),
  ],
})

function Where() {
  const l = useLocation()
  return <p data-testid="where">{l.pathname + l.search}</p>
}

function page(route = "/facts") {
  return renderWithProviders(
    <>
      <Routes>
        <Route path="/facts" element={<FactsPage />} />
      </Routes>
      <Where />
    </>,
    {
      route,
      live: { players: [pip, gm] },
      queryData: [
        [keys.campaign(), data],
        [keys.sessions(), [savedSession({ id: "s1", n: 1 })]],
      ],
    },
  )
}

const rail = () => within(screen.getByRole("navigation", { name: "Fact filters" }))
const rows = () => screen.getAllByRole("row").length - 1

it("shows every confirmed fact with counts per filter", () => {
  page()
  expect(rows()).toBe(4)
  expect(screen.getByText(/^4 things that stay true/)).toBeInTheDocument()
  expect(rail().getByRole("button", { name: /Everything/ })).toHaveTextContent("4")
  expect(rail().getByRole("button", { name: /^NPCs/ })).toHaveTextContent("2")
  expect(rail().getByRole("button", { name: /^Campaign/ })).toHaveTextContent("1")
  expect(rail().getByRole("button", { name: /GM stated/ })).toHaveTextContent("2")
  expect(rail().getByRole("button", { name: /Pip · Sam/ })).toHaveTextContent("1")
  expect(rail().getByRole("button", { name: /Alex · GM and NPCs/ })).toBeInTheDocument()
})

it("combines filters and keeps them in the URL", async () => {
  page()
  await userEvent.click(rail().getByRole("button", { name: /^NPCs/ }))
  await userEvent.click(rail().getByRole("button", { name: /GM stated/ }))
  expect(screen.getByTestId("where")).toHaveTextContent("/facts?about=npc&sure=gm")
  expect(rows()).toBe(1)
  expect(screen.getByText("Hates the tide.")).toBeInTheDocument()
  await userEvent.click(rail().getByRole("button", { name: /Everything/ }))
  expect(screen.getByTestId("where")).toHaveTextContent("/facts?sure=gm")
})

it("reads the filters from the URL on load", () => {
  page("/facts?about=npc&by=p1&q=gold")
  expect(rows()).toBe(1)
  expect(screen.getByRole("searchbox", { name: "Search facts" })).toHaveValue("gold")
  expect(rail().getByRole("button", { name: /Pip · Sam/ })).toHaveAttribute("aria-current", "true")
})

it("searches text, about and speaker", async () => {
  page()
  const box = screen.getByRole("searchbox", { name: "Search facts" })
  await userEvent.type(box, "abbey")
  expect(rows()).toBe(1)
  expect(screen.getByTestId("where")).toHaveTextContent("/facts?q=abbey")
  await userEvent.clear(box)
  await userEvent.type(box, "alex")
  expect(screen.getByText("Hates the tide.")).toBeInTheDocument()
  expect(rows()).toBe(1)
})

it("adds a fact to an entry with a campaign write", async () => {
  const { writes } = mockFetch(({ method }) => (method === "GET" ? data.entities[0] : data.entities[0]))
  page()
  await userEvent.click(screen.getByRole("button", { name: "Add fact" }))
  const dialog = within(screen.getByRole("dialog"))
  await userEvent.type(dialog.getByLabelText("Fact"), "Fears fire.")
  await userEvent.selectOptions(dialog.getByLabelText("About"), "Orsa Vell")
  await userEvent.selectOptions(dialog.getByLabelText("How sure"), "theory")
  await userEvent.click(dialog.getByRole("button", { name: "Add fact" }))
  await vi.waitFor(() => expect(writes()).toHaveLength(1))
  const call = writes()[0]!
  expect(call.method).toBe("POST")
  expect(call.url).toContain("/api/campaign/entities/Orsa%20Vell/facts")
  expect(bodyOf(call)).toMatchObject({ text: "Fears fire.", confidence: "theory" })
})

it("disables Add fact while the fact is being saved", async () => {
  let release!: () => void
  const gate = new Promise<void>((r) => (release = r))
  const { writes } = mockFetch(async ({ method }) => {
    if (method === "POST") await gate
    return []
  })
  page()
  await userEvent.click(screen.getByRole("button", { name: "Add fact" }))
  const dialog = within(screen.getByRole("dialog"))
  await userEvent.type(dialog.getByLabelText("Fact"), "The moon is red.")
  await userEvent.click(dialog.getByRole("button", { name: "Add fact" }))
  await vi.waitFor(() => expect(dialog.getByRole("button", { name: "Add fact" })).toBeDisabled())
  expect(writes()).toHaveLength(1)
  release()
})

it("adds a campaign fact", async () => {
  const { writes } = mockFetch(() => [])
  page()
  await userEvent.click(screen.getByRole("button", { name: "Add fact" }))
  const dialog = within(screen.getByRole("dialog"))
  await userEvent.type(dialog.getByLabelText("Fact"), "The moon is red.")
  await userEvent.click(dialog.getByRole("button", { name: "Add fact" }))
  await vi.waitFor(() => expect(writes()).toHaveLength(1))
  expect(writes()[0]!.url).toContain("/api/campaign/facts")
  expect(bodyOf(writes()[0]!)).toMatchObject({ text: "The moon is red.", confidence: "gm" })
})
