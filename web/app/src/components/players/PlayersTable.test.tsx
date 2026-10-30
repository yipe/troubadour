import { fireEvent, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { keys } from "@troubadour/api/query"
import { libraryPlayer, mockFetch, player, session, snapshotBase } from "@troubadour/api/testing"
import type { DndClass } from "@troubadour/api/players"
import { renderWithProviders } from "../../test/render.tsx"
import { PlayersTable } from "./PlayersTable.tsx"

const CLASSES: DndClass[] = [
  { id: "bard", label: "Bard", color: null, builtin: true },
  { id: "wizard", label: "Wizard", color: null, builtin: true },
]

const NORA = player({ id: "p1", name: "Nora", character: "Vex", color: "#f59e0b", dnd_class: "bard" })

function renderTable(live: Parameters<typeof renderWithProviders>[1] = {}) {
  return renderWithProviders(<PlayersTable mode="wizard" />, {
    live: { ...snapshotBase(), session: session(), players: [NORA], ...live.live },
    queryData: [[keys.classes(), CLASSES]],
  })
}

afterEach(() => vi.restoreAllMocks())

describe("PlayersTable", () => {
  it("changing the class patches dnd_class", async () => {
    const { writes } = mockFetch(() => player({ ...NORA, dnd_class: "wizard" }))
    renderTable()
    fireEvent.change(screen.getByLabelText("Class for Nora"), { target: { value: "wizard" } })
    await waitFor(() => expect(writes()).toHaveLength(1))
    expect(writes()[0]).toMatchObject({
      method: "PATCH",
      url: "/api/players/p1",
      body: { dnd_class: "wizard" },
    })
  })

  it("the Role dropdown patches is_gm both ways and the row menu has no GM item", async () => {
    const { writes } = mockFetch(() => NORA)
    renderTable()
    fireEvent.change(screen.getByLabelText("Role for Nora"), { target: { value: "gm" } })
    await waitFor(() => expect(writes()).toHaveLength(1))
    expect(writes()[0]).toMatchObject({ method: "PATCH", url: "/api/players/p1", body: { is_gm: true } })
    fireEvent.change(screen.getByLabelText("Role for Nora"), { target: { value: "player" } })
    await waitFor(() => expect(writes()).toHaveLength(2))
    expect(writes()[1]).toMatchObject({ body: { is_gm: false } })
    fireEvent.click(screen.getByRole("button", { name: "More for Nora" }))
    await screen.findByRole("menuitem", { name: "Custom colour" })
    expect(screen.queryByRole("menuitem", { name: /GM/ })).toBeNull()
  })

  it("rolls the Role dropdown back when the save fails", async () => {
    mockFetch(() => new Response(JSON.stringify({ detail: "No." }), { status: 400 }))
    renderTable()
    const select = screen.getByLabelText("Role for Nora")
    fireEvent.change(select, { target: { value: "gm" } })
    await waitFor(() => expect(select).toHaveValue("player"))
  })

  it("'Add a class…' posts the class, then patches the player with its id", async () => {
    const { writes } = mockFetch((c) => {
      if (c.url === "/api/classes" && c.method === "POST")
        return { id: "tinkerer", label: "Tinkerer", color: "#22c55e", builtin: false }
      if (c.url === "/api/classes") return CLASSES
      return NORA
    })
    renderTable()
    fireEvent.change(screen.getByLabelText("Class for Nora"), { target: { value: "__add__" } })
    fireEvent.change(await screen.findByLabelText("Class name"), { target: { value: "Tinkerer" } })
    fireEvent.click(screen.getByRole("button", { name: "Add class" }))
    await waitFor(() => expect(writes()).toHaveLength(2))
    expect(writes()[0]).toMatchObject({ method: "POST", url: "/api/classes", body: { label: "Tinkerer" } })
    expect(writes()[1]).toMatchObject({
      method: "PATCH",
      url: "/api/players/p1",
      body: { dnd_class: "tinkerer" },
    })
  })

  it("'Use class colour' sends color: null", async () => {
    const { writes } = mockFetch(() => ({ ...NORA, color: null }))
    renderTable()
    fireEvent.click(screen.getByRole("button", { name: "More for Nora" }))
    fireEvent.click(await screen.findByRole("menuitem", { name: "Custom colour" }))
    fireEvent.click(await screen.findByRole("button", { name: /^Colour:/ }))
    fireEvent.click(await screen.findByText("Use class colour"))
    await waitFor(() => expect(writes()).toHaveLength(1))
    expect(writes()[0]).toMatchObject({ method: "PATCH", body: { color: null } })
  })

  it("saves the name on blur and rolls back when the server refuses", async () => {
    mockFetch(() => new Response(JSON.stringify({ detail: "No." }), { status: 400 }))
    renderTable()
    const input = screen.getByLabelText("Player name for Nora")
    fireEvent.change(input, { target: { value: "Noor" } })
    fireEvent.blur(input)
    await waitFor(() => expect(input).toHaveValue("Nora"))
  })

  it("the library banner seats every trained player listed", async () => {
    const { writes } = mockFetch(() => NORA)
    renderTable({
      live: {
        library: [
          libraryPlayer({ id: "p2", name: "Sam", trained: true }),
          libraryPlayer({ id: "p3", name: "Jo", trained: true }),
          libraryPlayer({ id: "p4", name: "Rin", trained: false }),
        ],
      },
    })
    expect(screen.getByText(/2 players from your other campaigns/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Add Sam and Jo" }))
    await waitFor(() => expect(writes()).toHaveLength(2))
    expect(writes().map((c) => c.url)).toEqual(["/api/players/p2/seat", "/api/players/p3/seat"])
  })

  it("Train opens the dialog and Cancel calls cancelTraining while recording", async () => {
    const { writes } = mockFetch(() => undefined)
    renderTable()
    fireEvent.click(screen.getByRole("button", { name: "Train" }))
    expect(await screen.findByText("Train Nora's voice")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Start" }))
    await waitFor(() =>
      expect(writes()[0]).toMatchObject({ url: "/api/players/p1/train", body: { seconds: 20 } }),
    )
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
    await waitFor(() => expect(writes().map((c) => c.url)).toContain("/api/train/cancel"))
  })

  it("Add player creates 'New player', GM when the table is empty", async () => {
    const { writes } = mockFetch(() => player({ id: "p9", name: "New player", is_gm: true }))
    renderTable({ live: { players: [] } })
    fireEvent.click(screen.getByRole("button", { name: "Add player" }))
    await waitFor(() => expect(writes()).toHaveLength(1))
    expect(writes()[0]).toMatchObject({ url: "/api/players", body: { name: "New player", is_gm: true } })
  })
})
