import { screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { keys } from "@troubadour/api/query"
import { player } from "@troubadour/api/testing"
import { renderWithProviders } from "../../test/render.tsx"
import { PlayerAvatar } from "./PlayerAvatar.tsx"

const bard = { id: "bard", name: "Bard", builtin: true, color: null }

function avatarColor(container: HTMLElement) {
  return (container.firstElementChild as HTMLElement).style.getPropertyValue("--avatar")
}

describe("PlayerAvatar", () => {
  it("uses the class colour for a player with a class and no override", () => {
    const p = player({ id: "p1", name: "Priya Shah", color: null, dnd_class: "bard" })
    const { container } = renderWithProviders(<PlayerAvatar player={p} />, {
      queryData: [[keys.classes(), [bard]]],
    })
    expect(avatarColor(container)).toBe("var(--color-class-bard)")
    expect(screen.getByText("PS")).toBeInTheDocument()
  })

  it("falls back to the muted colour when the class was deleted", () => {
    const p = player({ id: "p1", name: "Rex", color: null, dnd_class: "gone" })
    const { container } = renderWithProviders(<PlayerAvatar player={p} />, {
      queryData: [[keys.classes(), [bard]]],
    })
    expect(avatarColor(container)).toBe("var(--color-fg-subtle)")
  })

  it("shows the player's avatar image", () => {
    const p = player({ id: "p1", name: "Rex", avatar: "data:image/png;base64,AAAA" })
    const { container } = renderWithProviders(<PlayerAvatar player={p} />)
    expect(container.querySelector("img")).toHaveAttribute("src", "data:image/png;base64,AAAA")
  })
})
