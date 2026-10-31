import type { Player } from "@troubadour/api/players"
import type { Fix, Message, Voice } from "@troubadour/api/session"
import type { SessionRecord } from "@troubadour/api/sessions"
import { playerColor, speakerFor, type ClassInfo } from "../../lib/players.ts"

/** What a transcript line renders; built from live messages or a saved record. */
export interface ViewLine {
  id: string
  /** Seconds into the session. */
  t: number
  /** null for a voice nobody has named yet; then `label` says which voice. */
  speaker: { name: string; color: string; as?: string } | null
  label?: string
  text: string
  fixes: Fix[]
  /** Provisional or low-confidence speaker. */
  unsure?: boolean
}

const unsure = (provisional: boolean, confidence: number) => provisional || confidence < 0.5

/** Live lines: each message's speaker comes from the voices and players known right now. */
export function toViewLines(
  messages: Message[],
  voices: Voice[],
  players: Player[],
  classes: ClassInfo[] = [],
): ViewLine[] {
  return messages.map((m) => {
    const s = speakerFor(m.voice_id, voices, players)
    return {
      id: m.id,
      t: m.t_start,
      speaker: s.player
        ? { name: s.name, color: playerColor(s.player, classes), as: s.character ?? undefined }
        : null,
      label: s.player ? undefined : s.name,
      text: m.text,
      fixes: m.fixes,
      unsure: unsure(m.provisional, m.confidence),
    }
  })
}

/** Saved lines: the record carries each speaker's name, so the live store is never consulted. */
export function recordToViewLines(record: SessionRecord, classes: ClassInfo[] = []): ViewLine[] {
  const players = new Map(record.players.map((p) => [p.id, p]))
  return [...record.messages]
    .sort((a, b) => a.t_start - b.t_start)
    .map((m) => {
      const player = m.player_id ? players.get(m.player_id) : undefined
      return {
        id: m.id,
        t: Number(m.t_start) || 0,
        // A player id missing from the roster still names the speaker, in the muted colour.
        speaker: m.player_id
          ? {
              name: m.speaker,
              color: player ? playerColor(player, classes) : "var(--color-fg-subtle)",
              as: m.character || undefined,
            }
          : null,
        label: m.player_id ? undefined : m.speaker,
        text: m.text,
        fixes: m.fixes ?? [],
        unsure: unsure(m.provisional, m.confidence ?? 1),
      }
    })
}
