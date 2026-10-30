import type { CampaignJob } from "../campaign/types.ts"
import { req, segment } from "../http/index.ts"
import { transcriptUrl } from "../session/endpoints.ts"
import type { RecordingQuality, ReviewedResult, SavedSession, SessionRecord } from "./types.ts"

export const sessions = () => req<SavedSession[]>("GET", "/api/sessions")

/** Append the later saved session onto the earlier one. Returns the session that remains. */
export const mergeSessions = (ids: [string, string]) =>
  req<SavedSession>("POST", "/api/sessions/merge", { ids })

/** Set (or clear) the "reviewed" mark on a saved session. */
export const markReviewed = (id: string, reviewed: boolean) =>
  req<ReviewedResult>("POST", `/api/sessions/${segment(id)}/reviewed`, { reviewed })

export const sessionRecord = (id: string) => req<SessionRecord>("GET", transcriptUrl("json", id))

/** Label which of each player's lines were in character (background job, kind "incharacter"). */
export const estimateInCharacter = (id: string) =>
  req<CampaignJob>("POST", `/api/sessions/${segment(id)}/in-character`)

/** Re-transcribe a saved session with the current glossary (background job). */
export const improveSession = (id: string) => req<CampaignJob>("POST", `/api/sessions/${segment(id)}/improve`)

/** Re-assign speakers on a saved recording. Overwrites hand-corrected speakers; the first original is kept. */
export const retranscribeSession = (id: string) =>
  req<CampaignJob>("POST", `/api/sessions/${segment(id)}/retranscribe`)

/** Run the spelling cleanup over a saved session (background job; no re-listening). */
export const fixSpellings = (id: string) => req<CampaignJob>("POST", `/api/sessions/${segment(id)}/spelling`)

/** Put an improved/spell-fixed session's original transcript back. */
export const restoreSession = (id: string) => req<unknown>("POST", `/api/sessions/${segment(id)}/restore`)

/** A saved recording's quality report (measured on first request, a few seconds). */
export const sessionQuality = (id: string) =>
  req<RecordingQuality>("GET", `/api/sessions/${segment(id)}/quality`)

/** The saved session's own mic recording (only when `SavedSession.audio`). */
export function sessionAudioUrl(sessionId: string): string {
  return `/api/sessions/${segment(sessionId)}/audio.wav`
}
