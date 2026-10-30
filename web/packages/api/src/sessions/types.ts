import type { Schemas } from "../generated/index.ts"
import type { QualityNumbers, QualityVerdict } from "../audio/types.ts"
import type { Fix } from "../session/types.ts"

/** One saved session's summary. `title` is the write-up's, else the working title; `n` is its session number. */
export type SavedSession = Schemas["SavedSession"]
/** A stretch of a written-up session: `t` is seconds into the session where it starts. */
export type Scene = Schemas["Scene"]
/** What a start sets or the server fills in after the fact; absent from records saved by older versions. */
type LaterFields = "title" | "present_player_ids" | "reviewed_at" | "talk" | "merged_from"
export type ReviewedResult = Schemas["ReviewedOut"]
/** Set on a saved record once "Improve transcript" re-transcribed it. */
export interface ImprovedInfo {
  at: number /* epoch seconds */
  model: string
  changed: number /* lines whose text changed */
}
/** Set on a saved record once Retranscribe reassigned speakers. The words are unchanged. */
export interface RetranscribedInfo {
  at: number
  changed: number
  lines: number
  /** Lines whose old label was hearing the person who spoke next. */
  heard_next: number
  /** Lines whose own audio now matches a different enrolled voice. */
  rematch: number
  backup: string
}
/** Set on a saved record once "Estimate in-character time" read it. */
export interface InCharacterInfo {
  at: number /* epoch seconds */
  lines: number /* players' lines */
  in_character: number
  by_voice: number /* in a voice named with a character */
  by_ai: number /* labelled by the AI */
  unread: number /* the AI didn't answer for these: counted as table talk */
}
/** Set on a saved record once "Fix spellings" ran over it. */
export interface SpellingInfo {
  at: number /* epoch seconds */
  fixed: number /* spellings fixed */
}
/** Saved session record from `GET /api/sessions/{id}/transcript.json`. Historical: speakers are precomputed. */
export interface RecordPlayer {
  id: string
  name: string
  character: string
  is_gm: boolean
  /** null: the class colour. Absent in records saved before colours were stored. */
  color?: string | null
  /** A class id (possibly one since deleted). Absent in records saved before classes. */
  dnd_class?: string | null
}
export interface RecordMessage {
  id: string
  t_start: number
  t_end: number
  speaker: string /* display name at save time, e.g. "Nora" or "Voice 38" */
  player_id: string | null /* null for unnamed voices */
  character: string | null
  voice_id: string | null
  provisional: boolean
  confidence: number
  text: string
  /** Records saved before mechanics were removed also carry `annotations`; ignored. */
  fixes?: Fix[] /* absent in records saved before the spelling cleanup */
  level_db?: number | null
  in_character?: boolean /* set once "Estimate in-character time" read the session */
}
export interface SessionRecord {
  version: number
  session: Omit<
    SavedSession,
    "audio" | "replayable" | "restorable" | "quality" | "n" | "summary" | "scenes" | LaterFields
  > &
    Partial<Pick<SavedSession, LaterFields>> & {
      improved?: ImprovedInfo
      in_character?: InCharacterInfo
      spelling?: SpellingInfo
      retranscribed?: RetranscribedInfo
    }
  players: RecordPlayer[]
  voices: {
    id: string
    label: string
    player_id: string | null
    character: string | null
    trained: boolean
  }[]
  messages: RecordMessage[]
}

export interface RecordingQuality {
  mic: string | null
  overall: QualityNumbers
  /** One point per minute. */
  timeline: {
    t: number
    speech_db: number
    noise_db: number
    snr_db: number
    rumble_pct: number
    clipped_pct: number
  }[]
  /** Named players, loudest first. */
  speakers: { speaker: string; level_db: number; lines: number }[]
  spread_db: number
  verdict: { kind: QualityVerdict | "unknown"; reasons: string[] }
}
