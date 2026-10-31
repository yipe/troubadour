import type { CampaignJob } from "../campaign/types.ts"
import { req, segment } from "../http/index.ts"
import type { Recap, RecapOptions } from "./types.ts"

/** The stored recap of a saved session, or null when none was built yet. */
export const sessionRecap = (id: string) => req<Recap | null>("GET", `/api/sessions/${segment(id)}/recap`)

/** Build the recap (background job, kind "recap"). 409 while one is already running for the session. */
export const buildRecap = (id: string, options: RecapOptions) =>
  req<CampaignJob>("POST", `/api/sessions/${segment(id)}/recap`, options)
