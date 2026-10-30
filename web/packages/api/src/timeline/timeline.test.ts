import { afterEach, expect, it, vi } from "vitest"
import { mockFetch } from "../testing/index.ts"
import { timeline } from "./index.ts"

afterEach(() => vi.restoreAllMocks())

it("timeline GETs the campaign timeline", async () => {
  const m = mockFetch(() => ({ sessions: [] }))
  expect(await timeline()).toEqual({ sessions: [] })
  expect(m.calls[0]).toMatchObject({ method: "GET", url: "/api/campaign/timeline" })
})
