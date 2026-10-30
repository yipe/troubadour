import { describe, expect, it } from "vitest"
import { answerSource } from "@troubadour/api/testing"
import { parseAnswer } from "./citations.ts"

describe("parseAnswer", () => {
  const sources = [
    answerSource({ id: "S1", excerpt: "Keeps what the tide leaves." }),
    answerSource({ id: "S2", excerpt: "Beneath the tide's tongue." }),
  ]

  it("numbers citations in order of appearance and orders the sources by it", () => {
    const { pieces, ordered } = parseAnswer("First [S2] then [S1] and [S2] again.", sources)
    expect(pieces.filter((p) => p.kind === "cite").map((p) => (p.kind === "cite" ? p.number : 0))).toEqual([
      1, 2, 1,
    ])
    expect(ordered.map((o) => [o.number, o.source.id])).toEqual([
      [1, "S2"],
      [2, "S1"],
    ])
  })

  it("drops citations of unknown sources and appends uncited ones", () => {
    const { pieces, ordered } = parseAnswer("Only [S9] and [S1].", sources)
    expect(pieces.some((p) => p.kind === "cite" && p.sourceId === "S9")).toBe(false)
    expect(ordered.map((o) => o.source.id)).toEqual(["S1", "S2"])
  })

  it("marks only quotes found in an excerpt", () => {
    const { pieces } = parseAnswer("She said “beneath the tide's tongue” and “nothing like it”.", sources)
    expect(pieces.filter((p) => p.kind === "quote")).toHaveLength(1)
  })
})
