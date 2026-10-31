import { expect, it } from "vitest"
import { readSeconds } from "./readSeconds.ts"

it("reads at about 150 words a minute, never under 5 seconds", () => {
  expect(readSeconds(Array(110).fill("word").join(" "))).toBe(44)
  expect(readSeconds("Short.")).toBe(5)
})
