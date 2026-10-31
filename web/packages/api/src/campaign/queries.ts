import { useQuery, useQueryClient } from "@tanstack/react-query"
import { mergeFetched } from "../query/cache.ts"
import { campaignWritesSettled } from "../query/campaignWrite.ts"
import { keys } from "../query/keys.ts"
import { campaign, campaignSuggestions, fetchEntity } from "./endpoints.ts"
import type { Campaign } from "./types.ts"

/**
 * The open campaign: notes, jobs and answers. `campaign.job` / `campaign.answer` events patch it
 * (query/bridge.ts); `campaign.updated` refetches it. A fetch waits for queued writes and keeps
 * jobs and answers that already ended, so it never undoes a newer state.
 */
export function useCampaign() {
  const client = useQueryClient()
  return useQuery({
    queryKey: keys.campaign(),
    queryFn: async (): Promise<Campaign> => {
      await campaignWritesSettled(client)
      return mergeFetched(await campaign(), client.getQueryData<Campaign>(keys.campaign()))
    },
  })
}

/**
 * One glossary entry. The note comes from the campaign (so edits show at once); `appearances` comes
 * from the single-entry GET, which sits under the campaign key so `campaign.updated` refetches it.
 */
export function useEntity(name: string | null | undefined) {
  const query = useCampaign()
  const detail = useQuery({
    queryKey: [...keys.campaign(), ...keys.entity(name ?? "")],
    queryFn: () => fetchEntity(name ?? ""),
    enabled: !!name,
  })
  const base = name ? query.data?.entities.find((e) => e.name === name) : undefined
  return {
    ...query,
    data: base && { ...base, appearances: detail.data?.appearances },
  }
}

export function useSuggestions() {
  return useQuery({ queryKey: keys.suggestions(), queryFn: campaignSuggestions })
}
