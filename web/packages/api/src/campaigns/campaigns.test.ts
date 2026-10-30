import { afterEach, expect, it, vi } from "vitest"
import { bodyOf, mockFetch } from "../testing/index.ts"
import { renameCampaign } from "./index.ts"

afterEach(() => vi.restoreAllMocks())

it("renameCampaign PATCHes the campaign by escaped id", async () => {
  const m = mockFetch(() => ({ id: "a b", name: "New" }))
  await renameCampaign("a b", "New")
  expect(m.calls[0]).toMatchObject({ method: "PATCH", url: "/api/campaigns/a%20b" })
  expect(bodyOf(m.calls[0]!)).toEqual({ name: "New" })
})
