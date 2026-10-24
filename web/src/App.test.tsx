import { act, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
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
})
