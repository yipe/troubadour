import type { QueryClient } from "@tanstack/react-query"
import type { Campaign, CampaignJob } from "../campaign/types.ts"
import { putLlmState } from "../llm/queries.ts"
import type { Socket } from "../socket/index.ts"
import { editCampaign, jobActive, withAnswer, withJob } from "./cache.ts"
import { isLiveOnlyKey, keys } from "./keys.ts"

export const REFETCH_DEBOUNCE_MS = 300

/** Jobs that change what GET /api/clones returns once they end. */
const CLONE_JOBS: ReadonlySet<CampaignJob["kind"]> = new Set(["clone", "say", "read", "profile"])

export interface BridgeOptions {
  /**
   * Another campaign was opened (a snapshot with a different campaign id). The cache is already
   * invalidated; use this to drop UI state that points into the old campaign, such as the open
   * glossary entry.
   */
  onCampaignSwitch?: (campaignId: string) => void
}

/**
 * Feed the query cache from the socket: patch what the event carries, invalidate what it only hints
 * at. Returns the unsubscribe. (The live store is fed separately by `wireLive`.)
 */
export function bridgeSocket(socket: Socket, client: QueryClient, opts: BridgeOptions = {}): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  let campaignId: string | undefined
  let status: string | undefined

  const invalidateCampaign = () => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      void client.invalidateQueries({ queryKey: keys.campaign() })
      void client.invalidateQueries({ queryKey: keys.suggestions() })
    }, REFETCH_DEBOUNCE_MS)
  }

  /** A new saved session exists once a live one stops. */
  const sessionStatus = (next: string) => {
    const was = status
    status = next
    if (next === "idle" && (was === "running" || was === "stopping"))
      void client.invalidateQueries({ queryKey: keys.sessions() })
  }

  const offs = [
    socket.on("campaign.updated", invalidateCampaign),
    socket.on("campaign.job", (job) => {
      // Looked at before the patch: "ended just now" is a change of state, not a state.
      const before = client.getQueryData<Campaign>(keys.campaign())?.jobs.find((j) => j.id === job.id)
      editCampaign(client, withJob(job))
      if (CLONE_JOBS.has(job.kind) && !jobActive(job) && (!before || jobActive(before)))
        void client.invalidateQueries({ queryKey: keys.clones() })
    }),
    socket.on("campaign.answer", (answer) => editCampaign(client, withAnswer(answer))),
    socket.on("cloud.updated", (data) => client.setQueryData(keys.cloud(), data)),
    socket.on("llm.updated", (data) => putLlmState(client, data)),
    socket.on("campaigns.updated", (data) => client.setQueryData(keys.campaigns(), data)),
    socket.on("session.updated", (session) => sessionStatus(session.status)),
    socket.on("snapshot", (snap) => {
      client.setQueryData(keys.campaigns(), { campaign: snap.campaign, campaigns: snap.campaigns })
      sessionStatus(snap.session.status)
      const switched = campaignId !== undefined && campaignId !== snap.campaign
      campaignId = snap.campaign
      if (!switched) return
      clearTimeout(timer)
      void client.invalidateQueries({ predicate: (q) => !isLiveOnlyKey(q.queryKey) })
      opts.onCampaignSwitch?.(snap.campaign)
    }),
  ]
  return () => {
    clearTimeout(timer)
    for (const off of offs) off()
  }
}
