import { describe, expect, it } from "vitest"
import vectors from "../../../../shared/test-vectors/session-numbers.json"
import { nextSessionNumber, sessionNumbers, sessionStatus } from "./sessions"

describe("sessionNumbers", () => {
  it.each(vectors.map((v, i) => [i, v] as const))("vector %s", (_i, v) => {
    expect(Object.fromEntries(sessionNumbers(v.sessions))).toEqual(v.expected)
  })

  it("accepts epoch seconds and skips merged-away sessions", () => {
    const sessions = [
      { id: "b", started_at: 200, merged_from: ["c"] },
      { id: "c", started_at: 300 },
      { id: "a", started_at: 100 },
    ]
    expect([...sessionNumbers(sessions)]).toEqual([
      ["a", 1],
      ["b", 2],
    ])
    expect(nextSessionNumber(sessions)).toBe(3)
    expect(nextSessionNumber([])).toBe(1)
  })
})

describe("sessionStatus", () => {
  it("not written up wins; otherwise reviewed or needs review", () => {
    expect(sessionStatus({ reviewed_at: 5 }, false)).toBe("not-written-up")
    expect(sessionStatus({ reviewed_at: null }, true)).toBe("needs-review")
    expect(sessionStatus({}, true)).toBe("needs-review")
    expect(sessionStatus({ reviewed_at: 5 }, true)).toBe("reviewed")
  })
})
