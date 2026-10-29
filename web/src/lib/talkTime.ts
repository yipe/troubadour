import type { Message, Player, Voice } from "./types"

export interface TalkTime {
  /** player_id → seconds spoken (all of the player's named voices) */
  byPlayer: Map<string, number>
  /** player_id → seconds of that in a character voice (a voice named with a character): an estimate,
   * as good as the voices panel's naming. Players without any are absent. */
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
