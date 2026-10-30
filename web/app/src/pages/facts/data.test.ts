import { describe, expect, it } from "vitest"
import { campaign, entity, fact } from "@troubadour/api/testing"
import { allRows, facetCounts, matches, newestFirst, parseFilters } from "./data.ts"

const src = (session_id: string, t: number | null) => ({ page: "p", label: null, session_id, t })
const c = campaign({
  facts: [fact({ text: "The moon is full.", confidence: "gm" })],
  entities: [
    entity({
      name: "Orsa Vell",
      type: "npc",
      facts: [
        fact({
          text: "Owes Pip gold.",
          confidence: "once",
          said_by: { name: "Pip", player_id: "p1" },
          source: src("s2", 10),
        }),
        fact({ text: "Hates the tide.", confidence: "gm", said_by: { name: "Alex", player_id: "p2" } }),
      ],
    }),
    entity({ name: "The Abbey", type: "place", facts: [fact({ text: "Drowned.", confidence: "theory" })] }),
  ],
})
const rows = allRows(c)
const none = parseFilters(new URLSearchParams())

describe("facts filters", () => {
  it("parses the query string and ignores unknown values", () => {
    expect(parseFilters(new URLSearchParams("about=npc&sure=gm&by=p1&q=x"))).toEqual({
      about: "npc",
      sure: "gm",
      by: "p1",
      q: "x",
    })
    expect(parseFilters(new URLSearchParams("about=bogus&sure=nope"))).toMatchObject({
      about: undefined,
      sure: undefined,
    })
  })

  it("lists entry and campaign facts", () => expect(rows).toHaveLength(4))

  it("counts each option with the other filters applied", () => {
    expect(facetCounts(rows, none, "about").get(undefined)).toBe(4)
    expect(facetCounts(rows, none, "about").get("npc")).toBe(2)
    expect(facetCounts(rows, none, "about").get("campaign")).toBe(1)
    const gm = { ...none, sure: "gm" as const }
    expect(facetCounts(rows, gm, "about").get("npc")).toBe(1)
    // the group's own selection doesn't narrow its counts
    expect(facetCounts(rows, gm, "sure").get("once")).toBe(1)
    expect(facetCounts(rows, none, "by").get("p1")).toBe(1)
  })

  it("combines filters", () => {
    const f = { ...none, about: "npc" as const, sure: "gm" as const }
    expect(rows.filter((r) => matches(r, f)).map((r) => r.fact.text)).toEqual(["Hates the tide."])
  })

  it("searches text, about and speaker", () => {
    const hit = (q: string) => rows.filter((r) => matches(r, { ...none, q })).length
    expect(hit("MOON")).toBe(1)
    expect(hit("abbey")).toBe(1)
    expect(hit("pip")).toBe(1)
    expect(hit("orsa")).toBe(2)
    expect(hit("zzz")).toBe(0)
  })

  it("sorts newest session first, unplaced last", () => {
    const numbers = new Map([["s2", 2]])
    expect(newestFirst(rows, numbers)[0]?.fact.text).toBe("Owes Pip gold.")
  })
})
