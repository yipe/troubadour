import { afterEach, expect, it, vi } from "vitest"
import { mockFetch } from "../testing/index.ts"
import { appearances, timeline } from "./index.ts"

afterEach(() => vi.restoreAllMocks())

it("timeline GETs the campaign timeline", async () => {
  const m = mockFetch(() => ({ sessions: [] }))
  expect(await timeline()).toEqual({ sessions: [] })
  expect(m.calls[0]).toMatchObject({ method: "GET", url: "/api/campaign/timeline" })
})

it("appearances GETs the per-session mention counts", async () => {
  const body = { sessions: [{ id: "s1", n: 1 }], counts: { Pip: [2] } }
  const m = mockFetch(() => body)
  expect(await appearances()).toEqual(body)
  expect(m.calls[0]).toMatchObject({ method: "GET", url: "/api/campaign/appearances" })
})
