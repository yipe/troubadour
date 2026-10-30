import { describe, expect, it } from "vitest"
import { campaignJob, entity } from "@troubadour/api/testing"
import {
  connectedEntries,
  entityTone,
  findEntity,
  latestJob,
  matchesSearch,
  needsReview,
  obsidianUrl,
  splitWikiLinks,
} from "./entities"

describe("splitWikiLinks", () => {
  it("shows the label after | and the target otherwise", () => {
    expect(splitWikiLinks("Met [[Elara|Ellie]] in [[Tarsis]].")).toEqual([
      { text: "Met " },
      { text: "Ellie", target: "Elara" },
      { text: " in " },
      { text: "Tarsis", target: "Tarsis" },
      { text: "." },
    ])
  })

  it("drops a #heading from the lookup target", () => {
    expect(splitWikiLinks("[[2026-10-08 The Desert Road#Fight]]")).toEqual([
      { text: "2026-10-08 The Desert Road#Fight", target: "2026-10-08 The Desert Road" },
    ])
  })

  it("leaves plain and malformed text alone", () => {
    expect(splitWikiLinks("no links [[here")).toEqual([{ text: "no links [[here" }])
    expect(splitWikiLinks("")).toEqual([])
  })
})

describe("glossary helpers", () => {
  it("needsReview covers suggested entries, spellings and facts", () => {
    expect(needsReview(entity({ name: "a" }))).toBe(false)
    expect(needsReview(entity({ name: "a", status: "suggested" }))).toBe(true)
    expect(needsReview(entity({ name: "a", heard_as_suggested: ["x"] }))).toBe(true)
    expect(needsReview(entity({ name: "a", suggested_facts: ["x"] }))).toBe(true)
  })

  it("matchesSearch checks name, aliases and heard-as, case-insensitively", () => {
    const e = entity({ name: "Elara", aliases: ["Ellie"], heard_as: ["Dilara"] })
    expect(["ela", "ELLIE", "dil", " "].map((q) => matchesSearch(e, q))).toEqual([true, true, true, true])
    expect(matchesSearch(e, "gorm")).toBe(false)
  })

  it("findEntity matches names first, then aliases", () => {
    const es = [entity({ name: "Ellie" }), entity({ name: "Elara", aliases: ["ellie", "El"] })]
    expect(findEntity(es, "ellie")?.name).toBe("Ellie")
    expect(findEntity(es, "el")?.name).toBe("Elara")
    expect(findEntity(es, "nobody")).toBeUndefined()
  })

  it("obsidianUrl names the vault by registry id, with the note path inside it", () => {
    expect(obsidianUrl({ id: "543fe3e0024d1d47", folder: "" })).toBe("obsidian://open?vault=543fe3e0024d1d47")
    expect(obsidianUrl({ id: "v1", folder: "" }, "People/Elara.md")).toBe(
      "obsidian://open?vault=v1&file=People%2FElara.md",
    )
    // TROUBADOUR_VAULT can be a folder inside a bigger vault: notes are relative to that vault's root.
    expect(obsidianUrl({ id: "v1", folder: "Campaigns/Morvath" }, "Sessions/A B.md")).toBe(
      "obsidian://open?vault=v1&file=Campaigns%2FMorvath%2FSessions%2FA%20B.md",
    )
  })
})

describe("latestJob", () => {
  it("is the last matching job in insertion order (ids are random)", () => {
    const jobs = Object.fromEntries(
      [
        campaignJob({ id: "zz", kind: "say", player_id: "p1" }),
        campaignJob({ id: "aa", kind: "say", player_id: "p1" }),
        campaignJob({ id: "mm", kind: "say", player_id: "p2" }),
      ].map((j) => [j.id, j]),
    )
    expect(latestJob(jobs, (j) => j.player_id === "p1")?.id).toBe("aa")
    expect(latestJob(jobs, (j) => j.kind === "clone")).toBeUndefined()
  })
})

describe("entityTone", () => {
  it("makes items legendary and the rest neutral", () => {
    expect(entityTone("item")).toBe("legendary")
    expect(entityTone("npc")).toBe("neutral")
  })
})

describe("connectedEntries", () => {
  const elara = entity({ name: "Elara", facts: ["Sworn to [[Tarsis|the city]] long ago"] })
  const tarsis = entity({ name: "Tarsis", type: "place" })
  const blade = entity({
    name: "Dawn Blade",
    type: "item",
    facts: [`Carried by [[Elara]] ${"and kept sharp ".repeat(6)}`],
  })
  const lonely = entity({ name: "Lonely" })
  const campaign = { entities: [elara, tarsis, blade, lonely] }

  it("follows links out of facts and the description, as plain text", () => {
    expect(connectedEntries(elara, campaign)).toEqual([
      { name: "Tarsis", reason: "Sworn to the city long ago" },
      { name: "Dawn Blade", reason: expect.stringMatching(/^Carried by Elara and kept sharp .*…$/) },
    ])
    const withDescription = entity({ name: "Gorm", description: "Friend of [[Elara]]." })
    expect(connectedEntries(withDescription, { entities: [...campaign.entities, withDescription] })).toEqual([
      { name: "Elara", reason: "Friend of Elara." },
    ])
  })

  it("finds links pointing here, once each, cut at 60 characters, never the entry itself", () => {
    const rows = connectedEntries(blade, campaign)
    expect(rows).toEqual([{ name: "Elara", reason: "Sworn to the city long ago" }].slice(0, 0).concat(rows))
    expect(rows.map((r) => r.name)).toEqual(["Elara"])
    expect(rows[0]?.reason.length).toBeLessThanOrEqual(60)
    const selfLinked = entity({ name: "Narcissus", facts: ["Loves [[Narcissus]]", "Also [[Narcissus]]"] })
    expect(connectedEntries(selfLinked, { entities: [selfLinked] })).toEqual([])
    expect(connectedEntries(lonely, campaign)).toEqual([])
  })

  it("lists an entry once when linked both ways", () => {
    const a = entity({ name: "A", facts: ["knows [[B]]"] })
    const b = entity({ name: "B", facts: ["knows [[A]]"] })
    expect(connectedEntries(a, { entities: [a, b] })).toEqual([{ name: "B", reason: "knows B" }])
  })
})
