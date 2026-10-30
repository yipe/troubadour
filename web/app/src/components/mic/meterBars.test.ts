import { describe, expect, it } from "vitest"
import { barHeight, barZone, BAR_COUNT, emptyBars, pushBar } from "./meterBars.ts"

describe("meterBars", () => {
  it("keeps 48 bars, newest on the right", () => {
    let bars = emptyBars()
    expect(bars).toHaveLength(BAR_COUNT)
    bars = pushBar(bars, -20)
    bars = pushBar(bars, -6)
    expect(bars).toHaveLength(BAR_COUNT)
    expect(bars.slice(-2)).toEqual([-20, -6])
  })

  it("height rises with level and never vanishes", () => {
    expect(barHeight(null)).toBe(4)
    expect(barHeight(-70)).toBe(4)
    expect(barHeight(-20)).toBeGreaterThan(barHeight(-40))
    expect(barHeight(0)).toBe(100)
  })

  it("colours by zone", () => {
    expect(barZone(null)).toBe("off")
    expect(barZone(-40)).toBe("quiet")
    expect(barZone(-20)).toBe("good")
    expect(barZone(-6)).toBe("hot")
    expect(barZone(-1)).toBe("clip")
  })
})
