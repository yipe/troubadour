import { describe, expect, it } from "vitest"
import { message, player, voice } from "@troubadour/api/testing"
import { recordTalkTime, sharePct, talkDuration, talkSegments, talkTime, topPlayer } from "./talk"

const players = [player({ id: "p1" }), player({ id: "p2" })]
const voices = [
  voice({ id: "v1", status: "named", player_id: "p1" }),
  voice({ id: "v1npc", status: "named", player_id: "p1", character: "Morvath" }),
  voice({ id: "v2", status: "named", player_id: "p2" }),
  voice({ id: "pending" }),
  voice({ id: "orphan", status: "named", player_id: "deleted" }),
]
const line = (id: string, voice_id: string | null, t_start: number, t_end: number) =>
  message({ id, voice_id, t_start, t_end })

describe("talkTime", () => {
  it("sums named voices per player, adding up all of a player's voices", () => {
    const t = talkTime(
      [line("a", "v1", 0, 10), line("b", "v1npc", 10, 15), line("c", "v2", 15, 18), line("d", "v1", 20, 22)],
      voices,
      players,
    )
    expect(t.byPlayer.get("p1")).toBe(17)
    expect(t.byPlayer.get("p2")).toBe(3)
    expect(t.unassigned).toBe(0)
    expect(t.total).toBe(20)
    expect(t.inCharacter.get("p1")).toBe(5)
    expect(t.inCharacter.has("p2")).toBe(false)
  })

  it("sends pending, null, unknown voices and deleted players to unassigned", () => {
    const t = talkTime(
      [
        line("a", "pending", 0, 1),
        line("b", null, 1, 3),
        line("c", "gone", 3, 6),
        line("d", "orphan", 6, 10),
        line("e", "v2", 10, 15),
      ],
      voices,
      players,
    )
    expect(t.unassigned).toBe(10)
    expect(t.byPlayer.get("p2")).toBe(5)
    expect(t.byPlayer.get("p1")).toBe(0)
    expect(t.byPlayer.has("deleted")).toBe(false)
    expect(t.total).toBe(15)
  })

  it("counts negative or zero durations as 0, and an empty list as total 0", () => {
    const t = talkTime(
      [line("a", "v1", 10, 5), line("b", "v1", 3, 3), line("c", null, 9, 2)],
      voices,
      players,
    )
    expect(t).toMatchObject({ unassigned: 0, total: 0 })
    expect(talkTime([], voices, players)).toMatchObject({ unassigned: 0, total: 0 })
  })
})

describe("sharePct", () => {
  it.each([
    [0, 0, ""],
    [5, 0, ""],
    [0, 100, "0%"],
    [0.4, 100, "<1%"],
    [0.5, 100, "1%"],
    [12.4, 100, "12%"],
    [1, 3, "33%"],
    [100, 100, "100%"],
  ])("%s of %s -> %j", (s, total, out) => expect(sharePct(s, total)).toBe(out))
})

describe("talkDuration", () => {
  it.each([
    [0, "0s"],
    [45.9, "45s"],
    [60, "1m"],
    [12 * 60 + 59, "12m"],
    [3600 + 5 * 60 + 30, "1h 05m"],
    [16 * 3600, "16h 00m"],
  ])("%s -> %s", (s, out) => expect(talkDuration(s)).toBe(out))
})

describe("recordTalkTime", () => {
  const l = (player_id: string | null, t_start: number, t_end: number) => ({ player_id, t_start, t_end })

  it("sums by the record's player_id and sends null player_id to unassigned", () => {
    const t = recordTalkTime([l("p1", 0, 10), l(null, 10, 13), l("p2", 13, 15), l("p1", 20, 25)])
    expect(t.byPlayer.get("p1")).toBe(15)
    expect(t.byPlayer.get("p2")).toBe(2)
    expect(t.unassigned).toBe(3)
    expect(t.total).toBe(20)
  })

  it("counts each player's time in a character voice, never an unassigned line's", () => {
    const t = recordTalkTime([
      { player_id: "p1", t_start: 0, t_end: 10 },
      { player_id: "p1", t_start: 10, t_end: 14, in_character: true },
      { player_id: null, t_start: 14, t_end: 20, in_character: true },
    ])
    expect(t.inCharacter.get("p1")).toBe(4)
    expect(t.inCharacter.size).toBe(1)
  })

  it("empty input gives a zero total", () => {
    expect(recordTalkTime([])).toMatchObject({ unassigned: 0, total: 0 })
  })
})

describe("talkSegments and topPlayer", () => {
  const roster = [
    player({ id: "gm", name: "Nora", is_gm: true }),
    player({ id: "a", name: "Ana", color: "#111111" }),
    player({ id: "b", name: "Bo", color: "#222222" }),
  ]

  it("orders like the players list and groups unknown voices under Others", () => {
    const segs = talkSegments({ b: 30, "voice:v9": 5, a: 60, gone: 5, gm: 0 }, roster)
    expect(segs).toEqual([
      { value: 60, color: "#111111", label: "Ana" },
      { value: 30, color: "#222222", label: "Bo" },
      { value: 10, color: "var(--color-fg-subtle)", label: "Others" },
    ])
  })

  it("topPlayer skips the GM and reports their share of all talk", () => {
    const top = topPlayer({ gm: 500, a: 20, b: 60, "voice:x": 20 }, roster)
    expect(top).toMatchObject({ pct: 10, seconds: 60 })
    expect(top?.player.id).toBe("b")
  })

  it("topPlayer is null when only the GM spoke", () => {
    expect(topPlayer({ gm: 10 }, roster)).toBeNull()
    expect(topPlayer({}, roster)).toBeNull()
  })
})
