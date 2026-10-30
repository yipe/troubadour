import type { Campaign } from "@troubadour/api/campaign"
import type { FactRow } from "../../components/facts-table/FactsTable.tsx"
import type { Confidence } from "../../lib/confidence.ts"

/** The "About" filters: the entry types the page lists, plus facts that belong to no entry. */
export const ABOUT_FILTERS = [
  { id: "npc", label: "NPCs" },
  { id: "place", label: "Places" },
  { id: "item", label: "Items" },
  { id: "faction", label: "Factions" },
  { id: "pc", label: "PCs" },
  { id: "campaign", label: "Campaign" },
] as const
export type AboutFilter = (typeof ABOUT_FILTERS)[number]["id"]

export const SURE_FILTERS: { id: Confidence; label: string; dot: "success" | "warning" | "neutral" }[] = [
  { id: "gm", label: "GM stated", dot: "success" },
  { id: "theory", label: "Party theory", dot: "warning" },
  { id: "once", label: "Heard once", dot: "neutral" },
]

export interface Filters {
  about?: AboutFilter
  sure?: Confidence
  /** A player id. */
  by?: string
  q: string
}

/** Query-string values are user-editable; anything unknown means "no filter". */
export function parseFilters(params: URLSearchParams): Filters {
  const about = params.get("about")
  const sure = params.get("sure")
  return {
    about: ABOUT_FILTERS.find((f) => f.id === about)?.id,
    sure: SURE_FILTERS.find((f) => f.id === sure)?.id,
    by: params.get("by") || undefined,
    q: params.get("q") ?? "",
  }
}

/** Every confirmed fact: those inside entries (with what they are about) and the campaign's own. */
export function allRows(campaign: Campaign | undefined): FactRow[] {
  if (!campaign) return []
  return [
    ...campaign.facts.map((fact): FactRow => ({ fact })),
    ...campaign.entities.flatMap((e) =>
      e.facts.map((fact): FactRow => ({ fact, about: { name: e.name, type: e.type } })),
    ),
  ]
}

const aboutOf = (row: FactRow): string => (row.about ? row.about.type : "campaign")

export function matches(row: FactRow, f: Filters): boolean {
  const { fact, about } = row
  if (f.about && aboutOf(row) !== f.about) return false
  if (f.sure && fact.confidence !== f.sure) return false
  if (f.by && fact.said_by?.player_id !== f.by) return false
  const q = f.q.trim().toLowerCase()
  if (!q) return true
  return [fact.text, about?.name, about?.type, fact.said_by?.name].some((s) => s?.toLowerCase().includes(q))
}

export type Facet = "about" | "sure" | "by"

/**
 * How many rows each option of one filter group would show, with the other groups (and the search)
 * as they are now. That way a count always says what clicking the option gives.
 */
export function facetCounts(rows: FactRow[], f: Filters, facet: Facet): Map<string | undefined, number> {
  const rest: Filters = { ...f, [facet]: undefined }
  const counts = new Map<string | undefined, number>()
  for (const row of rows) {
    if (!matches(row, rest)) continue
    const key =
      facet === "about" ? aboutOf(row) : facet === "sure" ? row.fact.confidence : row.fact.said_by?.player_id
    for (const k of [undefined, key ?? undefined]) counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  return counts
}

/** Newest session first, later in the session first; facts with no known session go last. */
export function newestFirst(rows: FactRow[], numbers: ReadonlyMap<string, number>): FactRow[] {
  const place = (r: FactRow) => {
    const id = r.fact.source?.session_id
    return { n: (id ? numbers.get(id) : undefined) ?? -1, t: r.fact.source?.t ?? -1 }
  }
  return rows
    .map((row) => ({ row, ...place(row) }))
    .sort((a, b) => b.n - a.n || b.t - a.t)
    .map((x) => x.row)
}
