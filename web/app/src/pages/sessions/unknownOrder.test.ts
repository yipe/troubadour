import { expect, it } from "vitest"
import { hasUnknownDate, movedTo, shifted, unknownOrder } from "./unknownOrder.ts"

const ab = ["a", "b", "c", "d"]

it("moves an id to where another one is, from either side", () => {
  expect(movedTo(ab, "d", "b")).toEqual(["a", "d", "b", "c"])
  expect(movedTo(ab, "a", "c")).toEqual(["b", "c", "a", "d"])
  expect(movedTo(ab, "a", "a")).toEqual(ab)
  expect(movedTo(ab, "x", "a")).toEqual(ab)
  expect(movedTo(ab, "a", "x")).toEqual(ab)
})

it("shifts one place and stops at the ends", () => {
  expect(shifted(ab, "c", -1)).toEqual(["a", "c", "b", "d"])
  expect(shifted(ab, "b", 1)).toEqual(["a", "c", "b", "d"])
  expect(shifted(ab, "a", -1)).toEqual(ab)
  expect(shifted(ab, "d", 1)).toEqual(ab)
})

it("takes the sessions with unknown dates, oldest first", () => {
  const rows = [
    { id: "dated", kind: "notes", started_at: 1_760_000_000 },
    { id: "u2", kind: "notes", started_at: 172_803 },
    { id: "u1", kind: "notes", started_at: 172_802 },
    { id: "rec", kind: "recording", started_at: 0 },
  ] as const
  expect(unknownOrder([...rows])).toEqual(["u1", "u2"])
  expect(hasUnknownDate(rows[3])).toBe(false) // a recording is never "unknown"
})
