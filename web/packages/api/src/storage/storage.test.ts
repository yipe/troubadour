import { afterEach, expect, it, vi } from "vitest"
import { mockFetch } from "../testing/index.ts"
import { storage } from "./index.ts"

afterEach(() => vi.restoreAllMocks())

it("storage GETs the byte counts", async () => {
  const usage = { root: "~/troubador", recordings: 3, voices: 2, notes: 1, other: 0 }
  const m = mockFetch(() => usage)
  expect(await storage()).toEqual(usage)
  expect(m.calls[0]).toMatchObject({ method: "GET", url: "/api/storage" })
})
