import type { Schemas } from "../generated/index.ts"

/** The recap built for a session: text, one quote, a moment per player, open questions. */
export type Recap = Schemas["Recap"]
export type RecapQuote = Schemas["RecapQuote"]
export type RecapMoment = Schemas["RecapMoment"]
/** What the recap is built with: the voice, the length in seconds read aloud (15..120) and what to include. */
export type RecapOptions = Schemas["RecapIn"]
export type RecapInclude = Schemas["RecapInclude"]
export type RecapVoice = RecapOptions["voice"]
