import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { keys } from "../query/keys.ts"
import { createCampaign, openCampaign, renameCampaign } from "./endpoints.ts"
import type { Campaigns } from "./types.ts"

/**
 * The campaign list and which one is open. Seeded by every `snapshot` and `campaigns.updated`, so
 * the fetch only matters before the socket connects. No GET exists: it is cache-only until then.
 */
export function useCampaigns() {
  return useQuery<Campaigns>({
    queryKey: keys.campaigns(),
    queryFn: () => Promise.reject(new Error("The campaign list arrives over the socket")),
    retry: false,
    staleTime: Infinity,
  })
}

/** Switch campaigns (between sessions). The snapshot that follows refreshes everything. */
export function useOpenCampaign() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => openCampaign(id),
    onSuccess: (data) => client.setQueryData(keys.campaigns(), data),
  })
}

export function useCreateCampaign() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (name: string) => createCampaign(name),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.campaigns() }),
  })
}

export function useRenameCampaign() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (v: { id: string; name: string }) => renameCampaign(v.id, v.name),
    onSuccess: (info) =>
      client.setQueryData<Campaigns>(
        keys.campaigns(),
        (c) => c && { ...c, campaigns: c.campaigns.map((x) => (x.id === info.id ? info : x)) },
      ),
  })
}
