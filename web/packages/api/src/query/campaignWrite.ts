import { useMutation, useQueryClient, type QueryClient, type UseMutationOptions } from "@tanstack/react-query"
import type { Campaign, Entity } from "../campaign/types.ts"
import { editCampaign, type Edit } from "./cache.ts"
import { keys } from "./keys.ts"

/** Old name -> new name for entries renamed by an earlier write, so queued writes still find them. */
const renames = new WeakMap<QueryClient, Map<string, string>>()

export interface WriteContext {
  /** The cached campaign at the moment this write runs (not when it was clicked). */
  latest: Campaign | undefined
  /** The entry called `name` now, or the one it was renamed or merged into by an earlier write. */
  entity(name: string): Entity | undefined
  /** Record that a write renamed (or merged) `from` into `to`. */
  renamed(from: string, to: string): void
}

function makeContext(client: QueryClient): WriteContext {
  const map = renames.get(client) ?? new Map<string, string>()
  renames.set(client, map)
  const latest = client.getQueryData<Campaign>(keys.campaign())
  return {
    latest,
    renamed: (from, to) => map.set(from, to),
    entity(name) {
      let n = name
      for (let hops = 0; hops < 20; hops++) {
        const e = latest?.entities.find((x) => x.name === n)
        if (e) return e
        const next = map.get(n)
        if (!next) return undefined
        n = next
      }
      return undefined
    },
  }
}

export type CampaignWriteOptions<TVars, TRes, TOnMutate> = Omit<
  UseMutationOptions<TRes, Error, TVars, TOnMutate>,
  "mutationFn" | "scope"
> & {
  /**
   * How the response changes the cached campaign, for endpoints that return the updated entity,
   * list or job. Without it the campaign is invalidated (refetched) instead.
   */
  apply?: (res: TRes, vars: TVars, ctx: WriteContext) => Edit | undefined
}

const campaignWrites = (client: QueryClient) =>
  client.getMutationCache().findAll({
    predicate: (m) => m.options.scope?.id === "campaign" && m.state.status === "pending",
  })

/**
 * Resolves once no campaign write is queued or running. The campaign query waits on this before it
 * fetches, so an older snapshot can't land between a write and the next one.
 */
export async function campaignWritesSettled(client: QueryClient): Promise<void> {
  const cache = client.getMutationCache()
  while (campaignWrites(client).length > 0) {
    await new Promise<void>((resolve) => {
      const off = cache.subscribe(() => {
        off()
        resolve()
      })
    })
  }
}

/**
 * A mutation in the shared `campaign` scope: TanStack runs these one at a time, in the order fired.
 *
 * Rule: each write is computed from the latest entry when it runs (`ctx.latest`, read from the
 * cache then, not when it was clicked); each response is applied to the cache before the next write
 * runs. List fields are replaced wholesale by the server, so a write built from stale state would
 * erase the one before it.
 *
 * `onMutate` still runs at click time (that is where optimistic updates go); `fn` runs in turn.
 * An error rejects only its own mutation; the next one starts normally.
 */
export function useCampaignWrite<TVars, TRes, TOnMutate = unknown>(
  fn: (vars: TVars, ctx: WriteContext) => Promise<TRes>,
  opts: CampaignWriteOptions<TVars, TRes, TOnMutate> = {},
) {
  const client = useQueryClient()
  const { apply, ...rest } = opts
  return useMutation<TRes, Error, TVars, TOnMutate>({
    ...rest,
    scope: { id: "campaign" },

    mutationFn: async (vars) => {
      // A fetch already in flight may hold state from before this write: drop its result.
      const interrupted = client.isFetching({ queryKey: keys.campaign() }) > 0
      await client.cancelQueries({ queryKey: keys.campaign() })
      const ctx = makeContext(client)
      const res = await fn(vars, ctx)
      const edit = apply?.(res, vars, ctx)
      if (edit) editCampaign(client, edit)
      // Not awaited: the refetch waits for the writes, this one included.
      if (!edit || interrupted) void client.invalidateQueries({ queryKey: keys.campaign() })
      return res
    },
  })
}
