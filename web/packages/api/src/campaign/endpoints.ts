import { req, segment } from "../http/index.ts"
import type {
  Campaign,
  CampaignJob,
  CampaignSuggestions,
  Entity,
  EntityCreate,
  EntityPatch,
  EntityReview,
} from "./types.ts"

const entityUrl = (name: string) => `/api/campaign/entities/${segment(name)}`

export const campaign = () => req<Campaign>("GET", "/api/campaign")
export const campaignSuggestions = () => req<CampaignSuggestions>("GET", "/api/campaign/suggestions")

export const createEntity = (b: EntityCreate) => req<Entity>("POST", "/api/campaign/entities", b)
export const updateEntity = (name: string, b: EntityPatch) => req<Entity>("PATCH", entityUrl(name), b)
export const deleteEntity = (name: string) => req<void>("DELETE", entityUrl(name))

/** Accept/reject suggestions atomically on the server (safe to click quickly). */
export const reviewEntity = (name: string, b: EntityReview) =>
  req<Entity>("POST", `${entityUrl(name)}/review`, b)
export const mergeEntity = (name: string, into: string) =>
  req<Entity>("POST", `${entityUrl(name)}/merge`, { into })
export const addEntityFact = (name: string, text: string) =>
  req<Entity>("POST", `${entityUrl(name)}/facts`, { text })
export const seekFacts = (name: string) => req<CampaignJob>("POST", `${entityUrl(name)}/facts/search`)

/** Never suggest these words again; returns the full ignored list. */
export const ignoreWords = (words: string[]) => req<string[]>("POST", "/api/campaign/ignore", { words })
export const unignoreWord = (word: string) => req<string[]>("DELETE", `/api/campaign/ignore/${segment(word)}`)

export const addCampaignFact = (text: string) => req<string[]>("POST", "/api/campaign/facts", { text })
export const setCampaignFacts = (facts: string[]) => req<string[]>("PUT", "/api/campaign/facts", { facts })

export const importNotes = (title: string, text: string) =>
  req<CampaignJob>("POST", "/api/campaign/import", { title, text })

export const writeUp = (sessionId: string) =>
  req<CampaignJob>("POST", `/api/campaign/writeup/${segment(sessionId)}`)
