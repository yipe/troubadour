export interface NumberedSession {
  id: string
  /** Epoch seconds, or an ISO string (the shared test vectors use those). */
  started_at: number | string
  /** Ids of later sessions already appended onto this one. */
  merged_from?: string[] | null
}

const startedMs = (s: NumberedSession) =>
  typeof s.started_at === "number" ? s.started_at * 1000 : Date.parse(s.started_at)

/**
 * Session numbers: 1-based position among the saved sessions, oldest first (ties by id), not counting a
 * session merged into another. The server implements the same rule (`lore.pages.session_numbers`); both
 * pass `shared/test-vectors/session-numbers.json`.
 */
export function sessionNumbers(sessions: NumberedSession[]): Map<string, number> {
  const mergedAway = new Set(sessions.flatMap((s) => s.merged_from ?? []))
  const ordered = sessions
    .filter((s) => !mergedAway.has(s.id))
    .sort((a, b) => startedMs(a) - startedMs(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return new Map(ordered.map((s, i) => [s.id, i + 1]))
}

/** The number the session about to be played gets. */
export function nextSessionNumber(sessions: NumberedSession[]): number {
  return sessionNumbers(sessions).size + 1
}

export type SessionStatus = "needs-review" | "reviewed" | "not-written-up"

/** `reviewed_at` is set by C2; until then every written-up session needs review. */
export function sessionStatus(s: { reviewed_at?: number | null }, writtenUp: boolean): SessionStatus {
  if (!writtenUp) return "not-written-up"
  return s.reviewed_at ? "reviewed" : "needs-review"
}
