import type { Schemas } from "../generated/index.ts"

/** A campaign: its own players' characters, notes (vault) and saved sessions. */
export type CampaignInfo = Schemas["CampaignInfo"]
/** The campaign list and the id of the open one. */
export type Campaigns = Schemas["CampaignsOut"]
