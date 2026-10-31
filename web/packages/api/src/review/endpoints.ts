import { req, segment } from "../http/index.ts"
import type { Review, ReviewAction, ReviewItem } from "./types.ts"

export const sessionReview = (id: string) => req<Review>("GET", `/api/sessions/${segment(id)}/review`)
export const reviewItem = (id: string, itemId: string, body: ReviewAction) =>
  req<ReviewItem>("POST", `/api/sessions/${segment(id)}/review/${segment(itemId)}`, body)
