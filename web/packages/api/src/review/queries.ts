import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useCampaignWrite } from "../query/campaignWrite.ts"
import { keys } from "../query/keys.ts"
import { reviewItem, sessionReview } from "./endpoints.ts"
import type { Review, ReviewAction, ReviewItem } from "./types.ts"

/** A session's review. The list is frozen on the server, so `counts.total` stays put as items are decided. */
export function useReview(id: string | null | undefined) {
  return useQuery({
    queryKey: keys.review(id ?? ""),
    queryFn: () => sessionReview(id!),
    enabled: !!id,
  })
}

/** `item` in the review, and the counts that follow from it. */
export function withItem(review: Review, item: ReviewItem): Review {
  const items = review.items.map((i) => (i.id === item.id ? item : i))
  const decided = (kind?: string) =>
    items.filter((i) => i.status !== "open" && (!kind || i.kind === kind)).length
  return { ...review, items, counts: { ...review.counts, done: decided() } }
}

/**
 * Accept or reject one item. Runs in the serial campaign scope (the vault changes), stores the
 * returned item in the review cache and refetches the campaign. A 409 means it was already decided:
 * the review is refetched instead.
 */
export function useReviewAction(id: string) {
  const client = useQueryClient()
  return useCampaignWrite(
    ({ itemId, ...body }: { itemId: string } & ReviewAction) => reviewItem(id, itemId, body),
    {
      onSuccess: (item) => {
        client.setQueryData<Review>(keys.review(id), (review) => (review ? withItem(review, item) : review))
      },
      onError: () => void client.invalidateQueries({ queryKey: keys.review(id) }),
    },
  )
}
