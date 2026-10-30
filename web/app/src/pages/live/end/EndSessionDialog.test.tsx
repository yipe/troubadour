import { fireEvent, screen, waitFor } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { campaignJob, httpError, mockFetch, savedSession, session } from "@troubadour/api/testing"
import { renderWithProviders } from "../../../test/render.tsx"
import { EndSessionDialog, endSummary } from "./EndSessionDialog.tsx"

const NOTEBOOK = {
  session_id: "s14",
  updating: false,
  pins: [{ id: "p1", t: 5, text: "x", created_at: 1 }],
  items: ["kept", "kept", "kept", "open", "dismissed"].map((status, i) => ({
    id: `i${i}`,
    kind: "fact",
    text: `f${i}`,
    old: null,
    about: null,
    entry_type: null,
    said_by: null,
    t: null,
    line_id: null,
    confidence: null,
    count: null,
    status,
  })),
}

function setup(writeupReply: unknown = campaignJob({ id: "j1", kind: "writeup", title: "s14" })) {
  const m = mockFetch((c) => {
    if (c.url === "/api/sessions") return [savedSession({ id: "a" }), savedSession({ id: "b" })]
    if (c.url === "/api/session/notebook") return NOTEBOOK
    if (c.url === "/api/session/stop") return session({ status: "idle", t: 6240 })
    if (c.url === "/api/campaign/writeup/s14") return writeupReply
    return undefined
  })
  renderWithProviders(<EndSessionDialog open onOpenChange={() => {}} />, { live: { session: session() } })
  return m
}

describe("EndSessionDialog", () => {
  it("counts kept facts and pins", () => {
    expect(endSummary(6240, NOTEBOOK as never)).toBe("1:44 recorded, 3 facts kept, 1 pin.")
    expect(endSummary(0, undefined)).toBe("0:00 recorded, 0 facts kept, 0 pins.")
  })

  it("stops, then starts the write-up for the saved session", async () => {
    const m = setup()
    expect(await screen.findByText("End session 3?")).toBeInTheDocument()
    await waitFor(() => expect(m.calls.some((c) => c.url === "/api/session/notebook")).toBe(true))
    await new Promise((r) => setTimeout(r, 20))
    fireEvent.click(screen.getByRole("button", { name: "End" }))
    expect(await screen.findByText("Session 3 saved")).toBeInTheDocument()
    expect(screen.getByText("1:44 recorded, 3 facts kept, 1 pin.")).toBeInTheDocument()
    await waitFor(() =>
      expect(m.calls.map((c) => c.url)).toEqual(
        expect.arrayContaining(["/api/session/stop", "/api/campaign/writeup/s14"]),
      ),
    )
    const urls = m.calls.map((c) => c.url)
    expect(urls.indexOf("/api/session/stop")).toBeLessThan(urls.indexOf("/api/campaign/writeup/s14"))
    expect(screen.getByRole("button", { name: "Open the session" })).toHaveAttribute("href", "/sessions/s14")
    expect(screen.getByRole("button", { name: "Go home" })).toHaveAttribute("href", "/")
  })

  it("shows a write-up error and keeps the buttons", async () => {
    setup(httpError(503, "No language model is available."))
    await screen.findByText("End session 3?")
    await new Promise((r) => setTimeout(r, 20))
    fireEvent.click(screen.getByRole("button", { name: "End" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("No language model is available.")
    expect(screen.getByRole("button", { name: "Open the session" })).toBeInTheDocument()
  })
})
