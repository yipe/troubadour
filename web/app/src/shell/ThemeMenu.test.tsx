import { fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { ThemeMenu } from "./ThemeMenu.tsx"

afterEach(() => {
  localStorage.clear()
  delete document.documentElement.dataset.theme
})

describe("ThemeMenu", () => {
  it("offers Dark, Light, Midnight and Auto, and applies and stores the pick", async () => {
    render(<ThemeMenu />)
    fireEvent.click(screen.getByRole("button", { name: "Theme" }))
    expect((await screen.findAllByRole("menuitem")).map((i) => i.textContent)).toEqual([
      "Dark",
      "Light",
      "Midnight",
      "Auto",
    ])
    fireEvent.click(screen.getByRole("menuitem", { name: "Midnight" }))
    expect(document.documentElement.dataset.theme).toBe("midnight")
    expect(localStorage.getItem("troubadour.theme")).toBe("midnight")
  })

  it("Auto follows the system again", async () => {
    localStorage.setItem("troubadour.theme", "light")
    render(<ThemeMenu />)
    fireEvent.click(screen.getByRole("button", { name: "Theme" }))
    fireEvent.click(await screen.findByRole("menuitem", { name: "Auto" }))
    expect(localStorage.getItem("troubadour.theme")).toBe("system")
  })
})
