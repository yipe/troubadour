import { expect, it } from "vitest"
import { CONFIDENCE } from "./confidence"

it("labels each confidence with its tone", () => {
  expect(CONFIDENCE).toEqual({
    gm: { label: "GM stated", tone: "success" },
    theory: { label: "Party theory", tone: "warning" },
    once: { label: "Heard once", tone: "neutral" },
  })
})
