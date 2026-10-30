import { classColorVar, CLASS_NAMES, type DndClass } from "@yipe/tokens/classes"
import type { Player } from "@troubadour/api/players"
import type { Voice } from "@troubadour/api/session"

/** Typed locally until the classes endpoint (C1) lands; S2 must not depend on it. */
export interface ClassInfo {
  id: string
  color: string | null
  builtin: boolean
}

/** What `playerColor` reads of a player. `dnd_class` arrives with C1. */
export interface ColoredPlayer {
  color?: string | null
  dnd_class?: string | null
  is_gm: boolean
}

const BUILT_IN = new Set<string>(CLASS_NAMES)

/**
 * The player's colour as a CSS value: their own hex override; else their class (a built-in's theme
 * variable, a custom class's own hex); else paladin for the GM; else the muted foreground.
 * A class id that is no longer in `classes` (deleted) falls through to the next rule.
 */
export function playerColor(p: ColoredPlayer, classes: ClassInfo[]): string {
  if (p.color) return p.color
  const cls = p.dnd_class ? classes.find((c) => c.id === p.dnd_class) : undefined
  if (cls?.builtin && BUILT_IN.has(cls.id)) return classColorVar(cls.id as DndClass)
  if (cls && !cls.builtin && cls.color) return cls.color
  if (p.is_gm) return classColorVar("paladin")
  return "var(--color-fg-subtle)"
}

/** "Priya Shah" -> "PS"; first and last word; "?" for an empty name. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return "?"
  const first = parts[0]?.[0] ?? "?"
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : ""
  return (first + last).toUpperCase()
}

export interface Speaker {
  voice: Voice | null
  player: Player | null
  name: string
  character: string | null
}

/** Who a voice is, for live lines. Saved records carry the answer precomputed (see `record.ts`). */
export function speakerFor(voiceId: string | null, voices: Voice[], players: Player[]): Speaker {
  const voice = voiceId ? (voices.find((v) => v.id === voiceId) ?? null) : null
  const player = voice?.player_id ? (players.find((p) => p.id === voice.player_id) ?? null) : null
  const name = player?.name ?? voice?.label ?? "…"
  // A player with any character voice speaks out-of-character on their other voices.
  const hasCharacterVoice =
    !!player && voices.some((v) => v.status === "named" && v.player_id === player.id && v.character != null)
  const character = voice?.character || (hasCharacterVoice ? null : player?.character) || null
  return { voice, player, name, character }
}

/**
 * Who a line is from, for grouping consecutive lines in a transcript. A player's voices share a key
 * (switching voices doesn't split their turn, a different character does); null when the speaker is
 * unknown, so unknown lines never group.
 */
export function speakerKey(
  playerId: string | null,
  voiceId: string | null,
  character: string | null,
): string | null {
  const who = playerId ? `p:${playerId}` : voiceId ? `v:${voiceId}` : null
  return who ? `${who}|${character ?? ""}` : null
}
