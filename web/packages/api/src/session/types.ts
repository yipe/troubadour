import type { Campaigns } from "../campaigns/types.ts"
import type { LibraryPlayer, Player } from "../players/types.ts"

export interface Voice {
  id: string
  label: string /* "Voice 3" */
  status: "pending" | "named"
  player_id: string | null
  character: string | null /* optional PC/NPC name for this voice */
  seconds: number /* speech heard so far */
  sample_url: string | null /* wav */
  suggested_player_id: string | null
  suggested_score: number | null /* 0-1, for pending voices */
  trained: boolean /* voiceprint came from a Train recording */
}
export interface Message {
  id: string
  voice_id: string | null
  text: string
  t_start: number
  t_end: number /* session seconds */
  confidence: number /* 0-1 */
  provisional: boolean
  /** Words the spelling cleanup replaced (UTF-16 offsets into the current `text`). */
  fixes: Fix[]
  /** Loudness of the line (dBFS); null when unknown. */
  level_db: number | null
}
/** A span of `Message.text` the spelling cleanup replaced; `heard` is what speech-to-text wrote. */
export interface Fix {
  start: number
  end: number /* UTF-16, end exclusive */
  heard: string
}
export type Source =
  | { kind: "mic"; device: string | null }
  | { kind: "file"; name: string; speed: number }
  | { kind: "session"; id: string /* saved session being replayed */; speed: number }
export interface Session {
  status: "idle" | "running" | "paused" | "stopping"
  source: Source | null
  t: number /* session seconds at send time */
  llm: { url: string; model: string; ok: boolean }
  asr: {
    model: string
    state: "loading" | "ready" | "error"
  } /* Whisper + voice models, loaded at start-up */
  training: { player_id: string } | null /* who is being trained right now */
  /** Live level + quality read-out on (PUT /api/audio/monitor); off saves the per-frame work. */
  audio_monitor: boolean
  error: string | null /* e.g. models failed to load; blocks Start and Train */
}
export type MessagePatch = { id: string } & Partial<Omit<Message, "id">>
export interface Snapshot extends Campaigns {
  session: Session
  players: Player[]
  library: LibraryPlayer[]
  voices: Voice[]
  messages: Message[]
}
export interface SourceList {
  files: { name: string; duration: number; audio_url: string }[]
  mics: { name: string; default: boolean }[]
}

export type TranscriptFormat = "md" | "json"
