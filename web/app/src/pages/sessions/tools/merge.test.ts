import { expect, it } from "vitest"
import { savedSession } from "@troubadour/api/testing"
import { inOrder, mergeCandidates, sameSitting } from "./merge.ts"

const a = savedSession({ id: "a", started_at: 1000, duration_s: 600 })
const b = savedSession({ id: "b", started_at: 1700, duration_s: 100 }) // 100 s after a ends
const far = savedSession({ id: "far", started_at: 9000, duration_s: 100 })
const old = savedSession({ id: "old", started_at: 10, duration_s: 100 })

it("sameSitting: within 10 minutes of the earlier one ending", () => {
  expect(sameSitting(a, b)).toBe(true)
  expect(sameSitting(a, far)).toBe(false)
  expect(sameSitting(b, a)).toBe(false) // wrong order
})

it("inOrder puts the earlier session first", () => {
  expect(inOrder(b, a)).toEqual([a, b])
})

it("mergeCandidates lists the same-sitting pair first, then newest first, never the session itself", () => {
  const list = mergeCandidates([old, far, b, a], a)
  expect(list.map((c) => [c.session.id, c.suggested])).toEqual([
    ["b", true],
    ["far", false],
    ["old", false],
  ])
})
