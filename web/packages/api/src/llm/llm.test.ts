import { afterEach, expect, it, vi } from "vitest"
import { bodyOf, mockFetch } from "../testing/index.ts"
import { llmKey } from "./index.ts"

afterEach(() => vi.restoreAllMocks())

it("llmKey PUTs the key to the provider", async () => {
  const m = mockFetch(() => [])
  await llmKey("anthropic", "k")
  expect(m.calls[0]).toMatchObject({ method: "PUT", url: "/api/llm/anthropic/key" })
  expect(bodyOf(m.calls[0]!)).toEqual({ key: "k" })
})
