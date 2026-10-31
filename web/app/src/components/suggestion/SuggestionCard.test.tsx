import { screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { renderWithProviders } from "../../test/render.tsx"
import { SuggestionCard } from "./SuggestionCard.tsx"

describe("SuggestionCard", () => {
  it("shows an update's old text struck through above the new text", () => {
    renderWithProviders(
      <SuggestionCard
        kind="update"
        about="Orsa Vell"
        text="Keeps the key under the tide bell."
        old="Keeps the key under the bell."
        confidence="gm"
        status="open"
        actions={<button>Keep</button>}
      />,
    )
    expect(screen.getByText("Updates a fact")).toBeInTheDocument()
    expect(screen.getByText("Keeps the key under the bell.")).toHaveClass("line-through")
    expect(screen.getByText("Keeps the key under the tide bell.")).not.toHaveClass("line-through")
    expect(screen.getByText("GM stated")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Keep" })).toBeInTheDocument()
  })

  it("dims a done card and borders an accepted one", () => {
    const { container } = renderWithProviders(
      <SuggestionCard kind="fact" text="x" status="done" tone="accepted" actions={null} />,
    )
    expect(container.firstChild).toHaveClass("opacity-75", "border-success")
  })

  it("links the moment it came from", () => {
    renderWithProviders(
      <SuggestionCard
        kind="fact"
        text="x"
        status="open"
        sessionId="s12"
        sessionN={12}
        t={6115}
        who={{ name: "Pip", color: "red" }}
        actions={null}
      />,
    )
    expect(screen.getByRole("button", { name: "S12 · 1:41:55" })).toBeInTheDocument()
    expect(screen.getByText("Pip")).toBeInTheDocument()
  })
})
