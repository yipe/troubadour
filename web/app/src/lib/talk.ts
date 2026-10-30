import type { Message, Voice } from "@troubadour/api/session"
import type { Player } from "@troubadour/api/players"
import { playerColor, type ClassInfo, type ColoredPlayer } from "./players"

export interface TalkTime {
  /** player_id -> seconds spoken (all of the player's named voices) */
  byPlayer: Map<string, number>
  /** player_id -> seconds of that in a character voice: an estimate, as good as the voices panel's
   * naming. Players without any are absent. */
  inCharacter: Map<string, number>
  /** seconds from lines not attributable to a current player */
  unassigned: number
  /** seconds of all lines (assigned + unassigned) */
  total: number
}

/**
 * Seconds spoken per player. A line counts toward a player only via a named voice of a player that
 * still exists; everything else (no voice, unknown voice, pending voice, deleted player) is unassigned.
 * O(messages + voices).
 */
export function talkTime(messages: Message[], voices: Voice[], players: Player[]): TalkTime {
  const voiceById = new Map(voices.map((v) => [v.id, v]))
  const known = new Set(players.map((p) => p.id))
  const t = recordTalkTime(
    messages.map((m) => {
      const voice = m.voice_id == null ? undefined : voiceById.get(m.voice_id)
      const playerId = voice?.status === "named" ? voice.player_id : null
      return {
        t_start: m.t_start,
        t_end: m.t_end,
        player_id: playerId != null && known.has(playerId) ? playerId : null,
        in_character: !!voice?.character,
      }
    }),
  )
  for (const p of players) if (!t.byPlayer.has(p.id)) t.byPlayer.set(p.id, 0)
  return t
}

interface TalkLine {
  t_start: number
  t_end: number
  player_id: string | null
  /** spoken in a character voice (absent: no) */
  in_character?: boolean
}

/**
 * Talk time for a saved record, by each line's precomputed `player_id` (records are historical, so
 * never re-resolved against live voices). Lines with a null `player_id` are unassigned.
 */
export function recordTalkTime(lines: TalkLine[]): TalkTime {
  const byPlayer = new Map<string, number>()
  const inCharacter = new Map<string, number>()
  let unassigned = 0
  let total = 0
  for (const m of lines) {
    const seconds = Math.max(0, m.t_end - m.t_start)
    total += seconds
    if (m.player_id == null) {
      unassigned += seconds
      continue
    }
    byPlayer.set(m.player_id, (byPlayer.get(m.player_id) ?? 0) + seconds)
    if (m.in_character) inCharacter.set(m.player_id, (inCharacter.get(m.player_id) ?? 0) + seconds)
  }
  return { byPlayer, inCharacter, unassigned, total }
}

/** Share of `total` as a whole percentage; "<1%" for tiny non-zero shares, "" when nothing was said. */
export function sharePct(seconds: number, total: number): string {
  if (total <= 0) return ""
  const share = seconds / total
  if (share > 0 && share < 0.005) return "<1%"
  return `${Math.round(share * 100)}%`
}

/** Compact duration: "45s", "12m", "1h 05m". */
export function talkDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  return `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}m`
}

export interface TalkSegment {
  value: number
  color: string
  label: string
}

type TalkPlayer = ColoredPlayer & { id: string; name: string }

/**
 * The talk-time bar: one segment per player who spoke, in the players list's order. Keys that are not a
 * player (unnamed voices, `voice:<id>`, deleted players) are grouped as "Others", last.
 */
export function talkSegments(
  talk: Record<string, number>,
  players: TalkPlayer[],
  classes: ClassInfo[] = [],
): TalkSegment[] {
  const ids = new Set(players.map((p) => p.id))
  const segments: TalkSegment[] = []
  for (const p of players) {
    const value = talk[p.id] ?? 0
    if (value > 0) segments.push({ value, color: playerColor(p, classes), label: p.name })
  }
  const others = Object.entries(talk)
    .filter(([key]) => !ids.has(key))
    .reduce((sum, [, seconds]) => sum + Math.max(0, seconds), 0)
  if (others > 0) segments.push({ value: others, color: "var(--color-fg-subtle)", label: "Others" })
  return segments
}

/** Who talked most, the GM excluded; `pct` is their whole-number share of all talk. Null when nobody did. */
export function topPlayer<P extends TalkPlayer>(
  talk: Record<string, number>,
  players: P[],
): { player: P; pct: number; seconds: number } | null {
  const total = Object.values(talk).reduce((sum, s) => sum + Math.max(0, s), 0)
  let best: { player: P; seconds: number } | null = null
  for (const player of players) {
    const seconds = talk[player.id] ?? 0
    if (player.is_gm || seconds <= 0) continue
    if (!best || seconds > best.seconds) best = { player, seconds }
  }
  return best && { ...best, pct: Math.round((best.seconds / total) * 100) }
}
