import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import { afterEach, expect, it, vi } from "vitest"
import type { DndClass } from "@troubadour/api/players"
import { keys } from "@troubadour/api/query"
import { mockFetch } from "@troubadour/api/testing"
import type { Terms } from "@troubadour/api/terms"
import { renderWithProviders } from "../../../../test/render.tsx"
import { Component as ContentSettings } from "./index.tsx"

afterEach(() => vi.restoreAllMocks())

const CLASSES: DndClass[] = [
  { id: "bard", label: "Bard", color: null, builtin: true },
  { id: "tinkerer", label: "Tinkerer", color: "#8c6040", builtin: false },
]

const ALL: Terms = {
  counts: { builtin: 2, local: 1, custom: 1 },
  total: 4,
  items: [
    { name: "Mirvane", type: "npc", source: "custom" },
    { name: "Zorbo", type: "creature", source: "local" },
    { name: "Fireball", type: "spell", source: "builtin" },
    { name: "Beholder", type: "creature", source: "builtin" },
  ],
}

/** A fake server: terms filtered by the query string, writes answered by `write`. */
function serve(write: unknown = { added: 1, skipped: [], more_skipped: 0 }) {
  return mockFetch((c) => {
    if (c.method !== "GET") return write
    if (c.url === "/api/classes") return CLASSES
    const params = new URL(c.url, "http://x").searchParams
    const q = (params.get("q") ?? "").toLowerCase()
    const source = params.get("source")
    const items = ALL.items.filter(
      (t) => t.name.toLowerCase().includes(q) && (!source || t.source === source),
    )
    return { ...ALL, items, total: items.length }
  })
}

function renderContent() {
  return renderWithProviders(<ContentSettings />, { queryData: [[keys.classes(), CLASSES]] })
}

it("lists the classes (moved here) and adds and removes one", async () => {
  const { writes } = serve({ id: "mystic", label: "Mystic", color: "#8b5cf6", builtin: false })
  renderContent()
  expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1)
  const classes = screen.getByRole("region", { name: "Classes" })
  expect(within(classes).getByText("Bard")).toBeInTheDocument()
  expect(within(classes).getByText("Tinkerer")).toBeInTheDocument()

  fireEvent.click(within(classes).getByRole("button", { name: /Add a class/ }))
  fireEvent.change(await screen.findByLabelText("Class name"), { target: { value: "Mystic" } })
  fireEvent.click(screen.getByRole("button", { name: "Add class" }))
  await waitFor(() => expect(writes()).toHaveLength(1))
  expect(writes()[0]).toMatchObject({ method: "POST", url: "/api/classes", body: { label: "Mystic" } })

  fireEvent.click(within(classes).getByRole("button", { name: "Remove Tinkerer" }))
  fireEvent.click(await screen.findByRole("button", { name: "Remove class" }))
  await waitFor(() => expect(writes()).toHaveLength(2))
  expect(writes()[1]).toMatchObject({ method: "DELETE", url: "/api/classes/tinkerer" })
})

it("shows counts and the list, with a remove button only on your own terms", async () => {
  serve()
  renderContent()
  const terms = await screen.findByRole("list", { name: "Terms" })
  expect(await within(terms).findByText("Mirvane")).toBeInTheDocument()
  expect(screen.getByText(/2 built-in · 1 in your local list · 1 added by you/)).toBeInTheDocument()
  expect(within(terms).getAllByRole("button")).toHaveLength(1)
  expect(within(terms).getByRole("button", { name: "Remove Mirvane" })).toBeInTheDocument()
})

it("searches and filters by source through the server", async () => {
  const { calls } = serve()
  renderContent()
  const terms = await screen.findByRole("list", { name: "Terms" })
  fireEvent.change(screen.getByLabelText("Search terms"), { target: { value: "fire" } })
  await waitFor(() => expect(within(terms).queryByText("Mirvane")).toBeNull())
  expect(within(terms).getByText("Fireball")).toBeInTheDocument()
  expect(calls.at(-1)!.url).toContain("q=fire")

  fireEvent.change(screen.getByLabelText("Search terms"), { target: { value: "" } })
  fireEvent.change(screen.getByLabelText("Show terms from"), { target: { value: "local" } })
  await waitFor(() => expect(within(terms).queryByText("Fireball")).toBeNull())
  expect(within(terms).getByText("Zorbo")).toBeInTheDocument()
  expect(calls.at(-1)!.url).toContain("source=local")
})

it("adds a term, and shows why one was skipped", async () => {
  const { writes } = serve({
    added: 0,
    skipped: [{ name: "Table", reason: "an everyday word" }],
    more_skipped: 0,
  })
  renderContent()
  await screen.findByText("Mirvane")
  fireEvent.change(screen.getByLabelText("Term name"), { target: { value: "Table" } })
  fireEvent.change(screen.getByLabelText("Term type"), { target: { value: "item" } })
  fireEvent.click(screen.getByRole("button", { name: "Add term" }))
  await waitFor(() => expect(writes()).toHaveLength(1))
  expect(writes()[0]).toMatchObject({
    method: "POST",
    url: "/api/terms",
    body: { terms: [{ name: "Table", type: "item" }] },
  })
  expect(await screen.findByText("Table: an everyday word")).toBeInTheDocument()
  expect(screen.getByText("Nothing was added from Table.")).toBeInTheDocument()
})

it("removes one of your terms", async () => {
  const { writes } = serve()
  renderContent()
  fireEvent.click(await screen.findByRole("button", { name: "Remove Mirvane" }))
  await waitFor(() => expect(writes()).toHaveLength(1))
  expect(writes()[0]).toMatchObject({ method: "DELETE", url: "/api/terms/Mirvane" })
})

it("uploads a list as text and reports what was added and skipped", async () => {
  serve()
  renderContent()
  await screen.findByText("Mirvane")
  const answer = { added: 2, skipped: [{ name: "Light", reason: "an everyday word" }], more_skipped: 0 }
  const post = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async (url) =>
      Response.json(String(url) === "/api/terms/upload" ? answer : { ...ALL, items: [] }),
    )
  const file = new File(["Krunk,creature\nBlorp\n"], "terms.csv", { type: "text/csv" })
  fireEvent.change(screen.getByLabelText("Term list file"), { target: { files: [file] } })
  expect(await screen.findByText("Added 2 terms from terms.csv.")).toBeInTheDocument()
  expect(screen.getByText("Light: an everyday word")).toBeInTheDocument()
  const sent = post.mock.calls.find(([url]) => String(url) === "/api/terms/upload")
  expect(sent![1]).toMatchObject({ method: "POST", body: "Krunk,creature\nBlorp\n" })
})
