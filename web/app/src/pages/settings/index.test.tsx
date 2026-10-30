import { screen, within } from "@testing-library/react"
import { afterEach, expect, it, vi } from "vitest"
import { keys } from "@troubadour/api/query"
import { cloudStatus, llmProvider, mockFetch, modelSettings } from "@troubadour/api/testing"
import { Route, Routes } from "react-router"
import { renderWithProviders } from "../../test/render.tsx"
import { Component as SettingsPage } from "./index.tsx"
import { StorageBar } from "./sections/models/StorageBar.tsx"
import { WhatLeavesList } from "./sections/models/WhatLeavesList.tsx"

afterEach(() => vi.restoreAllMocks())

it("routes /settings/:section to its section, and unknown ones to models", async () => {
  mockFetch((c) =>
    c.url === "/api/storage"
      ? { root: "~/troubador", recordings: 1, voices: 1, notes: 1, other: 1 }
      : modelSettings(),
  )
  const page = (route: string) =>
    renderWithProviders(
      <Routes>
        <Route path="/settings/:section" element={<SettingsPage />} />
      </Routes>,
      { route },
    )
  const { unmount } = page("/settings/microphone")
  expect(await screen.findByRole("heading", { name: "Microphone" })).toBeInTheDocument()
  unmount()
  page("/settings/bogus")
  expect(await screen.findByRole("heading", { name: "Models & privacy", level: 1 })).toBeInTheDocument()
})

function leaves(over: { provider?: "local" | "openrouter"; connected?: boolean }) {
  const providers = [llmProvider({ id: "openrouter", label: "OpenRouter" })]
  renderWithProviders(<WhatLeavesList />, {
    queryData: [
      [keys.llm(), { provider: over.provider ?? "local", providers }],
      [keys.cloud(), cloudStatus({ connected: over.connected ?? false })],
    ],
  })
}

it("says nothing leaves with a local model and no backup", () => {
  leaves({})
  expect(screen.getAllByText("Never with a local model")).toHaveLength(2)
  expect(screen.getByText("Off")).toBeInTheDocument()
})

it("names the hosted provider and cloud backup when on", () => {
  leaves({ provider: "openrouter", connected: true })
  expect(screen.getAllByText("Sent to OpenRouter")).toHaveLength(2)
  expect(screen.getByText("On: notes and write-ups")).toBeInTheDocument()
})

it("formats the storage numbers", () => {
  mockFetch(() => ({
    root: "~/troubador",
    recordings: 3 * 1024 ** 3,
    voices: 2048,
    notes: 5 * 1024 ** 2,
    other: 0,
  }))
  renderWithProviders(<StorageBar />)
  return screen.findByText("3.0 GB").then(() => {
    const list = screen.getByText("Voices").closest("ul")!
    expect(within(list).getByText("2.0 KB")).toBeInTheDocument()
    expect(within(list).getByText("5.0 MB")).toBeInTheDocument()
  })
})
