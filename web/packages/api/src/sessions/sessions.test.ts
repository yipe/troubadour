import { afterEach, expect, it, vi } from "vitest"
import { bodyOf, mockFetch, savedSession } from "../testing/index.ts"
import { mergeSessions, sessionAudioUrl } from "./index.ts"

afterEach(() => vi.restoreAllMocks())

it("mergeSessions POSTs both ids", async () => {
  const m = mockFetch(() => savedSession({ id: "a" }))
  await mergeSessions(["a", "b"])
  expect(m.calls[0]).toMatchObject({ method: "POST", url: "/api/sessions/merge" })
  expect(bodyOf(m.calls[0]!)).toEqual({ ids: ["a", "b"] })
})

it("sessionAudioUrl escapes the id", () => {
  expect(sessionAudioUrl("x y")).toBe("/api/sessions/x%20y/audio.wav")
})
