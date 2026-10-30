import { afterEach, expect, it, vi } from "vitest"
import { bodyOf, httpError, mockFetch } from "../testing/index.ts"
import { addTerms, removeTerm, terms, uploadTerms } from "./index.ts"

afterEach(() => vi.restoreAllMocks())

it("terms sends the search, the source and the page", async () => {
  const m = mockFetch(() => ({ counts: { builtin: 1, local: 0, custom: 0 }, items: [], total: 0 }))
  await terms({ q: "fire", source: "custom", offset: 50, limit: 50 })
  expect(m.calls[0]!.url).toBe("/api/terms?offset=50&limit=50&q=fire&source=custom")
  await terms({ q: "", source: null, offset: 0, limit: 50 })
  expect(m.calls[1]!.url).toBe("/api/terms?offset=0&limit=50")
})

it("addTerms and removeTerm", async () => {
  const m = mockFetch(() => ({ added: 1, skipped: [], more_skipped: 0 }))
  await addTerms([{ name: "Mirvane", type: "npc" }])
  expect(m.calls[0]).toMatchObject({ method: "POST", url: "/api/terms" })
  expect(bodyOf(m.calls[0]!)).toEqual({ terms: [{ name: "Mirvane", type: "npc" }] })
  await removeTerm("Tasha/Mirvane")
  expect(m.calls[1]).toMatchObject({ method: "DELETE", url: "/api/terms/Tasha%2FMirvane" })
})

it("uploadTerms posts the text as is and surfaces the server's message", async () => {
  const spy = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(new Response(JSON.stringify({ added: 2, skipped: [], more_skipped: 0 })))
    .mockResolvedValueOnce(httpError(400, "No terms found in that file."))
  expect((await uploadTerms("a\nb")).added).toBe(2)
  expect(spy.mock.calls[0]![1]).toMatchObject({ method: "POST", body: "a\nb" })
  await expect(uploadTerms("")).rejects.toThrow("No terms found in that file.")
})
