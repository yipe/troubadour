import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { putJob } from "../query/cache.ts"
import { keys } from "../query/keys.ts"
import { buildRecap, sessionRecap } from "./endpoints.ts"
import type { RecapOptions } from "./types.ts"

/** The stored recap, or null. Refetch (`keys.recap(id)`) when the recap job ends. */
export function useRecap(id: string | undefined) {
  return useQuery({
    queryKey: keys.recap(id ?? ""),
    queryFn: () => sessionRecap(id!),
    enabled: !!id,
  })
}

/** Start building the recap; the job then reports through `campaign.job`. */
export function useBuildRecap(id: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (options: RecapOptions) => buildRecap(id, options),
    onSuccess: (job) => putJob(client, job),
  })
}
