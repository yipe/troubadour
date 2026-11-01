import { req, segment } from "../http/index.ts"
import type {
  Campaign,
  CampaignJob,
  CampaignSuggestions,
  Entity,
  EntityCreate,
  EntityFactCreate,
  EntityPatch,
  EntityReview,
  Fact,
  FactCreate,
  FactEdit,
  ImportRow,
  NotesSessionInput,
  NotesSplit,
} from "./types.ts"

const entityUrl = (name: string) => `/api/campaign/entities/${segment(name)}`

export const campaign = () => req<Campaign>("GET", "/api/campaign")
export const campaignSuggestions = () => req<CampaignSuggestions>("GET", "/api/campaign/suggestions")

/** One entry with its `appearances`: one row per saved session, oldest first, zero counts included. */
export const fetchEntity = (name: string) => req<Entity>("GET", entityUrl(name))
export const createEntity = (b: EntityCreate) => req<Entity>("POST", "/api/campaign/entities", b)
export const updateEntity = (name: string, b: EntityPatch) => req<Entity>("PATCH", entityUrl(name), b)
export const deleteEntity = (name: string) => req<void>("DELETE", entityUrl(name))

/** Accept/reject suggestions atomically on the server (safe to click quickly). */
export const reviewEntity = (name: string, b: EntityReview) =>
  req<Entity>("POST", `${entityUrl(name)}/review`, b)
export const mergeEntity = (name: string, into: string) =>
  req<Entity>("POST", `${entityUrl(name)}/merge`, { into })
export const addEntityFact = (name: string, b: EntityFactCreate) =>
  req<Entity>("POST", `${entityUrl(name)}/facts`, b)
export const editEntityFact = (name: string, b: FactEdit) =>
  req<Entity>("PATCH", `${entityUrl(name)}/facts`, b)
export const deleteEntityFact = (name: string, factId: string) =>
  req<Entity>("DELETE", `${entityUrl(name)}/facts/${segment(factId)}`)
export const seekFacts = (name: string) => req<CampaignJob>("POST", `${entityUrl(name)}/facts/search`)

/** Never suggest these words again; returns the full ignored list. */
export const ignoreWords = (words: string[]) => req<string[]>("POST", "/api/campaign/ignore", { words })
export const unignoreWord = (word: string) => req<string[]>("DELETE", `/api/campaign/ignore/${segment(word)}`)

/** Campaign-wide facts: each write returns the whole list. */
export const addCampaignFact = (b: FactCreate) => req<Fact[]>("POST", "/api/campaign/facts", b)
export const editCampaignFact = (b: FactEdit) => req<Fact[]>("PATCH", "/api/campaign/facts", b)
export const deleteCampaignFact = (factId: string) =>
  req<Fact[]>("DELETE", `/api/campaign/facts/${segment(factId)}`)

/** `sessions`: the parts of a split paste to add to the Timeline (by position in the preview). `background`: also read what came before the first of them. */
export const importNotes = (title: string, text: string, sessions?: ImportRow[], background?: boolean) =>
  req<CampaignJob>("POST", "/api/campaign/import", {
    title,
    text,
    ...(sessions ? { sessions, ...(background ? { background } : {}) } : {}),
  })

/** The sessions a paste splits into by its headings; empty when it has no clear ones. */
export const previewImport = (title: string, text: string) =>
  req<NotesSplit>("POST", "/api/campaign/import/preview", { title, text })

/** One session written down rather than recorded: a notes-only session on the Timeline. */
export const addNotesSession = (session: NotesSessionInput) =>
  req<CampaignJob>("POST", "/api/sessions/notes", session)

export const writeUp = (sessionId: string) =>
  req<CampaignJob>("POST", `/api/campaign/writeup/${segment(sessionId)}`)
