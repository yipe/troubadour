import { describe, expect, it } from "vitest"
import { paths } from "./paths.ts"

describe("paths", () => {
  it("builds every route", () => {
    expect(paths.home()).toBe("/")
    expect(paths.welcome("table")).toBe("/welcome/table")
    expect(paths.ready()).toBe("/sessions/new")
    expect(paths.ready("file")).toBe("/sessions/new?source=file")
    expect(paths.live()).toBe("/sessions/live")
    expect(paths.session("12")).toBe("/sessions/12")
    expect(paths.review("12")).toBe("/sessions/12/review")
    expect(paths.recap("12")).toBe("/sessions/12/recap")
    expect(paths.settings("models")).toBe("/settings/models")
  })

  it("encodes ids and entry names", () => {
    expect(paths.session("a/b")).toBe("/sessions/a%2Fb")
    expect(paths.codex("Captain Orsa Vell")).toBe("/codex/Captain%20Orsa%20Vell")
    expect(paths.codex()).toBe("/codex")
  })

  it("puts the transcript time and the facts filters in the query string", () => {
    expect(paths.transcript("12")).toBe("/sessions/12/transcript")
    expect(paths.transcript("12", 95)).toBe("/sessions/12/transcript?t=95")
    expect(paths.transcript("12", 0)).toBe("/sessions/12/transcript?t=0")
    expect(paths.facts()).toBe("/facts")
    expect(paths.facts({ about: "npc", sure: "gm", q: "bell tower" })).toBe(
      "/facts?about=npc&sure=gm&q=bell+tower",
    )
  })
})
