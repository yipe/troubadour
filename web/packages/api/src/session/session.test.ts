import { afterEach, expect, it, vi } from "vitest"
import { bodyOf, mockFetch, session } from "../testing/index.ts"
import { startSession, transcriptUrl } from "./index.ts"

afterEach(() => vi.restoreAllMocks())

it("startSession POSTs the source", async () => {
  const m = mockFetch(() => session())
  await startSession({ kind: "mic", device: null })
  expect(m.calls[0]).toMatchObject({ method: "POST", url: "/api/session/start" })
  expect(bodyOf(m.calls[0]!)).toEqual({ source: { kind: "mic", device: null } })
})

it("transcriptUrl points at the live or a saved transcript", () => {
  expect(transcriptUrl("md")).toBe("/api/transcript.md")
  expect(transcriptUrl("json", "a/b")).toBe("/api/sessions/a%2Fb/transcript.json")
})
