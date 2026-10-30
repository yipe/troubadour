import { useMutation, useQueryClient } from "@tanstack/react-query"
import { editCampaign, withAnswer } from "../query/cache.ts"
import { ask } from "./endpoints.ts"

/** Ask the campaign a question. The pending answer lands in the cache now; `campaign.answer` events finish it. */
export function useAsk() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ question, t }: { question: string; t?: number }) => ask(question, t),
    onSuccess: (answer) => editCampaign(client, withAnswer(answer)),
  })
}
