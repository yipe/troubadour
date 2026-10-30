import type { Campaign, Fact } from "@troubadour/api/campaign"
import type { ReviewItem } from "@troubadour/api/review"
import type { SavedSession } from "@troubadour/api/sessions"

export interface HomeStats {
  sessions: number
  recordedS: number
  entries: number
  facts: number
}

/** Confirmed facts: those inside entries plus the campaign's own. Suggested ones wait in review. */
function allFacts(campaign: Campaign): Fact[] {
  return [...campaign.facts, ...campaign.entities.flatMap((e) => e.facts)]
}

export function homeStats(
  campaign: Campaign | undefined,
  sessions: SavedSession[],
  count: number,
): HomeStats {
  return {
    sessions: count,
    recordedS: sessions.reduce((sum, s) => sum + s.duration_s, 0),
    entries: campaign?.entities.length ?? 0,
    facts: campaign ? allFacts(campaign).length : 0,
  }
}

export interface NewestFact {
  fact: Fact
  sessionId: string
  /** The session's number, for "S12". */
  n: number
  t: number
}

/**
 * The newest confirmed facts by where they were said: later session first, then later in the session.
 * Facts without a known session and time can't be placed, so they are left out.
 */
export function newestFacts(
  campaign: Campaign | undefined,
  numbers: ReadonlyMap<string, number>,
  limit = 6,
): NewestFact[] {
  if (!campaign) return []
  const placed: NewestFact[] = []
  for (const fact of allFacts(campaign)) {
    const sessionId = fact.source?.session_id
    const n = sessionId ? numbers.get(sessionId) : undefined
    if (!sessionId || n === undefined) continue
    placed.push({ fact, sessionId, n, t: fact.source?.t ?? 0 })
  }
  return placed.sort((a, b) => b.n - a.n || b.t - a.t).slice(0, limit)
}

/** What a review still has open, by kind. */
export function openByKind(items: ReviewItem[]): { fact: number; spelling: number; entry: number } {
  const open = items.filter((i) => i.status === "open")
  const count = (kind: ReviewItem["kind"]) => open.filter((i) => i.kind === kind).length
  return { fact: count("fact"), spelling: count("spelling"), entry: count("entry") }
}
