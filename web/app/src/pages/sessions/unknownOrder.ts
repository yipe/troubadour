import type { SavedSession } from "@troubadour/api/sessions"
import { isPast } from "../../lib/format.ts"

/** Notes sessions whose date is unknown: the ones that can be put in order by hand. */
export const hasUnknownDate = (s: Pick<SavedSession, "kind" | "started_at">): boolean =>
  s.kind === "notes" && isPast(s.started_at)

/** Their ids, oldest first (the list is newest first). */
export function unknownOrder(sessions: Pick<SavedSession, "id" | "kind" | "started_at">[]): string[] {
  return sessions
    .filter(hasUnknownDate)
    .map((s) => s.id)
    .reverse()
}

/** `ids` with `id` taken out and put where `target` is. */
export function movedTo(ids: string[], id: string, target: string): string[] {
  const to = ids.indexOf(target)
  if (to < 0 || !ids.includes(id)) return ids
  const rest = ids.filter((x) => x !== id)
  return [...rest.slice(0, to), id, ...rest.slice(to)]
}

/** `ids` with `id` one place earlier (`-1`) or later (`1`); unchanged at either end. */
export function shifted(ids: string[], id: string, by: -1 | 1): string[] {
  const at = ids.indexOf(id)
  const neighbour = ids[at + by]
  return at < 0 || neighbour === undefined ? ids : movedTo(ids, id, neighbour)
}
