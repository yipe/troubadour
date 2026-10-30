import { afterEach, expect, it, vi } from "vitest"
import { backupAttempt, bodyOf, cloudStatus, mockFetch } from "../testing/index.ts"
import { cloudHistory, cloudOptions, cloudRestore } from "./index.ts"

afterEach(() => vi.restoreAllMocks())

it("cloudOptions PUTs the options", async () => {
  const m = mockFetch(() => cloudStatus({ auto_backup: true }))
  await cloudOptions({ auto_backup: true })
  expect(m.calls[0]).toMatchObject({ method: "PUT", url: "/api/cloud/options" })
  expect(bodyOf(m.calls[0]!)).toEqual({ auto_backup: true })
})

it("cloudHistory GETs the attempts", async () => {
  const attempts = [backupAttempt({ ok: false, snapshot: null, error: "offline" })]
  const m = mockFetch(() => ({ attempts }))
  await expect(cloudHistory()).resolves.toEqual({ attempts })
  expect(m.calls[0]).toMatchObject({ method: "GET", url: "/api/cloud/history" })
})

it("cloudRestore sends the restore point only when given", async () => {
  const m = mockFetch(() => ({}))
  await cloudRestore("v1")
  await cloudRestore("v1", "snap1")
  expect(bodyOf(m.calls[0]!)).toEqual({ vault_id: "v1" })
  expect(bodyOf(m.calls[1]!)).toEqual({ vault_id: "v1", snapshot: "snap1" })
})
