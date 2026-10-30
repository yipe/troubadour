import { req, segment } from "../http/index.ts"
import type { CampaignAnswer } from "./types.ts"

/** A question → answered in the background; progress and the answer arrive as `campaign.answer`. */
export const ask = (question: string, t?: number) =>
  req<CampaignAnswer>("POST", "/api/campaign/ask", t === undefined ? { question } : { question, t })

/** Forget a past question of the open campaign. */
export const deleteAnswer = (id: string) => req<void>("DELETE", `/api/campaign/answers/${segment(id)}`)
