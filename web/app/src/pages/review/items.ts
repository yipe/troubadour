import type { Fact } from "@troubadour/api/campaign"
import type { ReviewItem } from "@troubadour/api/review"

export type Filter = "all" | "fact" | "spelling" | "entry"

export const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "fact", label: "Facts" },
  { id: "spelling", label: "Spellings" },
  { id: "entry", label: "New entries" },
]

/** How many items each filter shows, whether decided or not. */
export function filterCounts(items: ReviewItem[]): Record<Filter, number> {
  const count = (kind: ReviewItem["kind"]) => items.filter((i) => i.kind === kind).length
  return { all: items.length, fact: count("fact"), spelling: count("spelling"), entry: count("entry") }
}

export const matchesFilter = (item: ReviewItem, filter: Filter) => filter === "all" || item.kind === filter

/** Open facts the GM said themselves: the ones "Accept all GM-stated" takes. */
export const gmStatedOpen = (items: ReviewItem[]) =>
  items.filter((i) => i.kind === "fact" && i.status === "open" && i.fact?.confidence === "gm")

const SECONDS_PER_ITEM = 20

/** About 20 s per open item, rounded up to whole minutes. */
export const minutesLeft = (open: number) => Math.ceil((open * SECONDS_PER_ITEM) / 60)

export interface Placement {
  /** Items by the transcript line they came from, in review order. */
  byLine: Map<string, ReviewItem[]>
  /** Items with no line in this transcript: notebook-only, or from a line that is gone. */
  loose: ReviewItem[]
}

export function placeItems(items: ReviewItem[], lineIds: Iterable<string>): Placement {
  const known = new Set(lineIds)
  const byLine = new Map<string, ReviewItem[]>()
  const loose: ReviewItem[] = []
  for (const item of items) {
    if (item.line_id === null || !known.has(item.line_id)) {
      loose.push(item)
      continue
    }
    byLine.set(item.line_id, [...(byLine.get(item.line_id) ?? []), item])
  }
  return { byLine, loose }
}

/** The line's state from its items: any open one makes it open; otherwise accepted if any was. */
export function lineState(items: ReviewItem[]): "open" | "accepted" | "rejected" {
  if (items.some((i) => i.status === "open")) return "open"
  return items.some((i) => i.status === "accepted") ? "accepted" : "rejected"
}

/** The text an update replaces, found among the campaign's confirmed facts by id. */
export function replacedText(replaces: string | null, facts: Fact[]): string | undefined {
  return replaces ? facts.find((f) => f.id === replaces)?.text : undefined
}

const DATE_PARTS = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric" })

/** "Thu Oct 22" */
export function reviewDate(epochS: number): string {
  const parts = DATE_PARTS.formatToParts(new Date(epochS * 1000))
  const part = (type: string) => parts.find((p) => p.type === type)?.value
  return `${part("weekday")} ${part("month")} ${part("day")}`
}
