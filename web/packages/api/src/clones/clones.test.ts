import { afterEach, expect, it, vi } from "vitest"
import { bodyOf, campaignJob, mockFetch } from "../testing/index.ts"
import { cloneSay } from "./index.ts"

afterEach(() => vi.restoreAllMocks())

it("cloneSay POSTs the text with defaults", async () => {
  const m = mockFetch(() => campaignJob({ id: "j1", kind: "say" }))
  await cloneSay("p1", "Hello")
  expect(m.calls[0]).toMatchObject({ method: "POST", url: "/api/players/p1/clone/say" })
  expect(bodyOf(m.calls[0]!)).toEqual({ text: "Hello", in_their_words: false, persona: "table" })
})
