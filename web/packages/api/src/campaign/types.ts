import type { CampaignAnswer } from "../ask/types.ts"

/* ---- Campaign memory (an Obsidian vault of notes) ---- */
export type EntityType = "pc" | "npc" | "place" | "faction" | "item" | "creature" | "spell" | "term"
export interface Entity {
  name: string
  type: EntityType
  aliases: string[]
  heard_as: string[] /* how speech-to-text misspells it; fixed in new transcripts */
  heard_as_suggested: string[]
  heard_as_rejected: string[]
  status: "confirmed" | "suggested"
  description: string
  facts: string[] /* may contain Obsidian links: [[Target]] or [[Target|label]] */
  suggested_facts: string[]
  path: string | null /* vault-relative, e.g. "People/Elara.md" */
  read_only: boolean
  sessions?: number /* how many played sessions mention this name; missing on older payloads */
}

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
export interface ObsidianVault {
  id: string
  folder: string
}
export interface Campaign {
  vault: string /* absolute path of the vault folder */
  obsidian: ObsidianVault | null /* null: Obsidian doesn't know the folder (not opened as a vault) */
  types: EntityType[]
  entities: Entity[]
  facts: string[] /* campaign-wide */
  jobs: CampaignJob[]
  answers: CampaignAnswer[] /* the open campaign's, oldest first */
  written_up: Record<string, string> /* session id -> vault-relative path of its session page */
  ignored: string[] /* words never suggested again (vault note "Ignored words.md") */
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
    | "facts"
    | "suggested_facts"
  >
>

export interface EntityCreate {
  name: string
  type?: EntityType
  description?: string
  aliases?: string[]
  heard_as?: string[]
}

export interface EntityReview {
  accept_spellings?: string[]
  reject_spellings?: string[]
  accept_facts?: string[]
  reject_facts?: string[]
}
