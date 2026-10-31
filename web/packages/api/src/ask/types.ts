import type { Schemas } from "../generated/index.ts"

/** A source an answer cites: a transcript excerpt, a glossary entry or another vault note. */
export type AnswerSource = Schemas["AnswerSource"]
/** What an answer searched and how long it took: "Answered on this computer in 4 s from 13 transcripts and 214 notes". */
export type AnswerStats = Schemas["AnswerStats"]
/** A question about the campaign, answered by the local LLM from transcripts and notes. */
export type CampaignAnswer = Schemas["CampaignAnswer"]
