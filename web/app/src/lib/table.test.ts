import { expect, it } from "vitest"
import { tableName } from "./table.ts"

it("falls back to “The table” when unset, blank or no campaign", () => {
  expect(tableName(undefined)).toBe("The table")
  expect(tableName({ table_name: "" })).toBe("The table")
  expect(tableName({ table_name: "   " })).toBe("The table")
})

it("uses the trimmed name", () => {
  expect(tableName({ table_name: "  Magic Mushroom Mob " })).toBe("Magic Mushroom Mob")
})
