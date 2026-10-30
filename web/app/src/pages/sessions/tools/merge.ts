import type { SavedSession } from "@troubadour/api/sessions"

/** A later session that began within this long of an earlier one ending is the same sitting. */
const SAME_SITTING_S = 10 * 60

export function sameSitting(earlier: SavedSession, later: SavedSession): boolean {
  const gap = later.started_at - (earlier.started_at + earlier.duration_s)
  return gap >= -1 && gap <= SAME_SITTING_S
}

/** Either order in, the earlier session first. */
export function inOrder(a: SavedSession, b: SavedSession): [SavedSession, SavedSession] {
  return a.started_at <= b.started_at ? [a, b] : [b, a]
}

/** Other sessions to merge with, the ones that look like the same sitting first, then the rest newest first. */
export function mergeCandidates(
  all: SavedSession[],
  current: SavedSession,
): { session: SavedSession; suggested: boolean }[] {
  const others = all.filter((s) => s.id !== current.id)
  const suggested = (s: SavedSession) => {
    const [first, second] = inOrder(s, current)
    return sameSitting(first, second)
  }
  return others
    .map((session) => ({ session, suggested: suggested(session) }))
    .sort((a, b) => Number(b.suggested) - Number(a.suggested) || b.session.started_at - a.session.started_at)
}
