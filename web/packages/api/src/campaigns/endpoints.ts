import { req, segment } from "../http/index.ts"
import type { CampaignInfo, Campaigns } from "./types.ts"

export const createCampaign = (name: string) => req<CampaignInfo>("POST", "/api/campaigns", { name })

export const renameCampaign = (id: string, name: string) =>
  req<CampaignInfo>("PATCH", `/api/campaigns/${segment(id)}`, { name })

/** Switch campaigns (between sessions); the server then sends a fresh snapshot. */
export const openCampaign = (id: string) => req<Campaigns>("POST", `/api/campaigns/${segment(id)}/open`)
