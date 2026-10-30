import { fireEvent, screen, waitFor } from "@testing-library/react"
import { afterEach, expect, it, vi } from "vitest"
import { campaign, mockFetch } from "@troubadour/api/testing"
import { renderWithProviders } from "../../../../test/render.tsx"
import { Component as VaultSettings } from "./index.tsx"

afterEach(() => vi.restoreAllMocks())

function server(over: Parameters<typeof campaign>[0]) {
  let c = campaign(over)
  return mockFetch((call) => {
    if (call.method === "DELETE" && call.url.startsWith("/api/campaign/ignore/")) {
      c = {
        ...c,
        ignored: c.ignored.filter((w) => w !== decodeURIComponent(call.url.split("/").pop() ?? "")),
      }
      return c.ignored
    }
    if (call.url === "/api/campaign") return c
    return []
  })
}

it("Unignore calls the endpoint and removes the chip", async () => {
  const { writes } = server({ ignored: ["Hmm", "Okay"] })
  renderWithProviders(<VaultSettings />)
  fireEvent.click(await screen.findByRole("button", { name: "Unignore Hmm" }))
  await waitFor(() => expect(screen.queryByRole("button", { name: "Unignore Hmm" })).toBeNull())
  expect(writes().map((w) => `${w.method} ${w.url}`)).toEqual(["DELETE /api/campaign/ignore/Hmm"])
  expect(screen.getByRole("button", { name: "Unignore Okay" })).toBeInTheDocument()
})

it("searches the ignored words only past 20", async () => {
  server({ ignored: Array.from({ length: 21 }, (_, i) => `word${i}`) })
  renderWithProviders(<VaultSettings />)
  fireEvent.change(await screen.findByRole("searchbox", { name: "Search ignored words" }), {
    target: { value: "word20" },
  })
  expect(screen.getAllByRole("button", { name: /^Unignore/ })).toHaveLength(1)
})

it("links to Obsidian when it knows the folder, and explains otherwise", async () => {
  server({ obsidian: { id: "abc123", folder: "" } })
  const { unmount } = renderWithProviders(<VaultSettings />)
  expect(await screen.findByRole("link", { name: /Open in Obsidian/ })).toHaveAttribute(
    "href",
    "obsidian://open?vault=abc123",
  )
  unmount()
  server({ obsidian: null })
  renderWithProviders(<VaultSettings />)
  expect(await screen.findByText("Open this folder as a vault in Obsidian first")).toBeInTheDocument()
  expect(screen.queryByRole("link", { name: /Open in Obsidian/ })).toBeNull()
})

it("names the page once, in one heading", async () => {
  server({})
  renderWithProviders(<VaultSettings />)
  expect(await screen.findByRole("heading", { level: 1, name: "Obsidian vault" })).toBeInTheDocument()
  expect(screen.getAllByText("Obsidian vault")).toHaveLength(1)
})
