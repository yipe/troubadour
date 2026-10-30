import "@testing-library/jest-dom/vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, expect, it } from "vitest"
import { PageHeading } from "./page-heading"

afterEach(cleanup)

it("draws the title in the accent colour with tone accent, and in ink by default", () => {
  render(<PageHeading tone="accent" title="Players & voices" />)
  expect(screen.getByRole("heading", { name: "Players & voices" })).toHaveClass("text-accent")
  cleanup()
  render(<PageHeading title="Home" />)
  expect(screen.getByRole("heading", { name: "Home" })).toHaveClass("text-ink")
})
