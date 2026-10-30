import { afterEach, expect, it, vi } from "vitest"
import { bodyOf, mockFetch, player } from "../testing/index.ts"
import { addClass, classes, deleteClass, updateClass, updatePlayer } from "./index.ts"

afterEach(() => vi.restoreAllMocks())

it("updatePlayer PATCHes the player", async () => {
  const m = mockFetch(() => player({ id: "p1", name: "Nora" }))
  expect((await updatePlayer("p1", { name: "Nora" })).name).toBe("Nora")
  expect(m.calls[0]).toMatchObject({ method: "PATCH", url: "/api/players/p1" })
  expect(bodyOf(m.calls[0]!)).toEqual({ name: "Nora" })
})

it("class endpoints hit /api/classes", async () => {
  const m = mockFetch(() => [])
  await classes()
  await addClass({ label: "Tinkerer", color: "#8c6040" })
  await updateClass("tinkerer", { color: "#112233" })
  await deleteClass("tinkerer")
  expect(m.calls.map((c) => `${c.method} ${c.url}`)).toEqual([
    "GET /api/classes",
    "POST /api/classes",
    "PATCH /api/classes/tinkerer",
    "DELETE /api/classes/tinkerer",
  ])
  expect(bodyOf(m.calls[1]!)).toEqual({ label: "Tinkerer", color: "#8c6040" })
})
