import { describe, expect, it } from "vitest"
import { campaign, entity, fact } from "@troubadour/api/testing"
import { newestFacts, openByKind } from "./data.ts"

const at = (session_id: string, t: number) => ({ page: "", label: null, session_id, t })
const numbers = new Map([
  ["s1", 1],
  ["s2", 2],
])

describe("newestFacts", () => {
  it("sorts by session number then time, across entries and campaign facts", () => {
    const c = campaign({
      facts: [fact({ text: "late s1", source: at("s1", 900) })],
      entities: [
        entity({
          name: "Orsa",
          facts: [
            fact({ text: "early s2", source: at("s2", 10) }),
            fact({ text: "late s2", source: at("s2", 500) }),
            fact({ text: "no source" }),
            fact({ text: "unknown session", source: at("gone", 5) }),
          ],
        }),
      ],
    })
    expect(newestFacts(c, numbers).map((f) => f.fact.text)).toEqual(["late s2", "early s2", "late s1"])
  })

  it("keeps the newest few", () => {
    const facts = Array.from({ length: 9 }, (_, i) => fact({ text: `f${i}`, source: at("s2", i) }))
    expect(newestFacts(campaign({ facts }), numbers)).toHaveLength(6)
  })
})

describe("openByKind", () => {
  it("counts only open items", () => {
    const item = (kind: "fact" | "spelling" | "entry", status: "open" | "accepted") =>
      ({ kind, status }) as Parameters<typeof openByKind>[0][number]
    expect(
      openByKind([
        item("fact", "open"),
        item("fact", "accepted"),
        item("spelling", "open"),
        item("entry", "open"),
      ]),
    ).toEqual({ fact: 1, spelling: 1, entry: 1 })
  })
})
