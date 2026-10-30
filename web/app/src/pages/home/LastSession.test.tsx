import { describe, expect, it } from "vitest"
import { keys } from "@troubadour/api/query"
import { player, savedSession } from "@troubadour/api/testing"
import { renderWithProviders } from "../../test/render.tsx"
import { LastSession } from "./LastSession.tsx"

describe("LastSession", () => {
  it("lists who talked most first", () => {
    const { container } = renderWithProviders(
      <LastSession
        session={savedSession({ id: "s1", talk: { a: 10, b: 90 } })}
        n={1}
        writtenUp={false}
        players={[player({ id: "a", name: "Ana" }), player({ id: "b", name: "Bo" })]}
      />,
      { queryData: [[keys.classes(), []]] },
    )
    const text = container.textContent ?? ""
    expect(text.indexOf("Bo")).toBeGreaterThan(-1)
    expect(text.indexOf("Bo")).toBeLessThan(text.indexOf("Ana"))
  })
})
