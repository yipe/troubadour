import { afterEach, expect, it, vi } from "vitest"
import { bodyOf, mockFetch } from "../testing/index.ts"
import { fileUrl, startMicTest } from "./index.ts"

afterEach(() => vi.restoreAllMocks())

it("startMicTest POSTs the device and optional seconds", async () => {
  const m = mockFetch(() => ({ state: "running", device: null, seconds: 5 }))
  await startMicTest(null, 5)
  expect(m.calls[0]).toMatchObject({ method: "POST", url: "/api/mic/test" })
  expect(bodyOf(m.calls[0]!)).toEqual({ device: null, seconds: 5 })
})

it("fileUrl escapes the sample file name", () => {
  expect(fileUrl("a b.wav")).toBe("/api/files/a%20b.wav")
})
