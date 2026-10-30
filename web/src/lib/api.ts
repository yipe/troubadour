import type {
  Campaign,
  CampaignAnswer,
  CampaignInfo,
  CloudAccount,
  CloudStatus,
  CloudVault,
  Campaigns,
  Clones,
  CampaignJob,
  LlmModel,
  LlmProvider,
  ModelSettings,
  CampaignSuggestions,
  Entity,
  EntityType,
  Message,
  MicInfo,
  MicSpecsPatch,
  Player,
  RecordingQuality,
  SavedSession,
  Session,
  SessionRecord,
  Source,
  SourceList,
  Voice,
} from "./types"

export class ApiError extends Error {}

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`
    try {
      const j = (await res.json()) as { detail?: unknown }
      if (typeof j.detail === "string") detail = j.detail
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(detail)
  }
  if (res.status === 204 || res.status === 202) return undefined as T
  return (await res.json()) as T
}

export type PlayerPatch = Partial<
  Pick<Player, "name" | "character" | "avatar" | "is_gm" | "color" | "clone_ok">
>

export type TranscriptFormat = "md" | "json"

/** Download URL for a transcript: the current/just-finished session, or a saved one by id. */
export function transcriptUrl(format: TranscriptFormat, sessionId?: string): string {
  return sessionId
    ? `/api/sessions/${encodeURIComponent(sessionId)}/transcript.${format}`
    : `/api/transcript.${format}`
}

/** The saved session's own mic recording (only when `SavedSession.audio`). */
export function sessionAudioUrl(sessionId: string): string {
  return `/api/sessions/${encodeURIComponent(sessionId)}/audio.wav`
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

const entityUrl = (name: string) => `/api/campaign/entities/${encodeURIComponent(name)}`

export const api = {
  sessions: () => req<SavedSession[]>("GET", "/api/sessions"),
  /** Append the later saved session onto the earlier one. Returns the session that remains. */
  mergeSessions: (ids: [string, string]) => req<SavedSession>("POST", "/api/sessions/merge", { ids }),
  sessionRecord: (id: string) => req<SessionRecord>("GET", transcriptUrl("json", id)),
  /** Re-transcribe a saved session with the current glossary (background job). */
  /** Label which of each player's lines were in character (background job, kind "incharacter"). */
  estimateInCharacter: (id: string) =>
    req<CampaignJob>("POST", `/api/sessions/${encodeURIComponent(id)}/in-character`),
  improveSession: (id: string) => req<CampaignJob>("POST", `/api/sessions/${encodeURIComponent(id)}/improve`),
  /** Re-assign speakers on a saved recording. Overwrites hand-corrected speakers; the first original is kept. */
  retranscribeSession: (id: string) =>
    req<CampaignJob>("POST", `/api/sessions/${encodeURIComponent(id)}/retranscribe`),
  /** Run the spelling cleanup over a saved session (background job; no re-listening). */
  fixSpellings: (id: string) => req<CampaignJob>("POST", `/api/sessions/${encodeURIComponent(id)}/spelling`),
  /** Put an improved/spell-fixed session's original transcript back. */
  restoreSession: (id: string) => req<unknown>("POST", `/api/sessions/${encodeURIComponent(id)}/restore`),
  sources: () => req<SourceList>("GET", "/api/sources"),
  /** A saved recording's quality report (measured on first request, a few seconds). */
  sessionQuality: (id: string) =>
    req<RecordingQuality>("GET", `/api/sessions/${encodeURIComponent(id)}/quality`),
  mics: () => req<MicInfo[]>("GET", "/api/mics"),
  updateMic: (name: string, b: MicSpecsPatch) =>
    req<MicInfo>("PATCH", `/api/mics/${encodeURIComponent(name)}`, b),
  /** Open the mic for a while without a session (level + quality events, source "test"). */
  startMicTest: (device: string | null, seconds?: number) =>
    req<{ state: "running"; device: string | null; seconds: number }>(
      "POST",
      "/api/mic/test",
      seconds === undefined ? { device } : { device, seconds },
    ),
  stopMicTest: () => req<unknown>("POST", "/api/mic/test/stop"),
  /** Live session level + quality read-out on/off (off: the server skips that work). */
  setAudioMonitor: (on: boolean) => req<{ on: boolean }>("PUT", "/api/audio/monitor", { on }),
  createPlayer: (b: { name: string; character?: string; avatar?: string | null; is_gm?: boolean }) =>
    req<Player>("POST", "/api/players", b),
  updatePlayer: (id: string, b: PlayerPatch) => req<Player>("PATCH", `/api/players/${id}`, b),
  /** Delete from the library: every campaign, voiceprints and training. */
  deletePlayer: (id: string) => req<void>("DELETE", `/api/players/${id}`),
  /** A library player joins the open campaign; their voice training comes along. Unset fields:
   * their seat from before they left this campaign. */
  seatPlayer: (id: string, b: { character?: string; is_gm?: boolean } = {}) =>
    req<Player>("POST", `/api/players/${id}/seat`, b),
  /** Out of the open campaign, back to the library (training kept). Between sessions only. */
  benchPlayer: (id: string) => req<void>("POST", `/api/players/${id}/bench`),
  createCampaign: (name: string) => req<CampaignInfo>("POST", "/api/campaigns", { name }),
  renameCampaign: (id: string, name: string) =>
    req<CampaignInfo>("PATCH", `/api/campaigns/${encodeURIComponent(id)}`, { name }),
  /** Switch campaigns (between sessions); the server then sends a fresh snapshot. */
  openCampaign: (id: string) => req<Campaigns>("POST", `/api/campaigns/${encodeURIComponent(id)}/open`),
  trainPlayer: (id: string, seconds?: number) =>
    req<void>("POST", `/api/players/${id}/train`, seconds === undefined ? {} : { seconds }),
  cancelTraining: () => req<void>("POST", "/api/train/cancel"),
  /** Built voice clones and every clip made with them. */
  clones: () => req<Clones>("GET", "/api/clones"),
  /** (Re)build a player's voice clone from their Train recording (job "clone"). */
  buildClone: (id: string) => req<CampaignJob>("POST", `/api/players/${id}/clone`),
  /** Count how they talk from every saved transcript, plus an AI description (job "profile"). */
  buildProfile: (id: string) => req<CampaignJob>("POST", `/api/players/${id}/profile`),
  /** Speak typed text in their voice (job "say"); in_their_words: restyled like them first. */
  cloneSay: (id: string, text: string, in_their_words = false, persona = "table") =>
    req<CampaignJob>("POST", `/api/players/${id}/clone/say`, { text, in_their_words, persona }),
  /** Read a session's write-up aloud in their voice (job "read"). */
  cloneRead: (id: string, session: string, in_their_words = false, persona = "table") =>
    req<CampaignJob>("POST", `/api/players/${id}/clone/read`, { session, in_their_words, persona }),
  deleteClip: (id: string, clip: string) => req<void>("DELETE", `/api/clones/${id}/clips/${clip}`),
  assignVoice: (id: string, player_id: string, character?: string | null) =>
    req<{ voice: Voice; merged_into: string | null }>("POST", `/api/voices/${id}/assign`, {
      player_id,
      character,
    }),
  unassignVoice: (id: string) => req<Voice>("POST", `/api/voices/${id}/unassign`),
  /** Who spoke one line; it stays theirs. The change arrives as voice.upserted + messages.updated. */
  assignMessage: (id: string, player_id: string, character?: string | null) =>
    req<{ message: Message; voice: Voice }>("POST", `/api/messages/${encodeURIComponent(id)}/speaker`, {
      player_id,
      character,
    }),
  // Session responses are deliberately not applied to the store: WS events are the only source of truth.
  startSession: (source: Source) => req<Session>("POST", "/api/session/start", { source }),
  pauseSession: () => req<Session>("POST", "/api/session/pause"),
  resumeSession: () => req<Session>("POST", "/api/session/resume"),
  stopSession: () => req<Session>("POST", "/api/session/stop"),
  /** Probe LM Studio now. The new status arrives as session.updated. */
  recheckLlm: () => req<Session["llm"]>("POST", "/api/llm/recheck"),

  campaign: () => req<Campaign>("GET", "/api/campaign"),
  modelSettings: () => req<ModelSettings>("GET", "/api/settings/models"),
  /** Only the fields sent change; `hosted` sets one provider's pair without touching the others. */
  saveModelSettings: (
    body: Partial<
      Pick<
        ModelSettings,
        "whisper" | "whisper_improve" | "llm" | "memory" | "llm_url" | "api_key" | "provider"
      >
    > & { hosted?: Partial<ModelSettings["hosted"]> },
  ) => req<ModelSettings>("PUT", "/api/settings/models", body),
  /** What a hosted provider offers the signed-in account; `error` says why the list is empty, and
   * `price_note` stands in when the provider's list has no prices. */
  /** What a local model server offers now (the typed address, saved or not), plus models chosen before. */
  scanLocalModels: (llm_url: string, api_key: string) =>
    req<{ installed: string[]; found: number; error: string | null }>("POST", "/api/llm/local/models", {
      llm_url,
      api_key,
    }),
  llmModels: (provider: LlmProvider["id"]) =>
    req<{ models: LlmModel[]; error: string | null; price_note: string | null }>(
      "GET",
      `/api/llm/models?provider=${encodeURIComponent(provider)}`,
    ),
  /** Start a browser sign-in (ChatGPT, OpenRouter). `fresh`: ChatGPT with another account. */
  llmConnect: (provider: LlmProvider["id"], fresh = false) =>
    req<{ authorize_url: string }>("POST", `/api/llm/${provider}/connect`, { fresh }),
  llmKey: (provider: LlmProvider["id"], key: string) =>
    req<LlmProvider[]>("PUT", `/api/llm/${provider}/key`, { key }),
  /** `revoked`: false when ChatGPT couldn't confirm the sign-out (it can be disconnected in ChatGPT's settings). */
  llmDisconnect: (provider: LlmProvider["id"]) =>
    req<{ providers: LlmProvider[]; revoked: boolean }>("POST", `/api/llm/${provider}/disconnect`),
  campaignSuggestions: () => req<CampaignSuggestions>("GET", "/api/campaign/suggestions"),
  createEntity: (b: EntityCreate) => req<Entity>("POST", "/api/campaign/entities", b),
  updateEntity: (name: string, b: EntityPatch) => req<Entity>("PATCH", entityUrl(name), b),
  deleteEntity: (name: string) => req<void>("DELETE", entityUrl(name)),
  /** Accept/reject suggestions atomically on the server (safe to click quickly). */
  reviewEntity: (name: string, b: EntityReview) => req<Entity>("POST", `${entityUrl(name)}/review`, b),
  mergeEntity: (name: string, into: string) => req<Entity>("POST", `${entityUrl(name)}/merge`, { into }),
  addEntityFact: (name: string, text: string) => req<Entity>("POST", `${entityUrl(name)}/facts`, { text }),
  /** Never suggest these words again; returns the full ignored list. */
  ignoreWords: (words: string[]) => req<string[]>("POST", "/api/campaign/ignore", { words }),
  unignoreWord: (word: string) => req<string[]>("DELETE", `/api/campaign/ignore/${encodeURIComponent(word)}`),
  addCampaignFact: (text: string) => req<string[]>("POST", "/api/campaign/facts", { text }),
  setCampaignFacts: (facts: string[]) => req<string[]>("PUT", "/api/campaign/facts", { facts }),
  importNotes: (title: string, text: string) =>
    req<CampaignJob>("POST", "/api/campaign/import", { title, text }),
  /** A question → answered in the background; progress and the answer arrive as `campaign.answer`. */
  ask: (question: string) => req<CampaignAnswer>("POST", "/api/campaign/ask", { question }),
  seekFacts: (name: string) =>
    req<CampaignJob>("POST", `/api/campaign/entities/${encodeURIComponent(name)}/facts/search`),
  writeUp: (sessionId: string) =>
    req<CampaignJob>("POST", `/api/campaign/writeup/${encodeURIComponent(sessionId)}`),

  cloud: () => req<CloudStatus>("GET", "/api/cloud"),
  /** Start signing in to Troubadour Cloud: the first call that reaches the service. Open the returned page. */
  cloudConnect: () => req<{ authorize_url: string }>("POST", "/api/cloud/connect"),
  cloudDisconnect: () => req<CloudStatus>("POST", "/api/cloud/disconnect"),
  cloudOptions: (options: { include_transcripts?: boolean; auto_backup?: boolean }) =>
    req<CloudStatus>("PUT", "/api/cloud/options", options),
  /** Back up the open campaign's notes (background job, kind "backup"). */
  cloudBackup: () => req<CampaignJob>("POST", "/api/cloud/backup"),
  /** This account's campaigns in Troubadour Cloud, from any Mac. */
  cloudVaults: () => req<CloudVault[]>("GET", "/api/cloud/vaults"),
  /** Who is signed in (name, email, avatar as a data: URL); the profile fields are null for an older sign-in. */
  cloudAccount: () => req<CloudAccount>("GET", "/api/cloud/account"),
  /** Bring a backed-up campaign's newest notes back, adding the campaign if this Mac lacks it (job "restore"). */
  cloudRestore: (vault_id: string) => req<CampaignJob>("POST", "/api/cloud/restore", { vault_id }),
}
