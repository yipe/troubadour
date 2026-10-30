/** A campaign: its own players' characters, notes (vault) and saved sessions. */
export interface CampaignInfo {
  id: string
  name: string
}
export interface Campaigns {
  campaign: string /* id of the open campaign */
  campaigns: CampaignInfo[]
}
