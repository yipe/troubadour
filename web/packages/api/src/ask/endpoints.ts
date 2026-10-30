import { req } from "../http/index.ts"
import type { CampaignAnswer } from "./types.ts"

/** A question → answered in the background; progress and the answer arrive as `campaign.answer`. */
export const ask = (question: string, t?: number) =>
  req<CampaignAnswer>("POST", "/api/campaign/ask", t === undefined ? { question } : { question, t })
