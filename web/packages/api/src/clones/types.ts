/** A player's built voice clone (GET /api/clones): their table voice, with `characters` beside it. */
export interface CloneVoice {
  player_id: string
  persona?: string /* "table", or a character voice's key; absent on older voices: "table" */
  label?: string /* the character's name; "" for the table voice */
  characters?: CloneVoice[] /* on the table voice: a voice per character they voice in the sessions */
  built_at: number /* epoch s */
  /* What the reference came from ("Train recording", "recording of 2026-10-12"), cleaned of room noise;
   * the build tries the Train recording and the cleanest session recordings and keeps the closest.
   * Absent on voices built before the search. */
  source?: string
  tried?: { source: string; likeness: number | null }[]
  /* What the preview says: ~20 s written in their style from their speech profile ("ai"), their own
   * lines from the transcripts ("their lines"), or the stock line (""). Absent on older voices. */
  preview_text?: string
  preview_kind?: "ai" | "their lines" | ""
  likeness: number | null /* cosine of the preview to their voiceprint (the speaker-ID model's view) */
  reference_s: number
  preview_url: string
  clone_wpm: number | null /* the clone's own pace; "in their words" stretches it to theirs */
}
/** Audio made with a clone: typed text ("say") or a session page read aloud ("read"). */
export interface CloneClip {
  id: string
  player_id: string
  kind: "say" | "read"
  title: string
  text: string /* the first 300 characters */
  source: { session?: string; note?: string }
  in_their_words: boolean /* restyled like them (text is what was spoken) and at their pace */
  persona?: string /* which of their voices; absent: "table" */
  seconds: number
  created_at: number /* epoch s */
  url: string
}
/** How a player talks, counted from their saved transcripts (talk.py); same consent as the clone. */
export interface SpeechProfile {
  player_id: string
  built_at: number /* epoch s */
  sessions: number
  lines: number
  words: number
  wpm: number | null /* words per minute of speech; null without enough timed lines */
  words_per_line: number
  questions: number /* share of lines, 0-1 */
  exclamations: number
  in_character: number
  phrases: string[] /* pet phrases: said far more than by the rest of the table */
  openers: string[] /* words their lines often start with */
  examples: string[] /* typical lines, for the AI to imitate */
  description: string | null /* the AI's short description; null when it was offline */
}
export interface Clones {
  voices: Record<string, CloneVoice> /* by player id */
  profiles: Record<string, SpeechProfile> /* by player id */
  clips: CloneClip[] /* newest first */
  available: boolean /* voice clones run here (Apple Silicon only); speech profiles work everywhere */
}
