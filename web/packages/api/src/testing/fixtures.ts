import type { AnswerSource, CampaignAnswer } from "../ask/types.ts"
import type { AudioLevel, AudioQuality, MicInfo, QualityNumbers } from "../audio/types.ts"
import type { Campaign, CampaignJob, Entity } from "../campaign/types.ts"
import type { CampaignInfo } from "../campaigns/types.ts"
import type { CloneClip, CloneVoice, SpeechProfile } from "../clones/types.ts"
import type { CloudAccount, CloudBackup, CloudStatus, CloudVault } from "../cloud/types.ts"
import type { LlmModel, LlmProvider, ModelSettings } from "../llm/types.ts"
import type { LibraryPlayer, Player } from "../players/types.ts"
import type { Message, Session, Snapshot, Voice } from "../session/types.ts"
import type { RecordMessage, RecordingQuality, SavedSession, SessionRecord } from "../sessions/types.ts"

export function player(p: Partial<Player> & { id: string }): Player {
  return {
    name: p.id,
    character: "",
    avatar: null,
    color: "#f59e0b",
    trained: false,
    is_gm: false,
    clone_ok: false,
    ...p,
  }
}

/** The campaign fields every snapshot carries: one campaign, nobody in the library. */
export function snapshotBase(s: Partial<Pick<Snapshot, "campaign" | "campaigns" | "library">> = {}) {
  return { campaign: "main", campaigns: [{ id: "main", name: "My campaign" }], library: [], ...s }
}

export function voice(v: Partial<Voice> & { id: string }): Voice {
  return {
    label: `Voice ${v.id}`,
    status: "pending",
    player_id: null,
    character: null,
    seconds: 0,
    sample_url: null,
    suggested_player_id: null,
    suggested_score: null,
    trained: false,
    ...v,
  }
}

export function message(m: Partial<Message> & { id: string }): Message {
  return {
    voice_id: null,
    text: "",
    t_start: 0,
    t_end: 1,
    confidence: 1,
    provisional: false,
    fixes: [],
    level_db: null,
    ...m,
  }
}

export function session(s: Partial<Session> = {}): Session {
  return {
    status: "running",
    source: { kind: "mic", device: null },
    t: 0,
    llm: { url: "http://llm", model: "m", ok: true },
    asr: { model: "whisper", state: "ready" },
    training: null,
    audio_monitor: true,
    title: "",
    present_player_ids: [],
    error: null,
    ...s,
  }
}

export function savedSession(s: Partial<SavedSession> & { id: string }): SavedSession {
  return {
    started_at: 1_760_000_000,
    source: null,
    duration_s: 0,
    lines: 0,
    audio: false,
    replayable: false,
    restorable: false,
    quality: null,
    n: 1,
    merged_from: [],
    title: null,
    summary: null,
    present_player_ids: null,
    reviewed_at: null,
    talk: {},
    ...s,
  }
}

export function recordMessage(m: Partial<RecordMessage> & { id: string }): RecordMessage {
  return {
    t_start: 0,
    t_end: 1,
    speaker: "Unknown",
    player_id: null,
    character: null,
    voice_id: null,
    provisional: false,
    confidence: 1,
    text: "",
    ...m,
  }
}

export function sessionRecord(r: Partial<SessionRecord> & { id: string }): SessionRecord {
  const { id, ...rest } = r
  return {
    version: 1,
    session: { id, started_at: 1_760_000_000, source: null, duration_s: 0, lines: 0 },
    players: [],
    voices: [],
    messages: [],
    ...rest,
  }
}

export function entity(e: Partial<Entity> & { name: string }): Entity {
  return {
    type: "npc",
    aliases: [],
    heard_as: [],
    heard_as_suggested: [],
    heard_as_rejected: [],
    status: "confirmed",
    description: "",
    facts: [],
    suggested_facts: [],
    path: `People/${e.name}.md`,
    read_only: false,
    ...e,
  }
}

export function campaignJob(j: Partial<CampaignJob> & { id: string }): CampaignJob {
  return {
    kind: "import",
    title: "",
    state: "queued",
    done: 0,
    total: 0,
    message: "",
    created: [],
    updated: [],
    suggested: 0,
    note: null,
    player_id: null,
    ...j,
  }
}

export function campaign(c: Partial<Campaign> = {}): Campaign {
  return {
    vault: "/Users/me/Vault",
    obsidian: { id: "abc123", folder: "" },
    types: ["pc", "npc", "place", "faction", "item", "creature", "spell", "term"],
    entities: [],
    facts: [],
    jobs: [],
    answers: [],
    written_up: {},
    ignored: [],
    ...c,
  }
}

/** A live quality read-out (quiet speech, some rumble). */
export function audioQuality(q: Partial<AudioQuality> = {}): AudioQuality {
  return {
    source: "session",
    window_s: 15,
    speech_db: -34.2,
    noise_db: -58.6,
    snr_db: 24.4,
    rumble_pct: 31,
    clipped_pct: 0.004,
    talking: true,
    grades: { speech: "ok", noise: "ok", snr: "ok", rumble: "ok", clipping: "good" },
    hints: [
      "Speech is quiet: raise the mic gain until talking peaks around −20 to −12 dBFS.",
      "Lots of low rumble: turn on the mic's high-pass filter (80–100 Hz) and put the mic on something soft.",
    ],
    ...q,
  }
}

/** A mic as GET /api/mics describes it. */
export function mic(m: Partial<MicInfo> & { name: string }): MicInfo {
  return {
    maker: null,
    connection: "USB",
    rate: 48000,
    default: false,
    specs: { source: "unknown" },
    measured: [],
    checks: [],
    ...m,
  }
}

export function libraryPlayer(p: Partial<LibraryPlayer> & { id: string }): LibraryPlayer {
  return { name: p.id, avatar: null, color: "#f59e0b", trained: false, clone_ok: false, ...p }
}

export function campaignInfo(c: Partial<CampaignInfo> & { id: string }): CampaignInfo {
  return { name: c.id, ...c }
}

/** A full snapshot: the base campaign fields, an idle-ish session and empty lists. */
export function snapshot(s: Partial<Snapshot> = {}): Snapshot {
  return { ...snapshotBase(), session: session(), players: [], voices: [], messages: [], ...s }
}

export function answerSource(a: Partial<AnswerSource> & { id: string }): AnswerSource {
  return {
    kind: "note",
    label: "",
    session: null,
    t: null,
    path: null,
    entry: null,
    excerpt: "",
    ...a,
  }
}

export function campaignAnswer(a: Partial<CampaignAnswer> & { id: string }): CampaignAnswer {
  return {
    question: "",
    state: "done",
    answer: "",
    found: true,
    sources: [],
    message: "",
    created: 1_760_000_000,
    ...a,
  }
}

export function cloudBackup(b: Partial<CloudBackup> = {}): CloudBackup {
  return {
    at: 1_760_000_000,
    snapshot: "snap1",
    files: 0,
    bytes: 0,
    uploaded: 0,
    unchanged: false,
    skipped: [],
    quota: { used_bytes: 0, limit_bytes: 1_000_000, after_bytes: 0 },
    fingerprint: "",
    ...b,
  }
}

export function cloudStatus(c: Partial<CloudStatus> = {}): CloudStatus {
  return {
    url: "http://cloud.invalid",
    connected: false,
    campaign: "main",
    include_transcripts: false,
    auto_backup: false,
    last_backup: null,
    last_error: null,
    ...c,
  }
}

export function cloudAccount(a: Partial<CloudAccount> = {}): CloudAccount {
  return { email: null, name: null, avatar: null, ...a }
}

export function cloudVault(v: Partial<CloudVault> & { id: string }): CloudVault {
  return {
    name: v.id,
    campaign_id: v.id,
    head_snapshot: null,
    created_at: "2026-01-01T00:00:00Z",
    ...v,
  }
}

export function llmProvider(p: Partial<LlmProvider> & { id: LlmProvider["id"] }): LlmProvider {
  return {
    label: p.id,
    sign_in: false,
    manage_url: "",
    connected: false,
    account: null,
    known_account: null,
    ...p,
  }
}

export function llmModel(m: Partial<LlmModel> & { id: string }): LlmModel {
  return { name: m.id, price: null, ...m }
}

export function modelSettings(m: Partial<ModelSettings> = {}): ModelSettings {
  return {
    whisper: "whisper",
    whisper_improve: "whisper",
    llm: "local-llm",
    memory: "local-llm",
    llm_url: "http://127.0.0.1:1235/v1",
    memory_url: "",
    api_key: "",
    provider: "local",
    hosted: {
      openai: { llm: "", memory: "" },
      openrouter: { llm: "", memory: "" },
      anthropic: { llm: "", memory: "" },
      deepseek: { llm: "", memory: "" },
    },
    providers: [],
    speaker: "speaker",
    speaker_label: "speaker model",
    whisper_options: [],
    installed: [],
    ...m,
  }
}

export function audioLevel(l: Partial<AudioLevel> = {}): AudioLevel {
  return { source: "session", db: -30, peak_db: -20, clipping: false, zone: "good", ...l }
}

export function qualityNumbers(q: Partial<QualityNumbers> = {}): QualityNumbers {
  return {
    speech_db: -20,
    noise_db: -60,
    snr_db: 40,
    rumble_pct: 5,
    clipped_pct: 0,
    grades: { speech: "good", noise: "good", snr: "good", rumble: "good", clipping: "good" },
    ...q,
  }
}

export function recordingQuality(r: Partial<RecordingQuality> = {}): RecordingQuality {
  return {
    mic: null,
    overall: qualityNumbers(),
    timeline: [],
    speakers: [],
    spread_db: 0,
    verdict: { kind: "good", reasons: [] },
    ...r,
  }
}

export function cloneVoice(v: Partial<CloneVoice> & { player_id: string }): CloneVoice {
  return {
    built_at: 1_760_000_000,
    likeness: null,
    reference_s: 0,
    preview_url: "",
    clone_wpm: null,
    ...v,
  }
}

export function cloneClip(c: Partial<CloneClip> & { id: string }): CloneClip {
  return {
    player_id: "",
    kind: "say",
    title: "",
    text: "",
    source: {},
    in_their_words: false,
    seconds: 0,
    created_at: 1_760_000_000,
    url: "",
    ...c,
  }
}

export function speechProfile(p: Partial<SpeechProfile> & { player_id: string }): SpeechProfile {
  return {
    built_at: 1_760_000_000,
    sessions: 0,
    lines: 0,
    words: 0,
    wpm: null,
    words_per_line: 0,
    questions: 0,
    exclamations: 0,
    in_character: 0,
    phrases: [],
    openers: [],
    examples: [],
    description: null,
    ...p,
  }
}
