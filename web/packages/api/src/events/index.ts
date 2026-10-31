import type { AudioLevel, AudioQuality } from "../audio/types.ts"
import type { CampaignAnswer } from "../ask/types.ts"
import type { CampaignJob } from "../campaign/types.ts"
import type { Campaigns } from "../campaigns/types.ts"
import type { CloudStatus } from "../cloud/types.ts"
import type { Notebook } from "../notebook/types.ts"
import type { LlmProvider, LlmProviderId } from "../llm/types.ts"
import type { LibraryPlayer, Player, TrainStatus } from "../players/types.ts"
import type { Message, MessagePatch, Session, Snapshot, Voice } from "../session/types.ts"

export type ServerEvent =
  | { type: "snapshot"; data: Snapshot }
  | { type: "session.updated"; data: Session }
  | { type: "player.upserted"; data: Player }
  | { type: "player.removed"; data: { id: string } }
  | { type: "voice.upserted"; data: Voice }
  | { type: "voice.removed"; data: { id: string; merged_into: string | null } }
  | { type: "speaker.active"; data: { voice_id: string | null; confidence: number } } // null = nobody speaking; ≤ 4/s
  | { type: "message.created"; data: Message }
  // Batch; unknown ids ignored. `fixes`, when present, replaces the old list and fits the patch's
  // `text` (or the current text if the patch has none).
  | { type: "messages.updated"; data: MessagePatch[] }
  | { type: "train.status"; data: TrainStatus }
  | { type: "error"; data: { message: string } }
  | { type: "campaign.job"; data: CampaignJob }
  | { type: "campaign.answer"; data: CampaignAnswer }
  | { type: "audio.level"; data: AudioLevel } // ~10/s while a mic is open
  | { type: "audio.quality"; data: AudioQuality } // every 2 s, over the last ~15 s
  | { type: "mic.test"; data: { state: "running" | "stopped" } }
  | { type: "campaign.updated"; data: Record<string, never> } // refetch GET /api/campaign
  | { type: "campaigns.updated"; data: Campaigns } // created or renamed; switching sends a snapshot
  | { type: "library.updated"; data: LibraryPlayer[] }
  | { type: "cloud.updated"; data: CloudStatus }
  | { type: "llm.updated"; data: { provider: LlmProviderId; providers: LlmProvider[] } }
  | { type: "notebook.updated"; data: Notebook } // the whole live notebook; replaces the cached one
