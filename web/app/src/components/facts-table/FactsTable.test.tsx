import { fireEvent, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { fact } from "@troubadour/api/testing"
import { renderWithProviders } from "../../test/render.tsx"
import { FactsTable, type FactRow } from "./FactsTable.tsx"

const rows: FactRow[] = [
  {
    fact: fact({
      id: "f1",
      text: "Keeps the key under the tide bell.",
      said_by: { name: "Pip", player_id: null },
      source: { page: "p", label: "S12 1:41", session_id: null, t: null },
      history: [
        {
          text: "Keeps the key under the bell.",
          confidence: "once",
          said_by: { name: "Alex", player_id: null },
          source: null,
        },
      ],
    }),
    about: { name: "Orsa Vell", type: "npc" },
  },
  { fact: fact({ id: "f2", text: "Fears deep water." }) },
]

describe("FactsTable", () => {
  it("expands and collapses a fact's history, current version first", () => {
    renderWithProviders(<FactsTable rows={rows} emptyText="none" />)
    const toggle = screen.getByRole("button", { name: /Changed once · history closed/ })
    expect(screen.queryByText("Keeps the key under the bell.")).toBeNull()
    fireEvent.click(toggle)
    expect(screen.getByRole("button", { name: /history open/ })).toHaveAttribute("aria-expanded", "true")
    expect(screen.getByText("Keeps the key under the bell.").closest(".line-through")).not.toBeNull()
    expect(screen.getByText(/^now/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: /history open/ }))
    expect(screen.queryByText("Keeps the key under the bell.")).toBeNull()
  })

  it("drops the About column when showAbout is false", () => {
    const first = renderWithProviders(<FactsTable rows={rows} emptyText="none" />)
    expect(screen.getByRole("columnheader", { name: "About" })).toBeInTheDocument()
    expect(screen.getByText("npc")).toBeInTheDocument()
    first.unmount()
    renderWithProviders(<FactsTable rows={rows} showAbout={false} emptyText="none" />)
    expect(screen.queryByRole("columnheader", { name: "About" })).toBeNull()
  })

  it("shows the empty text without rows", () => {
    renderWithProviders(<FactsTable rows={[]} emptyText="No facts yet." />)
    expect(screen.getByText("No facts yet.")).toBeInTheDocument()
  })
})
