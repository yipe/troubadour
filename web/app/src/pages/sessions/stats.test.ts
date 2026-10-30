import { campaign, entity, fact, factSuggestion } from "@troubadour/api/testing"
import { expect, it } from "vitest"
import { openSuggestions, sceneLengths, sessionGains } from "./stats.ts"

const at = (session_id: string) => ({ source: { page: "", label: null, session_id, t: null } })

it("a scene lasts until the next starts; the last runs to the session's end", () => {
  const scenes = [
    { t: 0, title: "a", place: null },
    { t: 840, title: "b", place: null },
    { t: 1000, title: "c", place: null },
  ]
  expect(sceneLengths(scenes, 4000)).toEqual([840, 160, 3000])
})

it("counts only this session's open suggestions", () => {
  const c = campaign({
    entities: [
      entity({
        name: "Orsa",
        suggested_facts: [
          factSuggestion({ text: "x", ...at("s2") }),
          factSuggestion({ text: "y", ...at("s1") }),
        ],
      }),
    ],
  })
  expect(openSuggestions(c, "s2")).toBe(1)
  expect(openSuggestions(undefined, "s2")).toBe(0)
})

it("an entry is new only when no fact of it is from an earlier session", () => {
  const numbers = new Map([
    ["s1", 1],
    ["s2", 2],
  ])
  const c = campaign({
    facts: [fact({ text: "table rule", ...at("s2") })],
    entities: [
      entity({ name: "Old", facts: [fact({ text: "a", ...at("s1") }), fact({ text: "b", ...at("s2") })] }),
      entity({ name: "Fresh", facts: [fact({ text: "c", ...at("s2") })] }),
    ],
  })
  expect(sessionGains(c, "s2", numbers)).toEqual({ facts: 3, entries: 1 })
})
