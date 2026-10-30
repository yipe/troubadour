import { req, segment } from "../http/index.ts"
import type { CampaignInfo, Campaigns } from "./types.ts"

export const createCampaign = (name: string) => req<CampaignInfo>("POST", "/api/campaigns", { name })

/** Change the name, the table name (the party's name for itself; "" clears it), or both. */
export const renameCampaign = (id: string, patch: { name?: string; table_name?: string }) =>
  req<CampaignInfo>("PATCH", `/api/campaigns/${segment(id)}`, patch)

/** Switch campaigns (between sessions); the server then sends a fresh snapshot. */
export const openCampaign = (id: string) => req<Campaigns>("POST", `/api/campaigns/${segment(id)}/open`)
