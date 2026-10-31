import { screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { keys } from "@troubadour/api/query"
import { player } from "@troubadour/api/testing"
import { renderWithProviders } from "../../test/render.tsx"
import { TheTable } from "./TheTable.tsx"

function table(tableName: string) {
  return renderWithProviders(<TheTable players={[player({ id: "p1", name: "Sam" })]} voices={[]} />, {
    queryData: [
      [
        keys.campaigns(),
        { campaign: "main", campaigns: [{ id: "main", name: "Phandelver", table_name: tableName }] },
      ],
    ],
  })
}

describe("TheTable heading", () => {
  it("shows the table's name", () => {
    table("Magic Mushroom Mob")
    expect(screen.getByText("Magic Mushroom Mob")).toBeInTheDocument()
  })

  it("falls back to “The table”", () => {
    table("")
    expect(screen.getByText("The table")).toBeInTheDocument()
  })
})
