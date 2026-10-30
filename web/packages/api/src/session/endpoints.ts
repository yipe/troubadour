import { req, segment } from "../http/index.ts"
import type { Message, Session, Source, SourceList, TranscriptFormat, Voice } from "./types.ts"

/** Download URL for a transcript: the current/just-finished session, or a saved one by id. */
export function transcriptUrl(format: TranscriptFormat, sessionId?: string): string {
  return sessionId ? `/api/sessions/${segment(sessionId)}/transcript.${format}` : `/api/transcript.${format}`
}

// Session responses are deliberately not applied to the store: WS events are the only source of truth.
export const startSession = (source: Source) => req<Session>("POST", "/api/session/start", { source })
export const pauseSession = () => req<Session>("POST", "/api/session/pause")
export const resumeSession = () => req<Session>("POST", "/api/session/resume")
export const stopSession = () => req<Session>("POST", "/api/session/stop")

/** Probe LM Studio now. The new status arrives as session.updated. */
export const recheckLlm = () => req<Session["llm"]>("POST", "/api/llm/recheck")

export const sources = () => req<SourceList>("GET", "/api/sources")

export const assignVoice = (id: string, player_id: string, character?: string | null) =>
  req<{ voice: Voice; merged_into: string | null }>("POST", `/api/voices/${segment(id)}/assign`, {
    player_id,
    character,
  })

export const unassignVoice = (id: string) => req<Voice>("POST", `/api/voices/${segment(id)}/unassign`)

/** Who spoke one line; it stays theirs. The change arrives as voice.upserted + messages.updated. */
export const assignMessage = (id: string, player_id: string, character?: string | null) =>
  req<{ message: Message; voice: Voice }>("POST", `/api/messages/${segment(id)}/speaker`, {
    player_id,
    character,
  })
