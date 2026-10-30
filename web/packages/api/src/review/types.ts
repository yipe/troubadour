import type { Schemas } from "../generated/index.ts"

/** One suggestion from a session, anchored to a transcript line. */
export type ReviewItem = Schemas["ReviewItem"]
export type ReviewKind = ReviewItem["kind"]
export type ReviewCounts = Schemas["ReviewCounts"]
/** A session's review: the frozen list of items and how many are decided. */
export type Review = Schemas["Review"]

/**
 * What the GM decided. `text` is an edited fact, or the name of a new entry for an unknown word.
 * `about` moves a fact to another entry; `null` (not omitted) moves it to the campaign's facts.
 */
export interface ReviewAction {
  action: "accept" | "reject"
  text?: string
  about?: string | null
}
