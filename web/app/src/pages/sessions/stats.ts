import type { Campaign } from "@troubadour/api/campaign"
import type { SavedSession } from "@troubadour/api/sessions"
import { dateShort } from "../../lib/format.ts"

export type Scene = NonNullable<SavedSession["scenes"]>[number]

/** Each scene runs until the next one starts; the last runs to the end of the session. */
export function sceneLengths(scenes: Scene[], durationS: number): number[] {
  return scenes.map((s, i) => Math.max(0, (scenes[i + 1]?.t ?? durationS) - s.t))
}

/** Suggested facts from this session that are still waiting for a keep or dismiss. */
export function openSuggestions(campaign: Campaign | undefined, sessionId: string): number {
  let count = 0
  for (const e of campaign?.entities ?? []) {
    count += e.suggested_facts.filter((f) => f.source?.session_id === sessionId).length
  }
  return count
}

/** Facts and entries the session added. An entry is new when none of its facts is from an earlier session. */
export function sessionGains(
  campaign: Campaign | undefined,
  sessionId: string,
  numbers: ReadonlyMap<string, number>,
): { facts: number; entries: number } {
  const own = numbers.get(sessionId)
  if (!campaign || own === undefined) return { facts: 0, entries: 0 }
  const from = (f: { source: { session_id: string | null } | null }) => f.source?.session_id ?? null
  let facts = campaign.facts.filter((f) => from(f) === sessionId).length
  let entries = 0
  for (const e of campaign.entities) {
    const here = e.facts.filter((f) => from(f) === sessionId).length
    facts += here
    if (here === 0) continue
    const earlier = e.facts.some((f) => {
      const n = numbers.get(from(f) ?? "")
      return n !== undefined && n < own
    })
    if (!earlier) entries += 1
  }
  return { facts, entries }
}

/** The title the list and the detail share: the write-up's, else "Untitled · Sep 17". */
export function sessionTitle(s: SavedSession): string {
  return s.title?.trim() || `Untitled · ${dateShort(s.started_at)}`
}
