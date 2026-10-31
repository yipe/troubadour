import { act, fireEvent, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { mockFetch, player, session } from "@troubadour/api/testing"
import { renderWithProviders } from "../../test/render.tsx"
import { LivePage } from "./LivePage.tsx"

// The three panes belong to other tasks; these stand-ins expose the props the page wires between them.
vi.mock("./end/EndSessionDialog.tsx", () => ({
  EndSessionDialog: ({ open }: { open: boolean }) => (open ? <div>end dialog open</div> : null),
}))
vi.mock("./notebook/Notebook.tsx", () => ({
  Notebook: ({ onJump, tab }: { onJump: (t: number) => void; tab: string }) => (
    <button onClick={() => onJump(42)}>jump (tab {tab})</button>
  ),
}))
vi.mock("./transcript/LiveTranscript.tsx", () => ({
  LiveTranscript: ({ highlightT, onPinned }: { highlightT: number | null; onPinned: () => void }) => (
    <button onClick={onPinned}>pin (highlight {String(highlightT)})</button>
  ),
}))

function setup() {
  mockFetch((c) => (c.url === "/api/sessions" || c.url === "/api/classes" ? [] : undefined))
  return renderWithProviders(<LivePage />, {
    live: { session: session(), players: [player({ id: "p1", name: "Maya" })] },
  })
}

describe("LivePage", () => {
  it("End session opens the end dialog", () => {
    setup()
    expect(screen.queryByText("end dialog open")).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: /End session/ }))
    expect(screen.getByText("end dialog open")).toBeInTheDocument()
  })

  it("a notebook jump highlights that line for a moment", () => {
    vi.useFakeTimers()
    try {
      setup()
      fireEvent.click(screen.getByText(/jump/))
      expect(screen.getByText("pin (highlight 42)")).toBeInTheDocument()
      act(() => void vi.advanceTimersByTime(2600))
      expect(screen.getByText("pin (highlight null)")).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it("pinning a line switches the notebook to Pins", () => {
    setup()
    expect(screen.getByText("jump (tab facts)")).toBeInTheDocument()
    fireEvent.click(screen.getByText(/^pin/))
    expect(screen.getByText("jump (tab pins)")).toBeInTheDocument()
  })
})
