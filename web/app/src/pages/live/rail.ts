import type { Player } from "@troubadour/api/players"
import type { Source, Voice } from "@troubadour/api/session"

/** Who the rail lists: the session's present players, or everyone when no attendance was set. */
export function presentPlayers(players: Player[], presentIds: string[] | null | undefined): Player[] {
  if (!presentIds || presentIds.length === 0) return players
  const present = new Set(presentIds)
  return players.filter((p) => present.has(p.id))
}

/** The newest pending voice (the server appends new voices), or null. */
export function newestPending(voices: Voice[]): Voice | null {
  for (let i = voices.length - 1; i >= 0; i--) {
    const v = voices[i]
    if (v?.status === "pending") return v
  }
  return null
}

/** Players to offer on the pending card: the suggested one first, the rest in table order. */
export function quickPicks(voice: Voice, players: Player[]): Player[] {
  const suggested = players.find((p) => p.id === voice.suggested_player_id)
  return suggested ? [suggested, ...players.filter((p) => p.id !== suggested.id)] : players
}

/** What the mic status line names: the device, the replayed file, or the replayed session. */
export function listeningLabel(source: Source | null | undefined): string {
  if (!source) return "No source"
  if (source.kind === "mic") return source.device ?? "Default microphone"
  if (source.kind === "file") return source.name
  return "Saved session"
}

/** "Voice 3 is Maya." or "Voice 3 is Alex (as Choir voice)." */
export function assignedMessage(voice: Voice, player: Player, character: string | null): string {
  const as = character ? ` (as ${character})` : ""
  return `${voice.label} is ${player.name}${as}. Past lines relabeled.`
}
