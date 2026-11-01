import type { CampaignJob, NotesSessionInput } from "../campaign/types.ts"
import { req, segment } from "../http/index.ts"
import { transcriptUrl } from "../session/endpoints.ts"
import type { RecordingQuality, ReviewedResult, SavedSession, SessionRecord, Upgrades } from "./types.ts"

/** What a notes-only session says (imported notes). */
export const sessionNotes = (id: string) => req<{ text: string }>("GET", `/api/sessions/${segment(id)}/notes`)

/** Replace a notes-only session's notes, date and title, and read the new notes into the codex again (a background job). */
export const editSessionNotes = (id: string, notes: NotesSessionInput) =>
  req<CampaignJob>("PUT", `/api/sessions/${segment(id)}/notes`, notes)

/** Set the order of the sessions whose dates are unknown (oldest first, every one of them). Returns the new list. */
export const reorderUnknownSessions = (ids: string[]) =>
  req<SavedSession[]>("PUT", "/api/sessions/order", { ids })

/** Name a notes-only session from its notes (a background job, kind "name"). */
export const nameSession = (id: string) => req<CampaignJob>("POST", `/api/sessions/${segment(id)}/name`)

export const sessions = () => req<SavedSession[]>("GET", "/api/sessions")

/** Append the later saved session onto the earlier one. Returns the session that remains. */
export const mergeSessions = (ids: [string, string]) =>
  req<SavedSession>("POST", "/api/sessions/merge", { ids })

/** Undo the last merge into this session: its old transcript and recording, and the later session, come back. */
export const unmergeSession = (id: string) =>
  req<SavedSession>("POST", `/api/sessions/${segment(id)}/unmerge`)

/** Move a session (recording and transcript) to the server's trash. The vault's write-up stays. */
export const deleteSession = (id: string) => req<void>("DELETE", `/api/sessions/${segment(id)}`)

/** Bring a deleted session back. */
export const undeleteSession = (id: string) =>
  req<SavedSession>("POST", `/api/sessions/${segment(id)}/undelete`)

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

/** Re-run every processing step that can run on a saved session (background job of kind "refresh"). */
export const refreshSession = (id: string) => req<CampaignJob>("POST", `/api/sessions/${segment(id)}/refresh`)

/** Stop a refresh before its next step; what finished stays. */
export const cancelRefresh = (jobId: string) =>
  req<void>("POST", `/api/sessions/refresh/${segment(jobId)}/cancel`)

/** Sessions an older Troubadour processed, with the steps that would be redone. */
export const sessionUpgrades = () => req<Upgrades>("GET", "/api/sessions/upgrades")

/** Queue the stale steps of every out-of-date session, oldest first (one job each). */
export const upgradeSessions = () => req<CampaignJob[]>("POST", "/api/sessions/upgrade")

/** Put an improved/spell-fixed session's original transcript back. */
export const restoreSession = (id: string) => req<unknown>("POST", `/api/sessions/${segment(id)}/restore`)

/** A saved recording's quality report (measured on first request, a few seconds). */
export const sessionQuality = (id: string) =>
  req<RecordingQuality>("GET", `/api/sessions/${segment(id)}/quality`)

/** The saved session's own mic recording (only when `SavedSession.audio`). */
export function sessionAudioUrl(sessionId: string): string {
  return `/api/sessions/${segment(sessionId)}/audio.wav`
}
