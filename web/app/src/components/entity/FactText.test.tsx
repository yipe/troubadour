import { screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { keys } from "@troubadour/api/query"
import { campaign, entity } from "@troubadour/api/testing"
import { renderWithProviders } from "../../test/render.tsx"
import { FactText } from "./FactText.tsx"

const seeded = {
  queryData: [
    [
      keys.campaign(),
      campaign({
        entities: [entity({ name: "Orsa Vell", type: "npc" }), entity({ name: "Sunblade", type: "item" })],
      }),
    ],
  ] as [readonly unknown[], unknown][],
}

describe("FactText", () => {
  it("links [[Target|label]] to the codex entry under the label", () => {
    renderWithProviders(<FactText text="Met [[Orsa Vell|the captain]] at dawn." />, seeded)
    const link = screen.getByRole("link", { name: "the captain" })
    expect(link).toHaveAttribute("href", "/codex/Orsa%20Vell")
    expect(screen.getByText(/Met/)).toBeInTheDocument()
  })

  it("tints items and leaves unknown names as plain text", () => {
    renderWithProviders(<FactText text="[[Sunblade]] and [[Nobody]]" />, seeded)
    expect(screen.getByRole("link", { name: "Sunblade" })).toHaveClass("text-legendary")
    expect(screen.getByText("Nobody")).toBeInTheDocument()
    expect(screen.getAllByRole("link")).toHaveLength(1)
  })
})
