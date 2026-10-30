import { screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { renderWithProviders } from "../../test/render.tsx"
import { LevelMeter48 } from "./LevelMeter48.tsx"

describe("LevelMeter48", () => {
  it("asks for a few words from each seat during a mic test", () => {
    renderWithProviders(<LevelMeter48 source="test" />)
    expect(screen.getByText("Say a few words from each seat")).toBeInTheDocument()
  })

  it("drops the mic-test instruction during a session", () => {
    renderWithProviders(<LevelMeter48 source="session" hint={null} />)
    expect(screen.queryByText("Say a few words from each seat")).not.toBeInTheDocument()
    expect(screen.getByText("quiet")).toBeInTheDocument()
  })
})
