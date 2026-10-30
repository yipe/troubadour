import { afterEach, expect, it, vi } from "vitest"
import { bodyOf, campaignAnswer, mockFetch } from "../testing/index.ts"
import { ask } from "./index.ts"

afterEach(() => vi.restoreAllMocks())

it("ask POSTs the question", async () => {
  const m = mockFetch(() => campaignAnswer({ id: "q1", state: "queued" }))
  await ask("Who is the baron?")
  expect(m.calls[0]).toMatchObject({ method: "POST", url: "/api/campaign/ask" })
  expect(bodyOf(m.calls[0]!)).toEqual({ question: "Who is the baron?" })
})

it("ask sends the live session time when given", async () => {
  const m = mockFetch(() => campaignAnswer({ id: "q1", state: "queued", t: 42 }))
  await ask("Who is the baron?", 42)
  expect(bodyOf(m.calls[0]!)).toEqual({ question: "Who is the baron?", t: 42 })
})
