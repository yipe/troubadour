import { afterEach, expect, it, vi } from "vitest"
import { bodyOf, mockFetch, savedSession } from "../testing/index.ts"
import {
  cancelRefresh,
  deleteSession,
  markReviewed,
  mergeSessions,
  refreshSession,
  sessionAudioUrl,
  sessionUpgrades,
  undeleteSession,
  unmergeSession,
  upgradeSessions,
} from "./index.ts"

afterEach(() => vi.restoreAllMocks())

it("mergeSessions POSTs both ids", async () => {
  const m = mockFetch(() => savedSession({ id: "a" }))
  await mergeSessions(["a", "b"])
  expect(m.calls[0]).toMatchObject({ method: "POST", url: "/api/sessions/merge" })
  expect(bodyOf(m.calls[0]!)).toEqual({ ids: ["a", "b"] })
})

it("sessionAudioUrl escapes the id", () => {
  expect(sessionAudioUrl("x y")).toBe("/api/sessions/x%20y/audio.wav")
})

it("markReviewed POSTs the flag", async () => {
  const m = mockFetch(() => ({ id: "a", reviewed_at: 5 }))
  await markReviewed("a", true)
  expect(m.calls[0]).toMatchObject({ method: "POST", url: "/api/sessions/a/reviewed" })
  expect(bodyOf(m.calls[0]!)).toEqual({ reviewed: true })
})

it("deleteSession, undeleteSession and unmergeSession hit their routes", async () => {
  const m = mockFetch((c) =>
    c.method === "DELETE" ? new Response(null, { status: 204 }) : savedSession({ id: "a" }),
  )
  await deleteSession("a")
  await undeleteSession("a")
  await unmergeSession("a")
  expect(m.calls.map((c) => [c.method, c.url])).toEqual([
    ["DELETE", "/api/sessions/a"],
    ["POST", "/api/sessions/a/undelete"],
    ["POST", "/api/sessions/a/unmerge"],
  ])
})

it("refresh, cancel, upgrades and upgrade hit their routes", async () => {
  const m = mockFetch((c) => {
    if (c.url === "/api/sessions/upgrades") return { sessions: [], current: { talk: 1 } }
    if (c.url.endsWith("/cancel")) return new Response(null, { status: 204 })
    return c.url === "/api/sessions/upgrade" ? [] : { id: "j1", kind: "refresh" }
  })
  await refreshSession("a b")
  await cancelRefresh("j1")
  await sessionUpgrades()
  await upgradeSessions()
  expect(m.calls.map((c) => [c.method, c.url])).toEqual([
    ["POST", "/api/sessions/a%20b/refresh"],
    ["POST", "/api/sessions/refresh/j1/cancel"],
    ["GET", "/api/sessions/upgrades"],
    ["POST", "/api/sessions/upgrade"],
  ])
})
