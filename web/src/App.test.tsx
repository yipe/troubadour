import { act, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { useLlmProviders } from "@/lib/llmStore"
import { useStore } from "@/lib/store"
import type * as Store from "@/lib/store"
import { session } from "@/test/fixtures"
import App from "./App"

// No WebSocket and no URL syncing: these tests drive the store directly.
vi.mock("@/lib/route", () => ({ startRouting: () => () => {} }))
vi.mock("@/lib/store", async (original) => ({
  ...(await original<typeof Store>()),
  connect: () => () => {},
}))

const initial = useStore.getState()
afterEach(() => useStore.setState(initial, true))

describe("App", () => {
  it("marks the current tab with aria-current", () => {
    render(<App />)
    const tab = (name: string) => screen.getByRole("button", { name })
    expect(tab("Sessions")).toHaveAttribute("aria-current", "page")
    expect(tab("Campaign")).not.toHaveAttribute("aria-current")
    fireEvent.click(tab("Campaign"))
    expect(tab("Campaign")).toHaveAttribute("aria-current", "page")
    expect(tab("Sessions")).not.toHaveAttribute("aria-current")
    fireEvent.click(tab("Sessions"))
    expect(tab("Sessions")).toHaveAttribute("aria-current", "page")
  })

  it("shows the server's session error as an alert", () => {
    render(<App />)
    expect(screen.queryByRole("alert")).toBeNull()
    act(() => useStore.setState({ session: session({ status: "idle", error: "Mic unplugged" }) }))
    expect(screen.getByRole("alert")).toHaveTextContent("Mic unplugged")
  })
  it("shows whether the AI answers, and opens Models from the status", () => {
    render(<App />)
    act(() =>
      useStore.setState({
        connected: true,
        session: session({ status: "idle", llm: { url: "http://127.0.0.1:1235/v1", model: "m", ok: false } }),
      }),
    )
    const status = screen.getByRole("button", { name: /Connected.*AI offline/ })
    fireEvent.click(status)
    expect(useLlmProviders.getState().modelsOpen).toBe(true)
    act(() => useLlmProviders.setState({ modelsOpen: false }))
  })
})
