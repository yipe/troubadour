import { afterEach, expect, it, vi } from "vitest"
import { bodyOf, entity, mockFetch } from "../testing/index.ts"
import { addEntityFact } from "./index.ts"

afterEach(() => vi.restoreAllMocks())

it("addEntityFact POSTs the text to the escaped entity name", async () => {
  const m = mockFetch(() => entity({ name: "Elara Vance" }))
  await addEntityFact("Elara Vance", "Owns a ship")
  expect(m.calls[0]).toMatchObject({ method: "POST", url: "/api/campaign/entities/Elara%20Vance/facts" })
  expect(bodyOf(m.calls[0]!)).toEqual({ text: "Owns a ship" })
})
