import { useMutation, useQueryClient } from "@tanstack/react-query"
import type { Campaign } from "../campaign/types.ts"
import { editCampaign, withAnswer, withoutAnswer } from "../query/cache.ts"
import { useCampaignWrite } from "../query/campaignWrite.ts"
import { keys } from "../query/keys.ts"
import { ask, deleteAnswer } from "./endpoints.ts"

/** Ask the campaign a question. The pending answer lands in the cache now; `campaign.answer` events finish it. */
export function useAsk() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ question, t }: { question: string; t?: number }) => ask(question, t),
    onSuccess: (answer) => editCampaign(client, withAnswer(answer)),
  })
}

/** Delete a past question: it leaves the list at once and comes back if the server refuses. */
export function useDeleteAnswer() {
  const client = useQueryClient()
  return useCampaignWrite((id: string) => deleteAnswer(id), {
    onMutate: (id) => {
      const removed = client.getQueryData<Campaign>(keys.campaign())?.answers.find((a) => a.id === id)
      editCampaign(client, withoutAnswer(id))
      return { removed }
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.removed) editCampaign(client, withAnswer(ctx.removed))
    },
    apply: (_res, id) => withoutAnswer(id),
  })
}
