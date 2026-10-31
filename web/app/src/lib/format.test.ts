import { describe, expect, it } from "vitest"
import hmsVectors from "../../../../shared/test-vectors/hms.json"
import { ago, bytes, dateLong, dateShort, duration, durationShort, hm, hms, timeRange } from "./format"

const at = (y: number, mo: number, d: number, h = 0, mi = 0) => Date.UTC(y, mo - 1, d, h, mi) / 1000

describe("hms", () => {
  it.each(hmsVectors as [number, string][])("vector %s -> %s", (s, out) => expect(hms(s)).toBe(out))

  it("handles the edges", () => {
    expect(hms(59)).toBe("0:59")
    expect(hms(3600)).toBe("1:00:00")
    expect(hms(-5)).toBe("0:00")
  })
})

describe("hm, duration, durationShort", () => {
  it("hm is hours:minutes", () => expect(hm(5882)).toBe("1:38"))
  it("durationShort is h:mm", () => expect(durationShort(3 * 3600 + 12 * 60 + 40)).toBe("3:12"))
  it.each([
    [40, "40 s"],
    [45 * 60 + 10, "45 m"],
    [3 * 3600 + 12 * 60, "3 h 12 m"],
    [3600, "1 h 0 m"],
  ])("duration %s -> %s", (s, out) => expect(duration(s)).toBe(out))
})

describe("dates", () => {
  it("dateShort and dateLong", () => {
    expect(dateShort(at(2026, 10, 22, 12))).toBe("Oct 22")
    expect(dateLong(at(2026, 10, 22, 12))).toBe("Thursday, October 22")
  })

  it("timeRange shares the am/pm when both ends have it", () => {
    expect(timeRange(at(2026, 10, 22, 19, 4), at(2026, 10, 22, 22, 16))).toBe("7:04 – 10:16 pm")
    expect(timeRange(at(2026, 10, 22, 11, 30), at(2026, 10, 22, 13, 15))).toBe("11:30 am – 1:15 pm")
  })
})

describe("ago", () => {
  const now = Date.UTC(2026, 9, 22, 20, 0, 0)
  const s = now / 1000
  it("counts minutes and hours, then shows the date", () => {
    expect(ago(s - 5, now)).toBe("just now")
    expect(ago(s + 30, now)).toBe("just now")
    expect(ago(s - 4 * 60, now)).toBe("4 min ago")
    expect(ago(s - 3 * 3600, now)).toBe("3 h ago")
    expect(ago(s - 3 * 86400, now)).toBe("Oct 19")
  })
})

describe("bytes", () => {
  it.each([
    [0, "0 B"],
    [512, "512 B"],
    [1536, "1.5 KB"],
    [3.1 * 1024 ** 3, "3.1 GB"],
  ])("%s -> %s", (n, out) => expect(bytes(n)).toBe(out))
})
