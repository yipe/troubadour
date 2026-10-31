import { backupAttempt } from "@troubadour/api/testing"
import { expect, it } from "vitest"
import { attemptSummary, attemptTime } from "./attempts.ts"

const NOW = Date.UTC(2026, 9, 30, 20, 0) // TZ=UTC

it("says Today for the same day and the date otherwise", () => {
  expect(attemptTime(Date.UTC(2026, 9, 30, 19, 42) / 1000, NOW)).toBe("Today, 7:42 pm")
  expect(attemptTime(Date.UTC(2026, 9, 22, 22, 31) / 1000, NOW)).toBe("Oct 22, 10:31 pm")
})

it("summarises successes and failures", () => {
  expect(attemptSummary(backupAttempt({ changed: 3 }))).toBe("3 notes changed")
  expect(attemptSummary(backupAttempt({ message: "Mac · 14 notes changed" }))).toBe("Mac · 14 notes changed")
  expect(attemptSummary(backupAttempt({ ok: false, snapshot: null, error: "no connection" }))).toBe(
    "Failed: no connection",
  )
})
