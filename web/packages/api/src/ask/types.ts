/** A source an answer cites: a transcript excerpt, a glossary entry or another vault note. */
export interface AnswerSource {
  id: string /* "S1"…, as the model cited it */
  kind: "transcript" | "entry" | "note"
  label: string /* "2026-10-08 The Desert Road · 01:15", or a vault-relative path */
  session: string | null /* transcript: saved session id */
  t: number | null /* transcript: seconds into the session */
  path: string | null /* entry or note: vault-relative */
  entry: string | null /* entry: its name */
  excerpt: string
}
/** A question about the campaign, answered by the local LLM from transcripts and notes. */
export interface CampaignAnswer {
  id: string
  question: string
  state: "queued" | "searching" | "thinking" | "done" | "error"
  answer: string
  found: boolean /* false: the sources didn't answer it */
  sources: AnswerSource[]
  message: string /* error */
  created: number /* epoch s */
}
