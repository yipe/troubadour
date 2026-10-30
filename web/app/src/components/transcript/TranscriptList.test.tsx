import { act, render, screen, within } from "@testing-library/react"
import { forwardRef, type ComponentProps } from "react"
import { VirtuosoMockContext, type VirtuosoHandle } from "react-virtuoso"
import { describe, expect, it, vi } from "vitest"
import { TooltipProvider } from "@troubadour/ui/tooltip"
import "../../test/setup.ts"
import { TranscriptList, type TranscriptListProps } from "./TranscriptList.tsx"
import type { ViewLine } from "./viewLines.ts"

// `initialTopMostItemIndex` waits for real layout, which jsdom lacks, and then renders no rows.
// Strip it in tests and scroll by hand.
vi.mock("react-virtuoso", async (importOriginal) => {
  const mod = await importOriginal<typeof import("react-virtuoso")>()
  const Virtuoso = forwardRef<VirtuosoHandle, ComponentProps<typeof mod.Virtuoso>>(
    function Virtuoso(props, ref) {
      return <mod.Virtuoso {...props} ref={ref} initialTopMostItemIndex={undefined} />
    },
  )
  return { ...mod, Virtuoso }
})

const ROW = 60
const VIEWPORT = 600
/** Virtuoso debounces scroll-state updates (~200 ms). */
const SETTLE_MS = 250

const line = (i: number, over: Partial<ViewLine> = {}): ViewLine => ({
  id: `m${i}`,
  t: i,
  speaker: { name: "Priya", color: "#f00" },
  text: `line ${i}`,
  fixes: [],
  ...over,
})
const make = (n: number) => Array.from({ length: n }, (_, i) => line(i))

function ui(props: TranscriptListProps) {
  return (
    <VirtuosoMockContext.Provider value={{ viewportHeight: VIEWPORT, itemHeight: ROW }}>
      <TooltipProvider>
        <TranscriptList {...props} />
      </TooltipProvider>
    </VirtuosoMockContext.Provider>
  )
}

const rows = (c: HTMLElement) => c.querySelectorAll("[data-line-id]")
const row = (c: HTMLElement, id: string) => c.querySelector<HTMLElement>(`[data-line-id="${id}"]`)

async function scrollTo(container: HTMLElement, count: number, top: number) {
  const scroller = container.querySelector<HTMLElement>("[data-virtuoso-scroller]")!
  // jsdom has no layout: report the virtual list height so "at bottom" can be computed.
  Object.defineProperty(scroller, "scrollHeight", { configurable: true, get: () => count * ROW })
  Object.defineProperty(scroller, "offsetHeight", { configurable: true, get: () => VIEWPORT })
  await act(async () => {
    scroller.scrollTop = top
    scroller.dispatchEvent(new Event("scroll"))
    await new Promise((r) => setTimeout(r, SETTLE_MS))
  })
}
const scrollToBottom = (c: HTMLElement, count: number) => scrollTo(c, count, count * ROW - VIEWPORT)

describe("TranscriptList", () => {
  it("only renders a window of rows for a long session", async () => {
    const { container } = render(ui({ lines: make(5000), mode: "live" }))
    await scrollToBottom(container, 5000)
    expect(rows(container).length).toBeGreaterThan(0)
    expect(rows(container).length).toBeLessThan(100)
    expect(row(container, "m4999")).not.toBeNull()
    expect(row(container, "m0")).toBeNull()
  })

  it("follows new lines at the bottom, not after the user scrolled up", async () => {
    const { container, rerender } = render(ui({ lines: make(200), mode: "live" }))
    await scrollToBottom(container, 200)
    expect(screen.queryByRole("button", { name: /Jump to latest/ })).toBeNull()

    await act(async () => {
      rerender(ui({ lines: [...make(200), line(500)], mode: "live" }))
      await new Promise((r) => setTimeout(r, SETTLE_MS))
    })
    expect(row(container, "m500")).not.toBeNull()
    await scrollToBottom(container, 201) // a real browser emits the scroll that follow-output triggered

    await scrollTo(container, 201, 0)
    expect(screen.getByRole("button", { name: /Jump to latest/ })).toBeInTheDocument()
    await act(async () => {
      rerender(ui({ lines: [...make(200), line(500), line(501)], mode: "live" }))
      await new Promise((r) => setTimeout(r, SETTLE_MS))
    })
    expect(row(container, "m501")).toBeNull()
    expect(row(container, "m0")).not.toBeNull()
  })

  it("never shows Jump to latest in static mode", async () => {
    const { container } = render(ui({ lines: make(200), mode: "static" }))
    await scrollTo(container, 200, 0)
    expect(screen.queryByRole("button", { name: /Jump to latest/ })).toBeNull()
  })

  it("marks the highlighted row with aria-current", () => {
    const { container } = render(ui({ lines: make(5), mode: "static", highlightId: "m2" }))
    expect(row(container, "m2")).toHaveAttribute("aria-current", "true")
    expect(row(container, "m1")).not.toHaveAttribute("aria-current")
  })

  it("renders the aside in the same row element as its line", () => {
    const { container } = render(
      ui({ lines: make(3), mode: "static", renderAside: (l) => <p>aside for {l.id}</p> }),
    )
    const r = row(container, "m1")!
    expect(within(r).getByText("line 1")).toBeInTheDocument()
    expect(within(r).getByText("aside for m1")).toBeInTheDocument()
    expect(r.style.gridTemplateColumns).toBe("minmax(0,1fr) 460px")
  })

  it("renders the footer after the rows", () => {
    render(ui({ lines: make(2), mode: "static", footer: <p>Priya is speaking…</p> }))
    expect(screen.getByText("Priya is speaking…")).toBeInTheDocument()
  })
})
