import type { Schemas } from "../generated/index.ts"

/** One session in the story so far: places, talk time, entries first met and facts accepted. */
export type TimelineSession = Schemas["TimelineSession"]
/** A confirmed entry whose first mention is in that session. */
export type NewEntity = Schemas["NewEntity"]
export type Timeline = Schemas["TimelineOut"]
