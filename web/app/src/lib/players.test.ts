import { describe, expect, it } from "vitest"
import { player, voice } from "@troubadour/api/testing"
import { initials, playerColor, speakerFor, speakerKey, type ClassInfo } from "./players"

const classes: ClassInfo[] = [
  { id: "bard", color: null, builtin: true },
  { id: "artificer", color: "#c0ffee", builtin: false },
]

describe("playerColor", () => {
  it("an override beats a built-in and a custom class", () => {
    expect(playerColor({ color: "#123456", dnd_class: "bard", is_gm: false }, classes)).toBe("#123456")
    expect(playerColor({ color: "#123456", dnd_class: "artificer", is_gm: false }, classes)).toBe("#123456")
  })

  it("uses the class colour: a theme variable for built-ins, the hex for custom ones", () => {
    expect(playerColor({ color: "", dnd_class: "bard", is_gm: false }, classes)).toBe(
      "var(--color-class-bard)",
    )
    expect(playerColor({ dnd_class: "artificer", is_gm: false }, classes)).toBe("#c0ffee")
  })

  it("a class beats the GM rule, which beats the fallback", () => {
    expect(playerColor({ dnd_class: "bard", is_gm: true }, classes)).toBe("var(--color-class-bard)")
    expect(playerColor({ is_gm: true }, classes)).toBe("var(--color-class-paladin)")
    expect(playerColor({ is_gm: false }, classes)).toBe("var(--color-fg-subtle)")
  })

  it("an unknown (deleted) class id falls through", () => {
    expect(playerColor({ dnd_class: "gone", is_gm: true }, classes)).toBe("var(--color-class-paladin)")
    expect(playerColor({ dnd_class: "gone", is_gm: false }, classes)).toBe("var(--color-fg-subtle)")
  })
})

describe("initials", () => {
  it.each([
    ["laura", "L"],
    ["Priya Shah", "PS"],
    ["  Rowan  Ellis Hart ", "RH"],
    ["", "?"],
    ["   ", "?"],
  ])("%j -> %s", (name, out) => expect(initials(name)).toBe(out))
})

const laura = player({ id: "p1", name: "Priya", character: "Pip" })
const matt = player({ id: "p2", name: "Nora", character: "", is_gm: true })

describe("speakerFor", () => {
  it("named voice resolves to the player's name and character", () => {
    const voices = [voice({ id: "v1", status: "named", player_id: "p1" })]
    expect(speakerFor("v1", voices, [laura])).toMatchObject({
      name: "Priya",
      character: "Pip",
      player: laura,
    })
  })

  it("voice.character wins over player.character", () => {
    const voices = [voice({ id: "v1", status: "named", player_id: "p2", character: "Morvath" })]
    expect(speakerFor("v1", voices, [matt]).character).toBe("Morvath")
  })

  it("no character on other voices when the player has a character voice", () => {
    const voices = [
      voice({ id: "v1", status: "named", player_id: "p1", character: "Pip" }),
      voice({ id: "v2", status: "named", player_id: "p1" }),
    ]
    expect(speakerFor("v2", voices, [laura])).toMatchObject({ name: "Priya", character: null })
    expect(speakerFor("v1", voices, [laura]).character).toBe("Pip")
  })

  it("empty player.character yields null", () => {
    const voices = [voice({ id: "v1", status: "named", player_id: "p2" })]
    expect(speakerFor("v1", voices, [matt]).character).toBeNull()
  })

  it("pending voice shows its label; unknown voice shows an ellipsis", () => {
    expect(speakerFor("v3", [voice({ id: "v3", label: "Voice 3" })], [laura])).toMatchObject({
      name: "Voice 3",
      player: null,
      character: null,
    })
    expect(speakerFor(null, [], [laura]).name).toBe("…")
    expect(speakerFor("gone", [voice({ id: "v1" })], [laura])).toMatchObject({ name: "…", voice: null })
  })
})

describe("speakerKey", () => {
  it("shares a key across a player's voices, splits on character, never groups unknowns", () => {
    expect(speakerKey("p1", "v1", null)).toBe(speakerKey("p1", "v2", null))
    expect(speakerKey("p1", "v1", "Morvath")).not.toBe(speakerKey("p1", "v1", null))
    expect(speakerKey(null, "v9", null)).toBe("v:v9|")
    expect(speakerKey(null, null, "Morvath")).toBeNull()
  })
})
