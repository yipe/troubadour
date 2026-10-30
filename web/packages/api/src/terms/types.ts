import type { Schemas } from "../generated/index.ts"

export type Terms = Schemas["TermsOut"]
export type Term = Schemas["TermOut"]
export type TermSource = Term["source"]
export type TermsAdded = Schemas["AddedOut"]

export interface TermsQuery {
  q: string
  source: TermSource | null
  offset: number
  limit: number
}
