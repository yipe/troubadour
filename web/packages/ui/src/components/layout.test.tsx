import "@testing-library/jest-dom/vitest"
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import { PillGroup } from "./pill-group"
import { SegmentedBar } from "./segmented-bar"
import { UnderlineTabs } from "./underline-tabs"

afterEach(cleanup)

describe("SegmentedBar", () => {
  it("sizes segments in proportion", () => {
    render(
      <SegmentedBar
        segments={[
          { value: 2, color: "red", label: "A" },
          { value: 1, color: "green", label: "B" },
          { value: 1, color: "blue", label: "C" },
        ]}
      />,
    )
    const widths = ["A", "B", "C"].map(
      (l) => document.querySelector<HTMLElement>(`[data-segment="${l}"]`)!.style.width,
    )
    expect(widths.map((w) => Math.round(parseFloat(w)))).toEqual([50, 25, 25])
    expect(screen.getByRole("img")).toHaveAccessibleName("A 50%, B 25%, C 25%")
  })

  it("writes each label inside its segment, or its first letter when the whole label doesn't fit", () => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    )
    // jsdom has no layout: a label is 50px wide; segment A is 100px, segment B 20px.
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(50)
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (this: HTMLElement) {
      return this.dataset.segment === "Aurelia" ? 100 : 20
    })
    render(
      <SegmentedBar
        labels
        segments={[
          { value: 5, color: "red", label: "Aurelia" },
          { value: 1, color: "green", label: "Bram" },
        ]}
      />,
    )
    const shown = [...document.querySelectorAll("[data-label]")].map((e) => e.textContent)
    expect(shown).toEqual(["Aurelia", "B"])
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it("renders nothing when the total is zero", () => {
    const { container } = render(<SegmentedBar segments={[{ value: 0, color: "red", label: "A" }]} />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe("UnderlineTabs", () => {
  it("calls onChange with the id and marks the active tab", async () => {
    const onChange = vi.fn()
    render(
      <UnderlineTabs
        value="a"
        onChange={onChange}
        items={[
          { id: "a", label: "Alpha" },
          { id: "b", label: "Beta" },
        ]}
      />,
    )
    expect(screen.getByRole("tab", { name: "Alpha" })).toHaveAttribute("aria-selected", "true")
    expect(screen.getByRole("tab", { name: "Beta" })).toHaveAttribute("aria-selected", "false")
    await userEvent.click(screen.getByRole("tab", { name: "Beta" }))
    expect(onChange).toHaveBeenCalledWith("b")
  })
})

describe("PillGroup", () => {
  it("shows counts and selects one item", async () => {
    const onChange = vi.fn()
    render(
      <PillGroup
        value="all"
        onChange={onChange}
        items={[
          { id: "all", label: "All", count: 9 },
          { id: "facts", label: "Facts", count: 4 },
        ]}
      />,
    )
    expect(screen.getByRole("button", { name: "All 9" })).toHaveAttribute("aria-pressed", "true")
    await userEvent.click(screen.getByRole("button", { name: "Facts 4" }))
    expect(onChange).toHaveBeenCalledWith("facts")
  })
})
