import { describe, expect, it } from "vitest"
import { MAX_LANES, travelStops } from "./travel"

const lanes = (places: string[][]) => travelStops(places).map((s) => s.lane)

describe("travelStops", () => {
  it("gives each place a stable lane by first appearance", () => {
    expect(lanes([["A"], ["B"], ["A"], ["C"], ["B"]])).toEqual([0, 1, 0, 2, 1])
  })

  it("marks arrivals: the first place and every change, not a stay", () => {
    expect(travelStops([["A"], ["A"], ["B"], ["A"]]).map((s) => s.arrives)).toEqual([true, false, true, true])
  })

  it("continues the line through a session without places", () => {
    const stops = travelStops([["A"], ["B"], [], ["B"]])
    expect(stops.map((s) => s.lane)).toEqual([0, 1, 1, 1])
    expect(stops[2]).toEqual({ lane: 1, place: "B", arrives: false })
    expect(stops[3]?.arrives).toBe(false)
  })

  it("starts in lane 0 with no place before the first one is named", () => {
    expect(travelStops([[], ["A"]])).toEqual([
      { lane: 0, place: null, arrives: false },
      { lane: 0, place: "A", arrives: true },
    ])
  })

  it("reuses the least recently used lane beyond the maximum", () => {
    const names = Array.from({ length: MAX_LANES }, (_, i) => [`P${i}`])
    // P0 is revisited, so P1 is now the least recently used.
    const result = lanes([...names, ["P0"], ["New"], ["P1"]])
    expect(result.slice(0, MAX_LANES)).toEqual([0, 1, 2, 3, 4, 5])
    expect(result[MAX_LANES + 1]).toBe(1)
    // P1 lost its lane, so coming back gives it a fresh one (New was just used; P2 is the oldest).
    expect(result[MAX_LANES + 2]).toBe(2)
  })
})
