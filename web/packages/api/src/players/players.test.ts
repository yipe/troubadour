import { afterEach, expect, it, vi } from "vitest"
import { bodyOf, mockFetch, player } from "../testing/index.ts"
import { updatePlayer } from "./index.ts"

afterEach(() => vi.restoreAllMocks())

it("updatePlayer PATCHes the player", async () => {
  const m = mockFetch(() => player({ id: "p1", name: "Nora" }))
  expect((await updatePlayer("p1", { name: "Nora" })).name).toBe("Nora")
  expect(m.calls[0]).toMatchObject({ method: "PATCH", url: "/api/players/p1" })
  expect(bodyOf(m.calls[0]!)).toEqual({ name: "Nora" })
})
