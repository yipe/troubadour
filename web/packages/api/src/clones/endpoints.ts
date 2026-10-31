import type { CampaignJob } from "../campaign/types.ts"
import { req, segment } from "../http/index.ts"
import type { Clones } from "./types.ts"

/** Built voice clones and every clip made with them. */
export const clones = () => req<Clones>("GET", "/api/clones")

/** (Re)build a player's voice clone from their Train recording (job "clone"). */
export const buildClone = (id: string) => req<CampaignJob>("POST", `/api/players/${segment(id)}/clone`)

/** Count how they talk from every saved transcript, plus an AI description (job "profile"). */
export const buildProfile = (id: string) => req<CampaignJob>("POST", `/api/players/${segment(id)}/profile`)

/** Speak typed text in their voice (job "say"); in_their_words: restyled like them first. */
export const cloneSay = (id: string, text: string, in_their_words = false, persona = "table") =>
  req<CampaignJob>("POST", `/api/players/${segment(id)}/clone/say`, { text, in_their_words, persona })

/** Read a session's write-up aloud in their voice (job "read"). */
export const cloneRead = (id: string, session: string, in_their_words = false, persona = "table") =>
  req<CampaignJob>("POST", `/api/players/${segment(id)}/clone/read`, { session, in_their_words, persona })

export const deleteClip = (id: string, clip: string) =>
  req<void>("DELETE", `/api/clones/${segment(id)}/clips/${segment(clip)}`)
