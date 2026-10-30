import { fireEvent, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { keys } from "@troubadour/api/query"
import { answerSource, bodyOf, campaign, campaignAnswer, mockFetch } from "@troubadour/api/testing"
import { renderWithProviders } from "../../test/render.tsx"
import { Component } from "./index.tsx"

afterEach(() => vi.restoreAllMocks())

const old = campaignAnswer({
  id: "a1",
  question: "Who guards the abbey?",
  answer: "Nobody [S1].",
  created: 1,
  sources: [answerSource({ id: "S1", kind: "note", label: "Notes", path: "Lore/a.md", excerpt: "Empty." })],
})
const newer = campaignAnswer({ id: "a2", question: "Where is the gem?", answer: "In the vault.", created: 2 })

function show(answers = [old, newer]) {
  return renderWithProviders(<Component />, {
    queryData: [[keys.campaign(), campaign({ answers })]],
  })
}

describe("Ask page", () => {
  it("lists past questions newest first and opens the selected answer", () => {
    show()
    const items = screen.getAllByRole("button", { name: /\?$/ })
    expect(items.map((b) => b.textContent)).toEqual(["Where is the gem?", "Who guards the abbey?"])
    expect(screen.getByText("In the vault.")).toBeInTheDocument()
    fireEvent.click(items[1]!)
    expect(screen.getByText(/Nobody/)).toBeInTheDocument()
  })

  it("Enter submits the trimmed question and selects the new answer", async () => {
    const pending = campaignAnswer({ id: "a3", question: "Who is Orsa?", state: "queued", created: 3 })
    const m = mockFetch(() => pending)
    show()
    const box = screen.getByRole("textbox", { name: "Ask about the campaign" })
    expect(screen.getByRole("button", { name: "Ask" })).toBeDisabled()
    fireEvent.change(box, { target: { value: "  Who is Orsa? " } })
    fireEvent.keyDown(box, { key: "Enter" })
    await waitFor(() => expect(screen.getByText(/Searching/)).toBeInTheDocument())
    expect(m.calls[0]).toMatchObject({ method: "POST", url: "/api/campaign/ask" })
    expect(bodyOf(m.calls[0]!)).toEqual({ question: "Who is Orsa?" })
    expect(box).toHaveValue("")
    expect(screen.getByRole("heading", { name: "Who is Orsa?" })).toBeInTheDocument()
  })

  it("opens a note source in Obsidian", () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null)
    show([old])
    fireEvent.click(screen.getByRole("button", { name: "Open note" }))
    expect(open).toHaveBeenCalledWith("obsidian://open?vault=abc123&file=Lore%2Fa.md", "_self")
  })

  it("offers to ask again when an answer failed", async () => {
    const failed = campaignAnswer({ id: "a9", question: "Why?", state: "error", message: "LM Studio is off" })
    const m = mockFetch(() => campaignAnswer({ id: "a10", question: "Why?", state: "queued" }))
    show([failed])
    fireEvent.click(screen.getByRole("button", { name: "Try again" }))
    await waitFor(() => expect(m.calls).toHaveLength(1))
    expect(bodyOf(m.calls[0]!)).toEqual({ question: "Why?" })
  })
})
