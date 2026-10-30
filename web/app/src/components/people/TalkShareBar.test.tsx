import { screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { keys } from "@troubadour/api/query"
import { player } from "@troubadour/api/testing"
import { renderWithProviders } from "../../test/render.tsx"
import { TalkShareBar } from "./TalkShareBar.tsx"

const players = [
  player({ id: "a", name: "Ana" }),
  player({ id: "b", name: "Bo" }),
  player({ id: "c", name: "Cy" }),
]

function legendOrder(talk: Record<string, number>, order?: "roster" | "share") {
  const { container } = renderWithProviders(<TalkShareBar talk={talk} players={players} order={order} />, {
    queryData: [[keys.classes(), []]],
  })
  const names = ["Ana", "Bo", "Cy", "Others"]
  return (container.textContent ?? "")
    .split(/\d+%|<1%/)
    .join(" ")
    .match(/Ana|Bo|Cy|Others/g)
    ?.filter((n, i, all) => names.includes(n) && all.indexOf(n) === i)
}

describe("TalkShareBar order", () => {
  it("keeps roster order by default", () => {
    expect(legendOrder({ a: 10, b: 30, c: 20 })).toEqual(["Ana", "Bo", "Cy"])
  })

  it("puts the biggest share first with order=share", () => {
    expect(legendOrder({ a: 10, b: 30, c: 20 }, "share")).toEqual(["Bo", "Cy", "Ana"])
  })

  it("keeps Others last even when it is the largest", () => {
    expect(legendOrder({ a: 10, b: 30, "voice:x": 500 }, "share")).toEqual(["Bo", "Ana", "Others"])
    expect(screen.getAllByText("Others").length).toBeGreaterThan(0)
  })

  it("keeps roster order for ties", () => {
    expect(legendOrder({ a: 20, b: 20, c: 20 }, "share")).toEqual(["Ana", "Bo", "Cy"])
  })
})
