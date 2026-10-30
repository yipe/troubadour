import type { Schemas } from "../generated/index.ts"

/** One session in the story so far: places, talk time, entries first met and facts accepted. */
export type TimelineSession = Schemas["TimelineSession"]
/** A confirmed entry whose first mention is in that session. */
export type NewEntity = Schemas["NewEntity"]
export type Timeline = Schemas["TimelineOut"]

/** Sessions oldest first, and each mentioned entry's mentions per session in the same order. */
export type Appearances = Schemas["AppearancesOut"]
