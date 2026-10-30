import { afterEach, expect, it, vi } from "vitest"
import { mockFetch } from "./index.ts"

afterEach(() => vi.restoreAllMocks())

it("records calls and routes them by method and path", async () => {
  const m = mockFetch((c) => {
    if (c.method === "GET" && c.url === "/api/a") return { name: "a" }
    if (c.method === "POST" && c.url === "/api/b") return undefined
    return new Response(null, { status: 404 })
  })
  const a = await fetch("/api/a")
  const b = await fetch("/api/b", { method: "POST", body: JSON.stringify({ x: 1 }) })
  const c = await fetch("/api/c")
  expect(await a.json()).toEqual({ name: "a" })
  expect(b.status).toBe(204)
  expect(c.status).toBe(404)
  expect(m.calls).toEqual([
    { method: "GET", url: "/api/a", body: undefined },
    { method: "POST", url: "/api/b", body: { x: 1 } },
    { method: "GET", url: "/api/c", body: undefined },
  ])
  expect(m.writes()).toHaveLength(1)
})
