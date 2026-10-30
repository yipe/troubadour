import { render } from "@testing-library/react"
import { forwardRef, useImperativeHandle } from "react"
import { describe, expect, it, vi } from "vitest"
import "../../test/setup.ts"
import { TranscriptList } from "./TranscriptList.tsx"
import type { ViewLine } from "./viewLines.ts"

const scrollToIndex = vi.fn()

// A plain list standing in for Virtuoso, so the handle's calls can be asserted.
vi.mock("react-virtuoso", () => ({
  Virtuoso: forwardRef(function Virtuoso(
    props: { data: ViewLine[]; itemContent: (i: number, l: ViewLine) => React.ReactNode },
    ref,
  ) {
    useImperativeHandle(ref, () => ({ scrollToIndex }))
    return <div>{props.data.map((l, i) => props.itemContent(i, l))}</div>
  }),
}))

const lines: ViewLine[] = ["a", "b", "c"].map((id, i) => ({
  id,
  t: i,
  speaker: null,
  label: "Voice 1",
  text: id,
  fixes: [],
}))

describe("TranscriptList scrollToId", () => {
  it("centres the line with that id", () => {
    scrollToIndex.mockClear()
    const { rerender } = render(<TranscriptList lines={lines} mode="static" />)
    expect(scrollToIndex).not.toHaveBeenCalled()
    rerender(<TranscriptList lines={lines} mode="static" scrollToId="c" />)
    expect(scrollToIndex).toHaveBeenCalledWith({ index: 2, align: "center" })
  })

  it("ignores an id that is not in the list", () => {
    scrollToIndex.mockClear()
    render(<TranscriptList lines={lines} mode="static" scrollToId="zzz" />)
    expect(scrollToIndex).not.toHaveBeenCalled()
  })
})
