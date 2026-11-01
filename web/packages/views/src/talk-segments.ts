export interface TalkSegment {
  value: number
  color: string
  label: string
}

/**
 * The talk-time bar: one segment per player who spoke, in the players list's order, or biggest share first
 * with `order: "share"` (ties keep roster order). Keys that are not a player (unnamed voices,
 * `voice:<id>`, deleted players) are grouped as "Others", always last. `colorOf` picks a player's colour
 * (the app knows custom classes; the website only the built-in ones).
 */
export function talkSegments<P extends { id: string; name: string }>(
  talk: Record<string, number>,
  players: P[],
  colorOf: (player: P) => string,
  order: "roster" | "share" = "roster",
): TalkSegment[] {
  const ids = new Set(players.map((p) => p.id))
  const segments: TalkSegment[] = []
  for (const p of players) {
    const value = talk[p.id] ?? 0
    if (value > 0) segments.push({ value, color: colorOf(p), label: p.name })
  }
  if (order === "share") segments.sort((a, b) => b.value - a.value)
  const others = Object.entries(talk)
    .filter(([key]) => !ids.has(key))
    .reduce((sum, [, seconds]) => sum + Math.max(0, seconds), 0)
  if (others > 0) segments.push({ value: others, color: "var(--color-fg-subtle)", label: "Others" })
  return segments
}
