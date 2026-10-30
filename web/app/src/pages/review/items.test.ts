import { describe, expect, it } from "vitest"
import type { ReviewItem } from "@troubadour/api/review"
import { fact, factSuggestion } from "@troubadour/api/testing"
import {
  filterCounts,
  gmStatedOpen,
  lineState,
  minutesLeft,
  placeItems,
  replacedText,
  reviewDate,
} from "./items.ts"

const item = (over: Partial<ReviewItem> & { id: string }): ReviewItem => ({
  kind: "fact",
  line_id: null,
  t: null,
  status: "open",
  preaccepted: false,
  fact: factSuggestion({ text: "x", confidence: "gm" }),
  spelling: null,
  entry: null,
  ...over,
})

describe("review items", () => {
  it("counts each kind", () => {
    const items = [item({ id: "a" }), item({ id: "b", kind: "spelling" }), item({ id: "c", kind: "entry" })]
    expect(filterCounts(items)).toEqual({ all: 3, fact: 1, spelling: 1, entry: 1 })
  })

  it("takes only open GM-stated facts for accept-all", () => {
    const items = [
      item({ id: "a" }),
      item({ id: "b", status: "accepted" }),
      item({ id: "c", fact: factSuggestion({ text: "y", confidence: "theory" }) }),
      item({ id: "d", kind: "spelling", fact: null }),
    ]
    expect(gmStatedOpen(items).map((i) => i.id)).toEqual(["a"])
  })

  it("rounds about 20 s per item up to minutes", () => {
    expect([0, 1, 3, 4, 12].map(minutesLeft)).toEqual([0, 1, 1, 2, 4])
  })

  it("puts items on their lines and the rest in loose", () => {
    const items = [
      item({ id: "a", line_id: "m1" }),
      item({ id: "b", line_id: "m1" }),
      item({ id: "c", line_id: "gone" }),
      item({ id: "d" }),
    ]
    const { byLine, loose } = placeItems(items, ["m1", "m2"])
    expect(byLine.get("m1")?.map((i) => i.id)).toEqual(["a", "b"])
    expect(loose.map((i) => i.id)).toEqual(["c", "d"])
  })

  it("says a line is open while any item is, else accepted if any was", () => {
    expect(lineState([item({ id: "a" }), item({ id: "b", status: "accepted" })])).toBe("open")
    expect(lineState([item({ id: "a", status: "rejected" }), item({ id: "b", status: "accepted" })])).toBe(
      "accepted",
    )
    expect(lineState([item({ id: "a", status: "rejected" })])).toBe("rejected")
  })

  it("finds the text an update replaces", () => {
    const facts = [fact({ id: "f1", text: "Old." })]
    expect(replacedText("f1", facts)).toBe("Old.")
    expect(replacedText("nope", facts)).toBeUndefined()
    expect(replacedText(null, facts)).toBeUndefined()
  })

  it("formats the date as weekday, month, day", () => {
    expect(reviewDate(1_761_177_600)).toMatch(/^[A-Z][a-z]{2} Oct 2[23]$/)
  })
})
