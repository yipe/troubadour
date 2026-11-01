import type { CampaignAnswer } from "../ask/types.ts"

import type { Schemas } from "../generated/index.ts"

/* ---- Campaign memory (an Obsidian vault of notes) ---- */
/** `appearances` is filled in only by the single-entry GET (`fetchEntity`, `useEntity`). */
export type Entity = Schemas["EntityOut"]
export type EntityType = Entity["type"]
/** Times an entry is named in one saved session's transcript. */
export type Appearance = Schemas["AppearanceOut"]
/** A fact in its note: wording, who said it, where, how sure, and older wordings (newest first). */
export type Fact = Schemas["FactOut"]
/** A fact waiting for review; `kind: "update"` says which existing fact (`replaces`, an id) it would replace. */
export type FactSuggestion = Schemas["FactSuggestionOut"]
export type FactSource = Schemas["FactSourceOut"]
export type FactVersion = Schemas["FactVersionOut"]
export type SaidBy = Schemas["SaidByOut"]
/** The generated request types mark fields with server defaults as required; a client may leave them out. */
type WithDefaults<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>

/** Body for adding a fact; `source.session_id` names a session that has a write-up page. */
export type FactCreate = WithDefaults<Schemas["FactIn"], "confidence">
export type EntityFactCreate = WithDefaults<Schemas["EntityFactIn"], "confidence" | "suggested">
/** Body for editing a fact by id. A text change fixes a typo in place unless `as_update` is true. */
export type FactEdit = WithDefaults<Schemas["FactEdit"], "as_update">

export interface CampaignJob {
  id: string
  kind:
    | "import"
    | "writeup"
    | "facts"
    | "improve"
    | "spelling"
    | "retranscribe"
    | "backup"
    | "restore"
    | "clone" /* build a player's voice clone */
    | "say" /* speak typed text in it */
    | "read" /* read a session's write-up aloud in it */
    | "profile" /* count how they talk from the transcripts */
    | "incharacter" /* label a saved session's lines in character or table talk */
    | "recap" /* C10: a session recap */
    | "refresh" /* F32: re-run a saved session's processing steps */
  title: string /* notes title; the session id for a write-up / improve / read; the player for clone / say / profile */
  state: "queued" | "running" | "done" | "error"
  done: number
  total: number
  message: string
  created: string[]
  updated: string[]
  suggested: number
  note: string | null /* vault-relative path it wrote */
  player_id: string | null /* clone / say / read / profile: whose voice */
  steps?: JobStep[] /* a job with stages (a write-up): in order */
  sessions?: string[] /* an import's notes sessions still to read, in order; the first is in progress */
  live?: JobLive | null /* the model call in flight, when it streams */
  snippets?: JobSnippet[] /* found so far: code-counted stats first, then what the model has written */
}
export interface JobSnippet {
  kind: "stat" | "beat" | "person" | "place" | "loot" | "character"
  at: string /* a beat's timestamp, else "" */
  text: string
}
export interface JobStep {
  label: string
  state: "pending" | "running" | "done"
}
/** A streaming model call: reading the prompt (no tokens yet), then thinking or writing. */
export interface JobLive {
  phase: "reading" | "thinking" | "writing"
  tokens: number /* estimated from the streamed text */
  tok_s: number
  started: number /* epoch seconds */
  fraction?: number /* 0-1, when the step can tell how far it is (notes: by session time; page: estimated) */
}
/** The campaign folder in Obsidian's vault registry: the vault's id and the folder inside it ("" = the vault). */
export type ObsidianVault = Schemas["ObsidianVaultOut"]
export type Campaign = Omit<Schemas["CampaignOut"], "jobs" | "answers"> & {
  jobs: CampaignJob[]
  answers: CampaignAnswer[] /* the open campaign's, oldest first */
}

export interface CampaignSuggestions {
  misheard: { entity: string; heard: string; count: number; example: string }[]
  unknown: { heard: string; count: number; example: string }[]
}

/** Editable fields of a glossary entry. Each list replaces the old one; `name` renames. */
export type EntityPatch = Partial<
  Pick<
    Entity,
    | "name"
    | "type"
    | "status"
    | "description"
    | "aliases"
    | "heard_as"
    | "heard_as_suggested"
    | "heard_as_rejected"
  >
>

export interface EntityCreate {
  name: string
  type?: EntityType
  description?: string
  aliases?: string[]
  heard_as?: string[]
}

/** Accept or reject by id: `accept_facts` / `reject_facts` are suggested-fact ids. */
export type EntityReview = Partial<Schemas["ReviewIn"]>

export type NotesSplit = Schemas["SplitOut"]
export type NotesSplitSession = Schemas["SplitSession"]
export type ImportRow = Schemas["ImportRow"]
export type NotesSessionInput = Schemas["NotesSessionIn"]
