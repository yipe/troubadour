import "@testing-library/jest-dom/vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, expect, it } from "vitest"
import { PageHeading } from "./page-heading"

afterEach(cleanup)

it("draws every page title in the accent colour", () => {
  render(<PageHeading title="Players & voices" />)
  expect(screen.getByRole("heading", { name: "Players & voices" })).toHaveClass("text-accent")
})
