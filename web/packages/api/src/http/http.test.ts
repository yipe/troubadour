import { afterEach, describe, expect, it, vi } from "vitest"
import { bodyOf, httpError, mockFetch } from "../testing/index.ts"
import { ApiError, req } from "./index.ts"

afterEach(() => vi.restoreAllMocks())

describe("req", () => {
  it("turns a non-OK response with a detail into ApiError(status, detail)", async () => {
    mockFetch(() => httpError(409, "Session is running"))
    const err = await req("POST", "/api/x").catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err).toMatchObject({ status: 409, detail: "Session is running", message: "Session is running" })
  })

  it("falls back to the status line when the error body is not JSON", async () => {
    mockFetch(() => new Response("oops", { status: 500, statusText: "Server Error" }))
    await expect(req("GET", "/api/x")).rejects.toMatchObject({ status: 500, detail: "500 Server Error" })
  })

  it("returns undefined for 204 and 202", async () => {
    mockFetch(() => undefined)
    expect(await req("DELETE", "/api/x")).toBeUndefined()
    mockFetch(() => new Response(null, { status: 202 }))
    expect(await req("POST", "/api/x")).toBeUndefined()
  })

  it("sends the body as JSON with a content type, and no header without a body", async () => {
    const m = mockFetch(() => ({ ok: true }))
    await req("POST", "/api/x", { a: 1 })
    await req("GET", "/api/y")
    const init = m.spy.mock.calls.map((c) => c[1]?.headers)
    expect(init[0]).toEqual({ "Content-Type": "application/json" })
    expect(init[1]).toBeUndefined()
    expect(bodyOf(m.calls[0]!)).toEqual({ a: 1 })
  })
})
