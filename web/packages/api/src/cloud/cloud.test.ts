import { afterEach, expect, it, vi } from "vitest"
import { bodyOf, cloudStatus, mockFetch } from "../testing/index.ts"
import { cloudOptions } from "./index.ts"

afterEach(() => vi.restoreAllMocks())

it("cloudOptions PUTs the options", async () => {
  const m = mockFetch(() => cloudStatus({ auto_backup: true }))
  await cloudOptions({ auto_backup: true })
  expect(m.calls[0]).toMatchObject({ method: "PUT", url: "/api/cloud/options" })
  expect(bodyOf(m.calls[0]!)).toEqual({ auto_backup: true })
})
